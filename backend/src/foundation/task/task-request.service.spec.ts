import { Test } from '@nestjs/testing';
import { TaskSlaService } from './task-sla.service';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskRequestService } from './task-request.service';
import { TaskAuthorityService } from './task-authority.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-173 — extension and on-hold requests, and the hold.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ASSIGNEE = 'assignee';
const CREATOR = 'creator';
const OUTSIDER = 'outsider';
const ADMIN = 'admin';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY);

// Fixed instants, so two fixtures built a moment apart still compare equal.
const START = inDays(-1);
const DUE = inDays(2);

const row = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id: `ta-${userId}`,
  taskId: 'task-1',
  userId,
  removedAt: null,
  pickedAt: null,
  ...overrides,
});

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organizationId: ORG_A,
  title: 'Collect the audit sample',
  createdById: CREATOR,
  status: 'PENDING',
  priority: 'MEDIUM',
  createdAt: START,
  dueAt: DUE,
  // ACC-174 — the SLA window: started yesterday, limit at the due date.
  slaStartAt: START,
  slaLimitAt: DUE,
  slaExtendedTo: null,
  slaBreachedAt: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  heldAt: null,
  onHoldUntil: null,
  heldFromStatus: null,
  assignees: [row(ASSIGNEE)],
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 'req-1',
  organizationId: ORG_A,
  taskId: 'task-1',
  type: 'EXTENSION',
  requestedById: ASSIGNEE,
  reason: 'Waiting on the lab',
  requestedDueAt: inDays(5),
  holdUntil: null,
  status: 'PENDING',
  ...overrides,
});

const mockPrisma = {
  organization: { findFirst: jest.fn() },
  task: { findFirst: jest.fn(), update: jest.fn() },
  taskRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
  user: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { log: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockCalendar = {
  workingHoursBetween: jest.fn(),
  calculateDeadline: jest.fn(),
  getEffectiveTimeZone: jest.fn(async () => 'Asia/Riyadh'),
};
const mockAuthority = {
  canActForCreator: jest.fn(),
  decisionRecipients: jest.fn(),
  creatorsCoveredBy: jest.fn(),
};

const assignee = { id: ASSIGNEE, permissions: [] as string[] };
const creator = { id: CREATOR, permissions: [] as string[] };
const outsider = { id: OUTSIDER, permissions: [] as string[] };
const admin = { id: ADMIN, permissions: ['tasks:reassign'] };

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

describe('TaskRequestService (ACC-173)', () => {
  let service: TaskRequestService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.task.findFirst.mockResolvedValue(task());
    mockPrisma.task.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...task(), ...data }),
    );
    mockPrisma.taskRequest.findFirst.mockResolvedValue(null);
    mockPrisma.taskRequest.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'req-1', status: 'PENDING', ...data }),
    );
    mockPrisma.taskRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...request(), ...data }),
    );
    mockPrisma.user.findFirst.mockResolvedValue({ name: 'Sara' });
    // The creator decides; nobody else covers anybody.
    mockAuthority.canActForCreator.mockImplementation(async (createdBy: string, viewer: string) => createdBy === viewer);
    mockAuthority.decisionRecipients.mockResolvedValue([CREATOR]);
    mockAuthority.creatorsCoveredBy.mockResolvedValue([]);
    // ACC-174 — a predictable calendar: N working hours is N clock hours. The
    // real arithmetic is WorkingCalendarService's own spec's business.
    mockCalendar.calculateDeadline.mockImplementation(async (start: DateTime, hours: number) =>
      start.plus({ hours }),
    );
    mockCalendar.workingHoursBetween.mockResolvedValue(0);

    const module = await Test.createTestingModule({
      providers: [
        TaskRequestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: NotificationService, useValue: mockNotifications },
        TaskSlaService,
        { provide: WorkingCalendarService, useValue: mockCalendar },
        { provide: TaskAuthorityService, useValue: mockAuthority },
      ],
    }).compile();
    service = module.get(TaskRequestService);
  });

  // ── ask ─────────────────────────────────────────────────────────────────
  describe('create', () => {
    const extension = (overrides: Record<string, unknown> = {}) => ({
      type: 'EXTENSION' as const,
      requestedDueAt: inDays(5).toISOString(),
      reason: 'Waiting on the lab',
      ...overrides,
    });
    const hold = (overrides: Record<string, unknown> = {}) => ({
      type: 'ON_HOLD' as const,
      holdUntil: inDays(10).toISOString(),
      reason: 'Supplier closed for the holiday',
      ...overrides,
    });

    it('records a request for more time, under the row lock, and tells the deciders in both languages', async () => {
      await service.create('task-1', extension(), ASSIGNEE, ORG_A);

      const [fragments, ...values] = mockPrisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(fragments.join('?')).toMatch(/FOR UPDATE/);
      expect(values).toEqual(['task-1', ORG_A]);
      expect(mockPrisma.taskRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          taskId: 'task-1',
          type: 'EXTENSION',
          requestedById: ASSIGNEE,
          requestedDueAt: expect.any(Date),
          holdUntil: null,
        }),
      });
      expect(mockAuthority.decisionRecipients).toHaveBeenCalledWith(CREATOR, ASSIGNEE, ORG_A);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        {
          userId: CREATOR,
          titleEn: 'More time requested',
          titleAr: 'طلب وقت إضافي',
          bodyEn: 'Sara asks for more time on "Collect the audit sample". Reason: Waiting on the lab',
          bodyAr: 'يطلب Sara وقتًا إضافيًا للمهمة "Collect the audit sample". السبب: Waiting on the lab',
          objectType: 'Task',
          objectId: 'task-1',
        },
        ORG_A,
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ objectType: 'TaskRequest', metadata: expect.objectContaining({ event: 'request_made' }) }),
      );
    });

    it('records a hold request', async () => {
      await service.create('task-1', hold(), ASSIGNEE, ORG_A);
      expect(mockPrisma.taskRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'ON_HOLD', holdUntil: expect.any(Date), requestedDueAt: null }),
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: 'Hold requested', titleAr: 'طلب إيقاف مؤقت' }),
        ORG_A,
      );
    });

    it("refuses the other type's date before reading anything (400)", async () => {
      await expect(service.create('task-1', extension({ holdUntil: inDays(3).toISOString() }), ASSIGNEE, ORG_A)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create('task-1', hold({ requestedDueAt: inDays(3).toISOString() }), ASSIGNEE, ORG_A)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('gives anyone who is not an active assignee the identical 404 — before any 409', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.create('task-1', extension(), OUTSIDER, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(task({ status: 'COMPLETED' }));
      const closed = await captureError(service.create('task-1', extension(), OUTSIDER, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(task({ assignees: [row(ASSIGNEE, { removedAt: new Date() })] }));
      const removed = await captureError(service.create('task-1', extension(), ASSIGNEE, ORG_A));

      for (const error of [missing, closed, removed]) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
          message: 'Task not found',
          error: 'Not Found',
          statusCode: 404,
        });
      }
    });

    it.each([
      ['ON_HOLD', 'This task is already on hold'],
      ['COMPLETED', 'A completed task cannot take a request'],
      ['CANCELLED', 'A cancelled task cannot take a request'],
      ['REJECTED', 'A rejected task cannot take a request'],
      ['UNASSIGNED', 'An unassigned task cannot take a request'],
    ])('refuses a %s task (409), in words', async (status, message) => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
      const error = await captureError(service.create('task-1', extension(), ASSIGNEE, ORG_A));
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(message);
    });

    it('accepts an In-progress task and a legacy OVERDUE (Assigned) one', async () => {
      for (const status of ['IN_PROGRESS', 'OVERDUE']) {
        mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
        await expect(service.create('task-1', extension(), ASSIGNEE, ORG_A)).resolves.toBeDefined();
      }
    });

    it('refuses a second open request (409)', async () => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue({ id: 'req-0' });
      const error = await captureError(service.create('task-1', hold(), ASSIGNEE, ORG_A));
      expect((error as ConflictException).message).toBe('This task already has a request waiting for a decision');
      expect(mockPrisma.taskRequest.findFirst).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, taskId: 'task-1', status: 'PENDING' },
        select: { id: true },
      });
    });

    it.each([
      ['in the past', { requestedDueAt: inDays(-1).toISOString() }, 'The new due date must be in the future'],
      ['not after the current one', { requestedDueAt: inDays(1).toISOString() }, 'The new due date must be after the current one'],
    ])('refuses a new due date %s (400)', async (_l, overrides, message) => {
      const error = await captureError(service.create('task-1', extension(overrides), ASSIGNEE, ORG_A));
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(message);
    });

    it('accepts any future date for a task with no due date', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ dueAt: null }));
      await expect(
        service.create('task-1', extension({ requestedDueAt: inDays(1).toISOString() }), ASSIGNEE, ORG_A),
      ).resolves.toBeDefined();
    });

    it.each([
      ['in the past', inDays(-1), 'The hold date must be in the future'],
      ['beyond 90 days', inDays(91), 'A hold can last at most 90 days'],
    ])('refuses a hold date %s (400)', async (_l, holdUntil, message) => {
      const error = await captureError(service.create('task-1', hold({ holdUntil: holdUntil.toISOString() }), ASSIGNEE, ORG_A));
      expect((error as BadRequestException).message).toBe(message);
    });

    it('accepts a hold of 89 days', async () => {
      await expect(
        service.create('task-1', hold({ holdUntil: inDays(89).toISOString() }), ASSIGNEE, ORG_A),
      ).resolves.toBeDefined();
    });

    itEnforcesTenantIsolation('create', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.create('task-1', extension(), ASSIGNEE, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskRequest.create).not.toHaveBeenCalled();
    });
  });

  // ── withdraw ────────────────────────────────────────────────────────────
  describe('withdraw', () => {
    beforeEach(() => mockPrisma.taskRequest.findFirst.mockResolvedValue(request()));

    it('lets the person who asked withdraw a pending request, audited', async () => {
      await service.withdraw('task-1', 'req-1', ASSIGNEE, ORG_A);
      expect(mockPrisma.taskRequest.update).toHaveBeenCalledWith({ where: { id: 'req-1' }, data: { status: 'WITHDRAWN' } });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { event: 'request_withdrawn', taskId: 'task-1' } }),
      );
    });

    it('gives anyone else the identical 404', async () => {
      const notMine = await captureError(service.withdraw('task-1', 'req-1', CREATOR, ORG_A));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(null);
      const missing = await captureError(service.withdraw('task-1', 'req-1', ASSIGNEE, ORG_A));
      expect((notMine as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
    });

    it('refuses a request already decided (409)', async () => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request({ status: 'APPROVED' }));
      const error = await captureError(service.withdraw('task-1', 'req-1', ASSIGNEE, ORG_A));
      expect((error as ConflictException).message).toBe('This request has already been approved');
    });

    itEnforcesTenantIsolation('withdraw', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.withdraw('task-1', 'req-1', ASSIGNEE, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskRequest.update).not.toHaveBeenCalled();
    });
  });

  // ── decide ──────────────────────────────────────────────────────────────
  describe('approve', () => {
    it('approves more time as asked: the new due date, overridden, escalation stamps cleared', async () => {
      const asked = inDays(5);
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ slaBreachedAt: new Date(), managerEscalatedAt: new Date(), headEscalatedAt: new Date() }),
      );
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request({ requestedDueAt: asked }));

      await service.approve('task-1', 'req-1', {}, creator, ORG_A);

      // ACC-174 — the limit rises to the approved date, and the date is kept.
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          dueAt: asked,
          dueDateOverridden: true,
          slaStartAt: task().slaStartAt,
          slaLimitAt: asked,
          slaExtendedTo: asked,
          slaBreachedAt: null,
          managerEscalatedAt: null,
          headEscalatedAt: null,
        },
      });
      expect(mockPrisma.taskRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'APPROVED', decidedById: CREATOR, decidedAt: expect.any(Date), decisionNote: null },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: ASSIGNEE,
          titleEn: 'More time approved',
          titleAr: 'تمت الموافقة على الوقت الإضافي',
        }),
        ORG_A,
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ objectType: 'Task', metadata: expect.objectContaining({ event: 'due_date_extended' }) }),
      );
    });

    it.each([
      ['IN_PROGRESS', 'IN_PROGRESS'],
      ['PENDING', 'PENDING'],
      ['OVERDUE', 'PENDING'],
    ])('approves a hold on an %s task: ON_HOLD, returning to %s', async (status, returnTo) => {
      const until = inDays(10);
      mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
      const asked = request({ type: 'ON_HOLD', requestedDueAt: null, holdUntil: until });
      mockPrisma.taskRequest.findFirst.mockResolvedValue(asked);
      mockPrisma.taskRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...asked, ...data }),
      );

      await service.approve('task-1', 'req-1', { note: 'Fine' }, creator, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'ON_HOLD',
          heldFromStatus: returnTo,
          heldAt: expect.any(Date),
          onHoldUntil: until,
        }),
      });
      expect(mockPrisma.taskRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decisionNote: 'Fine' }) }),
      );
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: ASSIGNEE, titleEn: 'Hold approved' }),
        ORG_A,
      );
    });

    it.each([
      ['EXTENSION', { requestedDueAt: inDays(-1) }, 'The requested due date has passed; decline and ask for a new one'],
      ['ON_HOLD', { type: 'ON_HOLD', holdUntil: inDays(-1) }, 'The requested hold date has passed; decline and ask for a new one'],
    ])('refuses to approve a %s whose date has passed (409)', async (_t, overrides, message) => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request(overrides));
      const error = await captureError(service.approve('task-1', 'req-1', {}, creator, ORG_A));
      expect((error as ConflictException).message).toBe(message);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    // ── ACC-174 — the SLA limit and the hold ──────────────────────────────
    it('never lowers the limit: an approved date inside it leaves the limit where it was (C3)', async () => {
      const limit = inDays(8);
      const asked = inDays(5);
      mockPrisma.task.findFirst.mockResolvedValue(task({ dueAt: inDays(2), slaLimitAt: limit }));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request({ requestedDueAt: asked }));

      await service.approve('task-1', 'req-1', {}, creator, ORG_A);

      const { data } = mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data['dueAt']).toEqual(asked);
      expect(data['slaLimitAt']).toEqual(limit);
      // Kept anyway, as the floor a later priority change cannot drop below.
      expect(data['slaExtendedTo']).toEqual(asked);
    });

    it('refuses an extension that is no longer after the current due date (C5, 409)', async () => {
      // The creator moved the due date past the asked-for one after it was asked.
      mockPrisma.task.findFirst.mockResolvedValue(task({ dueAt: inDays(6), slaLimitAt: inDays(6) }));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request({ requestedDueAt: inDays(5) }));

      const error = await captureError(service.approve('task-1', 'req-1', {}, creator, ORG_A));
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'The requested due date is no longer after the current one; decline and ask again',
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('moves due date, SLA start, limit and extension forward by the working hours to the hold date', async () => {
      const due = inDays(2);
      const start = inDays(-1);
      const limit = inDays(3);
      const extended = inDays(3);
      const until = inDays(10);
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ dueAt: due, slaStartAt: start, slaLimitAt: limit, slaExtendedTo: extended }),
      );
      const asked = request({ type: 'ON_HOLD', requestedDueAt: null, holdUntil: until });
      mockPrisma.taskRequest.findFirst.mockResolvedValue(asked);
      mockPrisma.taskRequest.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...asked, ...data }),
      );
      mockCalendar.workingHoursBetween.mockResolvedValue(48);

      await service.approve('task-1', 'req-1', {}, creator, ORG_A);

      // From approval to the hold date — never from heldAt at resume.
      expect(mockCalendar.workingHoursBetween).toHaveBeenCalledWith(
        expect.any(DateTime),
        DateTime.fromJSDate(until),
        ORG_A,
      );
      const plus48 = (d: Date) => new Date(d.getTime() + 48 * 60 * 60 * 1000);
      const { data } = mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).toEqual(
        expect.objectContaining({
          dueAt: plus48(due),
          slaStartAt: plus48(start),
          slaLimitAt: plus48(limit),
          slaExtendedTo: plus48(extended),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ event: 'hold_started', heldWorkingHours: 48, dueAtBefore: due }),
        }),
      );
    });

    it('moves nothing when no working hour lies before the hold date (a zero shift would normalise)', async () => {
      const due = inDays(2);
      mockPrisma.task.findFirst.mockResolvedValue(task({ dueAt: due }));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(
        request({ type: 'ON_HOLD', requestedDueAt: null, holdUntil: inDays(0.5) }),
      );
      mockCalendar.workingHoursBetween.mockResolvedValue(0);

      await service.approve('task-1', 'req-1', {}, creator, ORG_A);

      expect(mockCalendar.calculateDeadline).not.toHaveBeenCalled();
      const { data } = mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data['dueAt']).toEqual(due);
    });

    it('lets a tasks:reassign holder decide, though they do not cover the creator', async () => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request());
      await expect(service.approve('task-1', 'req-1', {}, admin, ORG_A)).resolves.toBeDefined();
    });

    it("lets whoever covers the creator decide", async () => {
      mockAuthority.canActForCreator.mockResolvedValue(true);
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request());
      await expect(service.approve('task-1', 'req-1', {}, outsider, ORG_A)).resolves.toBeDefined();
      expect(mockAuthority.canActForCreator).toHaveBeenCalledWith(CREATOR, OUTSIDER, ORG_A, mockPrisma);
    });

    it('gives anyone else the identical 404 — for a real request, a missing one and a missing task', async () => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request());
      const notEntitled = await captureError(service.approve('task-1', 'req-1', {}, outsider, ORG_A));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(null);
      const noRequest = await captureError(service.approve('task-1', 'req-1', {}, creator, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValue(null);
      const noTask = await captureError(service.approve('task-1', 'req-1', {}, creator, ORG_A));

      for (const error of [notEntitled, noRequest, noTask]) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual((noTask as NotFoundException).getResponse());
      }
    });

    it('refuses the person who asked — nobody decides their own request (403)', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ createdById: ASSIGNEE }));
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request());
      const error = await captureError(service.approve('task-1', 'req-1', {}, assignee, ORG_A));
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).message).toBe('You cannot decide your own request');
    });

    it('refuses a request no longer pending (409)', async () => {
      mockPrisma.taskRequest.findFirst.mockResolvedValue(request({ status: 'WITHDRAWN' }));
      const error = await captureError(service.approve('task-1', 'req-1', {}, creator, ORG_A));
      expect((error as ConflictException).message).toBe('This request has already been withdrawn');
    });

    itEnforcesTenantIsolation('approve', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.approve('task-1', 'req-1', {}, creator, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    beforeEach(() => mockPrisma.taskRequest.findFirst.mockResolvedValue(request()));

    it('declines with the note, changes nothing on the task, and tells the person who asked', async () => {
      await service.decline('task-1', 'req-1', { note: 'The audit date cannot move' }, creator, ORG_A);

      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockPrisma.taskRequest.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { status: 'DECLINED', decidedById: CREATOR, decidedAt: expect.any(Date), decisionNote: 'The audit date cannot move' },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        {
          userId: ASSIGNEE,
          titleEn: 'Request declined',
          titleAr: 'تم رفض طلبك',
          bodyEn: 'Your request on "Collect the audit sample" was declined: The audit date cannot move',
          bodyAr: 'تم رفض طلبك بشأن المهمة "Collect the audit sample": The audit date cannot move',
          objectType: 'Task',
          objectId: 'task-1',
        },
        ORG_A,
      );
    });

    it('gives a non-decider the identical 404', async () => {
      await expect(service.decline('task-1', 'req-1', { note: 'x' }, outsider, ORG_A)).rejects.toThrow('Task not found');
    });

    itEnforcesTenantIsolation('decline', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.decline('task-1', 'req-1', { note: 'x' }, creator, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskRequest.update).not.toHaveBeenCalled();
    });
  });

  // ── resume ──────────────────────────────────────────────────────────────
  describe('resume', () => {
    const heldAt = inDays(-3);
    const dueAt = inDays(1);
    const onHold = (overrides: Record<string, unknown> = {}) =>
      task({ status: 'ON_HOLD', heldFromStatus: 'IN_PROGRESS', heldAt, onHoldUntil: inDays(5), dueAt, ...overrides });

    beforeEach(() => {
      mockPrisma.task.findFirst.mockResolvedValue(onHold());
    });

    // ACC-174 — the window moved when the hold was approved; resume only ends it.
    it('shifts nothing: it returns to the held-from status and clears the hold, and that is all', async () => {
      await service.resume('task-1', assignee, ORG_A);

      expect(mockCalendar.workingHoursBetween).not.toHaveBeenCalled();
      expect(mockCalendar.calculateDeadline).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS', heldAt: null, onHoldUntil: null, heldFromStatus: null },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: ASSIGNEE,
          metadata: { event: 'resumed', automatic: false, early: true },
        }),
      );
    });

    it('resuming early keeps the dates set at approval', async () => {
      await service.resume('task-1', assignee, ORG_A);
      const { data } = mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> };
      for (const field of ['dueAt', 'slaStartAt', 'slaLimitAt', 'slaExtendedTo', 'slaBreachedAt']) {
        expect(data).not.toHaveProperty(field);
      }
    });

    it('tells the assignee and the creator — never the person who resumed it', async () => {
      await service.resume('task-1', assignee, ORG_A);
      const told = (mockNotifications.create.mock.calls as [{ userId: string; titleEn: string; titleAr: string }][]).map(
        ([n]) => n,
      );
      expect(told.map((n) => n.userId)).toEqual([CREATOR]);
      expect(told[0]).toEqual(expect.objectContaining({ titleEn: 'Task resumed', titleAr: 'استُؤنفت المهمة' }));
    });

    it('lets a decider resume early: the creator, their cover, or a tasks:reassign holder', async () => {
      await expect(service.resume('task-1', creator, ORG_A)).resolves.toBeDefined();
      await expect(service.resume('task-1', admin, ORG_A)).resolves.toBeDefined();
    });

    it('gives anyone else the identical 404', async () => {
      const notEntitled = await captureError(service.resume('task-1', outsider, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValue(null);
      const missing = await captureError(service.resume('task-1', creator, ORG_A));
      expect((notEntitled as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
    });

    it('refuses a task that is not on hold (409)', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'IN_PROGRESS' }));
      const error = await captureError(service.resume('task-1', assignee, ORG_A));
      expect((error as ConflictException).message).toBe('This task is not on hold');
    });

    itEnforcesTenantIsolation('resume', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.resume('task-1', assignee, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  describe('resumeDueHold — the sweep', () => {
    it('resumes a hold whose date has come, with no actor, audited as automatic — and shifts nothing', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ status: 'ON_HOLD', heldFromStatus: 'PENDING', heldAt: inDays(-5), onHoldUntil: inDays(-0.01) }),
      );

      await expect(service.resumeDueHold('task-1', ORG_A)).resolves.toBe(true);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'PENDING', heldAt: null, onHoldUntil: null, heldFromStatus: null },
      });
      expect(mockCalendar.workingHoursBetween).not.toHaveBeenCalled();
      const audit = mockAudit.log.mock.calls[0][0] as Record<string, unknown>;
      expect(audit).not.toHaveProperty('actorId');
      expect(audit['metadata']).toEqual(expect.objectContaining({ event: 'resumed', automatic: true }));
      // Both the assignee and the creator are told.
      expect((mockNotifications.create.mock.calls as [{ userId: string }][]).map(([n]) => n.userId).sort()).toEqual([
        ASSIGNEE,
        CREATOR,
      ]);
    });

    it('does nothing to a hold not yet due', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'ON_HOLD', heldAt: inDays(-1), onHoldUntil: inDays(2) }));
      await expect(service.resumeDueHold('task-1', ORG_A)).resolves.toBe(false);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    // Resumed by hand between the sweep's read and this lock: it runs once.
    it('does nothing to a task no longer on hold', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'IN_PROGRESS', onHoldUntil: null }));
      await expect(service.resumeDueHold('task-1', ORG_A)).resolves.toBe(false);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    // The sweep passes each due hold's own organizationId; the lock and the
    // re-read are scoped by it, so a task of another tenant is never resumed.
    itEnforcesTenantIsolation('resumeDueHold', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.resumeDueHold('task-1', ORG_B)).resolves.toBe(false);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockCalendar.workingHoursBetween).not.toHaveBeenCalled();
    });
  });

  // ── the decider inbox ───────────────────────────────────────────────────
  describe('awaitingDecision', () => {
    const inboxRow = {
      ...request(),
      createdAt: new Date(),
      requestedBy: { name: 'Sara' },
      task: { id: 'task-1', title: 'Collect the audit sample', sourceType: 'COMMITTEE', sourceId: 'c1', status: 'PENDING', priority: 'MEDIUM', dueAt: null },
    };

    it("lists pending requests on the viewer's tasks and on those of whoever they cover — never their own", async () => {
      mockAuthority.creatorsCoveredBy.mockResolvedValue(['away-1']);
      mockPrisma.taskRequest.findMany.mockResolvedValue([inboxRow]);

      const rows = await service.awaitingDecision(creator, ORG_A);

      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A,
            status: 'PENDING',
            requestedById: { not: CREATOR },
            OR: [{ task: { createdById: { in: [CREATOR, 'away-1'] } } }],
          },
        }),
      );
      expect(rows).toEqual([
        expect.objectContaining({ id: 'req-1', requestedByName: 'Sara', task: expect.objectContaining({ id: 'task-1' }) }),
      ]);
      expect(rows[0]).not.toHaveProperty('requestedBy');
    });

    it('adds tasks whose creator is no longer ACTIVE for a tasks:reassign holder', async () => {
      mockPrisma.taskRequest.findMany.mockResolvedValue([]);
      await service.awaitingDecision(admin, ORG_A);
      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { task: { createdById: { in: [ADMIN] } } },
              { task: { createdBy: { status: { not: 'ACTIVE' } } } },
            ],
          }),
        }),
      );
    });

    itEnforcesTenantIsolation('awaitingDecision', async () => {
      mockPrisma.taskRequest.findMany.mockResolvedValue([]);
      await service.awaitingDecision(creator, ORG_B);
      expect(mockPrisma.taskRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
      expect(mockAuthority.creatorsCoveredBy).toHaveBeenCalledWith(CREATOR, ORG_B);
    });
  });
});
