/**
 * ACC-312 — a record at its FINAL stage waits on nobody, so it is never flagged
 * unassigned, against a REAL Postgres. A final entry keeps `exitedAt` null for
 * good; once its pool empties (a withdrawn change request whose requester left),
 * it used to be flagged, and Setup health listed it.
 *
 * Three places, each with its counterpart on a non-final stage:
 *   1. the engine's entry-time check (WorkflowService.checkAndFlagUnassignedStage);
 *   2. the SLA monitor's sweep, through its one filter, SWEEP_OPEN_ENTRIES_WHERE
 *      (the processor's own spec pins that the sweep uses it);
 *   3. Setup health's "stage without an assignee" detector.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { SetupConditionDetectors } from '../setup-health/setup-condition.detectors';
import { WorkflowService } from './workflow.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { StagePoolService } from './stage-pool.service';
import { SWEEP_OPEN_ENTRIES_WHERE } from './sla-monitor.processor';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import type { WorkflowInstance, WorkflowStage } from '../../../generated/prisma/client';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;

describe('A final stage is never flagged unassigned, against a real database (ACC-312)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }), createInAppMany: async () => 0 } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, new StagePoolService(prisma));
  const detectors = new SetupConditionDetectors(prisma);

  // The engine's entry-time check, called as the engine calls it.
  const checkAndFlag = (stage: WorkflowStage, entryId: string, instance: WorkflowInstance, organizationId: string) =>
    (
      workflow as unknown as {
        checkAndFlagUnassignedStage: (s: WorkflowStage, e: string, i: WorkflowInstance, o: string) => Promise<void>;
      }
    ).checkAndFlagUnassignedStage(stage, entryId, instance, organizationId);

  interface World {
    org: string;
    final: { stage: WorkflowStage; instance: WorkflowInstance; entryId: string };
    open: { stage: WorkflowStage; instance: WorkflowInstance; entryId: string };
  }

  /**
   * One organisation; the committee template's final stage (Dissolved) and a
   * non-final one (Terms Review), each with NOBODY in its pool; one record
   * standing in each, its entry open and not yet flagged.
   */
  async function world(): Promise<World> {
    const slug = `acc312-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, org, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: org, objectType: 'COMMITTEE', isDefault: true } });
    const at = async (key: string) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      // An empty pool: the stage names nobody.
      await prisma.workflowStageAssignee.deleteMany({ where: { stageId: stage.id } });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: randomUUID(), status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
      return { stage, instance, entryId: entry.id };
    };
    const final = await at('dissolved');
    const open = await at('terms_review');
    // Non-vacuous: the fixture really has one final and one non-final stage.
    expect([final.stage.isFinal, open.stage.isFinal]).toEqual([true, false]);
    return { org, final, open };
  }

  const flagged = async (entryId: string) => (await prisma.workflowInstanceStage.findFirstOrThrow({ where: { id: entryId } })).isUnassigned;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the engine never flags a final stage whose pool is empty; a non-final one still is', async () => {
    const w = await world();
    await checkAndFlag(w.final.stage, w.final.entryId, w.final.instance, w.org);
    await checkAndFlag(w.open.stage, w.open.entryId, w.open.instance, w.org);
    expect(await flagged(w.final.entryId)).toBe(false);
    expect(await flagged(w.open.entryId)).toBe(true);
  });

  it("the sweep's filter leaves out a final stage's open entry, so it is never flagged and no pool is resolved for it", async () => {
    const w = await world();
    const scope = { workflowInstance: { organizationId: w.org } };
    const swept = await prisma.workflowInstanceStage.findMany({ where: { ...SWEEP_OPEN_ENTRIES_WHERE, ...scope }, select: { id: true } });
    expect(swept.map((e) => e.id)).toEqual([w.open.entryId]);
    // Non-vacuous: both entries are open; only the filter tells them apart.
    const open = await prisma.workflowInstanceStage.findMany({ where: { exitedAt: null, ...scope }, select: { id: true } });
    expect(open.map((e) => e.id).sort()).toEqual([w.final.entryId, w.open.entryId].sort());
  });

  it('Setup health never lists a final stage, even one flagged before this fix', async () => {
    const w = await world();
    // Both flagged, as the old engine would have left them.
    await prisma.workflowInstanceStage.updateMany({ where: { id: { in: [w.final.entryId, w.open.entryId] } }, data: { isUnassigned: true, unassignedAt: new Date() } });
    const listed = JSON.stringify(await detectors.stagesWithoutAssignee(w.org));
    expect(listed).toContain(w.open.stage.id);
    expect(listed).not.toContain(w.final.stage.id);
  });
});
