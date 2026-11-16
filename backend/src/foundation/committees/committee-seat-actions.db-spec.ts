/**
 * ACC-283 PR 1 — committee seat actions, against a REAL Postgres
 * (npm run test:db). Plan: backend/Plans/step-283-change-request-chain.md §2,
 * §12 and §15.
 *
 * Only a database proves:
 *
 *   - seatValues() answers exactly what LookupService.getValues() shows (the
 *     shared row's attributes with the organisation's override over them KEY BY
 *     KEY, a hidden seat left out, the organisation's own seats as they are);
 *   - a new committee gets its organisation's defaults, the override merged,
 *     and changing a default afterwards never reaches it;
 *   - the save: committees:view or membership, the stage (Formation only), the
 *     stale check, unknown actions and seats refused, one audit row, nothing for
 *     a no-op, and the committee's updatedAt touched;
 *   - another organisation's committee, seat or rows are never read or written;
 *   - the backfill fills only committees with no rows, refuses customers, and a
 *     second run plans nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { putCommitteeInEditableStage } from '../../common/testing/committee-in-stage';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CommitteesService } from './committees.service';
import { seatValues } from './committee-seat-rules';
import { SEAT_ACTIONS, seatActionsFor } from './seat-actions';
import { runBackfill } from '../../../prisma/backfill-acc283-seat-actions';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const ALL_FIVE = ['add_member', 'remove_member', 'change_member_seat', 'request_change', 'decide_reporting_changes'];
const MEMBER_FOUR = ['add_member', 'remove_member', 'change_member_seat', 'request_change'];

describe('Committee seat actions against a real database (ACC-283)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const lookups = new LookupService(prisma, audit);
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, audit, workflow, new StageRulesService(prisma));
  let seat: Record<string, string> = {};

  interface Org {
    id: string;
    slug: string;
    actorId: string;
  }

  async function org(): Promise<Org> {
    const slug = `acc283-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Admin', status: 'ACTIVE' } });
    await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    return { id: o.id, slug, actorId: actor.id };
  }

  /** A committee made the way the app makes one, in a stage that allows a direct edit. */
  async function committee(o: Org, name = 'Quality Council'): Promise<string> {
    const c = await committees.createCommittee({ nameEn: name, typeValueId: 'type', quorumCount: 1 } as never, o.id, o.actorId);
    await putCommitteeInEditableStage(prisma, o.id, c.id);
    return c.id;
  }

  /** A committee written straight to the table, as one made before PR 1 was: no seat actions. */
  async function oldCommittee(o: Org, name = 'Old committee'): Promise<string> {
    const unit = await prisma.orgUnit.findFirstOrThrow({ where: { organizationId: o.id } });
    const c = await prisma.committee.create({ data: { organizationId: o.id, nameEn: name, typeValueId: 'type', orgUnitId: unit.id } });
    return c.id;
  }

  /** Moves the committee's instance to a stage that allows nothing (as Active allows no direct edit). */
  async function moveToLockedStage(o: Org, committeeId: string): Promise<void> {
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { organizationId: o.id, objectId: committeeId } });
    const locked = await prisma.workflowStage.create({
      data: {
        workflowTemplateId: instance.workflowTemplateId,
        nameEn: 'Active (spec)',
        order: 30,
        whoMode: 'ANY_ONE',
        flags: ['IN_FORCE'],
        recordActions: { create: [{ organizationId: o.id, actionKey: COMMITTEE_ACTIONS.REQUEST_CHANGE }] },
      },
    });
    await prisma.workflowInstance.update({ where: { id: instance.id }, data: { currentStageId: locked.id } });
  }

  const byKey = async (organizationId: string, committeeId: string): Promise<Record<string, string[]>> => {
    const keyOf = new Map((await seatValues(prisma, organizationId)).map((s) => [s.id, s.key]));
    const out: Record<string, string[]> = {};
    for (const r of await seatActionsFor(prisma, organizationId, [committeeId])) {
      (out[keyOf.get(r.roleValueId) ?? r.roleValueId] ??= []).push(r.actionKey);
    }
    for (const k of Object.keys(out)) out[k]!.sort((a, b) => ALL_FIVE.indexOf(a) - ALL_FIVE.indexOf(b));
    return out;
  };

  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => { code?: string; message?: unknown } | string }) => {
        const r = e.getResponse?.();
        if (r && typeof r === 'object') return r.code ?? String(r.message);
        return `ERROR ${String(e)}`;
      },
    );

  const loadedAt = async (o: Org, committeeId: string): Promise<string> =>
    JSON.parse(JSON.stringify(await committees.getSeatActions(committeeId, o.id, { id: o.actorId, permissions: ['committees:view'] })))
      .updatedAt as string;

  const save = (
    o: Org,
    committeeId: string,
    seats: { roleValueId: string; actions: string[] }[],
    expectedUpdatedAt: string,
    viewer: { id: string; permissions: string[] } = { id: o.actorId, permissions: ['committees:view', 'committees:edit_details'] },
  ) => outcome(committees.replaceSeatActions(committeeId, { expectedUpdatedAt, seats }, o.id, viewer.id, viewer.permissions));

  const seatAuditRows = (committeeId: string) =>
    prisma.auditLog.count({ where: { objectId: committeeId, action: 'UPDATE', objectType: 'Committee' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookups.seedSystemData();
    const values = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  // ── seatValues() and getValues() ───────────────────────────────────────────

  it('seatValues() answers exactly what getValues() shows: overrides merged key by key, hidden left out, own seats as they are', async () => {
    const o = await org();
    await lookups.overrideLabel(seat['chairman']!, o.id, { labelOverrideEn: 'President' }, o.actorId);
    await lookups.overrideAttributes(seat['chairman']!, o.id, { attributes: { seatDecidesReportingChanges: false } }, o.actorId);
    await lookups.overrideAttributes(seat['member']!, o.id, { attributes: { seatAddsMember: true } }, o.actorId);
    await lookups.hideSystemValue(seat['observer']!, o.id, o.actorId);
    await lookups.addValue('committee_member_role', o.id, { key: 'rapporteur', labelEn: 'Rapporteur', sortOrder: 70, attributes: { seatRequestsChange: true } } as never, o.actorId);

    const shape = (v: { key: string; labelEn: string; labelAr: string | null; attributes: unknown }) => ({
      key: v.key,
      labelEn: v.labelEn,
      labelAr: v.labelAr,
      attributes: v.attributes ?? {},
    });
    const ours = (await seatValues(prisma, o.id)).map(shape).sort((a, b) => a.key.localeCompare(b.key));
    const shown = (await lookups.getValues('committee_member_role', o.id)).map(shape).sort((a, b) => a.key.localeCompare(b.key));

    expect(ours).toEqual(shown);
    expect(ours.map((s) => s.key)).not.toContain('observer');
    expect(ours.find((s) => s.key === 'chairman')!.attributes).toEqual(
      expect.objectContaining({ required: true, seatAddsMember: true, seatDecidesReportingChanges: false }),
    );
  });

  // ── The copy on create ─────────────────────────────────────────────────────

  it('a new committee gets the shared defaults: Chairman all five, Secretary the four member actions, nobody else anything', async () => {
    const o = await org();
    const id = await committee(o);
    expect(await byKey(o.id, id)).toEqual({ chairman: ALL_FIVE, secretary: MEMBER_FOUR });
  });

  it("a new committee gets its organisation's defaults with the override MERGED: an untick removes, a tick adds", async () => {
    const o = await org();
    await lookups.overrideAttributes(seat['chairman']!, o.id, { attributes: { seatDecidesReportingChanges: false } }, o.actorId);
    await lookups.overrideAttributes(seat['vice_chairman']!, o.id, { attributes: { seatDecidesReportingChanges: true } }, o.actorId);

    const id = await committee(o);

    expect(await byKey(o.id, id)).toEqual({
      chairman: MEMBER_FOUR,
      vice_chairman: ['decide_reporting_changes'],
      secretary: MEMBER_FOUR,
    });
  });

  it('changing a default afterwards never reaches a committee that already exists', async () => {
    const o = await org();
    const id = await committee(o);
    await lookups.overrideAttributes(seat['secretary']!, o.id, { attributes: { seatAddsMember: false } }, o.actorId);

    expect((await byKey(o.id, id))['secretary']).toEqual(MEMBER_FOUR);
    const later = await committee(o, 'Later committee');
    expect((await byKey(o.id, later))['secretary']).toEqual(['remove_member', 'change_member_seat', 'request_change']);
  });

  it("the create's audit row names the seat actions it copied", async () => {
    const o = await org();
    const id = await committee(o);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { objectId: id, action: 'CREATE' } });
    expect(row.metadata).toEqual({ seatActions: { [seat['chairman']!]: ALL_FIVE, [seat['secretary']!]: MEMBER_FOUR } });
  });

  // ── The read ───────────────────────────────────────────────────────────────

  it('the read lists every seat the organisation uses, in seat order, with its actions', async () => {
    const o = await org();
    const id = await committee(o);
    const read = await committees.getSeatActions(id, o.id, { id: o.actorId, permissions: ['committees:view'] });
    expect(read.actionKeys).toEqual(ALL_FIVE);
    expect(read.seats.map((s) => [s.key, s.actions])).toEqual([
      ['chairman', ALL_FIVE],
      ['vice_chairman', []],
      ['secretary', MEMBER_FOUR],
      ['member', []],
      ['observer', []],
      ['advisor', []],
    ]);
  });

  it('a member without committees:view reads it; someone else gets the 403', async () => {
    const o = await org();
    const id = await committee(o);
    const member = await prisma.user.create({ data: { organizationId: o.id, email: `${o.slug}-m@example.test`, name: 'Member', status: 'ACTIVE' } });
    await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: id, userId: member.id, roleValueId: seat['member']! } });
    const stranger = await prisma.user.create({ data: { organizationId: o.id, email: `${o.slug}-s@example.test`, name: 'Stranger', status: 'ACTIVE' } });

    expect(await outcome(committees.getSeatActions(id, o.id, { id: member.id, permissions: [] }))).toBe('OK');
    expect(await outcome(committees.getSeatActions(id, o.id, { id: stranger.id, permissions: [] }))).toMatch(/committees:view/);
  });

  // ── The save ───────────────────────────────────────────────────────────────

  it('in Formation, the save replaces the whole map, touches updatedAt and writes ONE audit row with before and after', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    const before = (await prisma.committee.findFirstOrThrow({ where: { id } })).updatedAt;

    expect(
      await save(o, id, [
        { roleValueId: seat['chairman']!, actions: ['decide_reporting_changes'] },
        { roleValueId: seat['member']!, actions: ['request_change', 'add_member'] },
      ], loaded),
    ).toBe('OK');

    expect(await byKey(o.id, id)).toEqual({ chairman: ['decide_reporting_changes'], member: ['add_member', 'request_change'] });
    expect((await prisma.committee.findFirstOrThrow({ where: { id } })).updatedAt.getTime()).toBeGreaterThan(before.getTime());
    const rows = await prisma.auditLog.findMany({ where: { objectId: id, action: 'UPDATE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toEqual({ seatActions: { [seat['chairman']!]: ALL_FIVE, [seat['secretary']!]: MEMBER_FOUR } });
    expect(rows[0]!.after).toEqual({
      seatActions: { [seat['chairman']!]: ['decide_reporting_changes'], [seat['member']!]: ['add_member', 'request_change'] },
    });
    expect(rows[0]!.metadata).toEqual({ change: 'seat_actions' });
  });

  it('a save that changes nothing writes nothing: no audit row, updatedAt unchanged', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);

    expect(
      await save(o, id, [
        { roleValueId: seat['secretary']!, actions: MEMBER_FOUR },
        { roleValueId: seat['chairman']!, actions: [...ALL_FIVE].reverse() },
      ], loaded),
    ).toBe('OK');

    expect(await seatAuditRows(id)).toBe(0);
    expect(JSON.parse(JSON.stringify((await prisma.committee.findFirstOrThrow({ where: { id } })).updatedAt))).toBe(loaded);
  });

  it('outside Formation (a stage that does not allow edit_details) the save is 409 STAGE_ACTION_NOT_ALLOWED and nothing is written', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    await moveToLockedStage(o, id);

    expect(await save(o, id, [], loaded)).toBe('STAGE_ACTION_NOT_ALLOWED');
    expect(await byKey(o.id, id)).toEqual({ chairman: ALL_FIVE, secretary: MEMBER_FOUR });
    expect(await seatAuditRows(id)).toBe(0);
  });

  it('a stale save (the committee changed since it was loaded) is 409 COMMITTEE_CHANGED, and so is a second save from the same load', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);

    expect(await save(o, id, [{ roleValueId: seat['chairman']!, actions: ALL_FIVE }], loaded)).toBe('OK');
    expect(await save(o, id, [{ roleValueId: seat['member']!, actions: ['add_member'] }], loaded)).toBe('COMMITTEE_CHANGED');
    expect(await byKey(o.id, id)).toEqual({ chairman: ALL_FIVE });
  });

  it('a details edit makes a seat-action save stale, and the other way round', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    await committees.updateCommittee(id, { nameEn: 'Renamed' } as never, o.id, o.actorId, ['committees:view']);
    expect(await save(o, id, [], loaded)).toBe('COMMITTEE_CHANGED');

    const again = await loadedAt(o, id);
    expect(await save(o, id, [], again)).toBe('OK');
    expect(
      await outcome(committees.updateCommittee(id, { nameEn: 'Again', expectedUpdatedAt: again } as never, o.id, o.actorId, ['committees:view'])),
    ).toBe('COMMITTEE_CHANGED');
  });

  it('an action not on the list is 400 SEAT_ACTION_UNKNOWN; a seat the organisation does not use is 400 SEAT_ACTION_SEAT_UNKNOWN', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    await lookups.hideSystemValue(seat['observer']!, o.id, o.actorId);

    expect(await save(o, id, [{ roleValueId: seat['chairman']!, actions: ['schedule_meeting'] }], loaded)).toBe('SEAT_ACTION_UNKNOWN');
    expect(await save(o, id, [{ roleValueId: 'no-such-seat', actions: [] }], loaded)).toBe('SEAT_ACTION_SEAT_UNKNOWN');
    expect(await save(o, id, [{ roleValueId: seat['observer']!, actions: ['add_member'] }], loaded)).toBe('SEAT_ACTION_SEAT_UNKNOWN');
    expect(await seatAuditRows(id)).toBe(0);
  });

  it('a member with committees:edit_details and without committees:view may save; a non-member gets the 404 a missing committee gets', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    const member = await prisma.user.create({ data: { organizationId: o.id, email: `${o.slug}-m@example.test`, name: 'Member', status: 'ACTIVE' } });
    await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: id, userId: member.id, roleValueId: seat['secretary']! } });
    const stranger = await prisma.user.create({ data: { organizationId: o.id, email: `${o.slug}-s@example.test`, name: 'Stranger', status: 'ACTIVE' } });

    expect(await save(o, id, [], loaded, { id: stranger.id, permissions: ['committees:edit_details'] })).toMatch(/Committee not found/);
    expect(await save(o, id, [], loaded, { id: member.id, permissions: ['committees:edit_details'] })).toBe('OK');
    expect(await byKey(o.id, id)).toEqual({});
  });

  it('rows of a seat the organisation no longer uses are left as they are by a save', async () => {
    const o = await org();
    const id = await committee(o);
    const loaded = await loadedAt(o, id);
    await prisma.committeeSeatAction.create({ data: { organizationId: o.id, committeeId: id, roleValueId: seat['observer']!, actionKey: 'add_member' } });
    await lookups.hideSystemValue(seat['observer']!, o.id, o.actorId);

    expect(await save(o, id, [], loaded)).toBe('OK');
    expect(await seatActionsFor(prisma, o.id, [id])).toEqual([{ committeeId: id, roleValueId: seat['observer']!, actionKey: 'add_member' }]);
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────

  itEnforcesTenantIsolation("committee seat actions — another organisation's committee is the 404 a missing one is, and nothing is written", async () => {
    const a = await org();
    const b = await org();
    const id = await committee(a);
    const loaded = await loadedAt(a, id);

    expect(await save(b, id, [], loaded)).toMatch(/Committee not found/);
    expect(await outcome(committees.getSeatActions(id, b.id, { id: b.actorId, permissions: ['committees:view'] }))).toMatch(/Committee not found/);
    expect(await byKey(a.id, id)).toEqual({ chairman: ALL_FIVE, secretary: MEMBER_FOUR });
  });

  itEnforcesTenantIsolation("committee seat actions — seatActionsFor() never returns another organisation's rows, and its seat is refused", async () => {
    const a = await org();
    const b = await org();
    const id = await committee(a);
    const loaded = await loadedAt(a, id);
    // A row filed under another organisation, pointing at this committee.
    await prisma.committeeSeatAction.create({ data: { organizationId: b.id, committeeId: id, roleValueId: seat['member']!, actionKey: 'add_member' } });
    const bSeat = await lookups.addValue('committee_member_role', b.id, { key: 'b-only', labelEn: 'B only', sortOrder: 80 } as never, b.actorId);

    expect((await seatActionsFor(prisma, a.id, [id])).map((r) => r.roleValueId)).not.toContain(seat['member']);
    expect(await seatActionsFor(prisma, a.id, [id], SEAT_ACTIONS.ADD_MEMBER)).toHaveLength(2);
    expect(await save(a, id, [{ roleValueId: bSeat.id, actions: ['add_member'] }], loaded)).toBe('SEAT_ACTION_SEAT_UNKNOWN');
  });

  // ── The backfill ───────────────────────────────────────────────────────────

  it('the backfill: a dry run writes nothing; --execute fills only committees with no rows; a second run plans nothing', async () => {
    const o = await org();
    const fixture = (slug: string) => slug === o.slug;
    const kept = await committee(o, 'Already has rows');
    const edited = await committee(o, 'Edited to nothing in Formation');
    await save(o, edited, [], await loadedAt(o, edited));
    const old1 = await oldCommittee(o, 'Old one');
    const old2 = await oldCommittee(o, 'Old two');
    // An unrelated organisation (a "customer" to the guard) is not narrowed in, so not touched.

    const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture: fixture });
    expect(dry.plans[0]!.committeeIds).toEqual([edited, old1, old2].sort());
    expect(dry.plans[0]!.rowsPerCommittee).toBe(9);
    expect(await byKey(o.id, old1)).toEqual({});

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: fixture });
    expect(run.refusedCustomers).toEqual([]);
    expect(run.changed).toEqual([{ slug: o.slug, committees: 3, rows: 27 }]);
    for (const c of [old1, old2, edited]) expect(await byKey(o.id, c)).toEqual({ chairman: ALL_FIVE, secretary: MEMBER_FOUR });
    expect(await byKey(o.id, kept)).toEqual({ chairman: ALL_FIVE, secretary: MEMBER_FOUR });
    expect(await prisma.auditLog.count({ where: { objectId: { in: [old1, old2, edited] }, metadata: { path: ['source'], equals: 'backfill-acc283-seat-actions' } } })).toBe(3);

    const again = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: fixture });
    expect(again.plans[0]!.committeeIds).toEqual([]);
    expect(again.changed).toEqual([]);
  });

  it('the backfill refuses a customer organisation and writes nothing anywhere', async () => {
    const fixtureOrg = await org();
    const customer = await org();
    const mine = await oldCommittee(fixtureOrg);
    const theirs = await oldCommittee(customer);

    const run = await runBackfill(prisma, {
      execute: true,
      organizationIds: [fixtureOrg.id, customer.id],
      isFixture: (slug) => slug === fixtureOrg.slug,
    });

    expect(run.refusedCustomers).toEqual([customer.slug]);
    expect(run.changed).toEqual([]);
    expect(await byKey(fixtureOrg.id, mine)).toEqual({});
    expect(await byKey(customer.id, theirs)).toEqual({});
  });
});
