/**
 * ACC-286 PR 2 — "Committee missing a required seat", detected against a REAL
 * Postgres (npm run test:db).
 *
 * Only a database proves:
 *
 *   - "in force" is rules 3 and 4's test, read from the stage's IN_FORCE flag
 *     and the committee being active (Ahmad, 15 Nov, Q-A): Active and SUSPENDED
 *     count; Formation, Terms Review, Dissolution Pending and an inactive
 *     committee do not;
 *   - a seat is filled only by an active membership of an ACTIVE user, and the
 *     organisation's own setting (an unticked seat) is honoured;
 *   - the reconciler opens one row per committee, aged "first detected" (Q-B),
 *     and clears it on the next run once the seat is filled;
 *   - another organisation's committees never reach this organisation's rows.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { SetupConditionDetectors } from '../setup-health/setup-condition.detectors';
import { SetupConditionReconciler } from '../setup-health/setup-condition.reconciler';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const TYPE = 'COMMITTEE_MISSING_REQUIRED_SEAT' as const;
type Status = 'ACTIVE' | 'INVITED' | 'INACTIVE';

describe('Committee missing a required seat, against a real database (ACC-286 PR 2)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const lookups = new LookupService(prisma, audit);
  const detectors = new SetupConditionDetectors(prisma);
  const reconciler = new SetupConditionReconciler(prisma, detectors);
  let seat: Record<string, string> = {};

  interface Org {
    id: string;
    actorId: string;
    /** A committee at the seeded stage `key`, holding `seats` (seat key → user status). */
    committee: (key: string, seats?: [string, Status][], isActive?: boolean) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc286d-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    const actor = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-a@example.test`, name: 'Admin', status: 'ACTIVE' } });
    let n = 0;
    const committee = async (key: string, seats: [string, Status][] = [], isActive = true) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const c = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: `Committee ${key} ${++n}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY', isActive },
      });
      await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      for (const [seatKey, status] of seats) {
        const u = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: seatKey, status } });
        await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId: u.id, roleValueId: seat[seatKey]!, isActive: true } });
      }
      return c.id;
    };
    return { id: o.id, actorId: actor.id, committee };
  }

  const detected = async (organizationId: string) =>
    Object.fromEntries(
      (await detectors.committeesMissingRequiredSeat(organizationId)).map((c) => [
        c.objectId,
        (c.subject['seats'] as { id: string }[]).map((s) => Object.entries(seat).find(([, id]) => id === s.id)?.[0]),
      ]),
    );

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

  it('a committee in force with empty required seats opens a row naming them, in seat order', async () => {
    const o = await org();
    const empty = await o.committee('active');
    const half = await o.committee('active', [['chairman', 'ACTIVE'], ['member', 'ACTIVE']]);
    const full = await o.committee('active', [['chairman', 'ACTIVE'], ['secretary', 'ACTIVE']]);

    const rows = await detected(o.id);
    expect(rows).toEqual({ [empty]: ['chairman', 'secretary'], [half]: ['secretary'] });
    expect(rows[full]).toBeUndefined();
  });

  it('SUSPENDED counts as in force (Q-A); Formation, Terms Review, Dissolution Pending and an inactive committee do not', async () => {
    const o = await org();
    const suspended = await o.committee('suspended', [['secretary', 'ACTIVE']]);
    await o.committee('formation');
    await o.committee('terms_review');
    await o.committee('dissolution_pending');
    await o.committee('active', [], false);

    expect(await detected(o.id)).toEqual({ [suspended]: ['chairman'] });
  });

  it('only an ACTIVE user fills a seat: an invited or deactivated Chairman leaves it empty', async () => {
    const o = await org();
    const invited = await o.committee('active', [['chairman', 'INVITED'], ['secretary', 'ACTIVE']]);
    const departed = await o.committee('active', [['chairman', 'INACTIVE'], ['secretary', 'ACTIVE']]);

    expect(await detected(o.id)).toEqual({ [invited]: ['chairman'], [departed]: ['chairman'] });
  });

  it("an organisation's own setting is honoured: an unticked seat is not required", async () => {
    const o = await org();
    await lookups.overrideAttributes(seat['secretary']!, o.id, { attributes: { required: false } }, o.actorId);
    const noSecretary = await o.committee('active', [['chairman', 'ACTIVE']]);
    const neither = await o.committee('active');

    expect(await detected(o.id)).toEqual({ [neither]: ['chairman'] });
    expect((await detected(o.id))[noSecretary]).toBeUndefined();
  });

  it('the reconciler opens one row, aged first detected, and clears it on the next run once the seat is filled', async () => {
    const o = await org();
    const id = await o.committee('active', [['secretary', 'ACTIVE']]);
    const t1 = new Date('2026-11-15T05:00:00Z');

    const first = await reconciler.reconcileType(o.id, TYPE, t1);
    expect(first).toMatchObject({ outcome: 'SUCCEEDED', opened: 1 });
    const open = await prisma.setupCondition.findFirstOrThrow({ where: { organizationId: o.id, type: TYPE } });
    expect(open).toMatchObject({ objectId: id, severity: 'AT_RISK', openedAt: t1, clearedAt: null });

    const chairman = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: 'Chair', status: 'ACTIVE' } });
    await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: id, userId: chairman.id, roleValueId: seat['chairman']!, isActive: true } });
    const t2 = new Date('2026-11-15T06:00:00Z');
    await reconciler.reconcileType(o.id, TYPE, t2);

    const closed = await prisma.setupCondition.findFirstOrThrow({ where: { id: open.id } });
    expect(closed.clearedAt).toEqual(t2);
    expect(closed.openedAt).toEqual(t1);
  });

  itEnforcesTenantIsolation("committees missing a required seat — another organisation's committees never reach these rows", async () => {
    const mine = await org();
    const theirs = await org();
    const myCommittee = await mine.committee('active');
    const theirCommittee = await theirs.committee('active');

    expect(Object.keys(await detected(mine.id))).toEqual([myCommittee]);
    expect(Object.keys(await detected(theirs.id))).toEqual([theirCommittee]);

    await reconciler.reconcileType(mine.id, TYPE, new Date('2026-11-15T05:00:00Z'));
    const rows = await prisma.setupCondition.findMany({ where: { type: TYPE, objectId: { in: [myCommittee, theirCommittee] } } });
    expect(rows.map((r) => [r.organizationId, r.objectId])).toEqual([[mine.id, myCommittee]]);
  });
});
