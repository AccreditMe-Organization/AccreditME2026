/**
 * ACC-271 PR 4 (plan §7) — the closed-task notices, against a REAL Postgres
 * (npm run test:db).
 *
 * Only a database proves:
 *
 *   - a send-back tells everyone still on the stage's task, naming and linking
 *     the committee only for someone who may open it, and never the actor;
 *   - a stage change that fails inside its transaction tells nobody: the
 *     notices are written after the commit, and a rolled-back move never gets
 *     there (the closed task is still open);
 *   - a completion tells the other assignees with the 4th wording, and not
 *     someone already off the task;
 *   - nobody in another organisation is ever told.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskSlaService } from './task-sla.service';
import { TaskClosedNoticeService } from './task-closed-notice.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;

describe('Closed-task notices, against a real database (ACC-271 PR 4)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  // Real notifications: what a person reads is the row this writes.
  const notifications = new NotificationService(prisma, audit, { add: async () => undefined } as never);
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const roles = { getUserPermissions: async () => [] } as unknown as RoleService;
  const organizations = { resolveActingHeadForOrgUnit: async () => [], refreshOrgUnitHeadVacancy: async () => undefined } as unknown as OrganizationService;
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, roles, organizations, queue, stageTasks, new StagePoolService(prisma));

  interface Org {
    id: string;
    slug: string;
    adminId: string;
    templateId: string;
    person: (name: string, viewsCommittees?: boolean) => Promise<string>;
  }

  /** An organisation with the committee workflow seeded and started on its admin, as a new one is. */
  async function org(): Promise<Org> {
    const slug = `acc271n-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const s of COMMITTEE_SEED.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
    for (const t of COMMITTEE_SEED.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const viewerRole = await prisma.role.create({ data: { organizationId: o.id, key: `VIEW-${slug}`, nameEn: 'Committee viewer' } });
    const view = await prisma.permission.upsert({
      where: { module_action: { module: 'committees', action: 'view' } },
      create: { module: 'committees', action: 'view' },
      update: {},
    });
    await prisma.rolePermission.create({ data: { roleId: viewerRole.id, permissionId: view.id } });
    let n = 0;
    const person = async (name: string, viewsCommittees = false) => {
      const u = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE' } });
      if (viewsCommittees) await prisma.userRole.create({ data: { userId: u.id, roleId: viewerRole.id } });
      return u.id;
    };
    const adminId = await person('The Admin', true);
    await writeStartingAssignments(prisma, o.id, adminId, adminId);
    return { id: o.id, slug, adminId, templateId: template.id, person };
  }

  /** A committee in terms_review with an open stage task on the entry, assigned to `assignees`. */
  async function committeeWithTask(o: Org, assignees: string[], removed: string[] = []) {
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'terms_review' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${randomUUID().slice(0, 6)}` } });
    const c = await prisma.committee.create({
      data: { organizationId: o.id, nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
    });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: o.id, workflowTemplateId: o.templateId, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
    });
    const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, actorId: o.adminId } });
    const task = await prisma.task.create({
      data: {
        organizationId: o.id,
        title: 'Check the terms',
        sourceType: 'COMMITTEE',
        sourceId: c.id,
        createdById: o.adminId,
        workflowInstanceId: instance.id,
        workflowInstanceStageId: entry.id,
        sourceStageId: stage.id,
        assignees: {
          create: [
            ...assignees.map((userId) => ({ userId, assignedById: o.adminId })),
            ...removed.map((userId) => ({ userId, assignedById: o.adminId, removedAt: new Date() })),
          ],
        },
      },
    });
    const revise = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: stage.id, toStage: { key: 'formation' } } });
    return { committeeId: c.id, instanceId: instance.id, taskId: task.id, revise };
  }

  const inbox = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('a send-back tells everyone still on the task: the record named and linked only for someone who may open it, never the actor', async () => {
    const o = await org();
    const nora = await o.person('Nora', true);
    const omar = await o.person('Omar');
    const c = await committeeWithTask(o, [o.adminId, nora, omar]);

    await workflow.triggerTransition(c.instanceId, { transitionId: c.revise.id }, o.id, o.adminId, []);

    const [toNora] = await inbox(nora);
    expect(toNora).toMatchObject({
      titleEn: 'Your task "Check the terms" is closed. Quality Committee was sent back to Formation by The Admin.',
      titleAr: 'أُغلقت مهمتك «Check the terms»: أُعيدت «لجنة الجودة» إلى «التأسيس» بقرار من The Admin.',
      channel: 'IN_APP',
      objectType: 'COMMITTEE',
      objectId: c.committeeId,
    });
    const [toOmar] = await inbox(omar);
    expect(toOmar).toMatchObject({
      titleEn: 'Your task "Check the terms" is closed. The committee was sent back to Formation by The Admin.',
      objectType: null,
      objectId: null,
    });
    // The actor gets no closed-task notice (the move's own Send notification is another matter).
    expect((await inbox(o.adminId)).filter((n) => n.titleEn.startsWith('Your task'))).toEqual([]);
  });

  it('a stage change that fails inside its transaction tells nobody, and the task stays open', async () => {
    const o = await org();
    const nora = await o.person('Nora', true);
    const c = await committeeWithTask(o, [nora]);
    // The destination creates a task, and creating it fails — after the old
    // entry's task was cancelled, inside the same transaction.
    const prepare = jest.spyOn(stageTasks, 'prepareEntryTasks').mockResolvedValueOnce({ tasks: [{ data: {} } as never], warnings: [] });
    const insert = jest.spyOn(tasks, 'insertPrepared').mockRejectedValueOnce(new Error('the task could not be written'));

    await expect(workflow.triggerTransition(c.instanceId, { transitionId: c.revise.id }, o.id, o.adminId, [])).rejects.toThrow(
      'the task could not be written',
    );

    prepare.mockRestore();
    insert.mockRestore();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: c.taskId } })).status).toBe('PENDING');
    expect(await inbox(nora)).toEqual([]);
  });

  it('a completion tells the others still on it with the 4th wording; not the completer, not someone already off it', async () => {
    const o = await org();
    const nora = await o.person('Nora', true);
    const omar = await o.person('Omar');
    const gone = await o.person('Gone', true);
    const c = await committeeWithTask(o, [nora, omar], [gone]);

    await tasks.complete(c.taskId, nora, o.id);

    expect(await inbox(nora)).toEqual([]);
    expect(await inbox(gone)).toEqual([]);
    const [toOmar] = await inbox(omar);
    expect(toOmar).toMatchObject({
      titleEn: 'Your task "Check the terms" on the committee is closed: Nora completed it.',
      titleAr: 'أُغلقت مهمتك «Check the terms» في اللجنة: أُنجزت من قِبل Nora.',
      objectType: null,
    });
  });

  itEnforcesTenantIsolation('closed-task notices — nobody in another organisation is told', async () => {
    const a = await org();
    const b = await org();
    const nora = await a.person('Nora', true);
    const stranger = await b.person('Stranger', true);
    // An assignee row naming another organisation's person: never told.
    const c = await committeeWithTask(a, [nora, stranger]);

    await workflow.triggerTransition(c.instanceId, { transitionId: c.revise.id }, a.id, a.adminId, []);

    expect(await inbox(nora)).toHaveLength(1);
    expect(await inbox(stranger)).toEqual([]);
    expect(await prisma.notification.count({ where: { organizationId: b.id } })).toBe(0);
  });
});
