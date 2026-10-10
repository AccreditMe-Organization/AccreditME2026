import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { DateTime } from 'luxon';
import { WorkflowService } from './workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TaskService } from '../task/task.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowRefusalException } from './workflow-refusal';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
// ACC-101 — the permission set the route hands the service. The visibility
// check is proven in workflow-parent-visibility.spec.ts; here it is stubbed.
// ACC-101 — see task.service.spec.ts: these exercise label RESOLUTION, so the
// viewer holds the permissions the labels require.
const VIEWER_PERMISSIONS = ['workflows:view', 'committees:view', 'org:view', 'users:view'];
const VIEWER_ID = 'viewer-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';

const BASE_TEMPLATE = {
  id: 'template-1',
  organizationId: ORG_A,
  objectType: 'DOCUMENT',
  isDefault: true,
  isActive: true,
};

const SINGLE_STAGE = {
  id: 'stage-single',
  workflowTemplateId: 'template-1',
  nameEn: 'Drafting',
  order: 10,
  slaWorkingHours: null as number | null,
  isInitial: true,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null as string | null,
  committeeId: null as string | null,
  assigneeStrategy: 'SELF',
  assigneeUserId: null as string | null,
  assigneeRoleId: null as string | null,
};

const PARALLEL_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-parallel',
  isInitial: false,
  approvalMode: 'PARALLEL',
  parallelThreshold: 'ALL',
  assigneeStrategy: 'ROLE',
  assigneeRoleId: 'role-qm',
};

const COMMITTEE_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-committee',
  isInitial: false,
  approvalMode: 'COMMITTEE',
  assigneeStrategy: 'COMMITTEE',
  committeeId: 'committee-a',
};

// ACC-40 Section 2.6.2
const ORG_UNIT_HEAD_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-org-unit-head',
  isInitial: false,
  approvalMode: 'PARALLEL',
  parallelThreshold: 'ALL',
  assigneeStrategy: 'ORG_UNIT_HEAD',
};

const TARGET_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-target',
  isInitial: false,
  isFinal: false,
};

const FINAL_STAGE = { ...TARGET_STAGE, id: 'stage-final', isFinal: true };

const BASE_INSTANCE = {
  id: 'instance-1',
  organizationId: ORG_A,
  workflowTemplateId: 'template-1',
  objectType: 'DOCUMENT',
  objectId: 'object-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-single',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ACC-34 — resolveObjectSubjectLabel() keys off instance.objectId (always
// populated), not stage.committeeId (a different, frequently-unset field).
// objectId deliberately differs from any stage's committeeId in these
// fixtures, so a test can't accidentally pass by keying off the wrong field.
const COMMITTEE_INSTANCE = {
  ...BASE_INSTANCE,
  objectType: 'COMMITTEE',
  objectId: 'committee-real-id',
};

const BASE_INSTANCE_STAGE = {
  id: 'instance-stage-1',
  workflowInstanceId: 'instance-1',
  stageId: 'stage-single',
  enteredAt: new Date(),
  exitedAt: null as Date | null,
  slaDueAt: null as Date | null,
  slaBreached: false,
  outcome: 'PENDING',
  actorId: ACTOR,
  comment: null as string | null,
};

const BASE_TRANSITION = {
  id: 'transition-1',
  fromStageId: 'stage-single',
  toStageId: 'stage-target',
  labelEn: 'Submit',
  labelAr: 'إرسال',
  requiredPermission: null as string | null,
  triggerCondition: 'ANY_AUTHENTICATED',
  triggerUserId: null as string | null,
  triggerRoleId: null as string | null,
  validatorConfig: null as unknown,
  isApprovalPath: false,
  kind: 'ADVANCE' as 'ADVANCE' | 'RETURN' | 'EXIT',
};

const BASE_APPROVAL = {
  id: 'approval-1',
  workflowInstanceStageId: 'instance-stage-1',
  approverId: ACTOR,
  decision: 'PENDING',
  comment: null as string | null,
  decidedAt: null as Date | null,
  createdAt: new Date(),
};

const makeInstance = (overrides: Partial<typeof BASE_INSTANCE> = {}) => ({
  ...BASE_INSTANCE,
  ...overrides,
});
const makeInstanceStage = (overrides: Partial<typeof BASE_INSTANCE_STAGE> = {}) => ({
  ...BASE_INSTANCE_STAGE,
  ...overrides,
});
const makeTransition = (overrides: Partial<typeof BASE_TRANSITION> = {}) => ({
  ...BASE_TRANSITION,
  ...overrides,
});
const makeApproval = (overrides: Partial<typeof BASE_APPROVAL> = {}) => ({
  ...BASE_APPROVAL,
  ...overrides,
});

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  workflowTemplate: { findFirst: jest.fn() },
  workflowStage: { findFirst: jest.fn(), findMany: jest.fn() },
  workflowInstance: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workflowInstanceStage: {
    findFirst: jest.fn(),
    // ACC-76 — getStageHistory() reads the whole visit chronology.
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  workflowTransition: { findFirst: jest.fn(), findMany: jest.fn() },
  workflowTransitionAction: { findMany: jest.fn() },
  workflowActionLog: { create: jest.fn() },
  workflowApproval: { upsert: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  // ACC-65 — allPreviousStageTasksComplete queries Task directly. Defaults to
  // [] in beforeEach so every pre-existing transition test is unaffected.
  task: { findMany: jest.fn() },
  userRole: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  committee: { findFirst: jest.fn() },
  committeeMember: { findMany: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  role: { findFirst: jest.fn() },
  // ACC-76 — findMany added for DelegationLabelService; getStageHistory()
  // also diffs visits against the template via workflowStage.findMany.
  orgUnit: { findFirst: jest.fn(), findMany: jest.fn() },
  orgPosition: { findFirst: jest.fn() },
  // ACC-190 — a stage change is one transaction under the instance's row lock.
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
};
// The transaction runs its callback against this same mock, so every existing
// expectation on mockPrisma still sees the writes.
mockPrisma.$transaction.mockImplementation((fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
// ACC-68 — performTransition() cancels the entry it is leaving; cancelInstance()
// cancels the whole instance. ACC-190 — the entry's cancel runs inside the
// stage-change transaction and is audited after it; the new entry's tasks are
// inserted inside it and announced after.
const mockTaskService = {
  cancelStageExitTasksInTx: jest.fn(),
  auditStageExitCancellation: jest.fn(),
  insertPrepared: jest.fn(),
  announceCreated: jest.fn(),
  cancelForInstance: jest.fn(),
};
// ACC-190 — what entering a stage creates. Defaults to nothing, so every test
// that does not care about stage tasks is unaffected.
const mockStageTaskDefinitions = { prepareEntryTasks: jest.fn() };
const mockRoleService = { getUserPermissions: jest.fn() };
const mockOrganizationService = { resolveActingHeadForOrgUnit: jest.fn() };
const mockQueue = { add: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

// ⚠️ MOCKING RULE FOR THIS FILE — any mock of `mockPrisma.user.findMany`
// MUST honor the `id: { in: [...] }` filter.
//
// Assignee resolution queries user.findMany TWICE per call: once for the
// strategy's own lookup (ROLE via userRole, POSITION_FIXED via user directly,
// etc.), and then again inside applyOutOfOfficeRouting(), which re-queries
// `{ id: { in: <whatever the first call resolved> }, organizationId }` to
// check each resolved user's out-of-office window. The same is true of
// resolveApproverPool(), which ends in the same applyOutOfOfficeRouting()
// call.
//
// A blanket `mockResolvedValue([...])` answers BOTH queries identically and
// silently corrupts the pool in one of two directions:
//   - returns MORE than the first call resolved → re-expands a pool that
//     SINGLE mode had just narrowed to one assignee;
//   - returns [] or fewer → empties a pool that should be populated, so a
//     gate under test is skipped and the test fails for a reason unrelated
//     to the code being tested.
//
// Both failure modes have already occurred in this file's history (ACC-54:
// once on the SINGLE-narrowing test, once on the approver-eligibility test),
// each time producing a red test that looked like a bug in the
// implementation and was not. Use mockImplementation and filter:
//
//   mockPrisma.user.findMany.mockImplementation(({ where }) =>
//     Promise.resolve(where.id?.in ? holders.filter((h) => where.id.in.includes(h.id)) : holders),
//   );
describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([]);
    // ACC-65 — default to no outstanding stage tasks, so every transition
    // test that does not care about task gating is unaffected.
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.workflowInstanceStage.create.mockResolvedValue(BASE_INSTANCE_STAGE);
    mockPrisma.workflowInstanceStage.update.mockResolvedValue(BASE_INSTANCE_STAGE);
    // ACC-28 Section 2.5 — default: no ASSIGNEE_POOL outgoing transitions, so
    // checkAndFlagUnassignedStage() is a no-op for every pre-existing test.
    // Tests that specifically exercise 2.5 override this per-case.
    mockPrisma.workflowTransition.findMany.mockResolvedValue([]);
    // Default: no user is out-of-office — applyOutOfOfficeRouting() passes
    // resolveAssignee()'s raw result through unchanged for existing tests.
    mockPrisma.user.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        where.id.in.map((id) => ({ id, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null })),
      ),
    );
    mockTaskService.cancelStageExitTasksInTx.mockResolvedValue({ open: [], cancelledRequests: [] });
    mockTaskService.insertPrepared.mockImplementation((_tx: unknown, prepared: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `task-${String(prepared.data['stageTaskDefinitionId'])}`, ...prepared.data }),
    );
    mockStageTaskDefinitions.prepareEntryTasks.mockResolvedValue({ tasks: [], warnings: [] });
    // ACC-40 Section 2.6.3 — defaults for the two new delegation-stamp
    // resolvers: no real holder found (user.count: 0) and no OrgUnit found
    // (orgUnit.findFirst: null) — resolveActingHeadOrgUnitIdForUser() falls
    // through to null for every pre-existing test. Tests exercising these
    // resolvers directly override per-case.
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
    // ACC-40 Section 2.6.2 — default: submitApproval() now fetches the
    // WorkflowInstance itself (for resolveApproverPool()'s ORG_UNIT_HEAD
    // case), previously only maybeAdvanceAfterApproval() did via
    // findUnique(). Tests needing a specific instance state (e.g.
    // currentStageId) override this per-case via findFirst, not findUnique
    // — findUnique is no longer called anywhere in this path.
    mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        // The REAL service (it takes only PrismaService) — mocking it would
        // hide the tenant scoping its own isolation test exists to prove.
        DelegationLabelService,
        // ACC-101 — permissive stub: these tests exercise the ENGINE, which
        // acts on its own behalf and has no viewer. The parent check is proven
        // at the route, in workflow-parent-visibility.spec.ts.
        {
          provide: ObjectVisibilityService,
          useValue: { assertCanView: jest.fn(), assertCanViewOrNotFound: jest.fn() },
        },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: OrganizationService, useValue: mockOrganizationService },
        { provide: getQueueToken('workflow-actions'), useValue: mockQueue },
        { provide: StageTaskDefinitionService, useValue: mockStageTaskDefinitions },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
  });

  // ── startInstance ────────────────────────────────────────────────────────────

  describe('startInstance', () => {
    it("creates the instance at the template's initial stage", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'IN_PROGRESS', currentStageId: 'stage-single' }),
        }),
      );
    });

    it('computes slaDueAt via WorkingCalendarService when the stage has slaWorkingHours', async () => {
      const stageWithSla = { ...SINGLE_STAGE, slaWorkingHours: 16 };
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(stageWithSla);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      const deadline = DateTime.fromJSDate(new Date('2026-02-01T00:00:00Z'));
      mockWorkingCalendar.calculateDeadline.mockResolvedValue(deadline);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockWorkingCalendar.calculateDeadline).toHaveBeenCalledWith(
        expect.any(DateTime),
        16,
        ORG_A,
      );
      expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ slaDueAt: deadline.toJSDate() }) }),
      );
    });

    it("notifies the initial stage's resolved assignee", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ACTOR }),
        ORG_A,
      );
    });

    it('throws NotFoundException when no active default template exists', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.workflowInstance.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the template has no initial stage', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(null);

      await expect(service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('writes a CREATE audit log entry', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'WorkflowInstance' }),
      );
    });
  });

  // ── getInstanceById ──────────────────────────────────────────────────────────

  describe('getInstanceById', () => {
    it('returns the instance when found', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);

      const result = await service.getInstanceById('instance-1', ORG_A);

      expect(result.id).toBe('instance-1');
    });

    it('throws NotFoundException for a missing or cross-tenant instance', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

      await expect(service.getInstanceById('instance-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  // ── getInstancesByObject ─────────────────────────────────────────────────────

  describe('getInstancesByObject', () => {
    it('returns all instances for an object, newest first', async () => {
      mockPrisma.workflowInstance.findMany.mockResolvedValue([
        makeInstance({ id: 'instance-2' }),
        BASE_INSTANCE,
      ]);

      const result = await service.getInstancesByObject('DOCUMENT', 'object-1', ORG_A, VIEWER_PERMISSIONS);

      expect(result).toHaveLength(2);
      expect(mockPrisma.workflowInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });
  });

  // ── getStageHistory (ACC-76) ─────────────────────────────────────────────────

  describe('getStageHistory (ACC-76)', () => {
    // Committee's own seeded template: Formation, Terms Review, Active,
    // Suspended, Dissolution Pending, Dissolved. Only the first three matter
    // to these tests.
    const TEMPLATE_STAGES = [
      { id: 'stage-formation', nameEn: 'Formation', nameAr: 'التكوين', order: 1 },
      { id: 'stage-terms', nameEn: 'Terms Review', nameAr: 'مراجعة النظام', order: 2 },
      { id: 'stage-active', nameEn: 'Active', nameAr: 'نشط', order: 3 },
    ];

    const visit = (
      id: string,
      stageId: string,
      enteredAt: string,
      exitedAt: string | null,
      extra: Record<string, unknown> = {},
    ) => ({
      ...BASE_INSTANCE_STAGE,
      id,
      stageId,
      enteredAt: new Date(enteredAt),
      exitedAt: exitedAt ? new Date(exitedAt) : null,
      actorId: null,
      comment: null,
      isUnassigned: false,
      delegationReason: null,
      delegationContextId: null,
      stage: TEMPLATE_STAGES.find((s) => s.id === stageId)!,
      ...extra,
    });

    beforeEach(() => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue({
        id: 'instance-1',
        workflowTemplateId: 'template-1',
      });
      mockPrisma.workflowStage.findMany.mockResolvedValue(TEMPLATE_STAGES);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
    });

    // THE test for this feature's shape. A committee that took the
    // "Revise Terms" transition back to Formation has been in two stages but
    // made FOUR visits. Any representation that collapses this to "step 2 of
    // 6" states something false about the record — which is why the history
    // is a chronology rather than a progression over WorkflowStage.order.
    it('preserves a stage entered more than once as separate visits, in order', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', '2026-01-03T09:00:00Z'),
        visit('is-3', 'stage-formation', '2026-01-03T09:00:00Z', '2026-01-04T09:00:00Z'),
        visit('is-4', 'stage-terms', '2026-01-04T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits).toHaveLength(4);
      expect(result.visits.map((v) => v.stageId)).toEqual([
        'stage-formation',
        'stage-terms',
        'stage-formation',
        'stage-terms',
      ]);
      // Each visit is keyed by its own instance-stage row, never the stage id
      // — two visits to one stage would otherwise collide as list keys.
      expect(new Set(result.visits.map((v) => v.id)).size).toBe(4);
      expect(mockPrisma.workflowInstanceStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { enteredAt: 'asc' } }),
      );
    });

    // The current stage is the OPEN visit, not a currentStageId comparison —
    // with a repeat, currentStageId cannot say which visit is live.
    it('marks exactly one visit as open when the instance is running', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits.filter((v) => v.exitedAt === null)).toHaveLength(1);
      expect(result.visits.find((v) => v.exitedAt === null)!.id).toBe('is-2');
    });

    // The SEQUENCE view — every template stage, always, in order. Distinct
    // from the chronology above and not derivable from it: visit rows carry no
    // `order`, so a client given only `visits` cannot reconstruct the process.
    it('returns every template stage in order, reached or not', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.stages.map((s) => s.id)).toEqual([
        'stage-formation',
        'stage-terms',
        'stage-active',
      ]);
      expect(result.stages.map((s) => s.visitCount)).toEqual([1, 0, 0]);
      expect(result.stages.map((s) => s.isCurrent)).toEqual([true, false, false]);
    });

    // How a linear sequence admits a loop honestly: it counts the visits
    // rather than flattening them to "visited".
    it('counts repeat visits on the sequence entry', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', '2026-01-03T09:00:00Z'),
        visit('is-3', 'stage-formation', '2026-01-03T09:00:00Z', '2026-01-04T09:00:00Z'),
        visit('is-4', 'stage-terms', '2026-01-04T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.stages.map((s) => s.visitCount)).toEqual([2, 2, 0]);
      // Current is the stage holding the OPEN visit — the second Terms Review,
      // not the first, and not Formation despite it also being visited twice.
      expect(result.stages.filter((s) => s.isCurrent).map((s) => s.id)).toEqual(['stage-terms']);
    });

    it('marks no stage current once every visit has been exited', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.stages.some((s) => s.isCurrent)).toBe(false);
    });

    it('returns the full sequence even for an instance with no visits yet', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.stages.length).toBe(3);
      expect(result.stages.every((s) => s.visitCount === 0 && !s.isCurrent)).toBe(true);
      expect(result.visits).toEqual([]);
    });

    it('resolves actor names and leaves an unresolvable actor null', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-sarah', name: 'Sarah' }]);
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z', {
          actorId: 'user-sarah',
        }),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', null, { actorId: 'user-gone' }),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits[0]!.actorName).toBe('Sarah');
      expect(result.visits[1]!.actorName).toBeNull();
    });

    // ACC-40 §2.6.3's stamp reaching a surface for the first time — this is
    // what lets a row read "Sarah — Acting Head of Cardiology" instead of
    // implying Sarah holds the position outright.
    it('resolves the delegation qualifier on a visit', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'user-sarah', name: 'Sarah' }]);
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: 'unit-cardiology', nameEn: 'Cardiology', nameAr: 'القلب' },
      ]);
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', null, {
          actorId: 'user-sarah',
          delegationReason: 'ACTING_HEAD',
          delegationContextId: 'unit-cardiology',
        }),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits[0]!.delegation).toEqual({
        reason: 'ACTING_HEAD',
        contextId: 'unit-cardiology',
        contextLabelEn: 'Cardiology',
        contextLabelAr: 'القلب',
      });
    });

    // WorkflowInstanceStage carries no organizationId of its own — tenancy is
    // transitive through workflowInstance. Asserted explicitly because the
    // scoping is easy to drop silently when the parent check above already
    // appears to cover it.
    it('scopes the visit query relationally, not just via the parent check', async () => {
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([]);

      await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(mockPrisma.workflowInstanceStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workflowInstanceId: 'instance-1', workflowInstance: { organizationId: ORG_A } },
        }),
      );
    });

    // ── transition inference + comment attribution (ACC-76) ────────────────

    // Committee's own seeded transitions for the stages above. No pair repeats
    // — which is what makes inference from a from/to pair safe.
    const TEMPLATE_TRANSITIONS = [
      {
        fromStageId: 'stage-formation',
        toStageId: 'stage-terms',
        labelEn: 'Submit for Approval',
        labelAr: 'إرسال للاعتماد',
      },
      {
        fromStageId: 'stage-terms',
        toStageId: 'stage-formation',
        labelEn: 'Revise Terms',
        labelAr: 'مراجعة النظام الداخلي',
      },
      {
        fromStageId: 'stage-terms',
        toStageId: 'stage-active',
        labelEn: 'Approve Committee',
        labelAr: 'اعتماد اللجنة',
      },
    ];

    it('names the transition that caused each visit, including a loop', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue(TEMPLATE_TRANSITIONS);
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', '2026-01-03T09:00:00Z'),
        visit('is-3', 'stage-formation', '2026-01-03T09:00:00Z', '2026-01-04T09:00:00Z'),
        visit('is-4', 'stage-terms', '2026-01-04T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits.map((v) => v.transitionLabelEn)).toEqual([
        // The first visit was not transitioned into — the instance started there.
        null,
        'Submit for Approval',
        // The loop: Terms Review sent it BACK, which is a different transition
        // from the one that first brought it forward.
        'Revise Terms',
        'Submit for Approval',
      ]);
    });

    // A pair with two transitions cannot be told apart from the visit rows
    // alone. Naming the wrong action in a compliance trail is worse than
    // naming none.
    it('names no transition when a from/to pair is ambiguous', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([
        ...TEMPLATE_TRANSITIONS,
        {
          fromStageId: 'stage-formation',
          toStageId: 'stage-terms',
          labelEn: 'Fast-track Approval',
          labelAr: 'اعتماد سريع',
        },
      ]);
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z'),
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', null),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result.visits[1]!.transitionLabelEn).toBeNull();
      expect(result.visits[1]!.transitionLabelAr).toBeNull();
    });

    // THE ATTRIBUTION TEST. A comment is written onto the row being LEFT, so
    // it explains the transition into the NEXT stage. Showing it beside this
    // row's own actor names the wrong person for the wrong event — and looks
    // right while doing so.
    it('shows a comment against the transition it explains, not the stage it was written on', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue(TEMPLATE_TRANSITIONS);
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'user-nora', name: 'Nora' },
        { id: 'user-ahmad', name: 'Ahmad' },
      ]);
      mockPrisma.workflowInstanceStage.findMany.mockResolvedValue([
        visit('is-1', 'stage-formation', '2026-01-01T09:00:00Z', '2026-01-02T09:00:00Z', {
          actorId: 'user-nora',
        }),
        // Ahmad returned it from Terms Review, writing his reason on THIS row
        // as he left it.
        visit('is-2', 'stage-terms', '2026-01-02T09:00:00Z', '2026-01-03T09:00:00Z', {
          actorId: 'user-nora',
          comment: 'scope unclear',
        }),
        visit('is-3', 'stage-formation', '2026-01-03T09:00:00Z', null, {
          actorId: 'user-ahmad',
        }),
      ]);

      const result = await service.getStageHistory('instance-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      // "scope unclear" explains the Revise Terms transition, which Ahmad
      // fired and which landed on Formation.
      expect(result.visits[2]).toMatchObject({
        stageId: 'stage-formation',
        transitionLabelEn: 'Revise Terms',
        actorName: 'Ahmad',
        comment: 'scope unclear',
      });
      // And it must NOT still sit on the Terms Review row beside Nora, which
      // is where the raw column holds it.
      expect(result.visits[1]!.comment).toBeNull();
    });

    itEnforcesTenantIsolation('getStageHistory', async () => {
      mockPrisma.workflowInstance.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(
          where.organizationId === ORG_A
            ? { id: 'instance-1', workflowTemplateId: 'template-1' }
            : null,
        ),
      );

      await expect(service.getStageHistory('instance-1', ORG_B, VIEWER_PERMISSIONS, VIEWER_ID)).rejects.toThrow(NotFoundException);
      // Never reached the history at all — not merely filtered afterwards.
      expect(mockPrisma.workflowInstanceStage.findMany).not.toHaveBeenCalled();
    });
  });

  // ── cancelInstance ───────────────────────────────────────────────────────────

  describe('cancelInstance', () => {
    it('sets status to CANCELLED and exits any open stage with outcome SKIPPED', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);

      await service.cancelInstance('instance-1', ORG_A, ACTOR, 'abandoned');

      expect(mockPrisma.workflowInstanceStage.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ outcome: 'SKIPPED' }) }),
      );
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    // ACC-68 — before this, force-cancelling a workflow closed every stage and
    // flipped the instance but left every one of its tasks open.
    it('cancels the open tasks of the whole instance, not just the current stage', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);

      await service.cancelInstance('instance-1', ORG_A, ACTOR, 'abandoned');

      expect(mockTaskService.cancelForInstance).toHaveBeenCalledWith('instance-1', ORG_A, ACTOR);
      expect(mockTaskService.cancelStageExitTasksInTx).not.toHaveBeenCalled();
    });

    it('throws ConflictException if already CANCELLED', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ status: 'CANCELLED' }));

      await expect(service.cancelInstance('instance-1', ORG_A, ACTOR, 'x')).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not cancel any task when the instance is already closed', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ status: 'COMPLETED' }));

      await expect(service.cancelInstance('instance-1', ORG_A, ACTOR, 'x')).rejects.toThrow(
        ConflictException,
      );
      expect(mockTaskService.cancelForInstance).not.toHaveBeenCalled();
    });

    it('throws ConflictException if already COMPLETED', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ status: 'COMPLETED' }));

      await expect(service.cancelInstance('instance-1', ORG_A, ACTOR, 'x')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for a cross-tenant instance', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

      await expect(service.cancelInstance('instance-1', ORG_B, ACTOR, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('writes an audit log entry with the cancellation reason in metadata', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);

      await service.cancelInstance('instance-1', ORG_A, ACTOR, 'abandoned');

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { reason: 'abandoned' } }),
      );
    });
  });

  // ── triggerTransition — SINGLE approval mode ─────────────────────────────────

  describe('triggerTransition — SINGLE approval mode', () => {
    function mockStagesById(map: Record<string, unknown>) {
      mockPrisma.workflowStage.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) => Promise.resolve(map[where.id] ?? null),
      );
    }

    it('advances immediately to the target stage', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStageId: 'stage-target' }) }),
      );
    });

    it('sets status COMPLETED when the target stage is final', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ toStageId: 'stage-final' }),
      );
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-final': FINAL_STAGE });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ status: 'COMPLETED' }));

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it("fires the transition's actions", async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'LOG_AUDIT', order: 10, isEnabled: true },
      ]);
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actionType: 'LOG_AUDIT', status: 'SUCCESS' }) }),
      );
    });

    // ACC-68 — regression test for the orphaned-task bug found during ACC-65's
    // live verification. A committee took the ungated "Revise Terms" transition
    // out of Terms Review and its open task stayed PENDING, gating nothing;
    // re-entering the stage then stacked a second task on the first.
    // ACC-190 — the cancel is keyed by the ENTRY being left, inside the
    // stage-change transaction.
    it('cancels the open tasks of the ENTRY being left, inside the transaction', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...SINGLE_STAGE, id: 'stage-target' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([]);
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      // The FROM entry — its own tasks by its id, and legacy tasks by the
      // from-stage id (Task.sourceStageId holds the stage a task was created
      // FOR), never transition.toStageId.
      const scope = {
        workflowInstanceId: 'instance-1',
        stageId: BASE_INSTANCE_STAGE.stageId,
        workflowInstanceStageId: BASE_INSTANCE_STAGE.id,
      };
      expect(mockTaskService.cancelStageExitTasksInTx).toHaveBeenCalledWith(mockPrisma, scope, ORG_A);
      expect(mockTaskService.auditStageExitCancellation).toHaveBeenCalledWith(
        { open: [], cancelledRequests: [] },
        scope,
        ORG_A,
        ACTOR,
      );
    });

    // ── Assignee resolution, through SEND_NOTIFICATION ───────────────────────
    // ACC-190 — these pinned resolveAssigneeRaw()'s strategies through
    // CREATE_TASK, which is retired. The strategies still decide who a
    // SEND_NOTIFICATION reaches (and who may approve), so they are pinned here
    // through the action that still uses them.
    const notifyAction = [
      { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'SEND_NOTIFICATION', order: 10, isEnabled: true },
    ];
    const notifiedUserIds = () =>
      (mockNotificationService.create.mock.calls as [{ userId: string; titleEn: string }, string][])
        .filter(([n]) => n.titleEn === BASE_TRANSITION.labelEn)
        .map(([n]) => n.userId);

    // Regression test for the bug fixed in Step 8 (ACC-11): only the first
    // resolved assignee was ever used, silently dropping the rest of a
    // multi-approver (ROLE-resolved to several holders) stage.
    it('reaches the FULL resolved assignee list, not just the first', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...PARALLEL_STAGE, id: 'stage-target' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue(notifyAction);
      mockPrisma.userRole.findMany.mockResolvedValue([
        { userId: 'holder-1' },
        { userId: 'holder-2' },
        { userId: 'holder-3' },
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(notifiedUserIds()).toEqual(['holder-1', 'holder-2', 'holder-3']);
    });

    // ACC-22, closing the ACC-17 deferred gap: the COMMITTEE case is org-scoped
    // and reads active members only.
    it("resolves a COMMITTEE stage to its active, org-scoped members", async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...TARGET_STAGE, assigneeStrategy: 'COMMITTEE', committeeId: 'committee-a' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue(notifyAction);
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'member-1' }, { userId: 'member-2' }]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: { committeeId: 'committee-a', organizationId: ORG_A, isActive: true },
      });
      expect(notifiedUserIds()).toEqual(['member-1', 'member-2']);
    });

    // ACC-28 — assigneeCommitteeRoleValueId narrows the COMMITTEE case to one
    // committee_member_role.
    it("narrows a COMMITTEE stage to a specific committee_member_role when assigneeCommitteeRoleValueId is set", async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': {
          ...TARGET_STAGE,
          assigneeStrategy: 'COMMITTEE',
          committeeId: 'committee-a',
          assigneeCommitteeRoleValueId: 'lookup-chairman-id',
        },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue(notifyAction);
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'chairman-user' }]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: { committeeId: 'committee-a', organizationId: ORG_A, isActive: true, roleValueId: 'lookup-chairman-id' },
      });
      expect(notifiedUserIds()).toEqual(['chairman-user']);
    });

    // ACC-54 — POSITION_FIXED: whoever holds a specific position in a
    // specific, explicitly-configured unit.
    const positionFixedStage = (overrides: Record<string, unknown> = {}) => ({
      ...TARGET_STAGE,
      assigneeStrategy: 'POSITION_FIXED',
      assigneePositionId: 'position-a',
      assigneeOrgUnitId: 'unit-a',
      ...overrides,
    });

    // resolveAssignee() calls prisma.user.findMany TWICE for this strategy:
    // once for the holder lookup, then again inside applyOutOfOfficeRouting()
    // with `id: { in: [...] }` over whatever the first call resolved — so this
    // honors the id filter (see the mocking rule at the top of the file).
    const mockPositionHolders = (holders: { id: string }[]) => {
      mockPrisma.user.findMany.mockImplementation(
        ({ where }: { where: { id?: { in: string[] }; organizationId: string } }) =>
          Promise.resolve(where.id?.in ? holders.filter((h) => where.id!.in.includes(h.id)) : holders),
      );
    };

    const runPositionFixedTransition = async (stage: Record<string, unknown>) => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': stage });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue(notifyAction);
      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);
    };

    it('resolves a POSITION_FIXED stage to the ACTIVE holder in that unit', async () => {
      mockPositionHolders([{ id: 'holder-1' }]);

      await runPositionFixedTransition(positionFixedStage());

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, positionId: 'position-a', primaryOrgUnitId: 'unit-a', status: 'ACTIVE' },
        select: { id: true },
      });
      expect(notifiedUserIds()).toEqual(['holder-1']);
    });

    // An unresolvable pool must come back EMPTY, never throw: a throw here
    // would abort the transition and, via the sweep, every other step in it.
    it('resolves to nobody, rather than throwing, when no one holds the position in that unit', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await expect(runPositionFixedTransition(positionFixedStage())).resolves.not.toThrow();
      expect(notifiedUserIds()).toEqual([]);
    });

    it.each([
      ['position', { assigneePositionId: null }],
      ['org unit', { assigneeOrgUnitId: null }],
      ['both fields', { assigneePositionId: null, assigneeOrgUnitId: null }],
    ])('resolves to nobody, without querying, when the stage is missing its %s', async (_label, overrides) => {
      await expect(runPositionFixedTransition(positionFixedStage(overrides))).resolves.not.toThrow();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(notifiedUserIds()).toEqual([]);
    });

    itEnforcesTenantIsolation('POSITION_FIXED resolves holders only within the requested tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: { where: { organizationId: string; id?: { in: string[] } } }) =>
        Promise.resolve(
          where.id?.in
            ? where.id.in.map((id) => ({ id, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null }))
            : where.organizationId === ORG_A
              ? [{ id: 'holder-1' }]
              : [{ id: 'leaked-holder' }],
        ),
      );

      await runPositionFixedTransition(positionFixedStage());

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
      expect(notifiedUserIds()).toEqual(['holder-1']);
    });

    it('routes an out-of-office assignee to their acting user', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...TARGET_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-x' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue(notifyAction);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'holder-1' }]);
      const now = new Date();
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'holder-1',
          outOfOfficeFrom: new Date(now.getTime() - 86400000),
          outOfOfficeTo: new Date(now.getTime() + 86400000),
          actingUserId: 'acting-user-1',
        },
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(notifiedUserIds()).toEqual(['acting-user-1']);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELEGATE', objectType: 'User', objectId: 'holder-1' }),
      );
    });

    // ── CREATE_TASK, retired (ACC-190) ───────────────────────────────────────
    it('skips a CREATE_TASK action left in stored config, logging it FAILED as retired — and creates no task', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);

      const result = await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actionType: 'CREATE_TASK',
            status: 'FAILED',
            responseSummary: expect.stringContaining('Retired'),
          }),
        }),
      );
      expect(mockTaskService.insertPrepared).not.toHaveBeenCalled();
      expect(result.unassignedTaskWarnings).toEqual([]);
    });
  });

  // ── triggerTransition — permission and trigger-condition gates ───────────────

  describe('triggerTransition — permission and trigger-condition gates', () => {
    beforeEach(() => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
    });

    it('throws ForbiddenException when requiredPermission is missing from the caller', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ requiredPermission: 'documents:submit' }),
      );

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for SYSTEM_AUTOMATIC transitions', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'SYSTEM_AUTOMATIC' }),
      );

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when SPECIFIC_USER and the actor does not match', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'SPECIFIC_USER', triggerUserId: 'someone-else' }),
      );

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when ROLE_BASED with a triggerRoleId and the actor lacks that role', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'ROLE_BASED', triggerRoleId: 'role-qm' }),
      );
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
    });

    // ACC-28 — ASSIGNEE_POOL reuses resolveAssignee() (OOO-aware, fixed
    // ACC-40 Section 2.6.1) rather than a new query pattern; SINGLE_STAGE's
    // assigneeStrategy is SELF, so the raw pool resolves to whoever started
    // the instance (the first WorkflowInstanceStage's actorId —
    // BASE_INSTANCE_STAGE.actorId is ACTOR). Explicit non-OOO user.findMany
    // stub below (rather than relying on beforeEach's global default) makes
    // this test's dependency on OOO-substitution's own query visible.
    it('throws ForbiddenException for ASSIGNEE_POOL when the actor is not in the resolved pool', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'ASSIGNEE_POOL' }),
      );
      // SINGLE_STAGE's assigneeStrategy is SELF — resolveAssigneeRaw()
      // resolves it to whoever started the instance (the first
      // WorkflowInstanceStage's actorId), via workflowInstanceStage.findFirst.
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue({
        ...BASE_INSTANCE_STAGE,
        actorId: 'someone-else',
      });
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'someone-else', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ASSIGNEE_POOL when the actor is in the resolved pool', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'ASSIGNEE_POOL' }),
      );
      // Same mocked call serves both resolveAssigneeRaw()'s SELF-case lookup
      // (wants actorId: ACTOR — satisfied) and the later currentInstanceStage
      // fetch (wants an active, non-exited entry — BASE_INSTANCE_STAGE
      // already has exitedAt: null).
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE); // actorId: ACTOR
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: ACTOR, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).resolves.not.toThrow();
    });

    // ACC-40 Section 2.6.1 — the live defect this phase fixes: before, this
    // exact scenario incorrectly threw ForbiddenException, because
    // triggerTransition() checked the raw (non-OOO-substituted) pool.
    it('allows ASSIGNEE_POOL when the actor is only in the pool via out-of-office substitution', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'ASSIGNEE_POOL' }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue({
        ...BASE_INSTANCE_STAGE,
        actorId: 'holder-1',
      });
      const now = new Date();
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'holder-1',
          outOfOfficeFrom: new Date(now.getTime() - 86400000),
          outOfOfficeTo: new Date(now.getTime() + 86400000),
          actingUserId: ACTOR,
        },
      ]);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).resolves.not.toThrow();
    });

    it("throws NotFoundException when the transition is not from the instance's current stage", async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'wrong-transition' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── triggerTransition — multi-approver mode (PARALLEL) ───────────────────────

  describe('triggerTransition — multi-approver mode (PARALLEL)', () => {
    it('records a vote and returns the instance unchanged when threshold is not yet met', async () => {
      const instance = makeInstance({ currentStageId: 'stage-parallel' });
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(instance);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

      const result = await service.triggerTransition(
        'instance-1',
        { transitionId: 'approve-transition' },
        ORG_A,
        ACTOR,
        [],
      );

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      expect(result.currentStageId).toBe('stage-parallel');
      // ACC-34 — threshold-not-met never reaches fireTransitionActions(), so
      // the default empty array must come through mapInstance() untouched.
      expect(result.unassignedTaskWarnings).toEqual([]);
      expect(mockPrisma.workflowTransitionAction.findMany).not.toHaveBeenCalled();
    });

    it('advances once the threshold is satisfied', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          { 'stage-parallel': PARALLEL_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null,
        ),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel', toStageId: 'stage-target', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStageId: 'stage-target' }) }),
      );
    });

    it('fires a non-approval-path transition immediately, with no threshold', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          { 'stage-parallel': PARALLEL_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null,
        ),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'return-transition', fromStageId: 'stage-parallel', toStageId: 'stage-target', isApprovalPath: false }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'return-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
      // No pool/threshold lookup needed for an immediate return-path fire.
      expect(mockPrisma.workflowApproval.findMany).not.toHaveBeenCalled();
    });

    it('upserts (does not duplicate) when the same actor votes twice', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);
      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalledTimes(2);
    });

    it('fires the transition where isApprovalPath is true, not any other outgoing transition from that stage', async () => {
      const approveTransition = makeTransition({
        id: 'approve-transition',
        fromStageId: 'stage-parallel',
        toStageId: 'stage-target',
        isApprovalPath: true,
      });
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          { 'stage-parallel': PARALLEL_STAGE, 'stage-target': TARGET_STAGE, 'stage-final': FINAL_STAGE }[
            where.id
          ] ?? null,
        ),
      );
      // Only the transitionId actually requested is ever resolved — a second,
      // unrelated outgoing transition from the same stage (e.g. a return path
      // to stage-final) exists in the DB but is never looked up or fired.
      mockPrisma.workflowTransition.findFirst.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'approve-transition' ? approveTransition : null),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStageId: 'stage-target' }) }),
      );
    });
  });

  // ── triggerTransition — COMMITTEE approval mode ───────────────────────────────
  // ACC-22, closing the ACC-17 deferred gap: isApprovalThresholdMet()'s
  // COMMITTEE branch previously read `prisma.committee.findUnique({ where:
  // { id } })` with no organizationId filter at all — a cross-tenant
  // committeeId could have resolved. This describe block is the first-ever
  // test coverage of the COMMITTEE approval path (there was none before this
  // ticket), so it proves both the happy path AND the org-scoping fix, not
  // just a regression check against pre-existing behavior.

  describe('triggerTransition — COMMITTEE approval mode', () => {
    it("looks up the committee scoped to the caller's organizationId", async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-committee' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(COMMITTEE_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-committee', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-committee' }),
      );
      mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-a', quorumCount: 2 });
      mockPrisma.workflowApproval.findMany.mockResolvedValue([
        makeApproval({ decision: 'APPROVED' }),
        makeApproval({ decision: 'APPROVED' }),
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'committee-a', organizationId: ORG_A },
      });
    });

    it('advances once quorum is met and more than half of the votes are APPROVED', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-committee' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-committee': COMMITTEE_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({
          id: 'approve-transition',
          fromStageId: 'stage-committee',
          toStageId: 'stage-target',
          isApprovalPath: true,
        }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-committee' }),
      );
      mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-a', quorumCount: 2 });
      mockPrisma.workflowApproval.findMany.mockResolvedValue([
        makeApproval({ decision: 'APPROVED' }),
        makeApproval({ decision: 'APPROVED' }),
      ]);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStageId: 'stage-target' }) }),
      );
    });

    it('does not advance when the vote count has not reached the quorum', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-committee' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(COMMITTEE_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-committee', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-committee' }),
      );
      mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-a', quorumCount: 3 });
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

      const result = await service.triggerTransition(
        'instance-1',
        { transitionId: 'approve-transition' },
        ORG_A,
        ACTOR,
        [],
      );

      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      expect(result.currentStageId).toBe('stage-committee');
    });

    // The actual tenant-isolation proof: a committeeId that belongs to a
    // DIFFERENT org must never resolve here. prisma.committee.findFirst is
    // mocked exactly as a real Prisma call would behave when organizationId
    // doesn't match the row -- it returns null, not the foreign row.
    it('does NOT treat the threshold as met when the committee belongs to a different tenant', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-committee' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(COMMITTEE_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-committee', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-committee' }),
      );
      // Simulates the committee row existing, but for ORG_B -- a scoped
      // findFirst({ id, organizationId: ORG_A }) correctly finds nothing.
      mockPrisma.committee.findFirst.mockResolvedValue(null);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([
        makeApproval({ decision: 'APPROVED' }),
        makeApproval({ decision: 'APPROVED' }),
      ]);

      const result = await service.triggerTransition(
        'instance-1',
        { transitionId: 'approve-transition' },
        ORG_A,
        ACTOR,
        [],
      );

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'committee-a', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      expect(result.currentStageId).toBe('stage-committee');
    });

    // resolveApproverPool()'s COMMITTEE branch is a THIRD, distinct call site
    // from the two above — isApprovalThresholdMet() only reaches it when
    // approvalMode is NOT 'COMMITTEE' (it returns early for that case), so a
    // PARALLEL-mode stage whose assigneeStrategy is 'COMMITTEE' is the only
    // way to actually exercise this branch. Neither of the two tests above
    // (approvalMode: 'COMMITTEE', which skips this call) nor the
    // resolveAssigneeRaw() CREATE_TASK test (approvalMode: 'SINGLE', which
    // never reaches isApprovalThresholdMet at all) touches this code path.
    it("sizes the PARALLEL approver pool via resolveApproverPool() using a committee's active, org-scoped members", async () => {
      const parallelCommitteeStage = {
        ...PARALLEL_STAGE,
        id: 'stage-parallel-committee',
        assigneeStrategy: 'COMMITTEE',
        assigneeRoleId: null,
        committeeId: 'committee-a',
      };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel-committee' }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(parallelCommitteeStage);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel-committee', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel-committee' }),
      );
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'member-1' }, { userId: 'member-2' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);
      // ACC-40 Section 2.6.1 — resolveApproverPool() now routes through
      // applyOutOfOfficeRouting(); explicit non-OOO stub makes this test's
      // dependency on that query visible rather than relying on beforeEach's
      // global default.
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'member-1', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
        { id: 'member-2', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: { committeeId: 'committee-a', organizationId: ORG_A, isActive: true },
      });
      // Pool size 2, threshold ALL, only 1 APPROVED vote so far — not yet met.
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    // ACC-28 — identical filter to resolveAssigneeRaw()'s COMMITTEE case
    // above, applied here so a PARALLEL-mode stage narrowed to e.g.
    // "chairman" sizes its threshold against that same narrowed pool, not
    // the full membership.
    it('applies assigneeCommitteeRoleValueId to the resolveApproverPool() COMMITTEE branch too', async () => {
      const parallelCommitteeStage = {
        ...PARALLEL_STAGE,
        id: 'stage-parallel-committee',
        assigneeStrategy: 'COMMITTEE',
        assigneeRoleId: null,
        committeeId: 'committee-a',
        assigneeCommitteeRoleValueId: 'lookup-chairman-id',
      };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel-committee' }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(parallelCommitteeStage);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel-committee', isApprovalPath: true }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel-committee' }),
      );
      // Pool of 1 (the chairman only) with 1 APPROVED vote — threshold ALL met.
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'chairman-user' }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'chairman-user', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: {
          committeeId: 'committee-a',
          organizationId: ORG_A,
          isActive: true,
          roleValueId: 'lookup-chairman-id',
        },
      });
      // Pool size 1 (narrowed), 1 APPROVED vote — threshold met, advances.
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });
  });

  // ── The stage gate (ACC-190) ────────────────────────────────────────────────
  // An ADVANCE out of an entry is refused while any MANDATORY task of that
  // entry is open. RETURN and EXIT never are. It replaced ACC-65's opt-in
  // allPreviousStageTasksComplete validator, which no transition used and the
  // approval path skipped.

  describe('the stage gate (ACC-190)', () => {
    function arrangeTransition(overrides: Record<string, unknown> = {}) {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(makeTransition(overrides));
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
    }
    const trigger = () => service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);
    const openMandatory = [
      { id: 'task-a', title: 'Check the terms', titleAr: 'مراجعة الشروط', status: 'PENDING' },
      { id: 'task-b', title: 'Collect signatures', titleAr: null, status: 'ON_HOLD' },
    ];

    it('refuses an ADVANCE with STAGE_TASKS_OPEN, naming each open mandatory task, before anything is written', async () => {
      arrangeTransition();
      mockPrisma.task.findMany.mockResolvedValue(openMandatory);

      const error = await trigger().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WorkflowRefusalException);
      const body = (error as WorkflowRefusalException).getResponse() as { code: string; statusCode: number; tasks: unknown[] };
      expect(body.statusCode).toBe(409);
      expect(body.code).toBe('STAGE_TASKS_OPEN');
      // In words, never the raw enum (ACC-173).
      expect(body.tasks).toEqual([
        expect.objectContaining({ id: 'task-a', title: 'Check the terms', statusLabel: 'Assigned' }),
        expect.objectContaining({ id: 'task-b', title: 'Collect signatures', statusLabel: 'On hold' }),
      ]);
      expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      expect(mockTaskService.cancelStageExitTasksInTx).not.toHaveBeenCalled();
    });

    it("counts only the CURRENT entry's MANDATORY, open tasks — scoped to the tenant", async () => {
      arrangeTransition();

      await trigger();

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A,
            workflowInstanceStageId: BASE_INSTANCE_STAGE.id,
            isMandatory: true,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        }),
      );
    });

    it('lets the ADVANCE through once no mandatory task is open', async () => {
      arrangeTransition();
      mockPrisma.task.findMany.mockResolvedValue([]);

      await trigger();

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });

    it.each(['RETURN', 'EXIT'] as const)('never gates a %s transition — it passes with mandatory tasks open, and cancels them', async (kind) => {
      arrangeTransition({ kind });
      mockPrisma.task.findMany.mockResolvedValue(openMandatory);

      await trigger();

      expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
      expect(mockTaskService.cancelStageExitTasksInTx).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ workflowInstanceStageId: BASE_INSTANCE_STAGE.id }),
        ORG_A,
      );
    });

    // The early check passes, then a task reopens before the lock is taken:
    // the check under the lock is the one that counts.
    it('re-checks under the instance lock, and that check is authoritative', async () => {
      arrangeTransition();
      mockPrisma.task.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(openMandatory);

      const error = await trigger().catch((e: unknown) => e);

      expect((error as WorkflowRefusalException).code).toBe('STAGE_TASKS_OPEN');
      expect(mockPrisma.$queryRaw).toHaveBeenCalled(); // the lock was taken first
      expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    it('refuses a transition whose entry was closed by someone else meanwhile, writing nothing', async () => {
      arrangeTransition();
      // The caller's read (by stage) found the entry open; the re-read under
      // the lock (by the entry's own id) finds it gone.
      mockPrisma.workflowInstanceStage.findFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? null : BASE_INSTANCE_STAGE),
      );

      await expect(trigger()).rejects.toThrow(ConflictException);
      expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    // A vote that cannot take effect is not stored (Ahmad, 9 Oct, J).
    describe('on a multi-approver stage', () => {
      function arrangeParallel(holders: string[], recorded: { approverId: string; decision: string }[]) {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
        mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ 'stage-parallel': PARALLEL_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
        );
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(
          makeTransition({ id: 'approve-transition', fromStageId: 'stage-parallel', toStageId: 'stage-target', isApprovalPath: true }),
        );
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(makeInstanceStage({ stageId: 'stage-parallel' }));
        mockPrisma.userRole.findMany.mockResolvedValue(holders.map((userId) => ({ userId })));
        mockPrisma.workflowApproval.findMany.mockResolvedValue(recorded.map((r) => makeApproval(r)));
      }
      const vote = () => service.triggerTransition('instance-1', { transitionId: 'approve-transition' }, ORG_A, ACTOR, []);

      it('refuses the DECIDING vote before it is recorded', async () => {
        // ALL of two: the other holder approved, so this vote decides it.
        arrangeParallel([ACTOR, 'user-2'], [{ approverId: 'user-2', decision: 'APPROVED' }]);
        mockPrisma.task.findMany.mockResolvedValue(openMandatory);

        const error = await vote().catch((e: unknown) => e);

        expect((error as WorkflowRefusalException).code).toBe('STAGE_TASKS_OPEN');
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      // The approval path never ran a validator before ACC-190, so it was the
      // way round any task check. It is gated now, on the deciding vote.
      it('gates submitApproval too: the deciding approval is refused before it is recorded', async () => {
        arrangeParallel([ACTOR, 'user-2'], [{ approverId: 'user-2', decision: 'APPROVED' }]);
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(makeInstanceStage({ stageId: 'stage-parallel' }));
        mockPrisma.workflowTransition.findFirst.mockResolvedValue({ kind: 'ADVANCE' });
        mockPrisma.task.findMany.mockResolvedValue(openMandatory);

        const error = await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR).catch((e: unknown) => e);

        expect((error as WorkflowRefusalException).code).toBe('STAGE_TASKS_OPEN');
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      it('lets submitApproval record a RETURN vote with mandatory tasks open', async () => {
        arrangeParallel([ACTOR, 'user-2'], []);
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(makeInstanceStage({ stageId: 'stage-parallel' }));
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(makeTransition({ isApprovalPath: false, kind: 'RETURN' }));
        mockPrisma.task.findMany.mockResolvedValue(openMandatory);
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'RETURNED' }));

        await service.submitApproval('instance-stage-1', { decision: 'RETURNED' }, ORG_A, ACTOR);

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      });

      it('records a vote that does not decide it, whatever the tasks', async () => {
        arrangeParallel([ACTOR, 'user-2'], []);
        mockPrisma.task.findMany.mockResolvedValue(openMandatory);

        await vote();

        expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });
    });

    itEnforcesTenantIsolation('open mandatory tasks counted by the stage gate', async () => {
      arrangeTransition();
      mockPrisma.task.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(where.organizationId === ORG_A ? openMandatory : []),
      );

      // A tenant whose own entry has no open mandatory task is never held by
      // another tenant's tasks.
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ organizationId: ORG_B }));
      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_B, ACTOR, []);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });
  });

  // ── Stage entry creates the stage's tasks (ACC-190) ─────────────────────────

  describe('stage entry tasks (ACC-190)', () => {
    const prepared = (definitionId: string, isMandatory = true) => ({
      data: { title: `Task ${definitionId}`, stageTaskDefinitionId: definitionId, isMandatory, status: 'PENDING' },
      eligibleAssigneeIds: ['holder-1'],
      delegations: new Map(),
      pooled: false,
    });

    function arrange() {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(COMMITTEE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': { ...TARGET_STAGE, slaWorkingHours: 40 } }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue({ ...BASE_INSTANCE_STAGE, id: 'entry-new', stageId: 'stage-target' });
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockWorkingCalendar.calculateDeadline.mockResolvedValue(DateTime.fromJSDate(new Date('2026-11-01T08:00:00Z')));
      mockStagesTasks([prepared('def-1'), prepared('def-2', false)], ['"Task def-2" went to a pool nobody is in yet']);
    }
    function mockStagesTasks(tasks: unknown[], warnings: string[] = []) {
      mockStageTaskDefinitions.prepareEntryTasks.mockResolvedValue({ tasks, warnings });
    }
    const trigger = () => service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

    it('prepares the destination stage\'s tasks from ONE entry instant, which the new entry and its deadline share', async () => {
      arrange();
      await trigger();

      const [stage, record, sourceType, enteredAt, org] = mockStageTaskDefinitions.prepareEntryTasks.mock.calls[0] as [
        { id: string },
        { objectId: string },
        string,
        Date,
        string,
      ];
      expect(stage.id).toBe('stage-target');
      expect(record.objectId).toBe(COMMITTEE_INSTANCE.objectId);
      expect(sourceType).toBe('COMMITTEE');
      expect(org).toBe(ORG_A);
      expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ stageId: 'stage-target', enteredAt }) }),
      );
      // The old entry closes at the same instant the new one opens.
      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ exitedAt: enteredAt }) }),
      );
      // The stage deadline is counted from the entry, not from "now" later.
      const [from, hours] = mockWorkingCalendar.calculateDeadline.mock.calls[0] as [DateTime, number];
      expect(from.toJSDate()).toEqual(enteredAt);
      expect(hours).toBe(40);
    });

    it('inserts each task inside the transaction, on the new entry, created by the mover', async () => {
      arrange();
      await trigger();

      expect(mockTaskService.insertPrepared).toHaveBeenCalledTimes(2);
      for (const [client, task, org, actor] of mockTaskService.insertPrepared.mock.calls as [unknown, { data: Record<string, unknown> }, string, string][]) {
        expect(client).toBe(mockPrisma); // the transaction client
        expect(task.data).toEqual(
          expect.objectContaining({ workflowInstanceId: COMMITTEE_INSTANCE.id, workflowInstanceStageId: 'entry-new' }),
        );
        expect(org).toBe(ORG_A);
        expect(actor).toBe(ACTOR);
      }
    });

    it('prepares (every read) BEFORE the transaction, and announces AFTER it commits', async () => {
      arrange();
      await trigger();

      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0] ?? 0;
      const tx = mockPrisma.$transaction as jest.Mock;
      expect(order(mockStageTaskDefinitions.prepareEntryTasks)).toBeLessThan(order(tx));
      expect(mockTaskService.announceCreated).toHaveBeenCalledTimes(2);
      expect(order(mockTaskService.announceCreated)).toBeGreaterThan(order(mockTaskService.insertPrepared));
      // No notice, no audit row, from inside the transaction.
      expect(mockTaskService.auditStageExitCancellation.mock.invocationCallOrder[0]).toBeGreaterThan(
        order(mockPrisma.workflowInstance.update),
      );
    });

    it('cancels the old entry before creating the new one, so a self-transition starts fresh', async () => {
      arrange();
      await trigger();

      const order = (m: jest.Mock) => m.mock.invocationCallOrder[0] ?? 0;
      expect(order(mockTaskService.cancelStageExitTasksInTx)).toBeLessThan(order(mockPrisma.workflowInstanceStage.create));
      expect(order(mockPrisma.workflowInstanceStage.create)).toBeLessThan(order(mockTaskService.insertPrepared));
    });

    it("passes the entry's task warnings to the actor (ACC-34)", async () => {
      arrange();
      const result = await trigger();
      expect(result.unassignedTaskWarnings).toEqual(['"Task def-2" went to a pool nobody is in yet']);
    });

    it('a failure while creating the tasks rolls the whole stage change back — and announces nothing', async () => {
      arrange();
      mockTaskService.insertPrepared.mockRejectedValueOnce(new Error('insert failed'));

      await expect(trigger()).rejects.toThrow('insert failed');
      // The transaction never resolved, so nothing after commit ran.
      expect(mockTaskService.announceCreated).not.toHaveBeenCalled();
      expect(mockTaskService.auditStageExitCancellation).not.toHaveBeenCalled();
      expect(mockPrisma.workflowTransitionAction.findMany).not.toHaveBeenCalled();
    });

    it("startInstance creates the INITIAL stage's tasks too, on its first entry", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue({ ...BASE_INSTANCE_STAGE, id: 'entry-first' });
      mockStagesTasks([prepared('def-1')]);

      await service.startInstance('DOCUMENT', 'doc-1', ORG_A, ACTOR);

      expect(mockStageTaskDefinitions.prepareEntryTasks).toHaveBeenCalledWith(
        SINGLE_STAGE,
        { objectType: BASE_TEMPLATE.objectType, objectId: 'doc-1' },
        'DOCUMENT',
        expect.any(Date),
        ORG_A,
      );
      expect(mockTaskService.insertPrepared).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({ data: expect.objectContaining({ workflowInstanceId: BASE_INSTANCE.id, workflowInstanceStageId: 'entry-first' }) }),
        ORG_A,
        ACTOR,
      );
      expect(mockTaskService.announceCreated).toHaveBeenCalledTimes(1);
    });
  });

  // ── allPreviousStageTasksComplete — retired (ACC-190) ───────────────────────

  describe('allPreviousStageTasksComplete — retired', () => {
    it('is ignored when still stored: a RETURN carrying it passes with tasks open', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ kind: 'RETURN', validatorConfig: { allPreviousStageTasksComplete: true } }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.task.findMany.mockResolvedValue([{ id: 't', title: 'Open', titleAr: null, status: 'PENDING' }]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });
  });

  describe('triggerTransition — validatorConfig', () => {
    it('throws ConflictException when minApprovals has not yet been reached', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ validatorConfig: { minApprovals: 2 } }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowApproval.count.mockResolvedValue(0);

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ConflictException);
    });

    it('passes through when validatorConfig is unset', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowApproval.count).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });

    it('passes through when minApprovals is satisfied', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ validatorConfig: { minApprovals: 1 } }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowApproval.count.mockResolvedValue(1);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });
  });

  // ── submitApproval ───────────────────────────────────────────────────────────

  describe('submitApproval', () => {
    it('records the decision via upsert', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
    });

    it('throws NotFoundException for a cross-tenant stage', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if the stage was already exited', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ exitedAt: new Date() }),
      );

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    // ACC-40 Section 2.6.2 — regression test for a real behavioral
    // tightening this refactor introduced (found on re-review, not caught
    // up front). Before: submitApproval() never fetched WorkflowInstance
    // itself — workflowApproval.upsert() ran unconditionally, and only
    // maybeAdvanceAfterApproval()'s OWN later findUnique() could discover
    // a missing instance, silently no-op-ing (`if (!instance) return;`)
    // AFTER the approval had already been recorded. After: submitApproval()
    // fetches the instance itself, up front, and throws before any write
    // if it's missing — a genuinely stricter, not merely relocated, check.
    // In real operation this is unreachable — WorkflowInstanceStage.workflowInstanceId
    // carries a real Prisma @relation, which Postgres enforces as a FK
    // constraint, so a stage can never reference a nonexistent instance
    // under normal referential integrity. Kept deliberately (fail loudly
    // before writing anything, rather than silently half-succeeding) —
    // see step-40-org-position-unit-head.md's Phase 7 section for the full
    // writeup of why this was kept rather than reverted to match the old
    // silent-partial-success behavior.
    it('throws NotFoundException and writes nothing when the stage references a WorkflowInstance that no longer resolves', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
    });

    // ACC-54 — resolveApproverPool() is structurally separate from
    // resolveAssigneeRaw(), so POSITION_FIXED gaining a case there did NOT
    // give it one here: it fell through to the terminal `else { return [] }`.
    // These two tests pin the consequences that silently disappeared as a
    // result, so the branch can't be dropped again without a failure.
    const POSITION_FIXED_PARALLEL_STAGE = {
      ...PARALLEL_STAGE,
      assigneeStrategy: 'POSITION_FIXED',
      assigneePositionId: 'position-a',
      assigneeOrgUnitId: 'unit-a',
    };

    it('rejects an approver outside the resolved POSITION_FIXED pool', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(POSITION_FIXED_PARALLEL_STAGE);
      // The position is held by someone else entirely — ACTOR is not in the
      // pool. The id-filter branch is applyOutOfOfficeRouting()'s own second
      // query over whatever the first resolved; it must return those same
      // users, or the pool empties and the gate it is meant to prove is
      // skipped for the wrong reason.
      mockPrisma.user.findMany.mockImplementation(
        ({ where }: { where: { id?: { in: string[] } } }) => {
          const holders = [{ id: 'a-different-holder' }];
          return Promise.resolve(
            where.id?.in ? holders.filter((h) => where.id!.in.includes(h.id)) : holders,
          );
        },
      );

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ForbiddenException);

      // Rejected BEFORE the approval is recorded — with the pool empty (the
      // pre-fix behavior) the gate was skipped entirely and this upsert ran.
      expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          positionId: 'position-a',
          primaryOrgUnitId: 'unit-a',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
    });

    it('sizes the ALL threshold against the real POSITION_FIXED pool, not the approval count', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(POSITION_FIXED_PARALLEL_STAGE);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      // Three holders, ACTOR among them: eligible to approve, and the
      // threshold must be sized against all three.
      mockPrisma.user.findMany.mockImplementation(
        ({ where }: { where: { id?: { in: string[] } } }) => {
          const pool = [{ id: ACTOR }, { id: 'holder-2' }, { id: 'holder-3' }];
          return Promise.resolve(where.id?.in ? pool.filter((u) => where.id!.in.includes(u.id)) : pool);
        },
      );
      // Only ACTOR has approved so far — 1 of 3 under PARALLEL/ALL.
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      // Must NOT advance. Pre-fix the pool was [], so poolSize fell back to
      // Math.max(approvals.length, 1) === 1 and this single approval
      // satisfied ALL — the stage advanced on one of three approvers.
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    // resolveApproverPool()'s POSITION_FIXED holder lookup is a SECOND,
    // structurally separate query from resolveAssigneeRaw()'s — covered by
    // its own gate-named test so CI's tenant-isolation job actually runs it,
    // rather than relying on the resolver's test to imply this one is safe.
    itEnforcesTenantIsolation(
      "POSITION_FIXED's approver-pool lookup resolves holders only within the requested tenant",
      async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowStage.findFirst.mockResolvedValue(POSITION_FIXED_PARALLEL_STAGE);
        mockPrisma.user.findMany.mockImplementation(
          ({ where }: { where: { id?: { in: string[] }; organizationId: string } }) => {
            // Only ORG_A resolves a holder; a foreign tenant's holder must
            // never enter this pool.
            const holders = where.organizationId === ORG_A ? [{ id: ACTOR }] : [{ id: 'leaked-approver' }];
            return Promise.resolve(
              where.id?.in ? holders.filter((h) => where.id!.in.includes(h.id)) : holders,
            );
          },
        );
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

        await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
        );
      },
    );

    it('never auto-advances on ABSTAINED', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'ABSTAINED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: ACTOR }]);

      await service.submitApproval('instance-stage-1', { decision: 'ABSTAINED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransition.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    it('fires the return-path transition immediately on RETURNED', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel', workflowInstanceId: 'instance-1' }),
      );
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'RETURNED' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          { 'stage-parallel': PARALLEL_STAGE, 'stage-target': TARGET_STAGE }[where.id] ?? null,
        ),
      );
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: ACTOR }]);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ fromStageId: 'stage-parallel', toStageId: 'stage-target', isApprovalPath: false }),
      );
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));

      await service.submitApproval('instance-stage-1', { decision: 'RETURNED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fromStageId: 'stage-parallel', isApprovalPath: false } }),
      );
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });

    it('advances only once threshold is met on APPROVED, otherwise just records', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel', workflowInstanceId: 'instance-1' }),
      );
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }, { userId: ACTOR }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransition.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when no approval-path transition is configured for the stage', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel', workflowInstanceId: 'instance-1' }),
      );
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: ACTOR }]);
      mockPrisma.workflowApproval.findMany.mockResolvedValue([makeApproval({ decision: 'APPROVED' })]);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when no return-path transition is configured for the stage', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel', workflowInstanceId: 'instance-1' }),
      );
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'RETURNED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ currentStageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: ACTOR }]);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'RETURNED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    // ACC-33 item 7 (SYSTEM-REFERENCE.md Section 2.8 / Section 11 Tier 2) —
    // submitApproval() previously had zero authorization check beyond
    // authentication. Reuses resolveApproverPool(), the same pool
    // isApprovalThresholdMet() already trusts for this exact stage.
    describe('authorization (ACC-33 item 7)', () => {
      it('throws ForbiddenException when actor is not in the resolved ROLE approver pool', async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
          makeInstanceStage({ stageId: 'stage-parallel' }),
        );
        mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
        mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'someone-else' }]);
        // ACC-40 Section 2.6.1 — resolveApproverPool() now routes through
        // applyOutOfOfficeRouting(); explicit non-OOO stub makes this test's
        // dependency on that query visible.
        mockPrisma.user.findMany.mockResolvedValueOnce([
          { id: 'someone-else', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
        ]);

        await expect(
          service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when actor is not an active member of the resolved COMMITTEE approver pool', async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
          makeInstanceStage({ stageId: 'stage-committee' }),
        );
        mockPrisma.workflowStage.findFirst.mockResolvedValue(COMMITTEE_STAGE);
        mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'someone-else' }]);
        mockPrisma.user.findMany.mockResolvedValueOnce([
          { id: 'someone-else', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
        ]);

        await expect(
          service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
        ).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      it('allows an actor who IS in the resolved ROLE approver pool', async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
          makeInstanceStage({ stageId: 'stage-parallel' }),
        );
        mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
        mockPrisma.userRole.findMany.mockResolvedValue([{ userId: ACTOR }]);
        mockPrisma.user.findMany.mockResolvedValueOnce([
          { id: ACTOR, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
        ]);
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(
          makeInstance({ currentStageId: 'stage-parallel' }),
        );
        mockPrisma.workflowApproval.findMany.mockResolvedValue([]);

        await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      });

      // ACC-40 Section 2.6.1 — the live defect this phase fixes: before,
      // this exact scenario incorrectly threw ForbiddenException, because
      // resolveApproverPool() checked the raw (non-OOO-substituted) pool.
      it('allows an actor who is only in the resolved ROLE approver pool via out-of-office substitution', async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
          makeInstanceStage({ stageId: 'stage-parallel' }),
        );
        mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
        mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'holder-1' }]);
        const now = new Date();
        mockPrisma.user.findMany.mockResolvedValueOnce([
          {
            id: 'holder-1',
            outOfOfficeFrom: new Date(now.getTime() - 86400000),
            outOfOfficeTo: new Date(now.getTime() + 86400000),
            actingUserId: ACTOR,
          },
        ]);
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(
          makeInstance({ currentStageId: 'stage-parallel' }),
        );
        mockPrisma.workflowApproval.findMany.mockResolvedValue([]);

        await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      });

      it('does not gate an unresolvable approvalMode/assigneeStrategy combination — pre-existing config-error case, not newly blocked', async () => {
        // SINGLE_STAGE's assigneeStrategy is SELF — resolveApproverPool()
        // returns [] for anything that isn't COMMITTEE or ROLE (its own
        // documented "seed/config error" fallback), same as before this fix.
        // Pool stays empty before ever reaching applyOutOfOfficeRouting(),
        // so no user.findMany stub is needed here.
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));

        await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      });

      it('throws NotFoundException when the stage record itself is missing', async () => {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowStage.findFirst.mockResolvedValue(null);

        await expect(
          service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
        ).rejects.toThrow(NotFoundException);
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });
    });
  });

  // ── tenant isolation ─────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return instances belonging to a different tenant', async () => {
      const instanceA = makeInstance({ id: 'instance-a', organizationId: ORG_A });
      const instanceB = makeInstance({ id: 'instance-b', organizationId: ORG_B });

      mockPrisma.workflowInstance.findFirst.mockImplementation(
        ({ where }: { where: { organizationId: string } }) => {
          if (where.organizationId === ORG_A) return Promise.resolve(instanceA);
          return Promise.resolve(instanceB);
        },
      );

      const resultA = await service.getInstanceById('instance-1', ORG_A);
      const resultB = await service.getInstanceById('instance-1', ORG_B);

      expect(resultA.id).toBe('instance-a');
      expect(resultB.id).toBe('instance-b');
    });

    it('should NOT allow triggerTransition on a cross-tenant instance', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

      await expect(
        service.triggerTransition('instance-belonging-to-org-a', { transitionId: 't1' }, ORG_B, ACTOR, []),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowTransition.findFirst).not.toHaveBeenCalled();
    });

    it('should NOT allow submitApproval on a cross-tenant stage', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('stage-belonging-to-org-a', { decision: 'APPROVED' }, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
    });

    it('should NOT allow cancelInstance on a cross-tenant instance', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

      await expect(
        service.cancelInstance('instance-belonging-to-org-a', ORG_B, ACTOR, 'x'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });
  });

  // ── ACC-33 item 6 / ACC-40 Section 2.5 — ORG_UNIT_HEAD ──────────────────────

  describe('resolveAssigneeRaw — ORG_UNIT_HEAD (ACC-33 item 6 / ACC-40 Section 2.5)', () => {
    it('resolves to an empty pool instead of throwing, for a stage using the ORG_UNIT_HEAD strategy when the instance carries no orgUnitId (every real caller today)', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE); // no orgUnitId field
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(BASE_INSTANCE_STAGE);

      // The regression this guards: before this fix, resolveAssigneeRaw()
      // threw an unconditional Error for ORG_UNIT_HEAD, which would have
      // rejected this whole call. Asserting resolves() (not rejects())
      // IS the explicit proof it no longer throws.
      await expect(
        service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR),
      ).resolves.toBeDefined();

      // resolveAndNotifyInitialAssignee() loops over resolveAssignee()'s
      // result and notifies each — an empty pool means this loop runs zero
      // times, so no "New workflow assignment" notification fires. Confirms
      // the resolved pool is genuinely [], not some other unintended value.
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: 'New workflow assignment' }),
        ORG_A,
      );
      // Never even attempts the resolver when there's no orgUnitId to
      // resolve against.
      expect(mockOrganizationService.resolveActingHeadForOrgUnit).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.5 — real wiring proof, using a synthetic/test-only
    // orgUnitId on the calling instance object, per the plan's own
    // confirmed prerequisite gap: no real workflow-driven object
    // (Committee, Meeting) carries this field yet, so no real end-to-end
    // consumer exists to test against. This proves the CASE itself is
    // correctly wired to OrganizationService.resolveActingHeadForOrgUnit(),
    // ready for whichever module supplies a real orgUnitId next.
    it('calls resolveActingHeadForOrgUnit() with the instance-supplied orgUnitId and returns its resolved pool', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      const instanceWithOrgUnit = { ...BASE_INSTANCE, orgUnitId: 'unit-synthetic-1' };
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(instanceWithOrgUnit);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['head-user-1']);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockOrganizationService.resolveActingHeadForOrgUnit).toHaveBeenCalledWith('unit-synthetic-1', ORG_A);
      // The resolved pool reached resolveAndNotifyInitialAssignee() — proof
      // the case's return value actually flows through, not just that the
      // resolver was called.
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: 'New workflow assignment' }),
        ORG_A,
      );
    });

    it('resolves to an empty pool when resolveActingHeadForOrgUnit() itself returns an empty pool (full chain exhausted) — no throw, matches every other empty-pool case', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      const instanceWithOrgUnit = { ...BASE_INSTANCE, orgUnitId: 'unit-synthetic-1' };
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(instanceWithOrgUnit);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([]);

      await expect(
        service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR),
      ).resolves.toBeDefined();

      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: 'New workflow assignment' }),
        ORG_A,
      );
    });
  });

  // ── ACC-40 Section 2.6.2 — resolveApproverPool()'s ORG_UNIT_HEAD case ──────
  //
  // Required prerequisite the plan's own investigation surfaced: without
  // this case, submitApproval()'s eligibility gate is a complete no-op for
  // ORG_UNIT_HEAD-strategy stages even after resolveAssigneeRaw() gains its
  // own case, since resolveApproverPool() is a structurally separate
  // method. Exercised through submitApproval() (the real, public entry
  // point), same pattern as the other 'authorization (ACC-33 item 7)'
  // tests above — with a synthetic/test-only orgUnitId on the instance,
  // per the same confirmed prerequisite gap as resolveAssigneeRaw()'s case.

  describe('resolveApproverPool — ORG_UNIT_HEAD (ACC-40 Section 2.6.2)', () => {
    it('throws ForbiddenException when actor is not in the resolved ORG_UNIT_HEAD approver pool', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-org-unit-head' }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(ORG_UNIT_HEAD_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ orgUnitId: 'unit-synthetic-1' } as never),
      );
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['head-user-1']);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'head-user-1', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(mockOrganizationService.resolveActingHeadForOrgUnit).toHaveBeenCalledWith('unit-synthetic-1', ORG_A);
      expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
    });

    it('allows an actor who IS in the resolved ORG_UNIT_HEAD approver pool', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-org-unit-head' }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(ORG_UNIT_HEAD_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(
        makeInstance({ orgUnitId: 'unit-synthetic-1' } as never),
      );
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue([ACTOR]);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: ACTOR, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      mockPrisma.workflowApproval.findMany.mockResolvedValue([]);

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
    });

    it('does not gate — degrades to an empty pool — when the instance carries no orgUnitId (every real caller today), same stub-safe behavior as before', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-org-unit-head' }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(ORG_UNIT_HEAD_STAGE);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE); // no orgUnitId field
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      expect(mockOrganizationService.resolveActingHeadForOrgUnit).not.toHaveBeenCalled();
      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
    });
  });

  // ── ACC-40 Section 2.6.3 — the two delegation-stamp resolvers ───────────────
  //
  // Isolated tests, exercising each resolver directly — same precedent as
  // resolveActingHeadForOrgUnit()'s own Phase 6 commit 1 tests, before
  // Phase 9 commit 3 wires either into a real write site.

  describe('resolveActingHeadOrgUnitIdForUser (ACC-40 Section 2.6.3)', () => {
    it("returns null when the actor is a REAL position-holder at the starting unit — not \"acting\"", async () => {
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);

      expect(result).toBeNull();
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled(); // never even checks actingHeadUserId
    });

    it('returns the starting unit id when the actor is its actingHeadUserId', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ actingHeadUserId: ACTOR, parentId: 'parent-1' });

      const result = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);

      expect(result).toBe('unit-1');
    });

    it('walks up to the parent unit when the starting unit has neither a real holder nor this actor as its Acting Head', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1'
            ? { actingHeadUserId: 'someone-else', parentId: 'parent-1' }
            : { actingHeadUserId: ACTOR, parentId: null },
        ),
      );

      const result = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);

      expect(result).toBe('parent-1');
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledTimes(2);
    });

    it('returns null when the full chain is exhausted with no match anywhere', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1'
            ? { actingHeadUserId: null, parentId: 'parent-1' }
            : { actingHeadUserId: null, parentId: null },
        ),
      );

      const result = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);

      expect(result).toBeNull();
    });

    it('returns null immediately when the starting unit does not exist in this tenant', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      const result = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);

      expect(result).toBeNull();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? { actingHeadUserId: ACTOR, parentId: null } : null),
      );

      const resultA = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_A);
      const resultB = await service.resolveActingHeadOrgUnitIdForUser(ACTOR, 'unit-1', ORG_B);

      expect(resultA).toBe('unit-1');
      expect(resultB).toBeNull();
    });
  });

  describe('resolveOutOfOfficeCoverageForUser (ACC-40 Section 2.6.3)', () => {
    it('returns the covered-for user id when the actor is their actingUserId and coverage is currently active', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' });

      const result = await service.resolveOutOfOfficeCoverageForUser(ACTOR, ['absent-user', 'other-user'], ORG_A);

      expect(result).toBe('absent-user');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: { in: ['absent-user', 'other-user'] },
          organizationId: ORG_A,
          actingUserId: ACTOR,
          outOfOfficeFrom: { lte: expect.any(Date) },
          outOfOfficeTo: { gte: expect.any(Date) },
        },
      });
    });

    it('returns null when nothing in the raw pool is currently covered by this actor', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const result = await service.resolveOutOfOfficeCoverageForUser(ACTOR, ['other-user'], ORG_A);

      expect(result).toBeNull();
    });

    it('is a no-op — no query at all — when the raw pool is empty', async () => {
      const result = await service.resolveOutOfOfficeCoverageForUser(ACTOR, [], ORG_A);

      expect(result).toBeNull();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.user.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? { id: 'absent-user-a' } : { id: 'absent-user-b' }),
      );

      const resultA = await service.resolveOutOfOfficeCoverageForUser(ACTOR, ['absent-user-a'], ORG_A);
      const resultB = await service.resolveOutOfOfficeCoverageForUser(ACTOR, ['absent-user-b'], ORG_B);

      expect(resultA).toBe('absent-user-a');
      expect(resultB).toBe('absent-user-b');
      expect(mockPrisma.user.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }));
      expect(mockPrisma.user.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }));
    });
  });

  // ── ACC-40 Section 2.6.3 — the delegation stamp, end to end ─────────────────
  //
  // Not just "each resolver returns the right value in isolation" (already
  // covered above) — these exercise the REAL public entry points
  // (triggerTransition()/submitApproval()) and assert the actual WRITTEN
  // row carries the correct delegationReason/delegationContextId. Per the
  // user's explicit ask: both paths this phase makes reachable
  // (OUT_OF_OFFICE_COVERAGE, already-shipped and now genuinely wired;
  // ACTING_HEAD, wired but still dormant in production the same way Phase
  // 7's ORG_UNIT_HEAD case is — no real orgUnitId exists on any object yet
  // — proven here with the same synthetic/test-only orgUnitId approach
  // established in Phase 7), plus the stated ACTING_HEAD-before-
  // OUT_OF_OFFICE_COVERAGE precedence for the rare case both could apply.

  describe('delegation stamp — end to end (ACC-40 Section 2.6.3)', () => {
    it('stamps OUT_OF_OFFICE_COVERAGE on the newly-created WorkflowInstanceStage when the triggering actor is covering for an absent raw-pool member', async () => {
      const roleStage = { ...SINGLE_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(roleStage);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'absent-user' }]);
      // resolveOutOfOfficeCoverageForUser()'s own query — the real proof
      // this is a genuine write, not a mocked-away resolver call.
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' });

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delegationReason: 'OUT_OF_OFFICE_COVERAGE',
            delegationContextId: 'absent-user',
          }),
        }),
      );
    });

    it('stamps ACTING_HEAD on the newly-created WorkflowInstanceStage when the triggering actor is the Acting Head of the relevant unit (synthetic orgUnitId, per Phase 7\'s own established testing approach)', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      const instanceWithOrgUnit = { ...BASE_INSTANCE, orgUnitId: 'unit-synthetic-1' };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(instanceWithOrgUnit);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.user.count.mockResolvedValue(0); // not a real holder
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ actingHeadUserId: ACTOR, parentId: null });

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delegationReason: 'ACTING_HEAD',
            delegationContextId: 'unit-synthetic-1',
          }),
        }),
      );
    });

    // The precedence rule, proven structurally — not just that the output
    // is ACTING_HEAD, but that the OOO check is never even attempted once
    // ACTING_HEAD resolves, matching "checked first" literally.
    it('stamps ACTING_HEAD, not OUT_OF_OFFICE_COVERAGE, when the actor could theoretically resolve via both — the stated precedence, proven structurally', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      const instanceWithOrgUnit = { ...BASE_INSTANCE, orgUnitId: 'unit-synthetic-1' };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(instanceWithOrgUnit);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);

      // ACTING_HEAD resolves: ACTOR genuinely is the acting head of unit-synthetic-1.
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ actingHeadUserId: ACTOR, parentId: null });

      // OUT_OF_OFFICE_COVERAGE would ALSO resolve, if it were ever reached:
      // the raw ORG_UNIT_HEAD pool includes 'absent-user', who ACTOR is
      // separately covering for.
      mockOrganizationService.resolveActingHeadForOrgUnit.mockResolvedValue(['absent-user']);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' }); // would satisfy resolveOutOfOfficeCoverageForUser() if called

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            delegationReason: 'ACTING_HEAD',
            delegationContextId: 'unit-synthetic-1',
          }),
        }),
      );
      // Structural proof of precedence: the raw-pool/OOO path (which needs
      // resolveActingHeadForOrgUnit() for its own ORG_UNIT_HEAD raw-pool
      // resolution, and user.findFirst for the OOO match itself) is never
      // reached at all once ACTING_HEAD resolves first.
      expect(mockOrganizationService.resolveActingHeadForOrgUnit).not.toHaveBeenCalled();
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('stamps OUT_OF_OFFICE_COVERAGE on the WorkflowApproval written by submitApproval() — the other real write site, not just performTransition()\'s stage-create', async () => {
      const roleStage = { ...SINGLE_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(roleStage);
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'absent-user' }]);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' });
      // submitApproval()'s own eligibility gate (resolveApproverPool(),
      // OOO-substituted) needs 'absent-user' -> ACTOR substitution too, or
      // ACTOR is never in the pool at all and the call is rejected before
      // ever reaching the delegation stamp.
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'absent-user',
          outOfOfficeFrom: new Date(Date.now() - 86400000),
          outOfOfficeTo: new Date(Date.now() + 86400000),
          actingUserId: ACTOR,
        },
      ]);

      await service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            delegationReason: 'OUT_OF_OFFICE_COVERAGE',
            delegationContextId: 'absent-user',
          }),
          update: expect.objectContaining({
            delegationReason: 'OUT_OF_OFFICE_COVERAGE',
            delegationContextId: 'absent-user',
          }),
        }),
      );
    });

    it('stamps OUT_OF_OFFICE_COVERAGE on triggerTransition()\'s own multi-approver vote-casting upsert — a distinct write site from both performTransition() and submitApproval()', async () => {
      const roleParallelStage = { ...PARALLEL_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-parallel' }));
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ fromStageId: 'stage-parallel', toStageId: 'stage-target', isApprovalPath: true }),
      );
      mockPrisma.workflowStage.findFirst.mockResolvedValue(roleParallelStage);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(
        makeInstanceStage({ stageId: 'stage-parallel' }),
      );
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'absent-user' }]);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' });
      mockPrisma.workflowApproval.findMany.mockResolvedValue([]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            delegationReason: 'OUT_OF_OFFICE_COVERAGE',
            delegationContextId: 'absent-user',
          }),
        }),
      );
    });

    // ACC-190 — the end-to-end delegation stamp through CREATE_TASK into
    // TaskService.create() is gone with CREATE_TASK: a stage task comes from a
    // definition and follows the manual-task route, which applies no
    // out-of-office routing (SYSTEM-REFERENCE §3.5). The stamps on stage entries
    // and approvals are pinned above.
  });

  // ── ACC-28 Section 2.5 — unassigned-stage detection ────────────────────────

  describe('resolveUnassignedBlockingTransitions (ACC-28 Section 2.5)', () => {
    const ROLE_STAGE = { ...SINGLE_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
    const ASSIGNEE_POOL_TRANSITION = makeTransition({
      id: 't-assignee-pool',
      triggerCondition: 'ASSIGNEE_POOL',
      requiredPermission: 'committees:approve',
    });

    it('returns an empty array when there are no outgoing ASSIGNEE_POOL transitions', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([]);

      const result = await service.resolveUnassignedBlockingTransitions(ROLE_STAGE as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
    });

    it('flags the transition when the resolved pool is empty, regardless of requiredPermission', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([
        makeTransition({ ...ASSIGNEE_POOL_TRANSITION, requiredPermission: null }),
      ]);
      mockPrisma.userRole.findMany.mockResolvedValue([]); // empty pool

      const result = await service.resolveUnassignedBlockingTransitions(ROLE_STAGE as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('t-assignee-pool');
      // Empty-pool case never needs to check permissions — nobody to check.
      expect(mockRoleService.getUserPermissions).not.toHaveBeenCalled();
    });

    it('flags the transition when the pool is non-empty but nobody in it holds requiredPermission', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([ASSIGNEE_POOL_TRANSITION]);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      // ACC-40 Section 2.6.1 — this method now routes through
      // resolveAssignee() (OOO-aware); explicit non-OOO stub makes this
      // test's dependency on that query visible.
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'user-1', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);
      mockRoleService.getUserPermissions.mockResolvedValue(['documents:view']); // lacks committees:approve

      const result = await service.resolveUnassignedBlockingTransitions(ROLE_STAGE as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('t-assignee-pool');
    });

    it('does not flag the transition when at least one pool member holds requiredPermission', async () => {
      // ROLE + approvalMode SINGLE truncates the resolved pool to its first
      // member (existing resolveAssigneeRaw() behavior, unrelated to
      // ACC-28) — PARALLEL is used here so both members actually enter the
      // pool this check evaluates.
      const parallelRoleStage = { ...ROLE_STAGE, approvalMode: 'PARALLEL' };
      mockPrisma.workflowTransition.findMany.mockResolvedValue([ASSIGNEE_POOL_TRANSITION]);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'user-1', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
        { id: 'user-2', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);
      mockRoleService.getUserPermissions.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'user-2' ? ['committees:approve'] : ['documents:view']),
      );

      const result = await service.resolveUnassignedBlockingTransitions(parallelRoleStage as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toEqual([]);
    });

    it('does not flag a non-empty pool when the transition has no requiredPermission at all', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([
        makeTransition({ ...ASSIGNEE_POOL_TRANSITION, requiredPermission: null }),
      ]);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);
      mockPrisma.user.findMany.mockResolvedValueOnce([
        { id: 'user-1', outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
      ]);

      const result = await service.resolveUnassignedBlockingTransitions(ROLE_STAGE as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toEqual([]);
      expect(mockRoleService.getUserPermissions).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.6.1 — the live defect this phase fixes: before, this
    // exact scenario incorrectly flagged the stage as blocked, because the
    // raw pool (the out-of-office holder, who lacks the permission) was
    // checked instead of the substituted acting user (who holds it).
    it('does not flag the transition when the raw holder is out-of-office but their acting user holds requiredPermission', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([ASSIGNEE_POOL_TRANSITION]);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'holder-1' }]);
      const now = new Date();
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'holder-1',
          outOfOfficeFrom: new Date(now.getTime() - 86400000),
          outOfOfficeTo: new Date(now.getTime() + 86400000),
          actingUserId: 'acting-1',
        },
      ]);
      mockRoleService.getUserPermissions.mockImplementation((userId: string) =>
        Promise.resolve(userId === 'acting-1' ? ['committees:approve'] : []),
      );

      const result = await service.resolveUnassignedBlockingTransitions(ROLE_STAGE as never, BASE_INSTANCE as never, ORG_A);

      expect(result).toEqual([]);
    });
  });

  // ACC-33 item 9 (SYSTEM-REFERENCE.md Section 2.13 / Section 11 Tier 1) —
  // structurally distinct from resolveUnassignedBlockingTransitions() above:
  // triggerRoleId/triggerUserId are transition-level fields, independent of
  // the stage's own assigneeStrategy/pool.
  describe('resolveUnreachableTriggerConditionTransitions (ACC-33 item 9)', () => {
    it('returns an empty array when there are no outgoing ROLE_BASED/SPECIFIC_USER transitions with a trigger target set', async () => {
      mockPrisma.workflowTransition.findMany.mockResolvedValue([]);

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.userRole.count).not.toHaveBeenCalled();
    });

    it('flags a ROLE_BASED transition when nobody active holds triggerRoleId', async () => {
      const transition = makeTransition({
        id: 't-role-based',
        triggerCondition: 'ROLE_BASED',
        triggerRoleId: 'role-chairman',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);
      mockPrisma.userRole.count.mockResolvedValue(0);

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('t-role-based');
      expect(mockPrisma.userRole.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            roleId: 'role-chairman',
            user: expect.objectContaining({ organizationId: ORG_A, status: 'ACTIVE' }),
          }),
        }),
      );
    });

    it('does not flag a ROLE_BASED transition when at least one active holder exists', async () => {
      const transition = makeTransition({
        id: 't-role-based',
        triggerCondition: 'ROLE_BASED',
        triggerRoleId: 'role-chairman',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);
      mockPrisma.userRole.count.mockResolvedValue(1);

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toEqual([]);
    });

    it('does not flag a ROLE_BASED transition with no triggerRoleId set (gated by requiredPermission instead — out of this check\'s scope)', async () => {
      const transition = makeTransition({
        id: 't-role-based',
        triggerCondition: 'ROLE_BASED',
        triggerRoleId: null,
        requiredPermission: 'committees:manage',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.userRole.count).not.toHaveBeenCalled();
    });

    it('flags a SPECIFIC_USER transition when triggerUserId is no longer active', async () => {
      const transition = makeTransition({
        id: 't-specific-user',
        triggerCondition: 'SPECIFIC_USER',
        triggerUserId: 'user-departed',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);
      mockPrisma.user.findFirst.mockResolvedValue(null); // not found active in this org

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('t-specific-user');
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-departed', organizationId: ORG_A, status: 'ACTIVE' },
      });
    });

    it('does not flag a SPECIFIC_USER transition when triggerUserId is still active', async () => {
      const transition = makeTransition({
        id: 't-specific-user',
        triggerCondition: 'SPECIFIC_USER',
        triggerUserId: 'user-active',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-active' });

      const result = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);

      expect(result).toEqual([]);
    });

    // MANDATORY — tenant isolation
    it('should NOT return records belonging to a different tenant', async () => {
      const transition = makeTransition({
        id: 't-specific-user',
        triggerCondition: 'SPECIFIC_USER',
        triggerUserId: 'user-a-only',
      });
      mockPrisma.workflowTransition.findMany.mockResolvedValue([transition]);
      mockPrisma.user.findFirst.mockImplementation(
        ({ where }: { where: { id: string; organizationId: string } }) =>
          Promise.resolve(
            where.id === 'user-a-only' && where.organizationId === ORG_A ? { id: 'user-a-only' } : null,
          ),
      );

      const resultA = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_A);
      const resultB = await service.resolveUnreachableTriggerConditionTransitions(SINGLE_STAGE as never, ORG_B);

      expect(resultA).toEqual([]); // found active in ORG_A — not blocking
      expect(resultB).toHaveLength(1); // same triggerUserId doesn't resolve under ORG_B — blocking
    });
  });

  // ACC-82 — notifyTenantAdminsOfUnassignedStage() and its tests were removed
  // with the "Workflow stage unreachable" admin notification. An unreachable
  // stage is a Setup health condition (STAGE_WITHOUT_ASSIGNEE), tested in
  // setup-condition.detectors.spec.ts (SYSTEM-REFERENCE §13.7).

  describe('startInstance — unassigned-stage detection wiring (ACC-28 Section 2.5)', () => {
    // ACC-82 — flagging is unchanged; the admin notification that used to
    // accompany it is gone (SYSTEM-REFERENCE §13.7). The TENANT_ADMIN mocks
    // are kept deliberately: with admins present to page, "no unreachable
    // notification" proves the removal rather than an empty admin list.
    it('flags the newly-created stage, and notifies no Tenant Admin, when its ASSIGNEE_POOL transition is unreachable', async () => {
      const roleStage = { ...SINGLE_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      const createdStage = { ...BASE_INSTANCE_STAGE, id: 'fresh-instance-stage' };

      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(roleStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(createdStage);
      mockPrisma.workflowTransition.findMany.mockResolvedValue([
        makeTransition({ id: 't-approve', triggerCondition: 'ASSIGNEE_POOL', requiredPermission: null }),
      ]);
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      // userRole.findMany is called 3 times in this flow (initial-assignee
      // notification's pool resolution, the blocking-transition check's own
      // pool resolution, and the admin lookup) — keyed by roleId rather than
      // call order, since call order is an implementation detail this test
      // shouldn't be coupled to.
      mockPrisma.userRole.findMany.mockImplementation(({ where }: { where: { roleId: string } }) => {
        if (where.roleId === 'role-qm') return Promise.resolve([]); // empty assignee pool
        if (where.roleId === 'admin-role-id') return Promise.resolve([{ userId: 'admin-1' }]);
        return Promise.resolve([]);
      });

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'fresh-instance-stage' },
        data: { isUnassigned: true, unassignedAt: expect.any(Date) },
      });
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1' }),
        ORG_A,
      );
    });

    // ACC-33 item 9 — entry-time check must combine BOTH resolvers. The
    // mock branches on the query's own triggerCondition filter (exactly
    // what the real Prisma where clause does) so the ASSIGNEE_POOL-only
    // resolver genuinely sees zero transitions here — proving THIS flag
    // comes from the new resolver, not cross-contamination from the mock
    // returning the same array to both calls.
    it('flags the newly-created stage when an outgoing ROLE_BASED transition has a triggerRoleId nobody active holds', async () => {
      const createdStage = { ...BASE_INSTANCE_STAGE, id: 'fresh-instance-stage' };
      const roleBasedTransition = makeTransition({
        id: 't-role-based',
        triggerCondition: 'ROLE_BASED',
        triggerRoleId: 'role-chairman',
      });

      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE); // assigneeStrategy SELF
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(createdStage);
      mockPrisma.workflowTransition.findMany.mockImplementation(
        ({ where }: { where: { triggerCondition: string | { in: string[] } } }) => {
          if (where.triggerCondition === 'ASSIGNEE_POOL') return Promise.resolve([]);
          return Promise.resolve([roleBasedTransition]);
        },
      );
      mockPrisma.userRole.count.mockResolvedValue(0); // nobody holds role-chairman
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]); // an admin who could have been paged

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'fresh-instance-stage' },
        data: { isUnassigned: true, unassignedAt: expect.any(Date) },
      });
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: expect.stringContaining('unreachable') }),
        ORG_A,
      );
    });

    // ACC-33 item 9 — both resolvers report a DIFFERENT blocking transition
    // simultaneously. This used to assert both labels in the admin
    // notification; ACC-82 removed that notification, so the only observable
    // left is the flag, written exactly once.
    it('flags the stage once when the ASSIGNEE_POOL resolver and the trigger-condition resolver each flag a different transition', async () => {
      const roleStage = { ...SINGLE_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      const createdStage = { ...BASE_INSTANCE_STAGE, id: 'fresh-instance-stage' };
      const assigneePoolTransition = makeTransition({
        id: 't-assignee-pool',
        labelEn: 'Approve (pool)',
        triggerCondition: 'ASSIGNEE_POOL',
        requiredPermission: null,
      });
      const roleBasedTransition = makeTransition({
        id: 't-role-based',
        labelEn: 'Escalate (role)',
        triggerCondition: 'ROLE_BASED',
        triggerRoleId: 'role-chairman',
      });

      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(roleStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.create.mockResolvedValue(createdStage);
      mockPrisma.workflowTransition.findMany.mockImplementation(
        ({ where }: { where: { triggerCondition: string | { in: string[] } } }) => {
          if (where.triggerCondition === 'ASSIGNEE_POOL') return Promise.resolve([assigneePoolTransition]);
          return Promise.resolve([roleBasedTransition]);
        },
      );
      mockPrisma.userRole.count.mockResolvedValue(0); // nobody holds role-chairman (trigger-condition side)
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      mockPrisma.userRole.findMany.mockImplementation(({ where }: { where: { roleId: string } }) => {
        if (where.roleId === 'role-qm') return Promise.resolve([]); // empty assignee pool (ASSIGNEE_POOL side)
        if (where.roleId === 'admin-role-id') return Promise.resolve([{ userId: 'admin-1' }]);
        return Promise.resolve([]);
      });

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      const flagWrites = mockPrisma.workflowInstanceStage.update.mock.calls.filter(
        ([arg]: [{ data: { isUnassigned?: boolean } }]) => arg.data.isUnassigned === true,
      );
      expect(flagWrites).toEqual([
        [{ where: { id: 'fresh-instance-stage' }, data: { isUnassigned: true, unassignedAt: expect.any(Date) } }],
      ]);
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: expect.stringContaining('unreachable') }),
        ORG_A,
      );
    });

    it('does not flag the stage when startInstance has no outgoing ASSIGNEE_POOL transitions (default fixture behavior)', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(SINGLE_STAGE);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      // Unrelated to ACC-28: SELF's initial-assignee notification still
      // fires as it always has — only the isUnassigned flag/notification is
      // asserted absent here.
      expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: expect.stringContaining('unreachable') }),
        ORG_A,
      );
    });
  });
});
