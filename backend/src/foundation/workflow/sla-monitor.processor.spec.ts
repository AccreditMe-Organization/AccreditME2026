import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SlaMonitorProcessor } from './sla-monitor.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { OrganizationService } from '../organization/organization.service';
import { TenantService } from '../tenant/tenant.service';
import { TaskService } from '../task/task.service';
import { WorkflowService } from './workflow.service';
import { ITaskSlaSettings } from '../tenant/interfaces/tenant.interface';

// Originally scoped narrowly to ACC-28 Section 2.5.1's new
// sweepUnassignedStages() — the pre-existing SLA-breach escalation
// (fireEscalation) and Task-overdue escalation (fireTaskEscalation) logic
// ran in production for a long time without a dedicated spec (SYSTEM-
// REFERENCE.md Section 11, ACC-33 item 8). Now covered below, in their own
// describe blocks.

const ORG_A = 'org-a-id';

const BASE_INSTANCE = {
  id: 'instance-1',
  organizationId: ORG_A,
  objectType: 'COMMITTEE',
  objectId: 'object-1',
};

const BASE_STAGE = {
  id: 'stage-1',
  nameEn: 'Chairman Review',
  committeeId: 'committee-1',
};

const makeOpenInstanceStage = (overrides: Record<string, unknown> = {}) => ({
  id: 'instance-stage-1',
  workflowInstanceId: 'instance-1',
  stageId: 'stage-1',
  exitedAt: null,
  isUnassigned: false,
  unassignedAt: null,
  workflowInstance: BASE_INSTANCE,
  stage: BASE_STAGE,
  ...overrides,
});

const BLOCKING_TRANSITION = [{ id: 't-1', labelEn: 'Approve', triggerCondition: 'ASSIGNEE_POOL' }];

const mockPrisma = {
  workflowInstanceStage: { findMany: jest.fn(), update: jest.fn() },
  task: { findMany: jest.fn(), update: jest.fn() },
  userRole: { findMany: jest.fn() },
  user: { findMany: jest.fn(), update: jest.fn() },
  orgUnit: { findMany: jest.fn(), update: jest.fn() },
  orgPosition: { findMany: jest.fn() },
};

// Always-open working-hours calendar — avoids clock-dependent flakiness in
// tests that don't care about working-hours gating specifically.
const ALWAYS_OPEN_CALENDAR = {
  timezone: 'UTC',
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  workingHoursStart: '00:00',
  workingHoursEnd: '23:59',
};

const makeBreachedInstanceStage = (overrides: Record<string, unknown> = {}) => ({
  id: 'instance-stage-1',
  workflowInstanceId: 'instance-1',
  stageId: 'stage-1',
  exitedAt: null,
  slaDueAt: new Date('2026-01-01T00:00:00.000Z'),
  slaBreached: false,
  escalatedRuleIndexes: [] as number[],
  workflowInstance: BASE_INSTANCE,
  stage: { ...BASE_STAGE, escalationConfig: null as unknown },
  ...overrides,
});

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { getOrCreate: jest.fn(), listHolidays: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockOrgPositionService = {
  notifyTenantAdminsOfVacantHeadRoleMappings: jest.fn(),
  // ACC-46 Section 2.7.e, Commit 4 — the real tier-based escalation firing
  // logic's own two resolvers (unit-tested for real in
  // org-position.service.spec.ts, Commit 3). Mocked here purely as wiring
  // — these tests prove the sweep calls them correctly and acts on their
  // result, not the resolvers' own internal dedup/Acting-Head logic.
  resolveManagerEscalationTargets: jest.fn(),
  resolveHeadEscalationTargets: jest.fn(),
};
// ACC-46 Section 2.7.e, Commit 4 — real tenant-configured tiers, matching
// TenantService's own DEFAULT_TASK_SLA_SETTINGS shape (Commit 2a) so these
// tests exercise realistic threshold values, not arbitrary numbers.
const TASK_SLA_SETTINGS: ITaskSlaSettings = {
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
};
const mockTenantService = { getTaskSla: jest.fn() };
const mockWorkflowService = {
  resolveUnassignedBlockingTransitions: jest.fn(),
  resolveUnreachableTriggerConditionTransitions: jest.fn(),
  notifyTenantAdminsOfUnassignedStage: jest.fn(),
  // ACC-51 — the recovery branch resolves the pool that just became
  // reachable. Safe no-op default (empty pool = nothing to recover) set in
  // beforeEach; recovery tests override it per-case.
  resolveAssigneeForStage: jest.fn(),
};
// ACC-51 — recovery hands the resolved pool to TaskService, which owns the
// actual assignment/notification logic (tested in task.service.spec.ts).
const mockTaskService = { attachAssigneesToUnassignedStageTasks: jest.fn() };
const mockOrgUnitHeadService = { completeHandoverAutomatically: jest.fn() };
const mockOrganizationService = {
  resolveActingHeadForOrgUnit: jest.fn(),
  notifyTenantAdminsOfOrgUnitVacancy: jest.fn(),
};
const mockQueue = { add: jest.fn() };

describe('SlaMonitorProcessor — sweepUnassignedStages (ACC-28 Section 2.5.1)', () => {
  let processor: SlaMonitorProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.task.findMany.mockResolvedValue([]); // no-op sweepOverdueTasks
    // ACC-40 Section 2.7 — default: no expired acting-org-unit assignments,
    // so sweepExpiredActingOrgUnitAssignments() is a no-op for every
    // pre-existing test. Tests exercising it override this per-case.
    mockPrisma.user.findMany.mockResolvedValue([]);
    // ACC-40 Section 2.3/2.5.1 — default: no handovers past their
    // effectiveDate AND no vacant org units, so both sweepDueHandovers()
    // and sweepOrgUnitVacancies() (both query orgUnit.findMany with
    // different where clauses) are no-ops for every pre-existing test.
    // Tests exercising either sweep override this per-case, keyed on the
    // where clause so the two sweeps' queries don't leak into each other.
    mockPrisma.orgUnit.findMany.mockResolvedValue([]);
    mockPrisma.orgUnit.update.mockResolvedValue({});
    // ACC-43 — default: no unmapped head-conferring positions, so
    // sweepVacantHeadRoleMappings() is a no-op for every pre-existing
    // test. Tests exercising it override this per-case.
    mockPrisma.orgPosition.findMany.mockResolvedValue([]);
    mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]);
    // ACC-46 Section 2.7.e, Commit 4 — safe default so a test that doesn't
    // care about Task SLA specifics doesn't crash if sweepOverdueTasks()
    // happens to run against a non-empty fixture. Tests exercising tiered
    // thresholds directly override this per-case.
    mockTenantService.getTaskSla.mockResolvedValue(TASK_SLA_SETTINGS);
    // Default: no breached stages / no open stages, so tests that don't
    // care about sweepUnassignedStages()/the top-of-process() breach loop
    // (e.g. the new sweepOrgUnitVacancies tests below) aren't broken by a
    // missing mock — this mirrors the same defensive-default reasoning as
    // every other mock set in this block. Tests exercising those two
    // concerns override with their own mockResolvedValueOnce() sequence.
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([]);
    mockPrisma.workflowInstanceStage.update.mockResolvedValue({});
    mockWorkingCalendar.getOrCreate.mockResolvedValue(ALWAYS_OPEN_CALENDAR);
    mockWorkingCalendar.listHolidays.mockResolvedValue([]);
    // ACC-33 item 9 — default: no ROLE_BASED/SPECIFIC_USER blocking, so
    // pre-existing tests exercise only the ASSIGNEE_POOL side unchanged.
    // Tests specifically exercising this new resolver override per-case.
    mockWorkflowService.resolveUnreachableTriggerConditionTransitions.mockResolvedValue([]);
    // ACC-51 — defaults: recovery resolves an empty pool and therefore
    // recovers nothing, so every pre-existing test is unaffected by the new
    // recovery branch. Recovery tests override both per-case.
    mockWorkflowService.resolveAssigneeForStage.mockResolvedValue([]);
    mockTaskService.attachAssigneesToUnassignedStageTasks.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaMonitorProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: OrgPositionService, useValue: mockOrgPositionService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: OrgUnitHeadService, useValue: mockOrgUnitHeadService },
        { provide: OrganizationService, useValue: mockOrganizationService },
        { provide: TenantService, useValue: mockTenantService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: getQueueToken('sla-monitor'), useValue: mockQueue },
      ],
    }).compile();

    processor = module.get<SlaMonitorProcessor>(SlaMonitorProcessor);
  });

  const runProcess = () => processor.process({} as never);

  it('flags a previously-fine open stage and notifies Tenant Admins on a false→true transition', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    mockPrisma.workflowInstanceStage.findMany
      .mockResolvedValueOnce([]) // breachedStages (top of process())
      .mockResolvedValueOnce([stage]); // openStages (sweepUnassignedStages)
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION);

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'instance-stage-1' },
      data: { isUnassigned: true, unassignedAt: expect.any(Date) },
    });
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).toHaveBeenCalledWith(
      ORG_A,
      BASE_INSTANCE,
      BASE_STAGE,
      BLOCKING_TRANSITION,
    );
  });

  it('clears isUnassigned on a previously-flagged stage once the pool is qualifying again, without notifying', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]); // now resolvable

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'instance-stage-1' },
      data: { isUnassigned: false, unassignedAt: null },
    });
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  // ACC-51 — the recovery branch. The test directly above still asserts the
  // admin half stays silent; these assert the assignee half no longer is.
  it('on recovery, attaches the newly-resolved pool to the stage\'s still-UNASSIGNED task', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]); // now resolvable
    mockWorkflowService.resolveAssigneeForStage.mockResolvedValue(['user-newly-eligible']);

    await runProcess();

    expect(mockWorkflowService.resolveAssigneeForStage).toHaveBeenCalledWith(
      BASE_STAGE,
      BASE_INSTANCE,
      ORG_A,
    );
    expect(mockTaskService.attachAssigneesToUnassignedStageTasks).toHaveBeenCalledWith(
      'instance-1',
      'stage-1',
      ['user-newly-eligible'],
      ORG_A,
    );
  });

  it('on recovery, still does NOT notify Tenant Admins — the assignee-facing fix must not reintroduce admin spam', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]);
    mockWorkflowService.resolveAssigneeForStage.mockResolvedValue(['user-newly-eligible']);

    await runProcess();

    expect(mockTaskService.attachAssigneesToUnassignedStageTasks).toHaveBeenCalled();
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  // A stage can recover because its blocking transition's requiredPermission
  // became satisfiable, with the pool itself unchanged and still empty.
  it('on recovery with a still-empty pool, recovers nothing rather than flipping a task to PENDING with no assignee', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]);
    mockWorkflowService.resolveAssigneeForStage.mockResolvedValue([]);

    await runProcess();

    expect(mockTaskService.attachAssigneesToUnassignedStageTasks).not.toHaveBeenCalled();
  });

  it('never attempts recovery on a false→true transition — that path pages admins instead', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION);

    await runProcess();

    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).toHaveBeenCalled();
    expect(mockTaskService.attachAssigneesToUnassignedStageTasks).not.toHaveBeenCalled();
  });

  it('does not attempt recovery when nothing changed — a still-blocked stage is not a recovery', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION);

    await runProcess();

    expect(mockTaskService.attachAssigneesToUnassignedStageTasks).not.toHaveBeenCalled();
  });

  it('does not write or notify when a stage is still blocked on re-check (prevents a duplicate notification)', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION); // still blocked

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  it('does not write or notify when a stage remains reachable', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]);

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  // ACC-33 item 9 — the periodic sweep must combine BOTH resolvers, not just
  // the pre-existing ASSIGNEE_POOL one, so drift in a ROLE_BASED/
  // SPECIFIC_USER trigger condition mid-review is caught the same way.
  it('flags a stage when only the trigger-condition resolver (ROLE_BASED/SPECIFIC_USER) reports blocking, with an otherwise-resolvable pool', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    const triggerBlockingTransition = [{ id: 't-role-based', labelEn: 'Approve Committee' }];
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]); // pool is fine
    mockWorkflowService.resolveUnreachableTriggerConditionTransitions.mockResolvedValue(
      triggerBlockingTransition,
    );

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'instance-stage-1' },
      data: { isUnassigned: true, unassignedAt: expect.any(Date) },
    });
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).toHaveBeenCalledWith(
      ORG_A,
      BASE_INSTANCE,
      BASE_STAGE,
      triggerBlockingTransition,
    );
  });

  // ── SLA breach escalation (ACC-33 item 8) — pre-existing, previously ────────
  // untested logic (fireEscalation, via process()'s breachedStages branch)

  describe('SLA breach escalation', () => {
    const runWithBreachedStage = (instanceStage: ReturnType<typeof makeBreachedInstanceStage>) => {
      mockPrisma.workflowInstanceStage.findMany
        .mockResolvedValueOnce([instanceStage]) // breachedStages (top of process())
        .mockResolvedValueOnce([]); // openStages (sweepUnassignedStages) — no-op here
      return runProcess();
    };

    it('marks the stage slaBreached with no escalation when the stage has no escalationConfig', async () => {
      const instanceStage = makeBreachedInstanceStage(); // escalationConfig: null

      await runWithBreachedStage(instanceStage);

      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'instance-stage-1' },
        data: { slaBreached: true },
      });
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('fires escalation to notifyUserId once its afterHours threshold has elapsed, during working hours', async () => {
      const instanceStage = makeBreachedInstanceStage({
        slaDueAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago
        stage: {
          ...BASE_STAGE,
          escalationConfig: [{ afterHours: 4, notifyUserId: 'user-escalate-1' }],
        },
      });

      await runWithBreachedStage(instanceStage);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-escalate-1', titleEn: 'SLA breach escalation' }),
        ORG_A,
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: ORG_A,
          objectType: 'WorkflowInstanceStage',
          objectId: 'instance-stage-1',
          metadata: { escalationRuleIndex: 0, notifiedUserCount: 1 },
        }),
      );
      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'instance-stage-1' },
        data: { slaBreached: true, escalatedRuleIndexes: [0] },
      });
    });

    it('notifies every active holder of notifyRoleId, deduplicated with notifyUserId via the Set', async () => {
      const instanceStage = makeBreachedInstanceStage({
        slaDueAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        stage: {
          ...BASE_STAGE,
          escalationConfig: [{ afterHours: 4, notifyUserId: 'user-a', notifyRoleId: 'role-qm' }],
        },
      });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-a' }, { userId: 'user-b' }]);

      await runWithBreachedStage(instanceStage);

      expect(mockPrisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roleId: 'role-qm', user: { organizationId: ORG_A, status: 'ACTIVE' } },
        }),
      );
      // user-a appears in both notifyUserId and the role holders — the Set
      // in fireEscalation() must dedupe it to a single notification.
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      const notifiedUserIds = mockNotificationService.create.mock.calls.map(
        ([arg]: [{ userId: string }]) => arg.userId,
      );
      expect(new Set(notifiedUserIds)).toEqual(new Set(['user-a', 'user-b']));
    });

    it('does not escalate when the rule\'s afterHours threshold has not yet elapsed, but still marks slaBreached', async () => {
      const instanceStage = makeBreachedInstanceStage({
        slaDueAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // only 1h ago
        stage: {
          ...BASE_STAGE,
          escalationConfig: [{ afterHours: 4, notifyUserId: 'user-escalate-1' }],
        },
      });

      await runWithBreachedStage(instanceStage);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'instance-stage-1' },
        data: { slaBreached: true },
      });
    });

    it('does not re-escalate a rule index already present in escalatedRuleIndexes (no duplicate notification)', async () => {
      const instanceStage = makeBreachedInstanceStage({
        slaDueAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        escalatedRuleIndexes: [0], // already escalated
        stage: {
          ...BASE_STAGE,
          escalationConfig: [{ afterHours: 4, notifyUserId: 'user-escalate-1' }],
        },
      });

      await runWithBreachedStage(instanceStage);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('does not escalate outside working hours, but still marks slaBreached', async () => {
      mockWorkingCalendar.getOrCreate.mockResolvedValue({ ...ALWAYS_OPEN_CALENDAR, workingDays: [] });
      const instanceStage = makeBreachedInstanceStage({
        slaDueAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        stage: {
          ...BASE_STAGE,
          escalationConfig: [{ afterHours: 4, notifyUserId: 'user-escalate-1' }],
        },
      });

      await runWithBreachedStage(instanceStage);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'instance-stage-1' },
        data: { slaBreached: true },
      });
    });
  });

  // ── Task overdue sweep — real, finished redesign (ACC-46 Section 2.7.e, ────
  // Commit 4). Replaces the interim describe block that existed for the
  // span of Commit 1 through Commit 3 (see sla-monitor.processor.ts's own
  // comment on sweepOverdueTasks() for why that gap existed).

  describe('Task overdue sweep (ACC-46 Section 2.7.e)', () => {
    // 5h overdue by default — past CRITICAL's manager threshold (2h) but
    // short of its cumulative Head threshold (2h + 4h = 6h).
    const makeOverdueTask = (overrides: Record<string, unknown> = {}) => ({
      id: 'task-1',
      organizationId: ORG_A,
      status: 'PENDING' as const,
      priority: 'CRITICAL' as const,
      dueAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      managerEscalatedAt: null as Date | null,
      headEscalatedAt: null as Date | null,
      assignees: [{ userId: 'assignee-1', removedAt: null }],
      ...overrides,
    });

    const runWithOverdueTask = (task: ReturnType<typeof makeOverdueTask>) => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([]); // no-op both branches
      mockPrisma.task.findMany.mockResolvedValueOnce([task]);
      return runProcess();
    };

    // Pins Finding 2's actual fix at the query level — the exact bug that
    // started this whole investigation. Under the old query
    // (status: { notIn: [..., 'OVERDUE', ...] }), a task became invisible
    // to this sweep forever, the instant it first went overdue — before
    // enough hours could plausibly have elapsed for any tier to fire.
    it('the sweep query no longer excludes OVERDUE tasks (Finding 2\'s fix)', async () => {
      await runProcess();

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: {
          dueAt: { lt: expect.any(Date) },
          status: { notIn: ['COMPLETED', 'CANCELLED', 'UNASSIGNED'] },
        },
        include: { assignees: { where: { removedAt: null } } },
      });
    });

    // The direct behavioral regression test the structural test above
    // proves is reachable: the SAME task, re-evaluated on a SECOND, later
    // sweep after already having gone OVERDUE and had its Manager tier
    // fire on the first sweep. Under the old code this second sweep could
    // never happen — the task was permanently excluded the moment it
    // became OVERDUE on sweep 1.
    it('a task remains eligible for re-evaluation across multiple sweeps — direct regression test for the original bug', async () => {
      mockOrgPositionService.resolveManagerEscalationTargets.mockResolvedValue(['manager-1']);
      const task = makeOverdueTask(); // 5h overdue, PENDING

      await runWithOverdueTask(task);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'OVERDUE', slaBreachedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { managerEscalatedAt: expect.any(Date) },
      });

      // Fresh call-count slate for sweep 2 — the task's own evolved state
      // below (already OVERDUE, managerEscalatedAt already set, further
      // time elapsed) is what proves re-eligibility, not leftover call
      // history from sweep 1.
      jest.clearAllMocks();
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([]);
      mockWorkingCalendar.getOrCreate.mockResolvedValue(ALWAYS_OPEN_CALENDAR);
      mockWorkingCalendar.listHolidays.mockResolvedValue([]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      mockPrisma.orgPosition.findMany.mockResolvedValue([]);
      mockTenantService.getTaskSla.mockResolvedValue(TASK_SLA_SETTINGS);
      mockOrgPositionService.resolveHeadEscalationTargets.mockResolvedValue(['head-1']);

      const sweptAgainTask = makeOverdueTask({
        status: 'OVERDUE', // already flipped by sweep 1
        managerEscalatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // fired by sweep 1
        dueAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // now past the 6h cumulative Head threshold
      });
      mockPrisma.task.findMany.mockResolvedValueOnce([sweptAgainTask]);

      await runProcess();

      // Not re-flipped to OVERDUE a second time — the `status !== 'OVERDUE'`
      // guard correctly recognizes it's already there.
      expect(mockPrisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'OVERDUE' }) }),
      );
      // But the Head tier DOES fire — proving the task was genuinely
      // re-evaluated on this second sweep, not silently dropped.
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { headEscalatedAt: expect.any(Date) },
      });
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'head-1' }),
        ORG_A,
      );
    });

    it('fires the Manager tier once its threshold has elapsed, notifying every resolved target and stamping managerEscalatedAt', async () => {
      mockOrgPositionService.resolveManagerEscalationTargets.mockResolvedValue(['manager-1']);
      const task = makeOverdueTask();

      await runWithOverdueTask(task);

      expect(mockOrgPositionService.resolveManagerEscalationTargets).toHaveBeenCalledWith(
        ['assignee-1'],
        ORG_A,
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        {
          userId: 'manager-1',
          titleEn: 'Task SLA breach escalation',
          bodyEn: 'A task has breached its SLA and has been escalated to you.',
          objectType: 'Task',
          objectId: 'task-1',
        },
        ORG_A,
      );
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { managerEscalatedAt: expect.any(Date) },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        tenantId: ORG_A,
        action: 'UPDATE',
        objectType: 'Task',
        objectId: 'task-1',
        metadata: { escalatedTo: ['manager-1'], tier: 'MANAGER' },
      });
    });

    // No-fall-through, part 1: even once enough time has passed for BOTH
    // thresholds cumulatively, the Manager tier still takes priority (the
    // if/else-if structure) — the Head tier is never even considered in
    // the same sweep the Manager tier is unfired.
    it('does not fire the Head tier when the Manager tier has not fired yet, even once the cumulative Head threshold has already elapsed (no fall-through)', async () => {
      mockOrgPositionService.resolveManagerEscalationTargets.mockResolvedValue(['manager-1']);
      const task = makeOverdueTask({ dueAt: new Date(Date.now() - 20 * 60 * 60 * 1000) }); // 20h overdue — far past both thresholds

      await runWithOverdueTask(task);

      expect(mockOrgPositionService.resolveHeadEscalationTargets).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { managerEscalatedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ headEscalatedAt: expect.any(Date) }) }),
      );
    });

    // No-fall-through, part 2: once the Manager tier HAS fired, the Head
    // tier still waits for its own additional grace period — reaching the
    // Manager threshold is not itself sufficient.
    it('does not fire the Head tier before its own additional grace period has elapsed, even after the Manager tier has fired', async () => {
      const task = makeOverdueTask({
        status: 'OVERDUE',
        managerEscalatedAt: new Date(Date.now() - 60 * 60 * 1000), // fired on a prior sweep
        dueAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // 4h overdue — past manager(2h), short of cumulative(6h)
      });

      await runWithOverdueTask(task);

      expect(mockOrgPositionService.resolveManagerEscalationTargets).not.toHaveBeenCalled();
      expect(mockOrgPositionService.resolveHeadEscalationTargets).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      // Already OVERDUE, nothing fired — no update call of any kind.
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('fires the Head tier once the Manager tier has fired AND its own additional grace period has elapsed', async () => {
      mockOrgPositionService.resolveHeadEscalationTargets.mockResolvedValue(['head-1']);
      const task = makeOverdueTask({
        status: 'OVERDUE',
        managerEscalatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h overdue — past the 6h cumulative threshold
      });

      await runWithOverdueTask(task);

      expect(mockOrgPositionService.resolveManagerEscalationTargets).not.toHaveBeenCalled();
      expect(mockOrgPositionService.resolveHeadEscalationTargets).toHaveBeenCalledWith(['assignee-1'], ORG_A);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'head-1' }),
        ORG_A,
      );
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { headEscalatedAt: expect.any(Date) },
      });
    });

    it('passes every active assignee to the resolver and notifies every distinct target it resolves — multi-assignee dedup proven end-to-end through the real sweep', async () => {
      mockOrgPositionService.resolveManagerEscalationTargets.mockResolvedValue(['manager-1', 'manager-2']);
      const task = makeOverdueTask({
        assignees: [
          { userId: 'assignee-1', removedAt: null },
          { userId: 'assignee-2', removedAt: null },
        ],
      });

      await runWithOverdueTask(task);

      expect(mockOrgPositionService.resolveManagerEscalationTargets).toHaveBeenCalledWith(
        ['assignee-1', 'assignee-2'],
        ORG_A,
      );
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'manager-1' }), ORG_A);
      expect(mockNotificationService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'manager-2' }), ORG_A);
    });

    it('fires escalation to an Acting Head resolved by the Head-tier resolver — Acting Head coverage (PD#9) proven end-to-end through the real sweep', async () => {
      mockOrgPositionService.resolveHeadEscalationTargets.mockResolvedValue(['acting-head-1']);
      const task = makeOverdueTask({
        status: 'OVERDUE',
        managerEscalatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        dueAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
      });

      await runWithOverdueTask(task);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'acting-head-1' }),
        ORG_A,
      );
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { headEscalatedAt: expect.any(Date) },
      });
    });

    it('audit-logs a skip, does not throw, when no Manager is resolvable for any assignee', async () => {
      mockOrgPositionService.resolveManagerEscalationTargets.mockResolvedValue([]);
      const task = makeOverdueTask();

      await expect(runWithOverdueTask(task)).resolves.not.toThrow();

      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        tenantId: ORG_A,
        action: 'UPDATE',
        objectType: 'Task',
        objectId: 'task-1',
        metadata: {
          escalationSkipped: true,
          tier: 'MANAGER',
          reason: "No manager resolvable for any of this task's assignees",
        },
      });
      expect(mockPrisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ managerEscalatedAt: expect.any(Date) }) }),
      );
    });

    it('does not fire escalation outside working hours, but still flips status to OVERDUE', async () => {
      mockWorkingCalendar.getOrCreate.mockResolvedValue({ ...ALWAYS_OPEN_CALENDAR, workingDays: [] });
      const task = makeOverdueTask();

      await runWithOverdueTask(task);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'OVERDUE', slaBreachedAt: expect.any(Date) },
      });
      expect(mockOrgPositionService.resolveManagerEscalationTargets).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // ACC-40 Section 2.7 — the simplest sweep step: actingOrgUnitId feeds
  // nothing in Head derivation/vacancy detection, so clearing it on expiry
  // needs no follow-on work at all.
  describe('sweepExpiredActingOrgUnitAssignments (ACC-40 Section 2.7)', () => {
    const EXPIRED_USER = {
      id: 'user-1',
      organizationId: ORG_A,
      actingOrgUnitId: 'unit-x',
      actingOrgUnitUntil: new Date('2026-01-01T00:00:00.000Z'), // in the past
    };

    it('clears actingOrgUnitId/actingOrgUnitUntil for a user past their expiry', async () => {
      mockPrisma.user.findMany.mockResolvedValue([EXPIRED_USER]);

      await runProcess();

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { actingOrgUnitId: null, actingOrgUnitUntil: null },
      });
    });

    it('notifies the affected user that their acting assignment has ended', async () => {
      mockPrisma.user.findMany.mockResolvedValue([EXPIRED_USER]);

      await runProcess();

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        ORG_A,
      );
    });

    it('does nothing when no user has an expired acting-org-unit assignment', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await runProcess();

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    // Confirms Pending Discussion #7 (plan Section 2.7 "THE KEY QUESTION")
    // holds in code, not just in the design document: expiring an
    // acting-org-unit assignment must not touch anything Head-derivation-
    // or vacancy-related — no follow-on work of any kind.
    it('does not touch any workflow, org-position, or role-related mechanism — pure scoping, no side effects', async () => {
      mockPrisma.user.findMany.mockResolvedValue([EXPIRED_USER]);

      await runProcess();

      expect(mockWorkflowService.resolveUnassignedBlockingTransitions).not.toHaveBeenCalled();
      expect(mockWorkflowService.resolveUnreachableTriggerConditionTransitions).not.toHaveBeenCalled();
      expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
      // Exactly one notification — the direct "assignment ended" message to
      // the affected user themself, no admin fan-out of any kind.
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
    });

    // ACC-44 — the query itself (prisma.user.findMany({ where: {
    // actingOrgUnitId: { not: null }, actingOrgUnitUntil: { lte: now } } }))
    // is deliberately global, no organizationId filter — this sweep scans
    // every tenant in one pass, same shape as sweepDueHandovers()/
    // sweepOrgUnitVacancies() above. The isolation concern here isn't a
    // cross-tenant read leak (there's nothing to leak — each returned row
    // already carries its own real organizationId) but whether each
    // user's own update()/notification stays correctly routed to THEIR
    // own id and tenant, never cross-wired with another tenant's expired
    // user in the same pass. No prior test in this block used more than
    // one tenant's worth of fixture data — added here, not just renamed.
    it('should NOT return records belonging to a different tenant', async () => {
      const otherTenantUser = {
        id: 'user-2',
        organizationId: 'org-b-id',
        actingOrgUnitId: 'unit-y',
        actingOrgUnitUntil: new Date('2026-01-01T00:00:00.000Z'),
      };
      mockPrisma.user.findMany.mockResolvedValue([EXPIRED_USER, otherTenantUser]);

      await runProcess();

      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { actingOrgUnitId: null, actingOrgUnitUntil: null },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: { actingOrgUnitId: null, actingOrgUnitUntil: null },
      });

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
        ORG_A,
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-2' }),
        'org-b-id',
      );
    });
  });

  // ACC-40 Section 2.3 — the automatic half of "what closes the window:
  // recommend both, not a single mechanism." Reuses
  // OrgUnitHeadService.completeHandoverAutomatically() rather than
  // duplicating the completion logic here.
  describe('sweepDueHandovers (ACC-40 Section 2.3)', () => {
    const DUE_ORG_UNIT = {
      id: 'unit-1',
      organizationId: ORG_A,
      pendingHeadUserId: 'incoming-user',
      headHandoverEffectiveDate: new Date('2026-01-01T00:00:00.000Z'), // in the past
    };

    it('completes every handover past its declared effectiveDate', async () => {
      mockPrisma.orgUnit.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.pendingHeadUserId !== undefined ? [DUE_ORG_UNIT] : []),
      );

      await runProcess();

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledWith({
        where: { pendingHeadUserId: { not: null }, headHandoverEffectiveDate: { lte: expect.any(Date) } },
      });
      expect(mockOrgUnitHeadService.completeHandoverAutomatically).toHaveBeenCalledWith(DUE_ORG_UNIT, ORG_A);
    });

    it('does nothing when no handover is past its declared effectiveDate', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);

      await runProcess();

      expect(mockOrgUnitHeadService.completeHandoverAutomatically).not.toHaveBeenCalled();
    });

    // ACC-44 — renamed to the exact CI isolation-gate string ("should NOT
    // return records belonging to a different tenant"). Same logic as
    // before (two due handovers from two different tenants in one sweep
    // pass, each routed to its own org via its own organizationId, never
    // cross-wired) — this test was always correct, just invisible to
    // CI's --testNamePattern gate under its old name.
    it('should NOT return records belonging to a different tenant', async () => {
      const otherOrgUnit = { ...DUE_ORG_UNIT, id: 'unit-2', organizationId: 'org-b-id', pendingHeadUserId: 'other-incoming' };
      mockPrisma.orgUnit.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.pendingHeadUserId !== undefined ? [DUE_ORG_UNIT, otherOrgUnit] : []),
      );

      await runProcess();

      expect(mockOrgUnitHeadService.completeHandoverAutomatically).toHaveBeenCalledTimes(2);
      expect(mockOrgUnitHeadService.completeHandoverAutomatically).toHaveBeenCalledWith(DUE_ORG_UNIT, ORG_A);
      expect(mockOrgUnitHeadService.completeHandoverAutomatically).toHaveBeenCalledWith(otherOrgUnit, 'org-b-id');
    });
  });

  // ACC-40 Section 2.5.1 — drift-after-entry re-check for org-unit head
  // vacancy, same shape as sweepUnassignedStages() above. Covers: the
  // duplicate-notification guard (no re-notify on repeated sweeps of an
  // already-flagged, still-fully-vacant chain), and the reminder-cadence
  // test explicitly named in the Phase 6 checkpoint requirements (first
  // notification fires immediately, no repeat before 2 days, a repeat
  // fires correctly once the interval elapses, silence resumes immediately
  // on recovery).
  describe('sweepOrgUnitVacancies (ACC-40 Section 2.5.1)', () => {
    const VACANT_UNIT = {
      id: 'unit-1',
      organizationId: ORG_A,
      nameEn: 'Intensive Care Unit',
      isHeadVacant: true,
      headVacantSince: new Date('2026-08-01T00:00:00.000Z'),
      isHeadFullyUnresolved: false,
      headFullyUnresolvedLastRemindedAt: null as Date | null,
    };

    function mockVacantUnits(units: unknown[]) {
      mockPrisma.orgUnit.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.isHeadVacant !== undefined ? units : []),
      );
    }

    it('is a no-op when there are no isHeadVacant org units at all', async () => {
      mockVacantUnits([]);

      await runProcess();

      expect(mockOrganizationService.resolveActingHeadForOrgUnit).not.toHaveBeenCalled();
    });

    it('leaves a partially-covered vacant unit (an ancestor holds it) untouched — no write, no notify', async () => {
      mockVacantUnits([VACANT_UNIT]); // isHeadFullyUnresolved: false already
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['ancestor-holder']);

      await runProcess();

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).not.toHaveBeenCalled();
    });

    it('on a false→true transition (sweep-discovered), flags isHeadFullyUnresolved, stamps the reminder timestamp, and notifies immediately with first-notification wording', async () => {
      mockVacantUnits([VACANT_UNIT]); // isHeadFullyUnresolved: false
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]); // now fully exhausted

      await runProcess();

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { isHeadFullyUnresolved: true, headFullyUnresolvedLastRemindedAt: expect.any(Date) },
      });
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledWith(
        ORG_A,
        VACANT_UNIT,
        false,
      );
    });

    it('on a true→false transition (an ancestor recovers coverage), clears both fields silently — the duplicate-notification guard\'s symmetric clear case', async () => {
      const fullyUnresolvedUnit = {
        ...VACANT_UNIT,
        isHeadFullyUnresolved: true,
        headFullyUnresolvedLastRemindedAt: new Date('2026-08-10T00:00:00.000Z'),
      };
      mockVacantUnits([fullyUnresolvedUnit]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['newly-available-ancestor']);

      await runProcess();

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { isHeadFullyUnresolved: false, headFullyUnresolvedLastRemindedAt: null },
      });
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).not.toHaveBeenCalled();
    });

    // The duplicate-notification guard itself: re-sweeping an
    // already-flagged, still-fully-vacant chain must not re-notify —
    // exact discipline sweepUnassignedStages() already proved once.
    it('does not re-notify on repeated sweeps of an already-flagged, still-fully-vacant chain — no state change, no write at all', async () => {
      const fullyUnresolvedUnit = {
        ...VACANT_UNIT,
        isHeadFullyUnresolved: true,
        // Reminded 1 hour ago — well within the 2-day interval, so this
        // pass must stay completely silent (no write, no notify).
        headFullyUnresolvedLastRemindedAt: new Date(Date.now() - 60 * 60 * 1000),
      };
      mockVacantUnits([fullyUnresolvedUnit]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]); // still fully exhausted

      await runProcess();

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).not.toHaveBeenCalled();
    });

    it('does not send a reminder before the 2-day interval has elapsed', async () => {
      const almostDue = {
        ...VACANT_UNIT,
        isHeadFullyUnresolved: true,
        // 1 day 23 hours ago — just under the 2-day threshold.
        headFullyUnresolvedLastRemindedAt: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)),
      };
      mockVacantUnits([almostDue]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]);

      await runProcess();

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).not.toHaveBeenCalled();
    });

    it('sends a reminder once the 2-day interval has elapsed, stating the actual elapsed duration via the reminder wording flag', async () => {
      const dueForReminder = {
        ...VACANT_UNIT,
        isHeadFullyUnresolved: true,
        // Just over 2 days ago.
        headFullyUnresolvedLastRemindedAt: new Date(Date.now() - (2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000)),
      };
      mockVacantUnits([dueForReminder]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]);

      await runProcess();

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { headFullyUnresolvedLastRemindedAt: expect.any(Date) },
      });
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledWith(
        ORG_A,
        dueForReminder,
        true, // isReminder — the reminder wording, not the first-notification wording
      );
    });

    it('resumes silence immediately on recovery — no lingering reminder cadence once cleared', async () => {
      // A unit that was fully unresolved and overdue for a reminder, but
      // this same sweep pass finds it's now covered by an ancestor —
      // resolveActingHeadForOrgUnit's fresh result governs, not the stale
      // reminder timestamp.
      const recoveredButOverdue = {
        ...VACANT_UNIT,
        isHeadFullyUnresolved: true,
        headFullyUnresolvedLastRemindedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      };
      mockVacantUnits([recoveredButOverdue]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['recovered-ancestor']);

      await runProcess();

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: { isHeadFullyUnresolved: false, headFullyUnresolvedLastRemindedAt: null },
      });
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      const otherTenantUnit = { ...VACANT_UNIT, id: 'unit-2', organizationId: 'org-b-id' };
      mockVacantUnits([VACANT_UNIT, otherTenantUnit]);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockImplementation((_id: string, organizationId: string) =>
        Promise.resolve(organizationId === ORG_A ? [] : ['org-b-holder']),
      );

      await runProcess();

      // ORG_A's unit is fully exhausted and notified; org-b's unit is
      // resolved by its own holder and correctly left untouched — the
      // resolver call for each unit is scoped to that unit's own
      // organizationId, never leaking cross-tenant.
      expect(mockOrganizationService.resolveActingHeadForOrgUnit).toHaveBeenCalledWith('unit-1', ORG_A);
      expect(mockOrganizationService.resolveActingHeadForOrgUnit).toHaveBeenCalledWith('unit-2', 'org-b-id');
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledTimes(1);
      expect(mockOrganizationService.notifyTenantAdminsOfOrgUnitVacancy).toHaveBeenCalledWith(ORG_A, VACANT_UNIT, false);
    });
  });

  // ACC-43 — wires OrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings()
  // (2.9e) into this sweep. That method existed and was unit-tested (in its
  // own spec) since ACC-40 Phase 12 but was never called from anywhere in
  // the running app until this ticket — found during ACC-43's live
  // verification pass. These tests cover the sweep's own wiring (which
  // tenants it decides to call the method for), not the method's internal
  // notification logic, which is already covered by org-position.service.spec.ts.
  //
  // orgUnit.findMany's `where: { isHeadVacant: true }` shape is shared with
  // sweepOrgUnitVacancies() above, so these mocks distinguish the two calls
  // by the presence of `select`/`distinct` (only this sweep's query uses
  // them) rather than by `where` alone.
  describe('sweepVacantHeadRoleMappings (ACC-43 / 2.9e)', () => {
    function mockVacantUnitOrgs(rows: { organizationId: string }[]) {
      mockPrisma.orgUnit.findMany.mockImplementation(({ where, select }: any) =>
        Promise.resolve(where?.isHeadVacant !== undefined && select ? rows : []),
      );
    }

    function mockUnmappedPositionOrgs(rows: { organizationId: string }[]) {
      mockPrisma.orgPosition.findMany.mockResolvedValue(rows);
    }

    it('is a no-op when there are no vacant units and no unmapped head-conferring positions', async () => {
      await runProcess();

      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).not.toHaveBeenCalled();
    });

    it('calls the method for a tenant with an unmapped head-conferring position, even with no vacant units', async () => {
      mockUnmappedPositionOrgs([{ organizationId: ORG_A }]);

      await runProcess();

      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledTimes(1);
      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledWith(ORG_A);
    });

    it('calls the method for a tenant with a vacant unit, even with no unmapped positions', async () => {
      mockVacantUnitOrgs([{ organizationId: ORG_A }]);

      await runProcess();

      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledTimes(1);
      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledWith(ORG_A);
    });

    it('calls the method exactly once for a tenant flagged by both signals — deduplicated, not called twice', async () => {
      mockVacantUnitOrgs([{ organizationId: ORG_A }]);
      mockUnmappedPositionOrgs([{ organizationId: ORG_A }]);

      await runProcess();

      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledTimes(1);
      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledWith(ORG_A);
    });

    it('should NOT return records belonging to a different tenant — calls each flagged tenant separately, scoped to its own organizationId', async () => {
      mockVacantUnitOrgs([{ organizationId: ORG_A }]);
      mockUnmappedPositionOrgs([{ organizationId: 'org-b-id' }]);

      await runProcess();

      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledTimes(2);
      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledWith(ORG_A);
      expect(mockOrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings).toHaveBeenCalledWith('org-b-id');
    });
  });
});
