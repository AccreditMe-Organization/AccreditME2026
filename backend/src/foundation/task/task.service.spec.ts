import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskService } from './task.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { ITaskSlaSettings } from '../tenant/interfaces/tenant.interface';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';
const USER_A = 'user-a-id';
const USER_B = 'user-b-id';

const BASE_TASK = {
  id: 'task-1',
  organizationId: ORG_A,
  title: 'Review document',
  description: null,
  sourceType: 'DOCUMENT',
  sourceId: 'doc-1',
  sourceStageId: null,
  workflowInstanceId: null,
  meetingId: null,
  createdById: ACTOR,
  status: 'PENDING',
  priority: 'MEDIUM',
  dueAt: new Date('2026-02-01'),
  dueDateOverridden: false,
  slaBreachedAt: null,
  completedAt: null,
  completedById: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignees: [{ id: 'ta-1', taskId: 'task-1', userId: USER_A, assignedAt: new Date(), assignedById: ACTOR, removedAt: null }],
};

const mockPrisma = {
  task: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  taskAssignee: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  taskEvidence: {
    create: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
};

// ACC-51 — attachAssigneesToUnassignedStageTasks() wraps its per-task writes
// in a transaction; the callback runs against this same mock. Assigned after
// the literal (not inside it) so mockPrisma's own type inference stays
// intact — same shape user.service.spec.ts already uses for its own
// transaction-taking flows.
(mockPrisma as unknown as Record<string, unknown>)['$transaction'] = jest.fn(
  (callback: (tx: unknown) => unknown) => callback(mockPrisma),
);

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockTenantService = { getTaskSla: jest.fn() };

// ACC-46 Section 2.7.c — a plausible, complete ITaskSlaSettings fixture;
// only dueAfterHours matters to computeSlaDueAt(), the escalation fields
// are exercised in sla-monitor.processor.spec.ts instead.
const DEFAULT_SLA: ITaskSlaSettings = {
  CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
  HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
};

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockWorkingCalendar.calculateDeadline.mockResolvedValue(DateTime.fromISO('2026-02-01T12:00:00Z'));
    mockTenantService.getTaskSla.mockResolvedValue(DEFAULT_SLA);
    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: TenantService, useValue: mockTenantService },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  describe('create', () => {
    // ACC-46 Section 2.7.c — computeSlaDueAt() now reads dueAfterHours via
    // TenantService.getTaskSla() instead of parsing Organization.settings
    // itself; getTaskSla()'s own fallback-to-platform-defaults behavior is
    // TenantService's responsibility, tested in tenant.service.spec.ts, not
    // duplicated here.
    it("computes dueAt from TenantService.getTaskSla()'s tier for the task's priority when no explicit due date given", async () => {
      mockTenantService.getTaskSla.mockResolvedValue({
        ...DEFAULT_SLA,
        HIGH: { dueAfterHours: 8, managerEscalationAfterHours: 4, headEscalationAfterHours: 8 },
      });
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A], priority: 'HIGH' },
        ORG_A,
        ACTOR,
      );

      expect(mockTenantService.getTaskSla).toHaveBeenCalledWith(ORG_A);
      expect(mockWorkingCalendar.calculateDeadline).toHaveBeenCalledWith(expect.any(DateTime), 8, ORG_A);
    });

    it("indexes the resolved settings by the task's own priority, not a fixed tier", async () => {
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A], priority: 'CRITICAL' },
        ORG_A,
        ACTOR,
      );

      expect(mockWorkingCalendar.calculateDeadline).toHaveBeenCalledWith(expect.any(DateTime), 4, ORG_A);
    });

    it('creates status UNASSIGNED and no TaskAssignee rows when the resolved assignee list is empty', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // no active users resolved
      mockPrisma.task.create.mockResolvedValue({ ...BASE_TASK, status: 'UNASSIGNED', assignees: [] });
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-admin' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A] },
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'UNASSIGNED', assignees: undefined }) }),
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1' }),
        ORG_A,
      );
    });

    it('logs to audit trail on creation', async () => {
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A] },
        ORG_A,
        ACTOR,
      );

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'Task' }),
      );
    });
  });

  describe('create — delegation stamping (ACC-40 Section 2.6.3)', () => {
    it('stamps delegationReason/delegationContextId only on the TaskAssignee row named in assigneeDelegations, null for everyone else', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A }, { id: USER_B }]);
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        {
          title: 'Task',
          sourceType: 'DOCUMENT',
          sourceId: 'doc-1',
          assigneeUserIds: [USER_A, USER_B],
          assigneeDelegations: [
            { userId: USER_A, delegationReason: 'ACTING_HEAD', delegationContextId: 'unit-1' },
          ],
        },
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignees: {
              create: [
                { userId: USER_A, assignedById: ACTOR, delegationReason: 'ACTING_HEAD', delegationContextId: 'unit-1' },
                { userId: USER_B, assignedById: ACTOR, delegationReason: null, delegationContextId: null },
              ],
            },
          }),
        }),
      );
    });

    it('stamps null for every assignee when assigneeDelegations is not provided at all (manual tasks:create path)', async () => {
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A] },
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignees: {
              create: [{ userId: USER_A, assignedById: ACTOR, delegationReason: null, delegationContextId: null }],
            },
          }),
        }),
      );
    });
  });

  describe('getMyTasks', () => {
    it('only returns tasks where the calling user has an active TaskAssignee row', async () => {
      mockPrisma.task.findMany.mockResolvedValue([BASE_TASK]);

      await service.getMyTasks(USER_A, ORG_A);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_A,
            assignees: { some: { userId: USER_A, removedAt: null } },
          }),
        }),
      );
    });

    // Renamed from "should NOT return tasks belonging to a different
    // tenant" (ACC-33 item 1) — the CI tenant-isolation gate filters on the
    // literal string "should NOT return records belonging to a different
    // tenant"; the near-miss wording meant this otherwise-correct test was
    // silently excluded from that gate.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.task.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? [BASE_TASK] : []),
      );

      const resultA = await service.getMyTasks(USER_A, ORG_A);
      const resultB = await service.getMyTasks(USER_A, ORG_B);

      expect(resultA).toHaveLength(1);
      expect(resultB).toHaveLength(0);
    });
  });

  describe('complete', () => {
    it('marks the task COMPLETED when called by an active assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED', completedById: USER_A });

      const result = await service.complete('task-1', USER_A, ORG_A);

      expect(result.status).toBe('COMPLETED');
    });

    it('sets removedAt on every other active assignee (ANY-completes semantics)', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED' });

      await service.complete('task-1', USER_A, ORG_A);

      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 'task-1', removedAt: null, userId: { not: USER_A } },
          data: expect.objectContaining({ removedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFoundException when the caller is not an active assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await expect(service.complete('task-1', USER_B, ORG_A)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a task belonging to a different tenant', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.complete('task-1', USER_A, ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  describe('reassign', () => {
    it('requires a reason and creates new TaskAssignee rows', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'PENDING' });

      await service.reassign('task-1', { newAssigneeUserIds: [USER_B], reason: 'Ahmad is on leave' }, ORG_A, ACTOR);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignees: { create: [{ userId: USER_B, assignedById: ACTOR }] },
          }),
        }),
      );
    });

    it('removes the previous assignees', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'PENDING' });

      await service.reassign('task-1', { newAssigneeUserIds: [USER_B], reason: 'reason' }, ORG_A, ACTOR);

      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: 'task-1', removedAt: null } }),
      );
    });

    it('logs a full before/after audit entry with the reason', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'PENDING' });

      await service.reassign('task-1', { newAssigneeUserIds: [USER_B], reason: 'Ahmad is on leave' }, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELEGATE',
          before: BASE_TASK,
          metadata: expect.objectContaining({ reason: 'Ahmad is on leave' }),
        }),
      );
    });

    it('throws NotFoundException for a task belonging to a different tenant', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(
        service.reassign('task-1', { newAssigneeUserIds: [USER_B], reason: 'x' }, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reassignAllForUser', () => {
    const ASSIGNMENT_SOLO = {
      id: 'ta-1',
      taskId: 'task-1',
      userId: USER_A,
      removedAt: null,
      task: {
        id: 'task-1',
        status: 'PENDING',
        assignees: [{ id: 'ta-1', userId: USER_A, removedAt: null }],
      },
    };

    it('reassigns every active task to the acting user when one is given', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);

      const result = await service.reassignAllForUser(USER_A, USER_B, ORG_A, ACTOR);

      expect(mockPrisma.taskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'ta-1' },
        data: { removedAt: expect.any(Date) },
      });
      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId: USER_B, assignedById: ACTOR },
      });
      expect(result).toEqual({ reassignedCount: 1, unassignedCount: 0 });
    });

    it('flags a task UNASSIGNED when no acting user is given and no other assignee remains', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);

      const result = await service.reassignAllForUser(USER_A, null, ORG_A, ACTOR);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'UNASSIGNED' },
      });
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 1 });
    });

    it('does NOT flag UNASSIGNED when another active assignee remains on the task (multi-assignee)', async () => {
      const multiAssignment = {
        ...ASSIGNMENT_SOLO,
        task: {
          id: 'task-1',
          status: 'PENDING',
          assignees: [
            { id: 'ta-1', userId: USER_A, removedAt: null },
            { id: 'ta-2', userId: USER_B, removedAt: null },
          ],
        },
      };
      mockPrisma.taskAssignee.findMany.mockResolvedValue([multiAssignment]);

      const result = await service.reassignAllForUser(USER_A, null, ORG_A, ACTOR);

      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0 });
    });

    it('falls back to UNASSIGNED when the requested acting user is not active in this tenant', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);
      mockPrisma.user.findMany.mockResolvedValue([]); // acting user not found/inactive

      const result = await service.reassignAllForUser(USER_A, 'inactive-user', ORG_A, ACTOR);

      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 1 });
    });

    it('logs an audit entry per reassigned task', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);

      await service.reassignAllForUser(USER_A, USER_B, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELEGATE',
          objectType: 'Task',
          objectId: 'task-1',
          metadata: expect.objectContaining({ event: 'departure_reassignment', fromUserId: USER_A }),
        }),
      );
    });

    it('should NOT reassign tasks belonging to a different tenant', async () => {
      mockPrisma.taskAssignee.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.task.organizationId === ORG_A ? [ASSIGNMENT_SOLO] : []),
      );

      const result = await service.reassignAllForUser(USER_A, null, ORG_B, ACTOR);

      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0 });
    });
  });

  describe('getForSource', () => {
    // Same near-miss title fix as getMyTasks() above (ACC-33 item 1).
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.task.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? [BASE_TASK] : []),
      );

      const result = await service.getForSource('DOCUMENT', 'doc-1', ORG_B);

      expect(result).toHaveLength(0);
    });
  });

  describe('listUnassigned (ACC-34)', () => {
    it('returns only status: UNASSIGNED tasks, tenant-wide', async () => {
      const unassignedTask = { ...BASE_TASK, status: 'UNASSIGNED', assignees: [] };
      mockPrisma.task.findMany.mockResolvedValue([unassignedTask]);

      const result = await service.listUnassigned(ORG_A);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, status: 'UNASSIGNED' },
        }),
      );
      expect(result).toEqual([unassignedTask]);
    });

    it('is not scoped to the calling user — no assignees filter applied', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.listUnassigned(ORG_A);

      const call = mockPrisma.task.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('assignees');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      const unassignedTask = { ...BASE_TASK, status: 'UNASSIGNED', assignees: [] };
      mockPrisma.task.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? [unassignedTask] : []),
      );

      const result = await service.listUnassigned(ORG_B);

      expect(result).toHaveLength(0);
    });
  });

  // ACC-51 — the recovery path. Every test here asserts real effect (the task
  // genuinely leaves UNASSIGNED, with a real TaskAssignee row behind it), not
  // just that a notification fired: a notification alone would point someone
  // at work complete() would still reject them from.
  describe('attachAssigneesToUnassignedStageTasks', () => {
    const INSTANCE_ID = 'wf-instance-1';
    const STAGE_ID = 'stage-1';
    const UNASSIGNED_TASK = {
      ...BASE_TASK,
      id: 'task-unassigned',
      status: 'UNASSIGNED',
      createdById: ACTOR,
      assignees: [],
    };

    it('attaches the newly-resolved assignee and flips the task out of UNASSIGNED', async () => {
      mockPrisma.task.findMany.mockResolvedValue([UNASSIGNED_TASK]);

      const recovered = await service.attachAssigneesToUnassignedStageTasks(
        INSTANCE_ID,
        STAGE_ID,
        [USER_A],
        ORG_A,
      );

      expect(recovered).toBe(1);
      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-unassigned', userId: USER_A, assignedById: ACTOR },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-unassigned' },
        data: { status: 'PENDING' },
      });
    });

    it('notifies each newly-eligible assignee, reusing create()\'s own new-assignment wording', async () => {
      mockPrisma.task.findMany.mockResolvedValue([UNASSIGNED_TASK]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A }, { id: USER_B }]);

      await service.attachAssigneesToUnassignedStageTasks(INSTANCE_ID, STAGE_ID, [USER_A, USER_B], ORG_A);

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_A,
          titleEn: 'New task assigned',
          objectType: 'Task',
          objectId: 'task-unassigned',
        }),
        ORG_A,
      );
    });

    it('queries only UNASSIGNED tasks for the recovered stage — an already-assigned task for the same stage is never touched', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      const recovered = await service.attachAssigneesToUnassignedStageTasks(
        INSTANCE_ID,
        STAGE_ID,
        [USER_A],
        ORG_A,
      );

      expect(recovered).toBe(0);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A,
            workflowInstanceId: INSTANCE_ID,
            sourceStageId: STAGE_ID,
            status: 'UNASSIGNED',
          },
        }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('does nothing when the resolved pool contains no ACTIVE user — never flips a task to PENDING with no real assignee', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // resolved id exists, but is INVITED/SUSPENDED

      const recovered = await service.attachAssigneesToUnassignedStageTasks(
        INSTANCE_ID,
        STAGE_ID,
        ['inactive-user'],
        ORG_A,
      );

      expect(recovered).toBe(0);
      expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    // Guards TaskAssignee's @@unique([taskId, userId]) — reachable on a
    // repeat recovery (block → recover → re-block → recover), and on a task
    // left UNASSIGNED by reassignAllForUser() with removed rows still on it.
    it('reactivates an existing removed assignee row in place instead of creating a duplicate', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        {
          ...UNASSIGNED_TASK,
          assignees: [
            { id: 'ta-old', taskId: 'task-unassigned', userId: USER_A, assignedById: ACTOR, removedAt: new Date() },
          ],
        },
      ]);

      const recovered = await service.attachAssigneesToUnassignedStageTasks(
        INSTANCE_ID,
        STAGE_ID,
        [USER_A],
        ORG_A,
      );

      expect(recovered).toBe(1);
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(mockPrisma.taskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'ta-old' },
        data: { removedAt: null, assignedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-unassigned' },
        data: { status: 'PENDING' },
      });
    });

    it('audit-logs the recovery without an actorId — system-driven, matching every other sweep-originated entry', async () => {
      mockPrisma.task.findMany.mockResolvedValue([UNASSIGNED_TASK]);

      await service.attachAssigneesToUnassignedStageTasks(INSTANCE_ID, STAGE_ID, [USER_A], ORG_A);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'Task',
          objectId: 'task-unassigned',
          tenantId: ORG_A,
          metadata: expect.objectContaining({ event: 'unassigned_stage_recovery' }),
        }),
      );
      expect(mockAuditLog.log.mock.calls[0][0]).not.toHaveProperty('actorId');
    });

    itEnforcesTenantIsolation(
      'attachAssigneesToUnassignedStageTasks only recovers tasks within the requested tenant',
      async () => {
        mockPrisma.task.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? [UNASSIGNED_TASK] : []),
        );

        const recovered = await service.attachAssigneesToUnassignedStageTasks(
          INSTANCE_ID,
          STAGE_ID,
          [USER_A],
          ORG_B,
        );

        expect(recovered).toBe(0);
        expect(mockPrisma.task.update).not.toHaveBeenCalled();
        expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
        );
      },
    );
  });
});
