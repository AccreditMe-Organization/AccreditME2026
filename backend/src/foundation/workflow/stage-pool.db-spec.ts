/**
 * ACC-271 PR 1 — who works a converted stage, against a REAL Postgres
 * (npm run test:db).
 *
 * Only a database proves:
 *
 *   - "the record's unit": an Org unit head entry with no unit resolves the
 *     head of the committee's own unit (plan gap 1, closed), and not the head
 *     of its parent (Q3: no walk up);
 *   - the leaver rule end to end: deactivating a pool member writes
 *     POOL_MEMBER_LEFT on the open entry, inside the deactivation, and an "All
 *     of them" stage then moves on the remaining member's approval alone;
 *   - another organisation's stage, people and entries never reach a pool, and
 *     a deactivation in one organisation writes nothing in another.
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
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { UserService } from '../user/user.service';
import type { AuthProvider } from '../../providers/auth/auth.provider';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { WorkflowService } from './workflow.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { StagePoolService } from './stage-pool.service';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;

describe('Who works a converted stage, against a real database (ACC-271 PR 1)', () => {
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
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const roles = { getUserPermissions: async () => [] } as unknown as RoleService;
  const organizations = {
    resolveActingHeadForOrgUnit: async () => [],
    refreshOrgUnitHeadVacancy: async () => undefined,
  } as unknown as OrganizationService;
  const queue = { add: async () => undefined } as never;
  const pools = new StagePoolService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, roles, organizations, queue, stageTasks, pools);
  const users = new UserService(
    prisma,
    audit,
    notifications,
    roles,
    tasks,
    organizations,
    { invalidateUserSessions: async () => undefined } as unknown as AuthProvider,
    {} as OrgUnitHeadService,
    {} as OrgPositionService,
    pools,
  );

  interface Org {
    id: string;
    templateId: string;
    parentUnitId: string;
    unitId: string;
    person: (name: string, extra?: Record<string, unknown>) => Promise<string>;
    /** A committee in `unitId`, sitting in the seeded stage `key`. */
    committeeAt: (key: string, actorId: string) => Promise<{ id: string; instanceId: string; entryId: string; stageId: string }>;
  }

  async function org(): Promise<Org> {
    const slug = `acc271-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const roleKeys = new Set<string>(['TENANT_ADMIN']);
    for (const s of COMMITTEE_SEED.stages) if (s.assigneeRoleKey) roleKeys.add(s.assigneeRoleKey);
    for (const t of COMMITTEE_SEED.transitions) if (t.triggerRoleKey) roleKeys.add(t.triggerRoleKey);
    for (const key of roleKeys) await prisma.role.create({ data: { organizationId: o.id, key, nameEn: key, isSystem: true } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const parent = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Hospital', code: `H-${slug}` } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${slug}`, parentId: parent.id } });
    let n = 0;
    const person = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } })).id;
    const committeeAt = async (key: string, actorId: string) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const c = await prisma.committee.create({
        data: { organizationId: o.id, nameEn: `Committee ${key}`, typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
      });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date(), actorId } });
      return { id: c.id, instanceId: instance.id, entryId: entry.id, stageId: stage.id };
    };
    return { id: o.id, templateId: template.id, parentUnitId: parent.id, unitId: unit.id, person, committeeAt };
  }

  /** Converts a seeded stage: its who mode and its entries, as PR 2's backfill and PR 3's editor will. */
  async function convert(o: Org, key: string, whoMode: 'ANY_ONE' | 'ALL' | 'COMMITTEE_VOTE', entries: Record<string, unknown>[]): Promise<string> {
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key } });
    await prisma.workflowStage.update({ where: { id: stage.id }, data: { whoMode } });
    let order = 0;
    for (const e of entries) {
      await prisma.workflowStageAssignee.create({ data: { organizationId: o.id, stageId: stage.id, order: ++order, ...e } as never });
    }
    return stage.id;
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("an Org unit head entry with no unit resolves the head of the record's own unit, not its parent's (gap 1, Q3)", async () => {
    const o = await org();
    const headPost = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Head', grade: 1, isUnitHeadPosition: true } });
    const unitHead = await o.person('Quality head', { positionId: headPost.id, primaryOrgUnitId: o.unitId });
    await o.person('Hospital head', { positionId: headPost.id, primaryOrgUnitId: o.parentUnitId });
    const stageId = await convert(o, 'terms_review', 'ANY_ONE', [{ kind: 'ORG_UNIT_HEAD' }]);
    const c = await o.committeeAt('terms_review', unitHead);

    const pool = await pools.resolve(o.id, stageId, { id: c.instanceId, objectType: 'COMMITTEE', objectId: c.id });

    expect(pool.members).toEqual([unitHead]);
  });

  it('a deactivated pool member is recorded as having left, and "All of them" then decides without them', async () => {
    const o = await org();
    const stays = await o.person('Stays');
    const leaves = await o.person('Leaves');
    const stageId = await convert(o, 'terms_review', 'ALL', [
      { kind: 'SPECIFIC_USER', userId: stays },
      { kind: 'SPECIFIC_USER', userId: leaves },
    ]);
    // An "All of them" stage's forward move is its approval path.
    const approve = await prisma.workflowTransition.findFirstOrThrow({
      where: { fromStageId: stageId, toStage: { key: 'active' } },
    });
    await prisma.workflowTransition.update({ where: { id: approve.id }, data: { isApprovalPath: true } });
    const c = await o.committeeAt('terms_review', stays);

    // Before: one approval of two is not enough.
    await workflow.triggerTransition(c.instanceId, { transitionId: approve.id }, o.id, stays, []);
    expect((await prisma.workflowInstance.findFirstOrThrow({ where: { id: c.instanceId } })).currentStageId).toBe(stageId);

    await users.deactivate(leaves, o.id, stays);

    const events = await prisma.workflowInstanceStageEvent.findMany({ where: { organizationId: o.id } });
    expect(events).toEqual([
      expect.objectContaining({ workflowInstanceStageId: c.entryId, kind: 'POOL_MEMBER_LEFT', userId: leaves, reason: 'DEACTIVATED' }),
    ]);

    // The remaining member's approval is now everyone's.
    await workflow.triggerTransition(c.instanceId, { transitionId: approve.id }, o.id, stays, []);
    const after = await prisma.workflowInstance.findFirstOrThrow({ where: { id: c.instanceId } });
    const active = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: o.templateId, key: 'active' } });
    expect(after.currentStageId).toBe(active.id);
  });

  it('an empty pool refuses the move, and someone outside the pool is refused, with nothing written', async () => {
    const o = await org();
    const outsider = await o.person('Outsider');
    const member = await o.person('Member', { status: 'INACTIVE' });
    const stageId = await convert(o, 'terms_review', 'ANY_ONE', [{ kind: 'SPECIFIC_USER', userId: member }]);
    const approve = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: stageId, toStage: { key: 'active' } } });
    const c = await o.committeeAt('terms_review', outsider);

    const empty = await workflow.triggerTransition(c.instanceId, { transitionId: approve.id }, o.id, outsider, ['committees:approve']).catch((e: { getResponse: () => unknown }) => e.getResponse());
    expect(empty).toMatchObject({ statusCode: 409, code: 'STAGE_HAS_NO_ONE', stageNameEn: 'Terms Review' });

    await prisma.user.update({ where: { id: member }, data: { status: 'ACTIVE' } });
    const outside = await workflow.triggerTransition(c.instanceId, { transitionId: approve.id }, o.id, outsider, ['committees:approve']).catch((e: { getResponse: () => unknown }) => e.getResponse());
    expect(outside).toMatchObject({ statusCode: 403, code: 'NOT_IN_STAGE_POOL' });

    expect((await prisma.workflowInstance.findFirstOrThrow({ where: { id: c.instanceId } })).currentStageId).toBe(stageId);
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: c.entryId } })).toBe(0);
  });

  itEnforcesTenantIsolation("StagePoolService — another organisation's stage, people and entries never reach a pool", async () => {
    const a = await org();
    const b = await org();
    const aUser = await a.person('A member');
    const bUser = await b.person('B member');
    const aStage = await convert(a, 'terms_review', 'ALL', [{ kind: 'SPECIFIC_USER', userId: aUser }]);
    // B's entry naming A's person on B's stage, and B's entry on A's stage id.
    const bStage = await convert(b, 'terms_review', 'ALL', [{ kind: 'SPECIFIC_USER', userId: aUser }]);
    await prisma.workflowStageAssignee.create({ data: { organizationId: b.id, stageId: aStage, order: 9, kind: 'SPECIFIC_USER', userId: bUser } });
    const aCommittee = await a.committeeAt('terms_review', aUser);
    const bCommittee = await b.committeeAt('terms_review', bUser);

    // A's stage, read as A: only A's entry. Read as B: only B's planted row, nothing of A's.
    expect((await pools.resolve(a.id, aStage, { id: aCommittee.instanceId, objectType: 'COMMITTEE', objectId: aCommittee.id })).members).toEqual([aUser]);
    expect((await pools.resolve(b.id, aStage, { id: aCommittee.instanceId, objectType: 'COMMITTEE', objectId: aCommittee.id })).members).toEqual([bUser]);
    // B's stage names A's person: they are not B's, so B's pool is empty.
    expect((await pools.resolve(b.id, bStage, { id: bCommittee.instanceId, objectType: 'COMMITTEE', objectId: bCommittee.id })).members).toEqual([]);

    // Deactivating A's person records A's entry only.
    await users.deactivate(aUser, a.id, aUser);
    expect(await prisma.workflowInstanceStageEvent.count({ where: { organizationId: a.id } })).toBe(1);
    expect(await prisma.workflowInstanceStageEvent.count({ where: { organizationId: b.id } })).toBe(0);
    expect(await pools.openEntriesWithMember(b.id, bUser)).toEqual([]);
  });
});
