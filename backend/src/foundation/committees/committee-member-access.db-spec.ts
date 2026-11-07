/**
 * ACC-281 — who may read and write a committee, against a REAL Postgres
 * (npm run test:db).
 *
 * The rule (Ahmad, 7 Nov):
 *
 *   - committees:view sees every committee (oversight), and writes with each
 *     action's own permission;
 *   - an ACTIVE member of an ACTIVE committee sees all of THAT committee's details
 *     without committees:view, and writes on it with each action's own permission;
 *   - anyone else sees none.
 *
 * Every read and write below is asked by four callers: an active member, a former
 * member (leftAt set), a non-member, and a committees:view holder. None of the
 * first three holds committees:view, and the writers hold the action's own key,
 * so the only thing that differs between them is membership.
 *
 * The refusals:
 *
 *   - a READ refused is today's 403 "Required permission: committees:view"
 *     (Ahmad, Q1), identical for a real committee and an invented id;
 *   - a WRITE refused is the 404 a missing committee gets.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { CommitteeViewer } from '../../common/services/committee-membership';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { putCommitteeInEditableStage } from '../../common/testing/committee-in-stage';
import { LookupService } from '../lookup/lookup.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const VIEW = 'committees:view';
const WRITE_KEYS = ['committees:edit_details', 'committees:add_member', 'committees:remove_member', 'committees:change_member_role'];
const READ_REFUSED = 'Required permission: committees:view';
const WRITE_REFUSED = 'Committee not found';

describe('Committee access for members, against a real database (ACC-281)', () => {
  const prisma = new PrismaService();
  const workflow = { startInstance: async () => undefined } as unknown as WorkflowService;
  const committees = new CommitteesService(prisma, new AuditLogService(prisma), workflow, new StageRulesService(prisma));
  const lookups = { getValues: async () => [{ id: 'seat-member', labelEn: 'Member', labelAr: null }] } as unknown as LookupService;
  const lists = new CommitteeListsService(prisma, lookups);
  const visibility = new ObjectVisibilityService(prisma);

  interface World {
    org: string;
    committee: string;
    child: string;
    parent: string;
    member: CommitteeViewer;
    former: CommitteeViewer;
    stranger: CommitteeViewer;
    oversight: CommitteeViewer;
    spare: string;
  }

  async function world(): Promise<World> {
    const slug = `acc281-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Root', code: `R-${slug}` } })).id;
    const user = async (name: string) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    const make = async (nameEn: string, extra: { parentCommitteeId?: string; reportingToCommitteeId?: string } = {}) => {
      const id = (await prisma.committee.create({ data: { organizationId: org, nameEn, typeValueId: 'type', orgUnitId: unit, ...extra } })).id;
      await putCommitteeInEditableStage(prisma, org, id);
      return id;
    };
    const parent = await make('Board');
    const committee = await make('Quality Council', { parentCommitteeId: parent, reportingToCommitteeId: parent });
    const child = await make('Hand Hygiene', { parentCommitteeId: committee });
    const ids = { member: await user('Member'), former: await user('Former'), stranger: await user('Stranger'), oversight: await user('Oversight'), spare: await user('Spare') };
    await prisma.committeeMember.create({ data: { organizationId: org, committeeId: committee, userId: ids.member, roleValueId: 'seat-member' } });
    await prisma.committeeMember.create({
      data: { organizationId: org, committeeId: committee, userId: ids.former, roleValueId: 'seat-member', isActive: false, leftAt: new Date() },
    });
    return {
      org,
      committee,
      child,
      parent,
      member: { id: ids.member, permissions: WRITE_KEYS },
      former: { id: ids.former, permissions: WRITE_KEYS },
      stranger: { id: ids.stranger, permissions: WRITE_KEYS },
      oversight: { id: ids.oversight, permissions: [VIEW, ...WRITE_KEYS] },
      spare: ids.spare,
    };
  }

  /** 'OK', or the refusal's message. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { message?: string | string[]; code?: string } }) => {
        const r = e.getResponse?.();
        if (typeof r === 'string') return r;
        return (r?.code as string) ?? (Array.isArray(r?.message) ? r.message.join('; ') : r?.message) ?? `ERROR ${String(e)}`;
      },
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('every read, four callers', () => {
    const reads: [string, (w: World, v: CommitteeViewer, id: string) => Promise<unknown>][] = [
      ['GET /committees/:id', (w, v, id) => committees.getCommitteeDetail(id, w.org, v)],
      ['GET /committees/:id/members', (w, v, id) => committees.listMembers(id, w.org, v)],
      ['GET /committees/:id/members/page', (w, v, id) => lists.members(id, {}, w.org, v)],
      ['GET /committees/:id/sub-committees', (w, v, id) => lists.subCommittees(id, {}, w.org, v)],
      ['GET /committees/:id/membership-events', (w, v, id) => lists.membershipEvents(id, w.org, v)],
      ['the record panel parent check', (w, v, id) => visibility.assertCanView('COMMITTEE', id, w.org, v.permissions, v.id)],
    ];

    it.each(reads)('%s: a member and a view holder are admitted; a former member and a stranger get the identical 403', async (_name, read) => {
      const w = await world();
      expect(await outcome(read(w, w.member, w.committee))).toBe('OK');
      expect(await outcome(read(w, w.oversight, w.committee))).toBe('OK');
      expect(await outcome(read(w, w.former, w.committee))).toBe(READ_REFUSED);
      expect(await outcome(read(w, w.stranger, w.committee))).toBe(READ_REFUSED);
      // Real versus invented: the same answer, so a refusal reveals nothing.
      expect(await outcome(read(w, w.stranger, randomUUID()))).toBe(READ_REFUSED);
    });

    it('a member is admitted to THEIR committee only, not to its parent or its children', async () => {
      const w = await world();
      expect(await outcome(committees.getCommitteeDetail(w.parent, w.org, w.member))).toBe(READ_REFUSED);
      expect(await outcome(committees.getCommitteeDetail(w.child, w.org, w.member))).toBe(READ_REFUSED);
    });

    it('the record names its parent and Reports to; each opens only for a viewer who may see it', async () => {
      const w = await world();
      const asMember = await committees.getCommitteeDetail(w.committee, w.org, w.member);
      expect(asMember.parent).toEqual({ id: w.parent, nameEn: 'Board', nameAr: null, mayOpen: false });
      expect(asMember.reportsTo).toEqual({ id: w.parent, nameEn: 'Board', nameAr: null, mayOpen: false });
      const asOversight = await committees.getCommitteeDetail(w.committee, w.org, w.oversight);
      expect(asOversight.parent?.mayOpen).toBe(true);
      // A member of the parent too may open it.
      await prisma.committeeMember.create({ data: { organizationId: w.org, committeeId: w.parent, userId: w.member.id, roleValueId: 'seat-member' } });
      expect((await committees.getCommitteeDetail(w.committee, w.org, w.member)).parent?.mayOpen).toBe(true);
    });

    it('Membership history is named by the read: who, the seat and who approved, with no users or lookups read', async () => {
      const w = await world();
      await prisma.committeeMembershipEvent.create({
        data: {
          organizationId: w.org,
          committeeId: w.committee,
          userId: w.member.id,
          roleValueId: 'seat-member',
          action: 'JOINED',
          effectiveDate: new Date(),
          approvedBy: w.oversight.id,
        },
      });
      const [row] = await lists.membershipEvents(w.committee, w.org, w.member);
      expect(row).toEqual(expect.objectContaining({ userName: 'Member', approvedByName: 'Oversight', roleLabelEn: 'Member', roleLabelAr: null }));
    });

    it('sub-committees are listed for a member, each opening only where they may see it', async () => {
      const w = await world();
      const page = await lists.subCommittees(w.committee, {}, w.org, w.member);
      expect(page.items.map((r) => [r.id, r.mayOpen])).toEqual([[w.child, false]]);
      expect((await lists.subCommittees(w.committee, {}, w.org, w.oversight)).items[0]!.mayOpen).toBe(true);
    });

    it('GET /committees: every committee for a view holder; a member their own active committees; a stranger or a former member none', async () => {
      const w = await world();
      expect((await committees.listCommittees(w.org, w.oversight)).map((c) => c.id).sort()).toEqual([w.parent, w.committee, w.child].sort());
      expect((await committees.listCommittees(w.org, w.member)).map((c) => c.id)).toEqual([w.committee]);
      expect(await committees.listCommittees(w.org, w.former)).toEqual([]);
      expect(await committees.listCommittees(w.org, w.stranger)).toEqual([]);
      // An inactive committee is no one's "own" committee.
      await prisma.committee.update({ where: { id: w.committee }, data: { isActive: false } });
      expect(await committees.listCommittees(w.org, w.member)).toEqual([]);
      expect(await outcome(committees.getCommitteeDetail(w.committee, w.org, w.member))).toBe(READ_REFUSED);
    });
  });

  describe('every write, four callers: the action\'s own key AND (view OR member of THIS committee)', () => {
    it('edit details', async () => {
      const w = await world();
      const edit = (v: CommitteeViewer, id = w.committee) => committees.updateCommittee(id, { purpose: `by ${v.id}` }, w.org, v.id, v.permissions);
      expect(await outcome(edit(w.member))).toBe('OK');
      expect(await outcome(edit(w.oversight))).toBe('OK');
      expect(await outcome(edit(w.former))).toBe(WRITE_REFUSED);
      expect(await outcome(edit(w.stranger))).toBe(WRITE_REFUSED);
      // Identical to a committee that does not exist, for every refused caller.
      expect(await outcome(edit(w.stranger, randomUUID()))).toBe(WRITE_REFUSED);
      expect(await outcome(edit(w.oversight, randomUUID()))).toBe(WRITE_REFUSED);
      // A member writes only on THEIR committee.
      expect(await outcome(edit(w.member, w.parent))).toBe(WRITE_REFUSED);
    });

    it('add, change the seat of, and remove a member', async () => {
      const w = await world();
      const add = (v: CommitteeViewer) =>
        committees.addMember(w.committee, { userId: w.spare, roleValueId: 'seat-member' }, w.org, v.id, v.permissions);
      expect(await outcome(add(w.former))).toBe(WRITE_REFUSED);
      expect(await outcome(add(w.stranger))).toBe(WRITE_REFUSED);
      expect(await outcome(add(w.member))).toBe('OK');
      const added = await prisma.committeeMember.findFirstOrThrow({ where: { committeeId: w.committee, userId: w.spare } });

      const seat = (v: CommitteeViewer) => committees.changeMemberRole(w.committee, added.id, { roleValueId: 'seat-chair' }, w.org, v.id, v.permissions);
      expect(await outcome(seat(w.former))).toBe(WRITE_REFUSED);
      expect(await outcome(seat(w.stranger))).toBe(WRITE_REFUSED);
      expect(await outcome(seat(w.member))).toBe('OK');
      expect(await outcome(seat(w.oversight))).toBe('OK');

      const remove = (v: CommitteeViewer) => committees.removeMember(w.committee, added.id, {}, w.org, v.id, v.permissions);
      expect(await outcome(remove(w.former))).toBe(WRITE_REFUSED);
      expect(await outcome(remove(w.stranger))).toBe(WRITE_REFUSED);
      expect(await outcome(remove(w.member))).toBe('OK');
    });

    it('a member who left loses write access at once: the check is live', async () => {
      const w = await world();
      await prisma.committeeMember.updateMany({ where: { committeeId: w.committee, userId: w.member.id }, data: { isActive: false, leftAt: new Date() } });
      expect(await outcome(committees.updateCommittee(w.committee, { purpose: 'late' }, w.org, w.member.id, w.member.permissions))).toBe(WRITE_REFUSED);
    });

    it('the stage rules still apply on top: a member is refused where the stage forbids the action', async () => {
      const w = await world();
      await prisma.workflowStageRecordAction.deleteMany({ where: { organizationId: w.org, actionKey: 'edit_details' } });
      expect(await outcome(committees.updateCommittee(w.committee, { purpose: 'x' }, w.org, w.member.id, w.member.permissions))).toBe('STAGE_ACTION_NOT_ALLOWED');
    });
  });

  itEnforcesTenantIsolation('committee member access across organisations', async () => {
    const a = await world();
    const b = await world();
    // A member of b's committee is no member of a's, even holding the same keys.
    const bMember = { id: b.member.id, permissions: b.member.permissions };
    expect(await outcome(committees.getCommitteeDetail(a.committee, a.org, bMember))).toBe(READ_REFUSED);
    expect(await outcome(committees.updateCommittee(a.committee, { purpose: 'x' }, a.org, bMember.id, bMember.permissions))).toBe(WRITE_REFUSED);
    expect(await committees.listCommittees(a.org, bMember)).toEqual([]);
    // And b's committee read inside a's organisation is refused for b's own member.
    expect(await outcome(committees.getCommitteeDetail(b.committee, a.org, bMember))).toBe(READ_REFUSED);
  });
});
