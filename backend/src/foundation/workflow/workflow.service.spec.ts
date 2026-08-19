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
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  role: { findFirst: jest.fn() },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockTaskService = { create: jest.fn() };
const mockRoleService = { getUserPermissions: jest.fn() };
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: TaskService, useValue: mockTaskService },
        { provide: RoleService, useValue: mockRoleService },
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
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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
        mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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
        mockPrisma.workflowInstance.findUnique.mockResolvedValue(
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

  // ── ACC-33 item 6 — ORG_UNIT_HEAD degrades gracefully ──────────────────────

  describe('resolveAssigneeRaw — ORG_UNIT_HEAD (ACC-33 item 6)', () => {
    it('resolves to an empty pool instead of throwing, for a stage using the ORG_UNIT_HEAD strategy', async () => {
      const orgUnitHeadStage = { ...SINGLE_STAGE, assigneeStrategy: 'ORG_UNIT_HEAD' };
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findFirst.mockResolvedValue(orgUnitHeadStage);
      mockPrisma.workflowInstance.create.mockResolvedValue(BASE_INSTANCE);
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
