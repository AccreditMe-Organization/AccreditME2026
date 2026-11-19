/**
 * ACC-307 PR 2 — Setup health's "Committee below quorum", against a REAL
 * Postgres (npm run test:db): which committees are flagged, who counts, and the
 * reconciler opening the row when a committee falls below its quorum and
 * clearing it once the committee is back (ACC-82: the reconciler is the only
 * writer; a failed check never clears a row). Fails, never skips, without a
 * local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
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
const TYPE = 'COMMITTEE_BELOW_QUORUM' as const;
type Status = 'ACTIVE' | 'INVITED' | 'INACTIVE';

describe('Committee below quorum, against a real database (ACC-307 PR 2)', () => {
  const prisma = new PrismaService();
  const detectors = new SetupConditionDetectors(prisma);
  const reconciler = new SetupConditionReconciler(prisma, detectors);

  interface Org {
    id: string;
    /** A committee at the seeded stage `key`, with that quorum and members of these statuses. */
    committee: (key: string, quorum: number, members?: Status[], isActive?: boolean) => Promise<{ id: string; userIds: string[] }>;
  }

  async function org(): Promise<Org> {
    const slug = `acc307-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    let n = 0;
    const committee: Org['committee'] = async (key, quorum, members = [], isActive = true) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const c = await prisma.committee.create({
        data: {
          organizationId: o.id,
          nameEn: `Committee ${key} ${++n}`,
          nameAr: `لجنة ${n}`,
          typeValueId: 'type',
          orgUnitId: unit.id,
          quorumCount: quorum,
          meetingFrequency: 'MONTHLY',
          isActive,
        },
      });
      await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      const userIds: string[] = [];
      for (const status of members) {
        const u = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: 'Member', status } });
        await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId: u.id, roleValueId: 'member', isActive: true } });
        userIds.push(u.id);
      }
      return { id: c.id, userIds };
    };
    return { id: o.id, committee };
  }

  /** What the detector reports: committee id → [quorum, members]. */
  const detected = async (organizationId: string) =>
    Object.fromEntries(
      (await detectors.committeesBelowQuorum(organizationId)).map((c) => [c.objectId, [c.subject['quorum'], c.subject['members']]]),
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('flags a committee in force with fewer members than its quorum, naming both; never one at quorum or with no quorum', async () => {
    const o = await org();
    const below = await o.committee('active', 3, ['ACTIVE', 'ACTIVE']);
    const atQuorum = await o.committee('active', 2, ['ACTIVE', 'ACTIVE']);
    const noQuorum = await o.committee('active', 0);

    const rows = await detected(o.id);
    expect(rows).toEqual({ [below.id]: [3, 2] });
    expect(rows[atQuorum.id]).toBeUndefined();
    expect(rows[noQuorum.id]).toBeUndefined();
    const [row] = await detectors.committeesBelowQuorum(o.id);
    expect(row).toMatchObject({ severity: 'AT_RISK', openedAt: null, subject: { nameEn: 'Committee active 1', nameAr: 'لجنة 1' } });
  });

  it('in force only: Suspended counts; Formation, Terms Review, Dissolution Pending, Dissolved and an inactive committee do not', async () => {
    const o = await org();
    const suspended = await o.committee('suspended', 2, ['ACTIVE']);
    await o.committee('formation', 2);
    await o.committee('terms_review', 2);
    await o.committee('dissolution_pending', 2);
    await o.committee('dissolved', 2);
    await o.committee('active', 2, [], false);

    expect(await detected(o.id)).toEqual({ [suspended.id]: [2, 1] });
  });

  it('only an ACTIVE user counts: an invited or deactivated member leaves the committee below quorum', async () => {
    const o = await org();
    const c = await o.committee('active', 2, ['ACTIVE', 'INVITED', 'INACTIVE']);

    expect(await detected(o.id)).toEqual({ [c.id]: [2, 1] });
  });

  it('the reconciler opens a row when a committee falls below quorum, and clears it once it is back', async () => {
    const o = await org();
    const c = await o.committee('active', 2, ['ACTIVE', 'ACTIVE']);
    const t0 = new Date('2026-11-19T05:00:00Z');
    expect(await reconciler.reconcileType(o.id, TYPE, t0)).toMatchObject({ outcome: 'SUCCEEDED', opened: 0 });

    // One member's account is deactivated: below quorum.
    await prisma.user.update({ where: { id: c.userIds[0]! }, data: { status: 'INACTIVE' } });
    const t1 = new Date('2026-11-19T06:00:00Z');
    expect(await reconciler.reconcileType(o.id, TYPE, t1)).toMatchObject({ outcome: 'SUCCEEDED', opened: 1 });
    const open = await prisma.setupCondition.findFirstOrThrow({ where: { organizationId: o.id, type: TYPE } });
    expect(open).toMatchObject({ objectId: c.id, severity: 'AT_RISK', openedAt: t1, clearedAt: null });
    expect(open.subject).toMatchObject({ quorum: 2, members: 1 });

    // A new member is added: back at quorum, so the next run clears it.
    const u = await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: 'New', status: 'ACTIVE' } });
    await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId: u.id, roleValueId: 'member', isActive: true } });
    const t2 = new Date('2026-11-19T07:00:00Z');
    await reconciler.reconcileType(o.id, TYPE, t2);
    const closed = await prisma.setupCondition.findFirstOrThrow({ where: { id: open.id } });
    expect(closed.clearedAt).toEqual(t2);
    expect(closed.openedAt).toEqual(t1);
  });

  it('a failed check never clears an open row (ACC-82)', async () => {
    const o = await org();
    const c = await o.committee('active', 2, ['ACTIVE']);
    await reconciler.reconcileType(o.id, TYPE, new Date('2026-11-19T05:00:00Z'));
    const spy = jest.spyOn(detectors, 'committeesBelowQuorum').mockRejectedValue(new Error('the check failed'));
    try {
      expect(await reconciler.reconcileType(o.id, TYPE, new Date('2026-11-19T06:00:00Z'))).toMatchObject({ outcome: 'FAILED' });
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.setupCondition.findFirstOrThrow({ where: { organizationId: o.id, type: TYPE, objectId: c.id } });
    expect(row.clearedAt).toBeNull();
  });

  itEnforcesTenantIsolation("committees below quorum — another organisation's committees never reach these rows", async () => {
    const mine = await org();
    const theirs = await org();
    const myCommittee = await mine.committee('active', 2);
    const theirCommittee = await theirs.committee('active', 2);

    expect(Object.keys(await detected(mine.id))).toEqual([myCommittee.id]);
    expect(Object.keys(await detected(theirs.id))).toEqual([theirCommittee.id]);

    await reconciler.reconcileType(mine.id, TYPE, new Date('2026-11-19T05:00:00Z'));
    const rows = await prisma.setupCondition.findMany({ where: { type: TYPE, objectId: { in: [myCommittee.id, theirCommittee.id] } } });
    expect(rows.map((r) => [r.organizationId, r.objectId])).toEqual([[mine.id, myCommittee.id]]);
  });
});
