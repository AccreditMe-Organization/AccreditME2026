/**
 * ACC-255 PR 2 — backfill:acc255-dissolved-membership against a REAL Postgres
 * (npm run test:db).
 *
 * It must: on each committee template's Dissolved stage that still holds
 * exactly PR 1's three member actions, remove them, with one audit row per
 * organisation; leave a Dissolved stage a tenant configured otherwise, every
 * other stage, and every other organisation alone; never plan the platform
 * organisation; refuse a customer; and plan nothing on a second run.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { MEMBER_ACTIONS, planBackfill, runBackfill, SCRIPT_NAME } from '../../../prisma/backfill-acc255-dissolved-membership';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const SEEDS = SYSTEM_WORKFLOW_SEED.filter((w) => w.objectType === 'COMMITTEE');

describe('backfill:acc255-dissolved-membership, on a real database (ACC-255 PR 2)', () => {
  const prisma = new PrismaService();
  const isFixture = () => true;

  /** An organisation as it stood after PR 1: Dissolved still allowed the three member actions. */
  async function org(isPlatformOrg = false) {
    const slug = `acc255d-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA', isPlatformOrg } })).id;
    const roleKeys = new Set<string>();
    for (const w of SEEDS) {
      for (const s of w.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
      for (const t of w.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    }
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, id, SEEDS);
    const dissolved = await stage(id, 'dissolved');
    await prisma.workflowStageRecordAction.createMany({
      data: MEMBER_ACTIONS.map((actionKey) => ({ organizationId: id, stageId: dissolved, actionKey })),
    });
    return { id, slug, dissolved };
  }

  async function stage(organizationId: string, key: string): Promise<string> {
    return (
      await prisma.workflowStage.findFirstOrThrow({
        where: { key, workflowTemplate: { organizationId, objectType: 'COMMITTEE', isDefault: true } },
        select: { id: true },
      })
    ).id;
  }

  async function actionsOf(stageId: string): Promise<string[]> {
    return (await prisma.workflowStageRecordAction.findMany({ where: { stageId }, select: { actionKey: true } })).map((r) => r.actionKey).sort();
  }

  const audits = (organizationId: string) =>
    prisma.auditLog.findMany({ where: { organizationId, metadata: { path: ['source'], equals: SCRIPT_NAME } } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("dry run plans the Dissolved stage; execute removes its member actions with one audit row; a second dry run plans 0", async () => {
    const o = await org();
    const pending = await stage(o.id, 'dissolution_pending');
    const pendingBefore = await actionsOf(pending);

    const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture });
    expect(dry.plans[0]!.toChange.map((s) => s.stageId)).toEqual([o.dissolved]);
    expect(await actionsOf(o.dissolved)).toEqual([...MEMBER_ACTIONS].sort());
    expect(await audits(o.id)).toHaveLength(0);

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture });
    expect(run.changed).toEqual([{ slug: o.slug, stages: 1 }]);
    expect(await actionsOf(o.dissolved)).toEqual([]);
    // Dissolution Pending keeps them, and the flags are untouched.
    expect(await actionsOf(pending)).toEqual(pendingBefore);
    expect((await prisma.workflowStage.findUniqueOrThrow({ where: { id: o.dissolved } })).flags).toEqual(['DISSOLVING']);

    const rows = await audits(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: null, action: 'UPDATE', objectType: 'WorkflowTemplate' });
    expect(rows[0]!.metadata).toMatchObject({ ticket: 'ACC-255', removed: [...MEMBER_ACTIONS], stagesChanged: 1 });

    const again = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture });
    expect(again.plans[0]!.toChange).toEqual([]);
  });

  it('leaves a Dissolved stage a tenant configured otherwise, and reports it', async () => {
    const o = await org();
    await prisma.workflowStageRecordAction.deleteMany({ where: { stageId: o.dissolved, actionKey: 'remove_member' } });

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture });

    expect(run.plans[0]!.toChange).toEqual([]);
    expect(run.plans[0]!.skipped.map((s) => s.stageId)).toEqual([o.dissolved]);
    expect(await actionsOf(o.dissolved)).toEqual(['add_member', 'change_member_role']);
    expect(await audits(o.id)).toHaveLength(0);
  });

  it("should NOT return records belonging to a different tenant — one organisation's run leaves another's stages alone", async () => {
    const a = await org();
    const b = await org();
    await runBackfill(prisma, { execute: true, organizationIds: [a.id], isFixture });
    expect(await actionsOf(a.dissolved)).toEqual([]);
    expect(await actionsOf(b.dissolved)).toEqual([...MEMBER_ACTIONS].sort());
    expect(await audits(b.id)).toHaveLength(0);
  });

  it('never plans the platform organisation', async () => {
    const p = await org(true);
    expect(await planBackfill(prisma, [p.id], isFixture)).toEqual([]);
  });

  it('refuses a customer organisation and writes nothing', async () => {
    const o = await org();
    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: () => false });
    expect(run.refusedCustomers).toEqual([o.slug]);
    expect(await actionsOf(o.dissolved)).toEqual([...MEMBER_ACTIONS].sort());
    expect(await audits(o.id)).toHaveLength(0);
  });
});
