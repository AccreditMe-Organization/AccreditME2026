/**
 * ACC-271 PR 2 (plan §5) — a new organisation's seeded workflows and their
 * starting assignments, against a REAL Postgres (npm run test:db).
 *
 * Only a database proves:
 *
 *   - the seed writes who works each stage it creates: whoMode on all 60
 *     stages, a CREATOR entry on the 12 the creator drives, a mover on all 75
 *     moves (8 the app's);
 *   - assignStartingAssignments() puts the invited admin on every other stage,
 *     once: a second run writes nothing;
 *   - an INVITED admin is in no pool until they accept (Q5), then is.
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
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { StagePoolService } from './stage-pool.service';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe("A new organisation's workflows start on its first admin, against a real database (ACC-271 PR 2)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }) } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla);
  const templates = new WorkflowTemplateService(prisma, audit, new StageTaskDefinitionService(prisma, audit, tasks));
  const pools = new StagePoolService(prisma);

  /** An organisation bootstrapped as far as its workflows: the roles the seed names, then the seed. */
  async function newOrganisation(): Promise<{ id: string; slug: string }> {
    const slug = `acc271s-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const w of SYSTEM_WORKFLOW_SEED) {
      for (const s of w.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
      for (const t of w.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    }
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await templates.seedDefaultWorkflows(o.id);
    return { id: o.id, slug };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the seed writes who works each stage it creates, and who moves along each move', async () => {
    const o = await newOrganisation();
    const scope = { workflowTemplate: { organizationId: o.id } };

    expect(await prisma.workflowStage.count({ where: scope })).toBe(60);
    expect(await prisma.workflowStage.count({ where: { ...scope, whoMode: null } })).toBe(0);
    expect(await prisma.workflowStage.count({ where: { ...scope, whoMode: 'ALL' } })).toBe(4);
    expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id, kind: 'CREATOR' } })).toBe(12);
    expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id, kind: { not: 'CREATOR' } } })).toBe(0);
    expect(await prisma.workflowTransition.count({ where: { fromStage: scope, mover: 'APP' } })).toBe(8);
    expect(await prisma.workflowTransition.count({ where: { fromStage: scope, mover: 'PERSON' } })).toBe(67);
    expect(await prisma.workflowTransition.count({ where: { fromStage: scope, mover: null } })).toBe(0);
  });

  it('starts every other stage on the invited admin, once; and the admin is in no pool until they accept', async () => {
    const o = await newOrganisation();
    const admin = await prisma.user.create({
      data: { organizationId: o.id, email: `${o.slug}-admin@example.test`, name: 'First admin', status: 'INVITED' },
    });

    const first = await templates.assignStartingAssignments(o.id, admin.id, admin.id);

    expect(first.stageIds).toHaveLength(48);
    const starting = await prisma.workflowStageAssignee.findMany({ where: { organizationId: o.id, isStartingAssignment: true } });
    expect(starting).toHaveLength(48);
    expect(new Set(starting.map((e) => `${e.kind}:${e.userId}:${e.order}`))).toEqual(new Set([`SPECIFIC_USER:${admin.id}:1`]));
    // Not on a stage the creator drives.
    expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id, kind: 'CREATOR', isStartingAssignment: true } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'WorkflowStageAssignee' } })).toBe(1);

    // Again: nothing more.
    const second = await templates.assignStartingAssignments(o.id, admin.id, admin.id);
    expect(second.stageIds).toEqual([]);
    expect(await prisma.workflowStageAssignee.count({ where: { organizationId: o.id, isStartingAssignment: true } })).toBe(48);
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'WorkflowStageAssignee' } })).toBe(1);

    // INVITED: holding the assignment is not being able to act (Q5, ACC-43).
    const formation = await prisma.workflowStage.findFirstOrThrow({ where: { key: 'formation', workflowTemplate: { organizationId: o.id, objectType: 'COMMITTEE' } } });
    const record = { id: randomUUID(), objectType: 'COMMITTEE' as const, objectId: randomUUID() };
    expect((await pools.resolve(o.id, formation.id, record)).members).toEqual([]);

    await prisma.user.update({ where: { id: admin.id }, data: { status: 'ACTIVE' } });
    expect((await pools.resolve(o.id, formation.id, record)).members).toEqual([admin.id]);
  });

  it("refuses a user of another organisation, and writes nothing", async () => {
    const a = await newOrganisation();
    const b = await newOrganisation();
    const bUser = await prisma.user.create({ data: { organizationId: b.id, email: `${b.slug}-x@example.test`, name: 'B user', status: 'ACTIVE' } });

    await expect(templates.assignStartingAssignments(a.id, bUser.id, bUser.id)).rejects.toThrow('User not found');
    expect(await prisma.workflowStageAssignee.count({ where: { organizationId: a.id, isStartingAssignment: true } })).toBe(0);
  });
});
