import { Test, TestingModule } from '@nestjs/testing';
import { TaskSlaService } from './task-sla.service';
import { ConflictException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskService } from './task.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskAuthorityService } from './task-authority.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';

// ACC-173 — what TaskService's existing actions do around a hold and a
// pending request. The request service itself is pinned in
// task-request.service.spec.ts.

const ORG_A = 'org-a';
const ASSIGNEE = 'assignee';
const OTHER = 'other';
const CREATOR = 'creator';
const DELEGATE = 'delegate';

const row = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id: `ta-${userId}`,
  taskId: 'task-1',
  userId,
  removedAt: null,
  pickedAt: null,
  delegationReason: null,
  delegationContextId: null,
  ...overrides,
});

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organizationId: ORG_A,
  title: 'Collect the audit sample',
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
  createdById: CREATOR,
  status: 'PENDING',
  priority: 'MEDIUM',
  requiresEvidence: false,
  dueAt: new Date('2026-10-20T13:00:00Z'),
  assignedOrgUnitId: null,
  assignedPositionId: null,
  assignedCommitteeId: null,
  assignedCommitteeRoleValueId: null,
  heldAt: null,
  onHoldUntil: null,
  heldFromStatus: null,
  assignees: [row(ASSIGNEE)],
  ...overrides,
});

const onHold = (overrides: Record<string, unknown> = {}) =>
  task({
    status: 'ON_HOLD',
    heldFromStatus: 'IN_PROGRESS',
    heldAt: new Date('2026-10-05T08:00:00Z'),
    onHoldUntil: new Date('2026-10-12T05:00:00Z'),
    ...overrides,
  });

const PENDING_REQUEST = { id: 'req-1', taskId: 'task-1' };

const mockPrisma = {
  organization: { findFirst: jest.fn() },
  task: { findFirst: jest.fn(), findFirstOrThrow: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  taskAssignee: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  taskEvidence: { count: jest.fn(), create: jest.fn() },
  taskRequest: { findMany: jest.fn(), updateMany: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  committeeMember: { findMany: jest.fn() },
  committee: { findFirst: jest.fn().mockResolvedValue({ nameEn: 'Infection Control Committee', nameAr: null }) },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { log: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockCalendar = { calculateDeadline: jest.fn() };
const mockTenant = {
  getTaskSla: jest.fn().mockResolvedValue({
    MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  }),
};
const mockAuthority = { canActForCreator: jest.fn(), creatorsCoveredBy: jest.fn(async () => [] as string[]) };

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

describe('TaskService — holds and requests (ACC-173)', () => {
  let service: TaskService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.task.findFirst.mockResolvedValue(task());
    mockPrisma.task.findFirstOrThrow.mockResolvedValue(task());
    mockPrisma.task.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...task(), ...data }),
    );
    mockPrisma.task.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.taskEvidence.create.mockResolvedValue({ id: 'ev-1' });
    mockPrisma.taskRequest.findMany.mockResolvedValue([]);
    mockPrisma.taskRequest.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findMany.mockImplementation(({ where }: { where: { id?: { in: string[] } } }) =>
      Promise.resolve((where.id?.in ?? []).map((id) => ({ id }))),
    );
    mockCalendar.calculateDeadline.mockResolvedValue(DateTime.fromISO('2026-10-08T09:00:00Z'));
    mockAuthority.canActForCreator.mockImplementation(async (createdById: string, viewerId: string) =>
      createdById === viewerId || viewerId === DELEGATE,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        TaskAssignmentService,
        { provide: TaskAuthorityService, useValue: mockAuthority },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAudit },
        DelegationLabelService,
        { provide: ObjectVisibilityService, useValue: { assertCanView: jest.fn(), assertCanViewOrNotFound: jest.fn() } },
        TaskSlaService,
        { provide: WorkingCalendarService, useValue: mockCalendar },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: TenantService, useValue: mockTenant },
      ],
    }).compile();
    service = module.get(TaskService);
  });

  const requestCancellations = () =>
    (mockAudit.log.mock.calls as [Record<string, unknown>][])
      .map(([entry]) => entry)
      .filter((entry) => entry['objectType'] === 'TaskRequest');

  // ── refusals while on hold ──────────────────────────────────────────────
  describe('while a task is on hold', () => {
    beforeEach(() => mockPrisma.task.findFirst.mockResolvedValue(onHold()));

    it.each([
      ['start', () => service.start('task-1', ASSIGNEE, ORG_A)],
      ['complete', () => service.complete('task-1', ASSIGNEE, ORG_A)],
      ['reject', () => service.reject('task-1', { reason: 'Not mine' }, ASSIGNEE, ORG_A)],
      ['release', () => service.release('task-1', { reason: 'Back' }, ASSIGNEE, ORG_A)],
    ])('%s is refused with 409 "Resume the task first"', async (_action, call) => {
      const error = await captureError(call());
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('Resume the task first');
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('a non-assignee still gets the identical 404 first, never the hold', async () => {
      await expect(service.complete('task-1', OTHER, ORG_A)).rejects.toThrow('Task not found');
    });

    it('evidence can still be added', async () => {
      await expect(
        service.addEvidence('task-1', { type: 'LINK', url: 'https://example.org/sample' }, ORG_A, ASSIGNEE),
      ).resolves.toBeDefined();
      expect(mockPrisma.taskEvidence.create).toHaveBeenCalled();
    });
  });

  // ── readable refusals ───────────────────────────────────────────────────
  it.each([
    ['COMPLETED', () => service.start('task-1', ASSIGNEE, ORG_A), 'A completed task cannot be started'],
    ['CANCELLED', () => service.complete('task-1', ASSIGNEE, ORG_A), 'A cancelled task cannot be completed'],
    ['REJECTED', () => service.start('task-1', ASSIGNEE, ORG_A), 'A rejected task cannot be started'],
  ])('a %s task is refused in words, never the raw status', async (status, call, message) => {
    mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
    const error = await captureError(call());
    expect((error as ConflictException).message).toBe(message);
  });

  it('an unassigned task is refused a start, in words', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'UNASSIGNED' }));
    const error = await captureError(service.start('task-1', ASSIGNEE, ORG_A));
    expect((error as ConflictException).message).toBe('An unassigned task cannot be started');
  });

  // ── the request cancel cascade ──────────────────────────────────────────
  describe('pending requests are cancelled', () => {
    beforeEach(() => mockPrisma.taskRequest.findMany.mockResolvedValue([PENDING_REQUEST]));

    it('when the task is completed — audited as request_cancelled', async () => {
      await service.complete('task-1', ASSIGNEE, ORG_A);

      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, taskId: { in: ['task-1'] }, status: 'PENDING' },
        select: { id: true, taskId: true },
      });
      expect(mockPrisma.taskRequest.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['req-1'] }, organizationId: ORG_A },
        data: { status: 'CANCELLED' },
      });
      expect(requestCancellations()).toEqual([
        expect.objectContaining({
          objectId: 'req-1',
          actorId: ASSIGNEE,
          metadata: { event: 'request_cancelled', taskId: 'task-1', cause: 'task_completed' },
        }),
      ]);
    });

    it('when the last assignee rejects the task', async () => {
      await service.reject('task-1', { reason: 'Not mine' }, ASSIGNEE, ORG_A);
      expect(requestCancellations()[0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ cause: 'task_rejected' }) }),
      );
    });

    it("only the rejecter's own request when others stay on the task", async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ assignees: [row(ASSIGNEE), row(OTHER)] }));
      await service.reject('task-1', { reason: 'Not mine' }, ASSIGNEE, ORG_A);
      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ requestedById: ASSIGNEE }) }),
      );
    });

    it('when the task is released back to its pool', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-1', assignees: [row(ASSIGNEE, { pickedAt: new Date() })] }),
      );
      await service.release('task-1', { reason: 'On leave' }, ASSIGNEE, ORG_A);
      expect(requestCancellations()[0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ cause: 'task_released' }) }),
      );
    });

    it('when the stage closes the task (cancelForStage), with the hold ended', async () => {
      mockPrisma.task.findMany.mockResolvedValue([onHold()]);
      await service.cancelForStage('instance-1', 'stage-1', ORG_A, 'actor', 'STAGE_EXIT');

      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['task-1'] }, organizationId: ORG_A },
        data: { status: 'CANCELLED', heldAt: null, onHoldUntil: null, heldFromStatus: null },
      });
      expect(requestCancellations()[0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ cause: 'task_cancelled' }) }),
      );
    });

    it('when the instance is cancelled (cancelForInstance), with the hold ended', async () => {
      mockPrisma.task.findMany.mockResolvedValue([onHold()]);
      await service.cancelForInstance('instance-1', ORG_A, 'admin');
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED', heldAt: null, onHoldUntil: null, heldFromStatus: null } }),
      );
    });
  });

  // ── reassign ────────────────────────────────────────────────────────────
  describe('reassign', () => {
    it('ends a hold and cancels a pending request: the new assignee asked for neither', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(onHold());
      mockPrisma.taskRequest.findMany.mockResolvedValue([PENDING_REQUEST]);

      await service.reassign('task-1', { newAssigneeUserIds: [OTHER], reason: 'Covering' }, ORG_A, CREATOR, []);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING', heldAt: null, onHoldUntil: null, heldFromStatus: null }),
        }),
      );
      expect(requestCancellations()[0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ cause: 'task_reassigned' }) }),
      );
    });

    it("lets whoever covers the creator reassign (canActForCreator)", async () => {
      await expect(
        service.reassign('task-1', { newAssigneeUserIds: [OTHER], reason: 'Covering' }, ORG_A, DELEGATE, []),
      ).resolves.toBeDefined();
      expect(mockAuthority.canActForCreator).toHaveBeenCalledWith(CREATOR, DELEGATE, ORG_A, mockPrisma);
    });

    it('still refuses anyone else with the identical 404', async () => {
      await expect(
        service.reassign('task-1', { newAssigneeUserIds: [OTHER], reason: 'x' }, ORG_A, OTHER, []),
      ).rejects.toThrow('Task not found');
    });
  });

  // ── departure ───────────────────────────────────────────────────────────
  describe('departure (reassignAllForUser)', () => {
    const departing = (t: ReturnType<typeof task>) => [{ id: `ta-${ASSIGNEE}`, task: t }];

    it('a held task going to the acting user keeps its hold; only the leaver\'s request is cancelled', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(departing(onHold()));

      await service.reassignAllForUser(ASSIGNEE, DELEGATE, ORG_A, 'admin');

      expect(mockPrisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ heldAt: null }) }),
      );
      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ requestedById: ASSIGNEE }) }),
      );
    });

    it('a held task left with nobody becomes UNASSIGNED and its hold ends', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(departing(onHold()));

      await service.reassignAllForUser(ASSIGNEE, null, ORG_A, 'admin');

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'UNASSIGNED', heldAt: null, onHoldUntil: null, heldFromStatus: null },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ event: 'departure_reassignment', holdEnded: true }) }),
      );
    });

    it('a held pool task returns to its pool with the hold ended and every pending request cancelled', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(
        departing(onHold({ assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-1' })),
      );
      mockPrisma.taskRequest.findMany.mockResolvedValue([PENDING_REQUEST]);
      mockPrisma.task.findFirst.mockResolvedValue(null); // the pool notice finds nothing to say

      await service.reassignAllForUser(ASSIGNEE, null, ORG_A, 'admin');

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'PENDING', heldAt: null, onHoldUntil: null, heldFromStatus: null }),
      });
      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.not.objectContaining({ requestedById: expect.anything() }) }),
      );
      expect(requestCancellations()[0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ cause: 'departure' }) }),
      );
    });
  });
});
