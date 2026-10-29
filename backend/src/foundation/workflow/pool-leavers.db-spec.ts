/**
 * ACC-271 PR 4 (plan §8) — the leaver rule's sweep half, against a REAL Postgres
 * (npm run test:db). Deactivation records its own leaver (PR 1); leaving a
 * position, a committee seat or an acting cover is recorded by the 15-minute
 * sweep, which compares each open "All of them" entry's pool with the entry's
 * own JOINED / LEFT events.
 *
 * Only a database proves:
 *
 *   - entering an "All of them" stage records who its pool starts with;
 *   - someone who leaves the position gets ONE POOL_MEMBER_LEFT, however often
 *     the sweep runs, and the stage then decides without them;
 *   - a committee member whose seat ends, and an acting head whose cover ends,
 *     are recorded the same way.
 *
 * `sweep()` makes exactly the calls SlaMonitorProcessor.sweepUnassignedStages()
 * makes (resolveStagePools, then recordPoolChanges for the All of them
 * entries); the processor's own wiring is pinned in its spec.
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
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { WorkflowService } from './workflow.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { StagePoolService } from './stage-pool.service';
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
const DAY = 86_400_000;

describe("Leaving an \"All of them\" stage's pool mid-stage, against a real database (ACC-271 PR 4)", () => {
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
  const roles = { getUserPermissions: async () => [] } as unknown as RoleService;
  const organizations = { resolveActingHeadForOrgUnit: async () => [], refreshOrgUnitHeadVacancy: async () => undefined } as unknown as OrganizationService;
  const queue = { add: async () => undefined } as never;
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, roles, organizations, queue, stageTasks, new StagePoolService(prisma));

  interface Org {
    id: string;
    adminId: string;
    templateId: string;
    unitId: string;
    person: (name: string, extra?: Record<string, unknown>) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc271l-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>();
    for (const s of COMMITTEE_SEED.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
    for (const t of COMMITTEE_SEED.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${slug}` } });
    let n = 0;
    const person = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } })).id;
    const adminId = await person('Admin');
    await writeStartingAssignments(prisma, o.id, adminId, adminId);
    return { id: o.id, adminId, templateId: template.id, unitId: unit.id, person };
  }

  /** Terms Review becomes "All of them" with these entries; its forward move is the approval path. */
  async function termsReviewAll(o: Org, entries: Record<string, unknown>[]) {
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'terms_review' } });
    await prisma.workflowStageAssignee.deleteMany({ where: { stageId: stage.id } });
    await prisma.workflowStage.update({ where: { id: stage.id }, data: { whoMode: 'ALL' } });
    let order = 0;
    for (const e of entries) await prisma.workflowStageAssignee.create({ data: { organizationId: o.id, stageId: stage.id, order: ++order, ...e } as never });
    const approve = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: stage.id, toStage: { key: 'active' } } });
    await prisma.workflowTransition.update({ where: { id: approve.id }, data: { isApprovalPath: true } });
    return { stageId: stage.id, approveId: approve.id };
  }

  /** A committee in Formation, moved into Terms Review by the engine (so the pool is recorded at entry). */
  async function committeeEnteringTermsReview(o: Org) {
    const c = await prisma.committee.create({
      data: { organizationId: o.id, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: o.unitId, quorumCount: 1, meetingFrequency: 'MONTHLY' },
    });
    const instance = await workflow.startInstance('COMMITTEE', c.id, o.id, o.adminId);
    const submit = await prisma.workflowTransition.findFirstOrThrow({
      where: { fromStage: { workflowTemplateId: o.templateId, key: 'formation' }, toStage: { key: 'terms_review' } },
    });
    await workflow.triggerTransition(instance.id, { transitionId: submit.id }, o.id, o.adminId, []);
    const entry = await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: instance.id, exitedAt: null } });
    return { committeeId: c.id, instanceId: instance.id, entryId: entry.id };
  }

  /** Exactly the sweep's calls: the open All of them entries' pools, then their changes. */
  async function sweep(o: Org) {
    const open = await prisma.workflowInstanceStage.findMany({
      where: { exitedAt: null, workflowInstance: { organizationId: o.id }, stage: { whoMode: 'ALL' } },
      include: { workflowInstance: true },
    });
    const pools = await workflow.resolveStagePools(
      o.id,
      open.map((e) => ({ key: e.id, stageId: e.stageId, instance: e.workflowInstance })),
    );
    return workflow.recordPoolChanges(o.id, pools);
  }

  const events = (entryId: string) =>
    prisma.workflowInstanceStageEvent.findMany({ where: { workflowInstanceStageId: entryId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('someone who leaves the position is recorded once, and All of them then decides without them', async () => {
    const o = await org();
    const post = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Reviewer', grade: 3 } });
    const leaves = await o.person('Leaves', { positionId: post.id, primaryOrgUnitId: o.unitId });
    const stays = await o.person('Stays', { positionId: post.id, primaryOrgUnitId: o.unitId });
    const t = await termsReviewAll(o, [{ kind: 'POSITION_IN_UNIT', positionId: post.id, orgUnitId: o.unitId }]);
    const c = await committeeEnteringTermsReview(o);

    // Entering the stage recorded who its pool starts with.
    expect((await events(c.entryId)).map((e) => `${e.kind}:${e.userId}`).sort()).toEqual([`POOL_MEMBER_JOINED:${leaves}`, `POOL_MEMBER_JOINED:${stays}`].sort());

    // The leaver approves, then leaves the position.
    await workflow.triggerTransition(c.instanceId, { transitionId: t.approveId }, o.id, leaves, []);
    await prisma.user.update({ where: { id: leaves }, data: { positionId: null } });

    expect(await sweep(o)).toEqual({ joined: 0, left: 1 });
    expect(await sweep(o)).toEqual({ joined: 0, left: 0 });
    const left = (await events(c.entryId)).filter((e) => e.kind === 'POOL_MEMBER_LEFT');
    expect(left.map((e) => [e.userId, e.reason, e.organizationId])).toEqual([[leaves, 'LEFT_POOL', o.id]]);

    // The one still in the pool decides it; the earlier approval stands.
    await workflow.triggerTransition(c.instanceId, { transitionId: t.approveId }, o.id, stays, []);
    const after = await prisma.workflowInstance.findUniqueOrThrow({ where: { id: c.instanceId } });
    const active = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'active' } });
    expect(after.currentStageId).toBe(active.id);
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: c.entryId, approverId: leaves } })).toBe(1);
  });

  it("a committee member whose seat ends is recorded as having left the record's committee pool", async () => {
    const o = await org();
    const a = await o.person('Member A');
    const b = await o.person('Member B');
    await termsReviewAll(o, [{ kind: 'COMMITTEE' }]);
    const c = await committeeEnteringTermsReview(o);
    // Seated after entry: the sweep sees them join, then one leave.
    const seatA = await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.committeeId, userId: a, roleValueId: 'member' } });
    await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.committeeId, userId: b, roleValueId: 'member' } });
    expect(await sweep(o)).toEqual({ joined: 2, left: 0 });

    await prisma.committeeMember.update({ where: { id: seatA.id }, data: { isActive: false, leftAt: new Date() } });

    expect(await sweep(o)).toEqual({ joined: 0, left: 1 });
    expect((await events(c.entryId)).filter((e) => e.kind === 'POOL_MEMBER_LEFT').map((e) => e.userId)).toEqual([a]);
  });

  it('an acting head whose cover ends is recorded as having left an Org unit head pool', async () => {
    const o = await org();
    const cover = await o.person('Acting head');
    const assignment = await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: o.id, orgUnitId: o.unitId, userId: cover, kind: 'ACTING', reason: 'VACANCY', validFrom: new Date(Date.now() - DAY), createdById: o.adminId },
    });
    await termsReviewAll(o, [{ kind: 'ORG_UNIT_HEAD' }]);
    const c = await committeeEnteringTermsReview(o);
    expect((await events(c.entryId)).map((e) => `${e.kind}:${e.userId}`)).toEqual([`POOL_MEMBER_JOINED:${cover}`]);

    await prisma.orgUnitHeadAssignment.update({ where: { id: assignment.id }, data: { endedAt: new Date(), endedById: o.adminId } });

    expect(await sweep(o)).toEqual({ joined: 0, left: 1 });
    expect((await events(c.entryId)).filter((e) => e.kind === 'POOL_MEMBER_LEFT').map((e) => e.userId)).toEqual([cover]);
  });
});
