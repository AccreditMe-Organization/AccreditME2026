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
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowRefusalException } from './workflow-refusal';
import { StagePool, StagePoolService } from './stage-pool.service';

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
  // ACC-271 PR 6a — every fixture stage is converted, as every stage on the
  // shared database is (the 29 Oct backfill's mapping: SINGLE → Any one,
  // PARALLEL ALL → All, COMMITTEE → Committee vote). Who works it comes from
  // mockStagePool, defaulting to the actor alone.
  whoMode: 'ANY_ONE' as string | null,
};

const PARALLEL_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-parallel',
  isInitial: false,
  approvalMode: 'PARALLEL',
  parallelThreshold: 'ALL',
  assigneeStrategy: 'ROLE',
  assigneeRoleId: 'role-qm',
  whoMode: 'ALL',
};

const COMMITTEE_STAGE = {
  ...SINGLE_STAGE,
  id: 'stage-committee',
  isInitial: false,
  approvalMode: 'COMMITTEE',
  assigneeStrategy: 'COMMITTEE',
  committeeId: 'committee-a',
  whoMode: 'COMMITTEE_VOTE',
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
  // ACC-271 PR 4 — the closed-task notices, after the stage change commits.
  noticeStageExitClosures: jest.fn(),
  insertPrepared: jest.fn(),
  announceCreated: jest.fn(),
  cancelForInstance: jest.fn(),
};
// ACC-190 — what entering a stage creates. Defaults to nothing, so every test
// that does not care about stage tasks is unaffected.
const mockStageTaskDefinitions = { prepareEntryTasks: jest.fn() };
const mockQueue = { add: jest.fn() };
// ACC-271 — who works a stage. PR 6a: every fixture stage is converted, so the
// engine always asks; it defaults to the actor alone (beforeEach), and a test
// that needs another pool sets it.
const mockStagePool = { resolve: jest.fn(), resolveMany: jest.fn(), voteCommitteeId: jest.fn(), recordPoolChanges: jest.fn() };
const poolOf = (members: string[], extra: Partial<StagePool> = {}): StagePool => ({
  members,
  direct: members,
  coveringFor: new Map(),
  actingHeadOf: new Map(),
  voteCommitteeId: null,
  ...extra,
});

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
    // ACC-271 PR 6a — the stage's pool: the actor alone, unless a test says otherwise.
    mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
    mockStagePool.recordPoolChanges.mockResolvedValue({ joined: 0, left: 0 });

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
        { provide: getQueueToken('workflow-actions'), useValue: mockQueue },
        { provide: StageTaskDefinitionService, useValue: mockStageTaskDefinitions },
        { provide: StagePoolService, useValue: mockStagePool },
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

    it('throws ForbiddenException for SYSTEM_AUTOMATIC transitions', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ triggerCondition: 'SYSTEM_AUTOMATIC' }),
      );

      await expect(
        service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []),
      ).rejects.toThrow(ForbiddenException);
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2']));
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2']));
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
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
    // ACC-271 PR 6a — a Committee vote's committee comes from the stage's pool
    // (its COMMITTEE entry's own, or the record's), not the stage row.
    beforeEach(() => {
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR], { voteCommitteeId: 'committee-a' }));
    });

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
    // ACC-208 (B7) — as Prisma returns the gate's select: who has each task,
    // the pool it waits in, its due date and whether it needs evidence.
    const noPool = { assignedOrgUnit: null, assignedPosition: null, assignedCommittee: null, assignedCommitteeRoleValue: null };
    const openMandatory = [
      {
        id: 'task-a',
        title: 'Check the terms',
        titleAr: 'مراجعة الشروط',
        status: 'PENDING',
        dueAt: new Date('2026-10-14T13:00:00Z'),
        requiresEvidence: true,
        assignees: [{ user: { id: 'user-nora', name: 'Nora Al-Otaibi' } }],
        ...noPool,
      },
      {
        id: 'task-b',
        title: 'Collect signatures',
        titleAr: null,
        status: 'ON_HOLD',
        dueAt: null,
        requiresEvidence: false,
        assignees: [],
        ...noPool,
        assignedCommittee: { nameEn: 'Quality Assurance Committee', nameAr: null },
        assignedCommitteeRoleValue: { labelEn: 'Secretary', labelAr: 'أمين السر', labelOverrideEn: 'Clerk', labelOverrideAr: null },
      },
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

    // ACC-208 (B7) — what the "Can't move yet" dialog names beside each task.
    it('names who has each open task, or the pool it waits in, with its due date and evidence rule', async () => {
      arrangeTransition();
      mockPrisma.task.findMany.mockResolvedValue(openMandatory);

      const error = await trigger().catch((e: unknown) => e);

      const body = (error as WorkflowRefusalException).getResponse() as { tasks: unknown[] };
      expect(body.tasks).toEqual([
        {
          id: 'task-a',
          title: 'Check the terms',
          titleAr: 'مراجعة الشروط',
          status: 'PENDING',
          statusLabel: 'Assigned',
          dueAt: new Date('2026-10-14T13:00:00Z'),
          requiresEvidence: true,
          assignees: [{ id: 'user-nora', name: 'Nora Al-Otaibi' }],
          pool: null,
        },
        {
          id: 'task-b',
          title: 'Collect signatures',
          titleAr: null,
          status: 'ON_HOLD',
          statusLabel: 'On hold',
          dueAt: null,
          requiresEvidence: false,
          assignees: [],
          // The tenant's label override wins, as the picker shows it.
          pool: {
            kind: 'COMMITTEE_ROLE',
            committee: { nameEn: 'Quality Assurance Committee', nameAr: null },
            role: { labelEn: 'Clerk', labelAr: 'أمين السر' },
          },
        },
      ]);
      // Only people still on the task are named.
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ assignees: expect.objectContaining({ where: { removedAt: null } }) }),
        }),
      );
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
        mockStagePool.resolve.mockResolvedValue(poolOf(holders));
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

  // ── A record's own preconditions (ACC-238) ──────────────────────────────────
  // A committee leaves Formation only with a quorum of at least 1. Read by the
  // stage KEY, checked early and again under the instance's lock.

  describe('transition preconditions (ACC-238)', () => {
    const FORMATION = { ...SINGLE_STAGE, key: 'formation' };
    function arrange(quorumCount: number, opts: { kind?: 'ADVANCE' | 'RETURN' | 'EXIT'; fromKey?: string | null; objectType?: string } = {}) {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue({ ...BASE_INSTANCE, objectType: opts.objectType ?? 'COMMITTEE' });
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          { 'stage-single': { ...FORMATION, key: opts.fromKey === undefined ? 'formation' : opts.fromKey }, 'stage-target': TARGET_STAGE }[where.id] ??
            null,
        ),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(makeTransition({ kind: opts.kind ?? 'ADVANCE' }));
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.task.findMany.mockResolvedValue([]);
      mockPrisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
        Promise.resolve(strings.join('?').includes('"Committee"') ? [{ quorumCount }] : []),
      );
    }
    const trigger = () => service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);
    const committeeReads = () =>
      mockPrisma.$queryRaw.mock.calls.filter(([strings]) => (strings as TemplateStringsArray).join('?').includes('"Committee"'));

    it('refuses Submit for Approval out of Formation with quorum 0: 409 COMMITTEE_QUORUM_NOT_SET, nothing moved', async () => {
      arrange(0);

      const error = await trigger().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WorkflowRefusalException);
      expect((error as WorkflowRefusalException).getResponse()).toMatchObject({ statusCode: 409, code: 'COMMITTEE_QUORUM_NOT_SET' });
      expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
      expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
    });

    it('moves the committee with quorum 1, reading the committee scoped by organisation, again inside the transaction', async () => {
      arrange(1);

      await trigger();

      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
      // Early, then under the lock — and every read names the organisation.
      expect(committeeReads()).toHaveLength(2);
      for (const call of committeeReads()) {
        expect(call.slice(1)).toEqual(['object-1', ORG_A]);
        expect((call[0] as TemplateStringsArray).join('?')).toContain('FOR SHARE');
      }
    });

    it('is decided by the stage key, never the name: a stage with no key is not checked', async () => {
      arrange(0, { fromKey: null });
      await trigger();
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalled();
    });

    it('never holds a RETURN or EXIT, nor another record type', async () => {
      arrange(0, { kind: 'RETURN' });
      await trigger();
      arrange(0, { objectType: 'DOCUMENT' });
      await trigger();
      expect(committeeReads()).toHaveLength(0);
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledTimes(2);
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

    it('never auto-advances on ABSTAINED', async () => {
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'ABSTAINED' }));
      mockPrisma.workflowStage.findFirst.mockResolvedValue(PARALLEL_STAGE);
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
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
      mockStagePool.resolve.mockResolvedValue(poolOf(['user-1', 'user-2', ACTOR]));
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
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
      mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
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

  // ── ACC-40 Section 2.6.3 — the two delegation-stamp resolvers ───────────────
  //
  // Isolated tests, exercising each resolver directly — same precedent as
  // resolveActingHeadForOrgUnit()'s own Phase 6 commit 1 tests, before
  // Phase 9 commit 3 wires either into a real write site.

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

  // ── ACC-28 Section 2.5 — unassigned-stage detection ────────────────────────

  // ACC-82 — notifyTenantAdminsOfUnassignedStage() and its tests were removed
  // with the "Workflow stage unreachable" admin notification. An unreachable
  // stage is a Setup health condition (STAGE_WITHOUT_ASSIGNEE), tested in
  // setup-condition.detectors.spec.ts (SYSTEM-REFERENCE §13.7).

  // ── ACC-271: a converted stage (whoMode set) is worked by its pool ────────────
  describe('converted stages (ACC-271)', () => {
    // approvalMode is left at SINGLE / PARALLEL on purpose: on a converted
    // stage the who mode decides, and the old columns are not read.
    const POOL_STAGE = { ...SINGLE_STAGE, id: 'stage-pool', nameEn: 'Quality review', nameAr: 'مراجعة الجودة', whoMode: 'ANY_ONE' };
    const ALL_STAGE = { ...POOL_STAGE, whoMode: 'ALL' };
    const VOTE_STAGE = { ...POOL_STAGE, whoMode: 'COMMITTEE_VOTE', approvalMode: 'PARALLEL' };
    const POOL_INSTANCE_STAGE = makeInstanceStage({ stageId: 'stage-pool' });

    function arrange(fromStage: Record<string, unknown>, transition: Record<string, unknown> = {}, toStage: Record<string, unknown> = TARGET_STAGE) {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-pool' }));
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve({ 'stage-pool': fromStage, [String(toStage['id'])]: toStage }[where.id] ?? null),
      );
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(
        makeTransition({ fromStageId: 'stage-pool', toStageId: String(toStage['id']), ...transition }),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(POOL_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: String(toStage['id']) }));
      mockPrisma.workflowApproval.findMany.mockResolvedValue([]);
    }
    const trigger = (permissions: string[] = []) =>
      service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, permissions);
    const refusal = async (promise: Promise<unknown>) => {
      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkflowRefusalException);
      return (error as WorkflowRefusalException).getResponse() as { code: string; statusCode: number; stageNameEn: string; stageNameAr: string };
    };
    const moved = () =>
      expect(mockPrisma.workflowInstance.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ currentStageId: 'stage-target' }) }),
      );

    describe('who may press a move (decision 1)', () => {
      it("lets a member of the stage's pool move it, without the transition's permission, role or user", async () => {
        arrange(POOL_STAGE, {
          requiredPermission: 'committees:approve',
          triggerCondition: 'SPECIFIC_USER',
          triggerUserId: 'someone-else',
          triggerRoleId: 'role-x',
        });
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

        await trigger([]);

        moved();
        expect(mockStagePool.resolve).toHaveBeenCalledWith(ORG_A, 'stage-pool', expect.objectContaining({ id: 'instance-1' }));
        expect(mockPrisma.userRole.findFirst).not.toHaveBeenCalled();
      });

      it('refuses someone outside the pool with NOT_IN_STAGE_POOL (403), whatever permissions they hold', async () => {
        arrange(POOL_STAGE, { requiredPermission: 'committees:approve' });
        mockStagePool.resolve.mockResolvedValue(poolOf(['user-nora']));

        const body = await refusal(trigger(['committees:approve']));

        expect(body).toMatchObject({ statusCode: 403, code: 'NOT_IN_STAGE_POOL', stageNameEn: 'Quality review', stageNameAr: 'مراجعة الجودة' });
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });

      it('refuses everyone when the pool is empty: STAGE_HAS_NO_ONE (409), never "anyone may act"', async () => {
        arrange(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([]));

        const body = await refusal(trigger(['committees:approve']));

        expect(body).toMatchObject({ statusCode: 409, code: 'STAGE_HAS_NO_ONE', stageNameEn: 'Quality review' });
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });

      it("lets a member who is away still act themselves, beside their acting user", async () => {
        arrange(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf(['stand-in'], { direct: [ACTOR], coveringFor: new Map([['stand-in', ACTOR]]) }));

        await trigger();

        moved();
      });

      it.each([
        ['mover APP', { mover: 'APP' }],
        ['SYSTEM_AUTOMATIC with no mover', { triggerCondition: 'SYSTEM_AUTOMATIC' }],
        ['mover AUTOMATIC', { mover: 'AUTOMATIC' }],
      ])('refuses a move a person does not make (%s), even to a pool member', async (_label, transition) => {
        arrange(POOL_STAGE, transition);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

        await expect(trigger()).rejects.toThrow(ForbiddenException);
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });

      it("a mover PERSON on a SYSTEM_AUTOMATIC row is a person's move: the marker wins over the old field", async () => {
        arrange(POOL_STAGE, { triggerCondition: 'SYSTEM_AUTOMATIC', mover: 'PERSON' });
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

        await trigger();

        moved();
      });

      it("still holds the stage's mandatory tasks (the gate runs on a converted stage too)", async () => {
        arrange(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
        mockPrisma.task.findMany.mockResolvedValue([
          {
            id: 'task-a',
            title: 'Check the terms',
            titleAr: null,
            status: 'PENDING',
            dueAt: null,
            requiresEvidence: false,
            assignees: [],
            assignedOrgUnit: null,
            assignedPosition: null,
            assignedCommittee: null,
            assignedCommitteeRoleValue: null,
          },
        ]);

        const body = await refusal(trigger());

        expect(body.code).toBe('STAGE_TASKS_OPEN');
      });

      it('stamps the delegation from the pool: an acting user standing in for an absent member', async () => {
        arrange(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf(['stand-in', ACTOR], { coveringFor: new Map([[ACTOR, 'away-user']]) }));

        await trigger();

        expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'away-user' }),
          }),
        );
        // Resolved once for the stage being left, not again for the stamp (the
        // stage being entered resolves its own, to flag it if nobody works it).
        expect(mockStagePool.resolve.mock.calls.filter((c) => c[1] === 'stage-pool')).toHaveLength(1);
      });

      // ACC-271 PR 6a — the old branch is gone. A stage with no `who` asks its
      // pool like any other, and StagePoolService answers it EMPTY (fail closed;
      // stage-pool.service.spec and stage-without-who.db-spec prove that half):
      // refused, even for a caller holding the move's old permission.
      it('a stage with no `who`: no old check runs, and its empty pool refuses STAGE_HAS_NO_ONE, whatever the caller holds', async () => {
        arrange({ ...POOL_STAGE, whoMode: null }, { requiredPermission: 'committees:approve', triggerCondition: 'ROLE_BASED' });
        mockStagePool.resolve.mockResolvedValue(poolOf([]));

        const body = await refusal(trigger(['committees:approve']));

        expect(body.code).toBe('STAGE_HAS_NO_ONE');
        expect(mockStagePool.resolve).toHaveBeenCalledWith(ORG_A, 'stage-pool', expect.objectContaining({ id: 'instance-1' }));
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });
    });

    describe('how the people decide (plan §4.3)', () => {
      const approve = { isApprovalPath: true };
      const approved = (approverId: string) => makeApproval({ approverId, decision: 'APPROVED' });

      it('Any one of them: the first press decides, whatever approvalMode the row still carries', async () => {
        arrange({ ...POOL_STAGE, approvalMode: 'PARALLEL', parallelThreshold: 'ALL' }, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2', 'user-3']));

        await trigger();

        moved();
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      it('All of them: records the approval and waits while a current member has not approved', async () => {
        arrange(ALL_STAGE, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2']));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved(ACTOR)]);

        await trigger();

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });

      it('All of them: moves once every current member has approved', async () => {
        arrange(ALL_STAGE, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2']));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved('user-2'), approved(ACTOR)]);

        await trigger();

        moved();
      });

      it('All of them: someone who left is no longer waited for, and their earlier approval still stands (Q6)', async () => {
        arrange(ALL_STAGE, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved('user-who-left'), approved(ACTOR)]);

        await trigger();

        moved();
      });

      it("All of them: an acting user's place is filled by the absent member's own approval", async () => {
        arrange(ALL_STAGE, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'stand-in'], { coveringFor: new Map([['stand-in', 'away-user']]) }));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved('away-user'), approved(ACTOR)]);

        await trigger();

        moved();
      });

      it('All of them: a send-back by any member fires at once', async () => {
        arrange(ALL_STAGE, { isApprovalPath: false, kind: 'RETURN' });
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2', 'user-3']));

        await trigger();

        moved();
      });

      it("Committee vote: the committee's quorum (saved at entry) and majority decide", async () => {
        arrange(VOTE_STAGE, approve);
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(makeInstanceStage({ stageId: 'stage-pool', quorumCount: 2 } as never));
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2', 'user-3'], { voteCommitteeId: 'committee-a' }));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved('user-2'), approved(ACTOR)]);

        await trigger();

        moved();
      });

      it('Committee vote: below the quorum, the vote is recorded and nothing moves', async () => {
        arrange(VOTE_STAGE, approve);
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(makeInstanceStage({ stageId: 'stage-pool', quorumCount: 3 } as never));
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2', 'user-3'], { voteCommitteeId: 'committee-a' }));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved('user-2'), approved(ACTOR)]);

        await trigger();

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });

      it('Committee vote with no committee to count against decides nothing (plan gap 5)', async () => {
        arrange(VOTE_STAGE, approve);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR], { voteCommitteeId: null }));
        mockPrisma.workflowApproval.findMany.mockResolvedValue([approved(ACTOR)]);

        await trigger();

        expect(mockPrisma.workflowInstance.update).not.toHaveBeenCalled();
      });
    });

    describe('submitApproval', () => {
      function arrangeVote(stage: Record<string, unknown>) {
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(POOL_INSTANCE_STAGE);
        mockPrisma.workflowStage.findFirst.mockResolvedValue(stage);
        mockPrisma.workflowApproval.findMany.mockResolvedValue([]);
        mockPrisma.workflowApproval.upsert.mockResolvedValue(makeApproval({ decision: 'APPROVED' }));
      }
      const vote = () => service.submitApproval('instance-stage-1', { decision: 'APPROVED' }, ORG_A, ACTOR);

      it('records the vote of a pool member', async () => {
        arrangeVote(ALL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR, 'user-2']));

        await vote();

        expect(mockPrisma.workflowApproval.upsert).toHaveBeenCalled();
      });

      it('refuses a vote from outside the pool with NOT_IN_STAGE_POOL', async () => {
        arrangeVote(ALL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf(['user-2']));

        expect((await refusal(vote())).code).toBe('NOT_IN_STAGE_POOL');
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      it('refuses every vote on an empty pool (plan gap 3: today an empty pool lets anyone vote)', async () => {
        arrangeVote(ALL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([]));

        expect((await refusal(vote())).code).toBe('STAGE_HAS_NO_ONE');
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });

      // ACC-271 PR 6a — no old approver pool: a stage with no `who` refuses its
      // votes from its (empty) pool.
      it('refuses a vote on a stage with no `who` with STAGE_HAS_NO_ONE, never the old approver pool', async () => {
        arrangeVote({ ...POOL_STAGE, whoMode: null, approvalMode: 'PARALLEL', parallelThreshold: 'ALL' });
        mockStagePool.resolve.mockResolvedValue(poolOf([]));

        expect((await refusal(vote())).code).toBe('STAGE_HAS_NO_ONE');
        expect(mockPrisma.workflowApproval.upsert).not.toHaveBeenCalled();
      });
    });

    describe('entering a converted stage', () => {
      it('flags the entry unassigned when its pool is empty (plan §4.5)', async () => {
        arrange(POOL_STAGE, {}, { ...TARGET_STAGE, whoMode: 'ALL' });
        mockStagePool.resolve.mockImplementation((_org: string, stageId: string) =>
          Promise.resolve(stageId === 'stage-pool' ? poolOf([ACTOR]) : poolOf([])),
        );

        await trigger();

        expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ isUnassigned: true }) }),
        );
        // The old detectors read transition fields a converted stage does not use.
        expect(mockPrisma.workflowTransition.findMany).not.toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ fromStageId: 'stage-target' }) }),
        );
      });

      it("saves the Committee vote's quorum, from the stage's committee, when the record enters", async () => {
        arrange(POOL_STAGE, {}, { ...TARGET_STAGE, whoMode: 'COMMITTEE_VOTE' });
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));
        mockStagePool.voteCommitteeId.mockResolvedValue('committee-9');
        mockPrisma.committee.findFirst.mockResolvedValue({ quorumCount: 3 });

        await trigger();

        expect(mockStagePool.voteCommitteeId).toHaveBeenCalledWith(ORG_A, 'stage-target', expect.objectContaining({ objectId: 'object-1' }));
        expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'committee-9', organizationId: ORG_A } }));
        expect(mockPrisma.workflowInstanceStage.create).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ quorumCount: 3 }) }),
        );
      });
    });

    // Ahmad, 28 Oct (Q2 before PR 1's review): the old per-call "routed to your
    // acting user" notices are gone, so the acting user must still get the
    // stage's ordinary notice, in the absent member's place.
    describe("an away member's acting user still gets the stage's notice", () => {
      const awayPool = () =>
        poolOf(['stand-in'], { direct: ['away-user'], coveringFor: new Map([['stand-in', 'away-user']]) });
      const noticesTo = (title: string) =>
        (mockNotificationService.create.mock.calls as [{ userId: string; titleEn: string }, string][])
          .filter(([n]) => n.titleEn === title)
          .map(([n]) => n.userId);

      it('when the record starts in a converted stage: "New workflow assignment" to the acting user, not the absent member', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
        mockPrisma.workflowStage.findFirst.mockResolvedValue({ ...POOL_STAGE, isInitial: true });
        mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
        mockStagePool.resolve.mockResolvedValue(awayPool());

        await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

        expect(noticesTo('New workflow assignment')).toEqual(['stand-in']);
      });

      it("when a move's Send notification reaches a converted stage: to the acting user, not the absent member", async () => {
        arrange(POOL_STAGE, {}, { ...TARGET_STAGE, whoMode: 'ALL' });
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'SEND_NOTIFICATION', order: 10, isEnabled: true },
        ]);
        mockStagePool.resolve.mockImplementation((_org: string, stageId: string) =>
          Promise.resolve(stageId === 'stage-pool' ? poolOf([ACTOR]) : awayPool()),
        );

        await trigger();

        expect(noticesTo(BASE_TRANSITION.labelEn)).toEqual(['stand-in']);
      });
    });

    // ACC-271 PR 2 — what the record page's buttons show comes from here.
    // ACC-271 PR 4 — the closed-task notices go out after the stage change
    // commits, never inside it: a change that fails tells nobody.
    describe('closed-task notices', () => {
      function arrangeSingle() {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ 'stage-single': SINGLE_STAGE, 'stage-target': { ...TARGET_STAGE, nameAr: 'الهدف' } }[where.id] ?? null),
        );
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(makeTransition({ kind: 'RETURN' }));
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        const cancellation = { open: [{ id: 'task-x', assignees: [] }], cancelledRequests: [] };
        mockTaskService.cancelStageExitTasksInTx.mockResolvedValue(cancellation);
        return cancellation;
      }
      const press = () => service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      it('tells whoever was on a closed task, with the move, after the transaction', async () => {
        const cancellation = arrangeSingle();

        await press();

        expect(mockTaskService.noticeStageExitClosures).toHaveBeenCalledWith(cancellation, ORG_A, ACTOR, {
          kind: 'RETURN',
          record: { objectType: 'DOCUMENT', objectId: 'object-1' },
          toStage: { nameEn: TARGET_STAGE.nameEn, nameAr: 'الهدف' },
          transition: { labelEn: BASE_TRANSITION.labelEn, labelAr: BASE_TRANSITION.labelAr },
        });
        expect(mockTaskService.noticeStageExitClosures.mock.invocationCallOrder[0]).toBeGreaterThan(
          mockPrisma.workflowInstance.update.mock.invocationCallOrder[0] ?? Infinity,
        );
      });

      it('tells nobody when the stage change fails inside its transaction', async () => {
        arrangeSingle();
        mockPrisma.workflowInstanceStage.create.mockRejectedValueOnce(new Error('the write failed'));

        await expect(press()).rejects.toThrow('the write failed');

        expect(mockTaskService.cancelStageExitTasksInTx).toHaveBeenCalled();
        expect(mockTaskService.noticeStageExitClosures).not.toHaveBeenCalled();
      });
    });

    describe('getMovesForViewer', () => {
      const moves = [
        { id: 'move-approve', requiredPermission: 'committees:approve', triggerCondition: 'ROLE_BASED', mover: null },
        { id: 'move-app', requiredPermission: null, triggerCondition: 'SYSTEM_AUTOMATIC', mover: null },
        { id: 'move-open', requiredPermission: null, triggerCondition: 'ANY_AUTHENTICATED', mover: 'PERSON' },
      ];
      function arrangeMoves(stage: Record<string, unknown>) {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ currentStageId: 'stage-pool' }));
        mockPrisma.workflowStage.findFirst.mockResolvedValue(stage);
        mockPrisma.workflowTransition.findMany.mockResolvedValue(moves);
      }
      const ask = (permissions: string[] = []) => service.getMovesForViewer('instance-1', ORG_A, permissions, ACTOR);

      it("a converted stage: a pool member gets the person's moves, whatever they require, and never the app's", async () => {
        arrangeMoves(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

        expect(await ask([])).toEqual({ transitionIds: ['move-approve', 'move-open'] });
      });

      it('a converted stage: someone outside the pool gets nothing, whatever permissions they hold', async () => {
        arrangeMoves(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf(['user-nora']));

        expect(await ask(['committees:approve'])).toEqual({ transitionIds: [] });
      });

      // ACC-271 PR 6a — no permission rule any more: a stage with no `who` has an
      // empty pool, so nobody is offered a move, whatever they hold.
      it('a stage with no `who`: nothing, whatever the caller holds (its pool is empty)', async () => {
        arrangeMoves({ ...POOL_STAGE, whoMode: null });
        mockStagePool.resolve.mockResolvedValue(poolOf([]));

        expect(await ask(['committees:approve'])).toEqual({ transitionIds: [] });
        expect(mockStagePool.resolve).toHaveBeenCalledWith(ORG_A, 'stage-pool', expect.anything());
      });

      it("reads the stage and its moves in the caller's organisation", async () => {
        arrangeMoves(POOL_STAGE);
        mockStagePool.resolve.mockResolvedValue(poolOf([ACTOR]));

        await ask();

        expect(mockPrisma.workflowStage.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'stage-pool', workflowTemplate: { organizationId: ORG_A } } }),
        );
        expect(mockPrisma.workflowTransition.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { fromStageId: 'stage-pool', fromStage: { workflowTemplate: { organizationId: ORG_A } } } }),
        );
      });

      it('a record that is missing, or another organisation\'s, is the same 404', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(null);

        await expect(ask()).rejects.toThrow(NotFoundException);
      });
    });

    describe('the move the app runs (the marker)', () => {
      it('triggerSystemTransition looks for mover APP, or SYSTEM_AUTOMATIC with no mover', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

        await expect(service.triggerSystemTransition('instance-1', 'approved', ORG_A, ACTOR)).rejects.toThrow(ConflictException);

        expect(mockPrisma.workflowTransition.findFirst).toHaveBeenCalledWith({
          where: {
            fromStageId: 'stage-single',
            toStage: { key: 'approved', workflowTemplateId: 'template-1' },
            OR: [{ mover: 'APP' }, { mover: null, triggerCondition: 'SYSTEM_AUTOMATIC' }],
          },
        });
      });
    });
  });
});
