import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { DateTime } from 'luxon';
import { WorkflowService } from './workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';

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
  workflowTransition: { findFirst: jest.fn() },
  workflowTransitionAction: { findMany: jest.fn() },
  workflowActionLog: { create: jest.fn() },
  workflowApproval: { upsert: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  userRole: { findFirst: jest.fn(), findMany: jest.fn() },
  committee: { findUnique: jest.fn() },
  committeeMember: { findMany: jest.fn() },
  task: { create: jest.fn() },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockQueue = { add: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.workflowTransitionAction.findMany.mockResolvedValue([]);
    mockPrisma.workflowInstanceStage.create.mockResolvedValue(BASE_INSTANCE_STAGE);
    mockPrisma.workflowInstanceStage.update.mockResolvedValue(BASE_INSTANCE_STAGE);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
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
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
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
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'user-1' }]);
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
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.submitApproval('instance-stage-1', { decision: 'RETURNED' }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
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
});
