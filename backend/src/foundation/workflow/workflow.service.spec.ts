import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { DateTime } from 'luxon';
import { WorkflowService } from './workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TaskService } from '../task/task.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
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
  workflowStage: { findFirst: jest.fn() },
  workflowInstance: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workflowInstanceStage: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  workflowTransition: { findFirst: jest.fn(), findMany: jest.fn() },
  workflowTransitionAction: { findMany: jest.fn() },
  workflowActionLog: { create: jest.fn() },
  workflowApproval: { upsert: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  userRole: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  committee: { findFirst: jest.fn() },
  committeeMember: { findMany: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  role: { findFirst: jest.fn() },
  orgUnit: { findFirst: jest.fn() },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockTaskService = { create: jest.fn() };
const mockRoleService = { getUserPermissions: jest.fn() };
const mockOrganizationService = { resolveActingHeadForOrgUnit: jest.fn() };
const mockQueue = { add: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([]);
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
    mockTaskService.create.mockResolvedValue({ id: 'task-1', status: 'PENDING' });
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
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: RoleService, useValue: mockRoleService },
        { provide: OrganizationService, useValue: mockOrganizationService },
        { provide: getQueueToken('workflow-actions'), useValue: mockQueue },
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

      const result = await service.getInstancesByObject('DOCUMENT', 'object-1', ORG_A);

      expect(result).toHaveLength(2);
      expect(mockPrisma.workflowInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
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

    it('throws ConflictException if already CANCELLED', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(makeInstance({ status: 'CANCELLED' }));

      await expect(service.cancelInstance('instance-1', ORG_A, ACTOR, 'x')).rejects.toThrow(
        ConflictException,
      );
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
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ actionType: 'CREATE_TASK', status: 'SUCCESS' }) }),
      );
    });

    // Regression test for the bug fixed in Step 8 (ACC-11): executeCreateTask()
    // used to only ever pass assigneeIds[0] to the task-creation call, silently
    // dropping every other resolved assignee for multi-approver (ROLE-resolved
    // to multiple holders, PARALLEL/COMMITTEE) stages.
    it('passes the FULL resolved assigneeIds array to TaskService.create(), not just the first', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...PARALLEL_STAGE, id: 'stage-target' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      // PARALLEL_STAGE resolves via ROLE with approvalMode PARALLEL — every
      // holder is returned, not just the first (that's exactly the bug).
      mockPrisma.userRole.findMany.mockResolvedValue([
        { userId: 'holder-1' },
        { userId: 'holder-2' },
        { userId: 'holder-3' },
      ]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['holder-1', 'holder-2', 'holder-3'] }),
        ORG_A,
        ACTOR,
      );
    });

    // ACC-46 Section 2.7.f — workflow-created tasks now honor
    // stage.slaWorkingHours for dueDate, reusing the exact same private
    // computeSlaDueAt() already feeding WorkflowInstanceStage.slaDueAt
    // (see the 'startInstance' describe block's own equivalent test above)
    // rather than duplicating WorkingCalendarService.calculateDeadline().
    describe('CREATE_TASK dueDate — honors stage.slaWorkingHours (ACC-46 Section 2.7.f)', () => {
      it('passes a computed dueDate to TaskService.create() when the target stage has slaWorkingHours configured', async () => {
        const stageWithSla = { ...TARGET_STAGE, slaWorkingHours: 16 };
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': stageWithSla });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]);
        const deadline = DateTime.fromJSDate(new Date('2026-02-01T00:00:00Z'));
        mockWorkingCalendar.calculateDeadline.mockResolvedValue(deadline);

        await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockWorkingCalendar.calculateDeadline).toHaveBeenCalledWith(expect.any(DateTime), 16, ORG_A);
        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ dueDate: deadline.toJSDate().toISOString() }),
          ORG_A,
          ACTOR,
        );
      });

      // Regression guard for the plan's own stated requirement: "zero
      // behavior change for any stage that hasn't configured an SLA" —
      // TARGET_STAGE's own slaWorkingHours is null by default (see its
      // fixture above), so every pre-existing CREATE_TASK test already
      // exercises this path implicitly; this test asserts it directly.
      it('leaves dueDate undefined when the target stage has no slaWorkingHours configured', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]);

        await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockWorkingCalendar.calculateDeadline).not.toHaveBeenCalled();
        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ dueDate: undefined }),
          ORG_A,
          ACTOR,
        );
      });
    });

    // ACC-34 — executeCreateTask()'s title previously read
    // `${transition.labelEn} — ${instance.objectType}` (e.g. "Submit for
    // Approval — COMMITTEE"), with no name resolution at all.
    describe('CREATE_TASK title — committee-name resolution (ACC-34)', () => {
      it('resolves the real committee name into the task title for a COMMITTEE-type instance', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(COMMITTEE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(
          makeInstance({ objectType: 'COMMITTEE', objectId: COMMITTEE_INSTANCE.objectId, currentStageId: 'stage-target' }),
        );
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]);
        mockPrisma.committee.findFirst.mockResolvedValue({ nameEn: 'Quality Committee' });

        await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
          where: { id: COMMITTEE_INSTANCE.objectId, organizationId: ORG_A },
          select: { nameEn: true },
        });
        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ title: `${BASE_TRANSITION.labelEn} — Quality Committee` }),
          ORG_A,
          ACTOR,
        );
      });

      it('falls back to the generic objectType format for a non-COMMITTEE instance (unchanged behavior)', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]);

        await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockPrisma.committee.findFirst).not.toHaveBeenCalled();
        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ title: `${BASE_TRANSITION.labelEn} — ${BASE_INSTANCE.objectType}` }),
          ORG_A,
          ACTOR,
        );
      });

      // MANDATORY — tenant isolation for resolveObjectSubjectLabel()'s new
      // committee.findFirst() query.
      it('should NOT return records belonging to a different tenant', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(COMMITTEE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(
          makeInstance({ objectType: 'COMMITTEE', objectId: COMMITTEE_INSTANCE.objectId, currentStageId: 'stage-target' }),
        );
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]);
        // Mock branches on organizationId exactly like a real Postgres query
        // would — the committee genuinely only resolves for ORG_A.
        mockPrisma.committee.findFirst.mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            Promise.resolve(where.organizationId === ORG_A ? { nameEn: 'Quality Committee' } : null),
        );

        await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ title: `${BASE_TRANSITION.labelEn} — Quality Committee` }),
          ORG_A,
          ACTOR,
        );
      });
    });

    // ACC-34 item 3 — fireTransitionActions() now returns unassignedTaskWarnings
    // (array-shaped, threaded through to IWorkflowInstance) and sets
    // WorkflowActionLogStatus.SUCCESS_UNASSIGNED instead of SUCCESS when a
    // CREATE_TASK action resolves zero eligible assignees.
    describe('unassignedTaskWarnings / SUCCESS_UNASSIGNED (ACC-34 item 3)', () => {
      const ROLE_TARGET_STAGE = { ...TARGET_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-x' };

      it('logs SUCCESS_UNASSIGNED and returns one warning when CREATE_TASK resolves zero eligible assignees', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': ROLE_TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]); // nobody holds role-x

        const result = await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ actionType: 'CREATE_TASK', status: 'SUCCESS_UNASSIGNED' }),
          }),
        );
        expect(result.unassignedTaskWarnings).toHaveLength(1);
        expect(result.unassignedTaskWarnings[0]).toContain('no eligible assignee');
      });

      it('logs SUCCESS and returns no warnings when CREATE_TASK resolves eligible assignees', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': ROLE_TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'holder-1' }]);

        const result = await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ actionType: 'CREATE_TASK', status: 'SUCCESS' }),
          }),
        );
        expect(result.unassignedTaskWarnings).toEqual([]);
      });

      // Proves the array genuinely collects one entry per action rather than
      // one overwriting another — the concrete risk flagged during planning
      // (WorkflowTransitionAction rows are tenant-editable; nothing prevents
      // two CREATE_TASK actions on one transition, even though no seeded
      // transition does this today).
      it('collects a distinct warning entry for each of multiple CREATE_TASK actions on one transition', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': ROLE_TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
          { id: 'action-2', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 20, isEnabled: true },
        ]);
        mockPrisma.userRole.findMany.mockResolvedValue([]); // nobody holds role-x — both actions unassigned

        const result = await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(result.unassignedTaskWarnings).toHaveLength(2);
        expect(mockTaskService.create).toHaveBeenCalledTimes(2);
        expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledTimes(2);
      });

      it('leaves every other action type logging SUCCESS, unaffected by the new CREATE_TASK branch', async () => {
        mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
        mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
        mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': TARGET_STAGE });
        mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
        mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
        mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
          { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'SEND_NOTIFICATION', order: 10, isEnabled: true },
        ]);
        mockPrisma.role.findFirst.mockResolvedValue(null);

        const result = await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

        expect(mockPrisma.workflowActionLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ actionType: 'SEND_NOTIFICATION', status: 'SUCCESS' }),
          }),
        );
        expect(result.unassignedTaskWarnings).toEqual([]);
      });
    });

    // ACC-22, closing the ACC-17 deferred gap: resolveAssigneeRaw()'s
    // COMMITTEE case previously read `prisma.committeeMember.findMany({
    // where: { committeeId, leftAt: null } })` with no organizationId
    // filter -- first-ever test coverage of this branch, proving both the
    // happy path and the org-scoping fix (isActive + organizationId).
    it("resolves the CREATE_TASK assignees to a COMMITTEE stage's active, org-scoped members", async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...TARGET_STAGE, assigneeStrategy: 'COMMITTEE', committeeId: 'committee-a' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'member-1' }, { userId: 'member-2' }]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: { committeeId: 'committee-a', organizationId: ORG_A, isActive: true },
      });
      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['member-1', 'member-2'] }),
        ORG_A,
        ACTOR,
      );
    });

    // ACC-28 — assigneeCommitteeRoleValueId narrows the COMMITTEE case to a
    // specific committee_member_role. Unset (the test above) preserves the
    // pre-ACC-28 "every active member" behavior; this proves the filter is
    // actually applied to the Prisma query when set.
    it("narrows a COMMITTEE stage's CREATE_TASK assignees to a specific committee_member_role when assigneeCommitteeRoleValueId is set", async () => {
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
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'chairman-user' }]);

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockPrisma.committeeMember.findMany).toHaveBeenCalledWith({
        where: {
          committeeId: 'committee-a',
          organizationId: ORG_A,
          isActive: true,
          roleValueId: 'lookup-chairman-id',
        },
      });
      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['chairman-user'] }),
        ORG_A,
        ACTOR,
      );
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
    // with `id: { in: [...] }` over whatever the first call resolved. A
    // blanket mockResolvedValue would answer both identically and silently
    // re-expand a pool SINGLE mode had just narrowed — so this honors the id
    // filter, exactly as the OOO-aware tests elsewhere in this file do.
    const mockPositionHolders = (holders: { id: string }[]) => {
      mockPrisma.user.findMany.mockImplementation(
        ({ where }: { where: { id?: { in: string[] }; organizationId: string } }) =>
          Promise.resolve(
            where.id?.in ? holders.filter((h) => where.id!.in.includes(h.id)) : holders,
          ),
      );
    };

    const runPositionFixedTransition = async (stage: Record<string, unknown>) => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({ 'stage-single': SINGLE_STAGE, 'stage-target': stage });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);
    };

    it("resolves a POSITION_FIXED stage's assignee to the ACTIVE holder of that position in that unit", async () => {
      mockPositionHolders([{ id: 'holder-1' }]);

      await runPositionFixedTransition(positionFixedStage());

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          positionId: 'position-a',
          primaryOrgUnitId: 'unit-a',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['holder-1'] }),
        ORG_A,
        ACTOR,
      );
    });

    // The property that lets POSITION_FIXED inherit ACC-28's unassigned-stage
    // detection and ACC-51/52's task recovery for free: an unresolvable pool
    // must come back EMPTY, never throw. Pinned explicitly rather than
    // assumed — a throw here would abort the transition and, via the sweep,
    // take down every other step in that cycle.
    it('returns an empty pool rather than throwing when no one holds the position in that unit', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await expect(runPositionFixedTransition(positionFixedStage())).resolves.not.toThrow();

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: [] }),
        ORG_A,
        ACTOR,
      );
    });

    it.each([
      ['position', { assigneePositionId: null }],
      ['org unit', { assigneeOrgUnitId: null }],
      ['both fields', { assigneePositionId: null, assigneeOrgUnitId: null }],
    ])(
      'returns an empty pool rather than throwing when the stage is missing its %s',
      async (_label, overrides) => {
        await expect(runPositionFixedTransition(positionFixedStage(overrides))).resolves.not.toThrow();

        // Short-circuits before querying at all — no point asking the
        // database who holds an unspecified position.
        expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
        expect(mockTaskService.create).toHaveBeenCalledWith(
          expect.objectContaining({ assigneeUserIds: [] }),
          ORG_A,
          ACTOR,
        );
      },
    );

    it('narrows a POSITION_FIXED pool to one assignee under SINGLE approvalMode, like ROLE does', async () => {
      mockPositionHolders([{ id: 'holder-1' }, { id: 'holder-2' }]);

      await runPositionFixedTransition(positionFixedStage({ approvalMode: 'SINGLE' }));

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['holder-1'] }),
        ORG_A,
        ACTOR,
      );
    });

    it('returns every holder for a non-SINGLE POSITION_FIXED stage', async () => {
      mockPositionHolders([{ id: 'holder-1' }, { id: 'holder-2' }]);

      await runPositionFixedTransition(positionFixedStage({ approvalMode: 'PARALLEL' }));

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['holder-1', 'holder-2'] }),
        ORG_A,
        ACTOR,
      );
    });

    itEnforcesTenantIsolation('POSITION_FIXED resolves holders only within the requested tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(where.organizationId === ORG_A ? [{ id: 'holder-1' }] : [{ id: 'leaked-holder' }]),
      );

      await runPositionFixedTransition(positionFixedStage());

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['holder-1'] }),
        ORG_A,
        ACTOR,
      );
    });

    it('routes an out-of-office assignee to their acting user before task creation', async () => {
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockStagesById({
        'stage-single': SINGLE_STAGE,
        'stage-target': { ...TARGET_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-x' },
      });
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
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

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeUserIds: ['acting-user-1'] }),
        ORG_A,
        ACTOR,
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'holder-1' }),
        ORG_A,
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'acting-user-1' }),
        ORG_A,
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELEGATE', objectType: 'User', objectId: 'holder-1' }),
      );
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

  // ── triggerTransition — validatorConfig ───────────────────────────────────────

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

    // Commit 4's own scope: proves the chain all the way from a real
    // CREATE_TASK transition action through executeCreateTask()'s
    // per-assignee resolveDelegationStamp() call to the exact dto passed
    // into TaskService.create() — task.service.spec.ts's own "delegation
    // stamping" tests separately prove that dto correctly becomes a
    // stamped TaskAssignee row, so together the two specs cover the full
    // path with no unverified link in between.
    it('produces a correctly-stamped assigneeDelegations entry via a real CREATE_TASK transition action, end to end from executeCreateTask() into TaskService.create()', async () => {
      const roleTargetStage = { ...TARGET_STAGE, assigneeStrategy: 'ROLE', assigneeRoleId: 'role-qm' };
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(BASE_INSTANCE);
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowStage.findFirst.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(({ 'stage-single': SINGLE_STAGE, 'stage-target': roleTargetStage } as Record<string, unknown>)[where.id] ?? null),
      );
      mockPrisma.workflowInstanceStage.findFirst.mockResolvedValue(BASE_INSTANCE_STAGE);
      mockPrisma.workflowInstance.update.mockResolvedValue(makeInstance({ currentStageId: 'stage-target' }));
      mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([
        { id: 'action-1', workflowTransitionId: 'transition-1', actionType: 'CREATE_TASK', order: 10, isEnabled: true },
      ]);
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'absent-user' }]);
      // Raw ROLE pool resolves to 'absent-user' — applyOutOfOfficeRouting()
      // substitutes it to ACTOR before executeCreateTask() ever sees the
      // resolved assigneeIds, so the task's real assignee is ACTOR, not
      // 'absent-user'.
      mockPrisma.user.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) =>
            id === 'absent-user'
              ? {
                  id,
                  outOfOfficeFrom: new Date(Date.now() - 86400000),
                  outOfOfficeTo: new Date(Date.now() + 86400000),
                  actingUserId: ACTOR,
                }
              : { id, outOfOfficeFrom: null, outOfOfficeTo: null, actingUserId: null },
          ),
        ),
      );
      // resolveOutOfOfficeCoverageForUser()'s own query, run against the
      // RAW pool (['absent-user']) inside resolveDelegationStamp() —
      // independent of the substitution above.
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'absent-user' });

      await service.triggerTransition('instance-1', { transitionId: 'transition-1' }, ORG_A, ACTOR, []);

      expect(mockTaskService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeUserIds: [ACTOR],
          assigneeDelegations: [
            { userId: ACTOR, delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'absent-user' },
          ],
        }),
        ORG_A,
        ACTOR,
      );
    });
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

  describe('notifyTenantAdminsOfUnassignedStage (ACC-28 Section 2.5)', () => {
    const STAGE_WITH_COMMITTEE = { ...COMMITTEE_STAGE, nameEn: 'Chairman Review' };
    const BLOCKING = [makeTransition({ id: 't-blocked', labelEn: 'Approve', triggerCondition: 'ASSIGNEE_POOL' })];

    // ACC-34 — regression test proving resolveObjectSubjectLabel()'s
    // instance.objectId-keyed resolution is now genuinely reachable.
    // Previously keyed off stage.committeeId, which no seeded stage ever
    // sets (confirmed by grepping workflow.seed.ts) — this exact
    // notification, with a COMMITTEE-typed instance, would NOT have
    // resolved a real name before this fix even though STAGE_WITH_COMMITTEE
    // has a committeeId set, because nothing ever passed a stage with
    // committeeId populated in practice.
    it('notifies every active TENANT_ADMIN, naming the transition and the committee', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }, { userId: 'admin-2' }]);
      mockPrisma.committee.findFirst.mockResolvedValue({ nameEn: 'Quality Committee' });

      await service.notifyTenantAdminsOfUnassignedStage(ORG_A, COMMITTEE_INSTANCE as never, STAGE_WITH_COMMITTEE as never, BLOCKING as never);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: COMMITTEE_INSTANCE.objectId, organizationId: ORG_A },
        select: { nameEn: true },
      });
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      const [firstCallArgs] = mockNotificationService.create.mock.calls[0] as [{ bodyEn: string; userId: string }];
      expect(firstCallArgs.userId).toBe('admin-1');
      expect(firstCallArgs.bodyEn).toContain('Approve');
      expect(firstCallArgs.bodyEn).toContain('Quality Committee');
    });

    it('falls back to objectType/objectId for a non-COMMITTEE instance, even when the stage has a committeeId set', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      // STAGE_WITH_COMMITTEE (committeeId set) deliberately paired with a
      // non-COMMITTEE instance — proves resolution is keyed off
      // instance.objectType, not merely "does the stage have a committeeId".
      await service.notifyTenantAdminsOfUnassignedStage(ORG_A, BASE_INSTANCE as never, STAGE_WITH_COMMITTEE as never, BLOCKING as never);

      expect(mockPrisma.committee.findFirst).not.toHaveBeenCalled();
      const [callArgs] = mockNotificationService.create.mock.calls[0] as [{ bodyEn: string }];
      expect(callArgs.bodyEn).toContain(BASE_INSTANCE.objectType);
      expect(callArgs.bodyEn).toContain(BASE_INSTANCE.objectId);
    });

    it('does nothing when no TENANT_ADMIN role exists for the tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await service.notifyTenantAdminsOfUnassignedStage(ORG_A, BASE_INSTANCE as never, SINGLE_STAGE as never, BLOCKING as never);

      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-id' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.notifyTenantAdminsOfUnassignedStage(ORG_A, COMMITTEE_INSTANCE as never, STAGE_WITH_COMMITTEE as never, BLOCKING as never);

      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });
  });

  describe('startInstance — unassigned-stage detection wiring (ACC-28 Section 2.5)', () => {
    it('flags the newly-created stage and notifies Tenant Admins when its ASSIGNEE_POOL transition is unreachable', async () => {
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
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', titleEn: expect.stringContaining('unreachable') }),
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
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]); // TENANT_ADMIN lookup

      await service.startInstance('DOCUMENT', 'object-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
        where: { id: 'fresh-instance-stage' },
        data: { isUnassigned: true, unassignedAt: expect.any(Date) },
      });
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', titleEn: expect.stringContaining('unreachable') }),
        ORG_A,
      );
    });

    // ACC-33 item 9 — genuine union proof: both resolvers report a DIFFERENT
    // blocking transition simultaneously; both labels must survive into the
    // single notification, proving concatenation ([...poolBlocking,
    // ...triggerBlocking]) rather than one overwriting/masking the other
    // (e.g. an `||` fallback or last-write-wins assignment would drop one).
    it('preserves BOTH blocking transitions when the ASSIGNEE_POOL resolver and the trigger-condition resolver each flag a different transition on the same stage', async () => {
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

      const [callArgs] = mockNotificationService.create.mock.calls.find(
        ([arg]: [{ titleEn: string }]) => arg.titleEn.includes('unreachable'),
      ) as [{ bodyEn: string }];
      expect(callArgs.bodyEn).toContain('Approve (pool)');
      expect(callArgs.bodyEn).toContain('Escalate (role)');
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
