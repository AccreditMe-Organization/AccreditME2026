/**
 * ACC-271 PR 6a — a stage with no `who` (whoMode null), against a REAL Postgres
 * (npm run test:db). The engine's old branch is gone, so such a stage is read as
 * converted with an EMPTY pool (fail closed), whatever entries it still holds:
 *
 *   - entering it flags the entry unassigned;
 *   - nobody may move the record or vote on it: STAGE_HAS_NO_ONE, whatever they
 *     hold;
 *   - nobody is offered a move;
 *   - it awaits nobody;
 *   - the sweep's batch resolves it empty (the processor flags an empty pool,
 *     pinned in sla-monitor.processor.spec).
 *
 * Each case first shows the same stage WITH a `who` working for the same
 * person, so a pass means the missing `who` refused it, not the set-up.
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
import { WorkflowService } from './workflow.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { StagePoolService } from './stage-pool.service';
import { WorkflowAwaitingService } from './workflow-awaiting.service';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { writeStartingAssignments } from './workflow-who';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
// Everything a committee's moves could ask for: the refusal must not be about permissions.
const EVERYTHING = ['committees:view', 'committees:manage', 'committees:approve', 'committees:edit_details', 'workflows:manage'];

describe('A stage with no `who`, against a real database (ACC-271 PR 6a)', () => {
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
  const pools = new StagePoolService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, pools);
  const awaiting = new WorkflowAwaitingService(prisma, pools);

  async function org() {
    const slug = `acc271w-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${slug}` } });
    const adminId = (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-admin@example.test`, name: 'Admin', status: 'ACTIVE' } })).id;
    await writeStartingAssignments(prisma, o.id, adminId, adminId);
    const stageId = async (key: string) => (await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } })).id;
    /** The stage is worked by the admin alone, Any one of them — or, with null, has no `who` (its entry stays). */
    const workedByAdmin = async (key: string, whoMode: 'ANY_ONE' | null) => {
      const id = await stageId(key);
      await prisma.workflowStageAssignee.deleteMany({ where: { stageId: id } });
      await prisma.workflowStageAssignee.create({ data: { organizationId: o.id, stageId: id, order: 1, kind: 'SPECIFIC_USER', userId: adminId } });
      await prisma.workflowStage.update({ where: { id }, data: { whoMode } });
      return id;
    };
    const committee = async () =>
      (
        await prisma.committee.create({
          data: { organizationId: o.id, nameEn: `${slug} committee ${randomUUID().slice(0, 4)}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
        })
      ).id;
    /** A committee sitting in `key`, with its open entry. */
    const committeeAt = async (key: string) => {
      const id = await committee();
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: id, status: 'IN_PROGRESS', currentStageId: await stageId(key) },
      });
      const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: await stageId(key) } });
      return { instance, entryId: entry.id };
    };
    return { id: o.id, adminId, stageId, workedByAdmin, committee, committeeAt };
  }

  const refusalCode = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { code?: string } }) => {
        const r = e.getResponse?.();
        return typeof r === 'string' ? r : (r?.code ?? `ERROR ${String(e)}`);
      },
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('nobody may move it or vote on it, nobody is offered a move, and it awaits nobody', async () => {
    const o = await org();
    const stageId = await o.workedByAdmin('terms_review', 'ANY_ONE');
    const { instance, entryId } = await o.committeeAt('terms_review');
    const approve = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: stageId, toStage: { key: 'active' } } });

    // With a `who`, the admin is offered the move and the record waits on them.
    expect((await workflow.getMovesForViewer(instance.id, o.id, EVERYTHING, o.adminId)).transitionIds).toContain(approve.id);
    expect((await awaiting.awaitingMe(o.id, o.adminId, EVERYTHING)).total).toBe(1);

    // The same stage, its entry still in place, with no `who`.
    await prisma.workflowStage.update({ where: { id: stageId }, data: { whoMode: null } });

    expect(await workflow.getMovesForViewer(instance.id, o.id, EVERYTHING, o.adminId)).toEqual({ transitionIds: [] });
    expect(await awaiting.awaitingMe(o.id, o.adminId, EVERYTHING)).toEqual({ total: 0, rows: [] });
    expect(await refusalCode(workflow.triggerTransition(instance.id, { transitionId: approve.id }, o.id, o.adminId, EVERYTHING))).toBe('STAGE_HAS_NO_ONE');
    expect(await refusalCode(workflow.submitApproval(entryId, { decision: 'APPROVED' }, o.id, o.adminId))).toBe('STAGE_HAS_NO_ONE');

    // Nothing moved and no vote was recorded.
    expect((await prisma.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } })).currentStageId).toBe(stageId);
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: entryId } })).toBe(0);

    // The sweep's batch: an empty pool, which it flags.
    const swept = await workflow.resolveStagePools(o.id, [{ key: entryId, stageId, instance }]);
    expect(swept.get(entryId)?.members).toEqual([]);
  });

  it('entering it flags the entry unassigned', async () => {
    const o = await org();
    const formation = await o.workedByAdmin('formation', 'ANY_ONE');

    // With a `who`, a committee entering Formation has someone working it.
    const worked = await workflow.startInstance('COMMITTEE', await o.committee(), o.id, o.adminId);
    expect(await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: worked.id, stageId: formation } })).toMatchObject({ isUnassigned: false });

    await prisma.workflowStage.update({ where: { id: formation }, data: { whoMode: null } });

    const unworked = await workflow.startInstance('COMMITTEE', await o.committee(), o.id, o.adminId);
    expect(await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: unworked.id, stageId: formation } })).toMatchObject({
      isUnassigned: true,
      unassignedAt: expect.any(Date),
    });
  });
});
