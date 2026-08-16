import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskService } from './task.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';

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
  escalationUserId: null,
  escalationAfterHours: null,
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
  organization: {
    findUnique: jest.fn(),
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

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { calculateDeadline: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockOrgPositionService = { validateEscalationTarget: jest.fn() };

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockWorkingCalendar.calculateDeadline.mockResolvedValue(DateTime.fromISO('2026-02-01T12:00:00Z'));
    mockPrisma.organization.findUnique.mockResolvedValue({ settings: null });
    mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: OrgPositionService, useValue: mockOrgPositionService },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  describe('create', () => {
    it('computes dueAt from Organization.settings.taskSla[priority] when no explicit due date given', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ settings: { taskSla: { HIGH: 8 } } });
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        { title: 'Task', sourceType: 'DOCUMENT', sourceId: 'doc-1', assigneeUserIds: [USER_A], priority: 'HIGH' },
        ORG_A,
        ACTOR,
      );

      expect(mockWorkingCalendar.calculateDeadline).toHaveBeenCalledWith(expect.any(DateTime), 8, ORG_A);
    });

    it('respects platform defaults when settings.taskSla is absent', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ settings: null });
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

    it('validates the escalation pair via OrgPositionService when escalationUserId is set', async () => {
      mockPrisma.task.create.mockResolvedValue(BASE_TASK);

      await service.create(
        {
          title: 'Task',
          sourceType: 'DOCUMENT',
          sourceId: 'doc-1',
          assigneeUserIds: [USER_A],
          escalationUserId: 'escalation-1',
          escalationAfterHours: 24,
        },
        ORG_A,
        ACTOR,
      );

      expect(mockOrgPositionService.validateEscalationTarget).toHaveBeenCalledWith(
        [USER_A],
        'escalation-1',
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
});
