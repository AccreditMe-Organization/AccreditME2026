/**
 * ACC-255 PR 4b-be (G4) — the template read's live count per stage, against a
 * REAL Postgres (npm run test:db).
 *
 * The unit spec fakes the grouped count. Only a database proves:
 *
 *   1. each stage counts exactly the organisation's records standing in it:
 *      a record at a final stage counts, a cancelled instance does not;
 *   2. another organisation's instance is never counted, even one that names
 *      this organisation's template and stage (organisationId in the WHERE),
 *      and another organisation cannot read the template at all;
 *   3. the count is ONE query, whatever the number of stages and records.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TENANT_ISOLATION_GATE_STRING } from '../../common/testing/tenant-isolation';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowTemplateService } from './workflow-template.service';

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

describe('The template read counts the records in each stage (ACC-255 PR 4b-be, G4)', () => {
  const prisma = new PrismaService();
  // The read also asks for stage task summaries and due hours; neither matters here.
  const stageTasks = {
    summaryForStages: async () => new Map(),
    taskDueHours: async () => ({ LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 }),
  } as unknown as StageTaskDefinitionService;
  const templates = new WorkflowTemplateService(prisma, new AuditLogService(prisma), stageTasks);

  async function org(): Promise<{ id: string; templateId: string; stage: (key: string) => Promise<string> }> {
    const slug = `acc255g4-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const w of SEEDS) {
      for (const s of w.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
      for (const t of w.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    }
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, SEEDS);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const stage = async (key: string): Promise<string> =>
      (await prisma.workflowStage.findFirstOrThrow({ where: { key, workflowTemplateId: template.id }, select: { id: true } })).id;
    return { id: o.id, templateId: template.id, stage };
  }

  /** `n` instances standing at `stageId`, owned by `organizationId`. */
  async function instances(
    organizationId: string,
    templateId: string,
    stageId: string,
    n: number,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' = 'IN_PROGRESS',
  ): Promise<void> {
    await prisma.workflowInstance.createMany({
      data: Array.from({ length: n }, () => ({
        organizationId,
        workflowTemplateId: templateId,
        objectType: 'COMMITTEE' as const,
        objectId: randomUUID(),
        currentStageId: stageId,
        status,
      })),
    });
  }

  const countsByKey = async (organizationId: string, templateId: string): Promise<Record<string, number>> => {
    const read = await templates.getTemplateById(templateId, organizationId);
    const keys = await prisma.workflowStage.findMany({ where: { workflowTemplateId: templateId }, select: { id: true, key: true } });
    const keyOf = new Map(keys.map((k) => [k.id, k.key ?? '(none)']));
    return Object.fromEntries(read.stages!.map((s) => [keyOf.get(s.id)!, s.liveCount!]));
  };

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('counts each stage: a record at a final stage counts, a cancelled one does not, an empty stage is 0', async () => {
    const a = await org();
    await instances(a.id, a.templateId, await a.stage('active'), 3);
    await instances(a.id, a.templateId, await a.stage('formation'), 1);
    await instances(a.id, a.templateId, await a.stage('dissolved'), 2, 'COMPLETED');
    await instances(a.id, a.templateId, await a.stage('terms_review'), 4, 'CANCELLED');

    expect(await countsByKey(a.id, a.templateId)).toEqual({
      formation: 1,
      terms_review: 0,
      active: 3,
      suspended: 0,
      dissolution_pending: 0,
      dissolved: 2,
    });
  });

  it(`${TENANT_ISOLATION_GATE_STRING} — the live count never counts another organisation's instances`, async () => {
    const a = await org();
    const b = await org();
    const activeA = await a.stage('active');
    await instances(a.id, a.templateId, activeA, 2);
    // B's own records, in B's own template.
    await instances(b.id, b.templateId, await b.stage('active'), 5);
    // An instance owned by B that names A's template and stage: the
    // organisation in the WHERE is what keeps it out of A's count.
    await instances(b.id, a.templateId, activeA, 7);

    expect((await countsByKey(a.id, a.templateId))['active']).toBe(2);
    expect((await countsByKey(b.id, b.templateId))['active']).toBe(5);
    // B cannot read A's template, so it cannot see A's counts either.
    await expect(templates.getTemplateById(a.templateId, b.id)).rejects.toThrow(NotFoundException);
  });

  it('is ONE query, whatever the number of stages and records', async () => {
    const delegate = prisma.workflowInstance;
    const calls = (): number[] => ['groupBy', 'count', 'findMany', 'findFirst', 'aggregate'].map((m) => {
      const spy = (delegate as unknown as Record<string, jest.Mock>)[m];
      return spy?.mock?.calls.length ?? 0;
    });
    const spies = ['groupBy', 'count', 'findMany', 'findFirst', 'aggregate'].map((m) => jest.spyOn(delegate as never, m as never));

    const small = await org();
    await instances(small.id, small.templateId, await small.stage('active'), 1);
    spies.forEach((s) => s.mockClear());
    await templates.getTemplateById(small.templateId, small.id);
    const forSmall = calls();

    const large = await org();
    for (const key of ['formation', 'terms_review', 'active', 'suspended', 'dissolution_pending', 'dissolved']) {
      await instances(large.id, large.templateId, await large.stage(key), 40);
    }
    spies.forEach((s) => s.mockClear());
    await templates.getTemplateById(large.templateId, large.id);
    const forLarge = calls();

    spies.forEach((s) => s.mockRestore());
    // groupBy once, nothing else on workflowInstance, for 1 record or 240.
    expect(forSmall).toEqual([1, 0, 0, 0, 0]);
    expect(forLarge).toEqual(forSmall);
  });
});
