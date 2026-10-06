import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskService } from './task.service';
import { TaskSlaService } from './task-sla.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskAuthorityService } from './task-authority.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-174 — a task's creator edits, cancels and reopens it, within the SLA
// limit. The calendar is mocked as "N working hours is N clock hours", and the
// tenant has the default SLA (MEDIUM 40, HIGH 16, CRITICAL 4, LOW 80).

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CREATOR = 'creator';
const DELEGATE = 'delegate';
const ADMIN = 'admin';
const OUTSIDER = 'outsider';
const ASSIGNEE = 'assignee';
const OTHER = 'other';

const HOUR = 60 * 60 * 1000;
const hoursFromNow = (h: number) => new Date(Date.now() + h * HOUR);
const plusHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);

const creator = { id: CREATOR, permissions: [] as string[] };
const delegate = { id: DELEGATE, permissions: [] as string[] };
const outsider = { id: OUTSIDER, permissions: [] as string[] };
const admin = { id: ADMIN, permissions: ['tasks:reassign'] };

const row = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id: `ta-${userId}`,
  taskId: 'task-1',
  userId,
  removedAt: null as Date | null,
  pickedAt: null,
  delegationReason: null,
  delegationContextId: null,
  ...overrides,
});

// Fixed instants: a task created 10 hours ago, MEDIUM, due and limited at the
// end of its 40-hour SLA.
const START = hoursFromNow(-10);
const LIMIT = plusHours(START, 40);

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organizationId: ORG_A,
  title: 'Collect the audit sample',
  description: null,
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
  sourceStageId: null,
  workflowInstanceId: null,
  createdById: CREATOR,
  createdBy: { status: 'ACTIVE' },
  status: 'PENDING',
  priority: 'MEDIUM',
  requiresEvidence: false,
  createdAt: START,
  dueAt: LIMIT,
  dueDateOverridden: false,
  slaStartAt: START,
  slaLimitAt: LIMIT,
  slaExtendedTo: null,
  slaBreachedAt: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  completedAt: null,
  completedById: null,
  assignedOrgUnitId: null,
  assignedPositionId: null,
  assignedCommitteeId: null,
  assignedCommitteeRoleValueId: null,
  pooledAt: null,
  poolEscalateAt: null,
  poolEscalatedAt: null,
  heldAt: null,
  onHoldUntil: null,
  heldFromStatus: null,
  assignees: [row(ASSIGNEE)],
  ...overrides,
});

const mockPrisma = {
  organization: { findFirst: jest.fn() },
  task: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  taskAssignee: { updateMany: jest.fn() },
  taskRequest: { findMany: jest.fn(), updateMany: jest.fn() },
  workflowInstance: { findFirst: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  committeeMember: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
};
const mockAudit = { log: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockCalendar = {
  calculateDeadline: jest.fn(async (start: DateTime, hours: number) => start.plus({ hours })),
  getEffectiveTimeZone: jest.fn(async () => 'Asia/Riyadh'),
};
const mockTenant = {
  getTaskSla: jest.fn().mockResolvedValue({
    CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
    HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
    MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
    LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  }),
};
// The creator, and DELEGATE acting for them; nobody else.
const mockAuthority = {
  canActForCreator: jest.fn(async (createdById: string, viewerId: string) => createdById === viewerId || viewerId === DELEGATE),
  creatorsCoveredBy: jest.fn(async (viewerId: string) => (viewerId === DELEGATE ? [CREATOR] : [])),
};

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

const updateData = () => (mockPrisma.task.update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
const told = () =>
  (mockNotifications.create.mock.calls as [{ userId: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }][]).map(
    ([n]) => n,
  );

describe('TaskService — edit, cancel and reopen within the SLA limit (ACC-174)', () => {
  let service: TaskService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(mockPrisma));
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.organization.findFirst.mockResolvedValue({ settings: {} });
    mockPrisma.task.findFirst.mockResolvedValue(task());
    mockPrisma.task.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      const { createdBy: _c, assignees: _a, ...base } = task();
      return Promise.resolve({ ...base, ...data });
    });
    mockPrisma.task.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'task-new', ...data, assignees: [] }),
    );
    mockPrisma.taskAssignee.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.taskRequest.findMany.mockResolvedValue([]);
    mockPrisma.taskRequest.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findMany.mockImplementation(({ where }: { where: { id?: { in: string[] } } }) =>
      Promise.resolve((where.id?.in ?? []).map((id) => ({ id }))),
    );
    mockPrisma.user.findFirst.mockResolvedValue({ name: 'Yasser', status: 'ACTIVE' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        TaskSlaService,
        TaskAssignmentService,
        { provide: TaskAuthorityService, useValue: mockAuthority },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAudit },
        { provide: DelegationLabelService, useValue: { resolveMany: jest.fn(async () => new Map()), lookup: () => null } },
        { provide: ObjectVisibilityService, useValue: { assertCanView: jest.fn(), assertCanViewOrNotFound: jest.fn() } },
        { provide: WorkingCalendarService, useValue: mockCalendar },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: TenantService, useValue: mockTenant },
      ],
    }).compile();
    service = module.get(TaskService);
  });

  // ── the cap on New task ──────────────────────────────────────────────────
  describe('create — the SLA cap', () => {
    const dto = (overrides: Record<string, unknown> = {}) => ({
      title: 'Chase the lab',
      sourceType: 'COMMITTEE' as const,
      sourceId: 'committee-1',
      assigneeUserIds: [ASSIGNEE],
      priority: 'HIGH' as const,
      ...overrides,
    });

    it('records the SLA start and the limit; with no date, the due date IS the limit', async () => {
      await service.create(dto(), ORG_A, CREATOR);
      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, Date> };
      expect(data['slaLimitAt']).toEqual(plusHours(data['slaStartAt']!, 16));
      expect(data['dueAt']).toEqual(data['slaLimitAt']);
      expect(data['slaExtendedTo']).toBeNull();
    });

    it("accepts a person's date at or before the limit", async () => {
      await service.create(dto({ dueDate: hoursFromNow(15).toISOString() }), ORG_A, CREATOR);
      expect(mockPrisma.task.create).toHaveBeenCalled();
    });

    it("refuses a person's date past the limit (400), before anything is written", async () => {
      const error = await captureError(service.create(dto({ dueDate: hoursFromNow(17).toISOString() }), ORG_A, CREATOR));
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toMatch(
        /^The due date can't be later than .+, the SLA limit for High priority$/,
      );
      expect(mockPrisma.task.create).not.toHaveBeenCalled();
    });

    it("refuses a person's date in the past (400)", async () => {
      const error = await captureError(service.create(dto({ dueDate: hoursFromNow(-1).toISOString() }), ORG_A, CREATOR));
      expect((error as BadRequestException).message).toBe('The due date must be in the future');
    });

    it("raises the limit to the engine's stage date instead of refusing it (C1), recorded in slaExtendedTo", async () => {
      const stageDate = hoursFromNow(240);
      await service.create(
        dto({ priority: 'MEDIUM', dueDate: stageDate.toISOString(), sourceStageId: 's1', workflowInstanceId: 'i1' }),
        ORG_A,
        CREATOR,
        undefined,
        'engine',
      );
      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, Date> };
      expect(data['dueAt']).toEqual(stageDate);
      expect(data['slaLimitAt']).toEqual(stageDate);
      expect(data['slaExtendedTo']).toEqual(stageDate);
    });

    it("leaves the limit alone when the engine's stage date is inside it", async () => {
      await service.create(dto({ dueDate: hoursFromNow(5).toISOString() }), ORG_A, CREATOR, undefined, 'engine');
      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, Date | null> };
      expect(data['slaExtendedTo']).toBeNull();
      expect(data['slaLimitAt']).toEqual(plusHours(data['slaStartAt']!, 16));
    });
  });

  // ── who may ──────────────────────────────────────────────────────────────
  describe('who manages a task', () => {
    const actions = (viewer: { id: string; permissions: string[] }, org = ORG_A) => [
      () => service.update('task-1', { title: 'Renamed' }, viewer, org),
      () => service.cancel('task-1', { reason: 'Not needed' }, viewer, org),
      () => service.reopen('task-1', { reason: 'Evidence is wrong' }, viewer, org),
      () => service.slaPreviewForTask('task-1', viewer, org),
    ];

    it('gives anyone else the identical 404 — the same as a missing task, and before any 409', async () => {
      // A COMPLETED task: the creator would get a 409 on edit; an outsider must not learn that.
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'COMPLETED' }));
      for (const call of actions(outsider)) {
        const refused = await captureError(call());
        expect(refused).toBeInstanceOf(NotFoundException);
        expect((refused as NotFoundException).getResponse()).toEqual(new NotFoundException('Task not found').getResponse());
      }
      mockPrisma.task.findFirst.mockResolvedValue(null);
      for (const call of actions(creator)) {
        const missing = await captureError(call());
        expect((missing as NotFoundException).getResponse()).toEqual(new NotFoundException('Task not found').getResponse());
      }
    });

    it("lets whoever acts for the creator manage it — TaskAuthorityService's rule, not a copy", async () => {
      await expect(service.update('task-1', { title: 'Renamed' }, delegate, ORG_A)).resolves.toBeDefined();
      expect(mockAuthority.canActForCreator).toHaveBeenCalledWith(CREATOR, DELEGATE, ORG_A, mockPrisma);
    });

    it('lets a tasks:reassign holder manage it only while the creator is no longer ACTIVE', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ name: 'Yasser', status: 'ACTIVE' });
      expect(await captureError(service.update('task-1', { title: 'x' }, admin, ORG_A))).toBeInstanceOf(NotFoundException);

      mockPrisma.task.findFirst.mockResolvedValue(task({ createdBy: { status: 'INACTIVE' } }));
      await expect(service.update('task-1', { title: 'x' }, admin, ORG_A)).resolves.toBeDefined();
    });
  });

  // ── edit ─────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('refuses an empty edit (400) before reading anything', async () => {
      const error = await captureError(service.update('task-1', {}, creator, ORG_A));
      expect((error as BadRequestException).message).toBe('Change at least one field');
      expect(mockPrisma.task.findFirst).not.toHaveBeenCalled();
    });

    it.each([['COMPLETED', 'A completed task cannot be edited'], ['CANCELLED', 'A cancelled task cannot be edited']])(
      'refuses a %s task (409)',
      async (status, message) => {
        mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
        const error = await captureError(service.update('task-1', { title: 'x' }, creator, ORG_A));
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).message).toBe(message);
      },
    );

    it('edits a REJECTED task', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'REJECTED' }));
      await expect(service.update('task-1', { title: 'Clearer' }, creator, ORG_A)).resolves.toBeDefined();
    });

    it('lets an ON_HOLD task be renamed, but refuses its due date and priority (409 "Resume the task first")', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'ON_HOLD' }));
      await expect(service.update('task-1', { title: 'x', description: 'y' }, creator, ORG_A)).resolves.toBeDefined();
      for (const dto of [{ dueDate: hoursFromNow(5).toISOString() }, { priority: 'HIGH' as const }]) {
        const error = await captureError(service.update('task-1', dto, creator, ORG_A));
        expect((error as ConflictException).message).toBe('Resume the task first');
      }
    });

    it('title and description edits are silent, and touch no date', async () => {
      await service.update('task-1', { title: 'Renamed', description: null }, creator, ORG_A);
      expect(updateData()).toEqual({ title: 'Renamed', description: null });
      expect(mockNotifications.create).not.toHaveBeenCalled();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: CREATOR, metadata: { event: 'edited', fields: ['title', 'description'] } }),
      );
    });

    it('a due date within the limit: overridden, escalation re-armed, the assignees told in both languages', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ slaBreachedAt: new Date(), managerEscalatedAt: new Date(), headEscalatedAt: new Date() }),
      );
      const asked = plusHours(START, 30);
      await service.update('task-1', { dueDate: asked.toISOString() }, creator, ORG_A);

      expect(updateData()).toEqual({
        dueAt: asked,
        dueDateOverridden: true,
        slaStartAt: START,
        slaLimitAt: LIMIT,
        slaBreachedAt: null,
        managerEscalatedAt: null,
        headEscalatedAt: null,
      });
      expect(told()).toEqual([
        expect.objectContaining({
          userId: ASSIGNEE,
          titleEn: 'Task updated',
          titleAr: 'تم تحديث مهمة',
          bodyEn: expect.stringMatching(/^"Collect the audit sample" was updated: it is now due .+\.$/),
          bodyAr: expect.stringContaining('أصبح موعد استحقاقها'),
        }),
      ]);
    });

    it('refuses a due date past the limit (400), and one in the past (400)', async () => {
      const late = await captureError(
        service.update('task-1', { dueDate: plusHours(LIMIT, 1).toISOString() }, creator, ORG_A),
      );
      expect((late as BadRequestException).message).toMatch(/the SLA limit for Medium priority$/);
      const past = await captureError(service.update('task-1', { dueDate: hoursFromNow(-1).toISOString() }, creator, ORG_A));
      expect((past as BadRequestException).message).toBe('The due date must be in the future');
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('a priority change recomputes due date and limit from the SLA start under the new priority', async () => {
      await service.update('task-1', { priority: 'LOW' }, creator, ORG_A);
      const data = updateData();
      expect(data['priority']).toBe('LOW');
      expect(data['dueAt']).toEqual(plusHours(START, 80));
      expect(data['slaLimitAt']).toEqual(plusHours(START, 80));
      expect(data['dueDateOverridden']).toBe(false);
      expect(told()[0]!.bodyEn).toMatch(
        /^"Collect the audit sample" was updated: it is now due .+, and its priority is now Low\.$/,
      );
      expect(told()[0]!.bodyAr).toContain('أصبحت أولويتها منخفضة');
    });

    it('a priority change never drops the limit below an approved extension', async () => {
      const extended = plusHours(START, 70);
      mockPrisma.task.findFirst.mockResolvedValue(task({ slaExtendedTo: extended, slaLimitAt: extended, dueAt: extended }));
      await service.update('task-1', { priority: 'CRITICAL' }, creator, ORG_A);
      expect(updateData()['dueAt']).toEqual(plusHours(START, 4));
      expect(updateData()['slaLimitAt']).toEqual(extended);
    });

    it('the same edit may send a due date within the NEW limit', async () => {
      const asked = plusHours(START, 60);
      await service.update('task-1', { priority: 'LOW', dueDate: asked.toISOString() }, creator, ORG_A);
      expect(updateData()['dueAt']).toEqual(asked);
      expect(updateData()['slaLimitAt']).toEqual(plusHours(START, 80));
      expect(updateData()['dueDateOverridden']).toBe(true);
    });

    it('a recomputed due date may be in the past, and keeps its escalation stamps (C4)', async () => {
      const longAgo = hoursFromNow(-100);
      const stamped = new Date();
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ slaStartAt: longAgo, createdAt: longAgo, managerEscalatedAt: stamped, slaBreachedAt: stamped }),
      );
      await service.update('task-1', { priority: 'HIGH' }, creator, ORG_A);
      const data = updateData();
      expect(data['dueAt']).toEqual(plusHours(longAgo, 16));
      expect(data).not.toHaveProperty('managerEscalatedAt');
      expect(data).not.toHaveProperty('slaBreachedAt');
    });

    it('leaves an open request for more time alone', async () => {
      await service.update('task-1', { dueDate: plusHours(START, 30).toISOString() }, creator, ORG_A);
      expect(mockPrisma.taskRequest.updateMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('update', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.update('task-1', { title: 'x' }, creator, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  // ── cancel ───────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('cancels with the reason, keeps the assignee rows, clears the pool clock, tells the assignees', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(
        task({ assignees: [row(ASSIGNEE), row(OTHER)], pooledAt: new Date(), poolEscalateAt: new Date() }),
      );
      await service.cancel('task-1', { reason: 'The audit was postponed' }, creator, ORG_A);

      expect(updateData()).toEqual(
        expect.objectContaining({
          status: 'CANCELLED',
          cancelledReason: 'The audit was postponed',
          cancelledAt: expect.any(Date),
          cancelledById: CREATOR,
          pooledAt: null,
          poolEscalateAt: null,
          poolEscalatedAt: null,
        }),
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(told().map((n) => n.userId)).toEqual([ASSIGNEE, OTHER]);
      expect(told()[0]).toEqual(
        expect.objectContaining({
          titleEn: 'Task cancelled',
          titleAr: 'أُلغيت مهمة',
          bodyEn: 'Yasser cancelled "Collect the audit sample". Reason: The audit was postponed',
          bodyAr: 'ألغى Yasser المهمة "Collect the audit sample". السبب: The audit was postponed',
        }),
      );
    });

    it('ends a hold and cancels a pending request, as the creator', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'ON_HOLD', heldAt: new Date(), onHoldUntil: hoursFromNow(48) }));
      mockPrisma.taskRequest.findMany.mockResolvedValue([{ id: 'req-1', taskId: 'task-1' }]);
      await service.cancel('task-1', { reason: 'Not needed' }, creator, ORG_A);

      expect(updateData()).toEqual(expect.objectContaining({ heldAt: null, onHoldUntil: null, heldFromStatus: null }));
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: 'TaskRequest',
          metadata: expect.objectContaining({ event: 'request_cancelled', cause: 'task_cancelled_by_creator' }),
        }),
      );
    });

    it('refuses a workflow stage task (409), after the identical 404 for anyone else', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ sourceStageId: 's1', workflowInstanceId: 'i1' }));
      const error = await captureError(service.cancel('task-1', { reason: 'x' }, creator, ORG_A));
      expect((error as ConflictException).message).toBe('This task belongs to a workflow step');
      expect(await captureError(service.cancel('task-1', { reason: 'x' }, outsider, ORG_A))).toBeInstanceOf(NotFoundException);
    });

    it.each([['COMPLETED', 'A completed task cannot be cancelled'], ['CANCELLED', 'A cancelled task cannot be cancelled']])(
      'refuses a %s task (409)',
      async (status, message) => {
        mockPrisma.task.findFirst.mockResolvedValue(task({ status }));
        const error = await captureError(service.cancel('task-1', { reason: 'x' }, creator, ORG_A));
        expect((error as ConflictException).message).toBe(message);
      },
    );

    it('cancels a REJECTED task', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(task({ status: 'REJECTED', assignees: [] }));
      await expect(service.cancel('task-1', { reason: 'Nobody will take it' }, creator, ORG_A)).resolves.toBeDefined();
    });

    itEnforcesTenantIsolation('cancel', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.cancel('task-1', { reason: 'x' }, creator, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  // ── reopen ───────────────────────────────────────────────────────────────
  describe('reopen', () => {
    const completedAt = hoursFromNow(-2);
    const completed = (overrides: Record<string, unknown> = {}) =>
      task({
        status: 'COMPLETED',
        completedAt,
        completedById: ASSIGNEE,
        slaExtendedTo: hoursFromNow(-5),
        managerEscalatedAt: new Date(),
        assignees: [
          row(ASSIGNEE), // the completer — still active
          row(OTHER, { removedAt: completedAt }), // stamped by complete()
          row('earlier', { removedAt: hoursFromNow(-30) }), // left long before
        ],
        ...overrides,
      });

    beforeEach(() => mockPrisma.task.findFirst.mockResolvedValue(completed()));

    it('returns to Assigned with the people on it at completion; the SLA restarts; the evidence stays', async () => {
      const before = Date.now();
      await service.reopen('task-1', { reason: 'The photo is not the right ward' }, creator, ORG_A);

      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ta-assignee', 'ta-other'] } },
        data: { removedAt: null },
      });
      const data = updateData() as Record<string, unknown> & { slaStartAt: Date };
      expect(data).toEqual(
        expect.objectContaining({
          status: 'PENDING',
          completedAt: null,
          completedById: null,
          dueDateOverridden: false,
          slaExtendedTo: null,
          slaBreachedAt: null,
          managerEscalatedAt: null,
          headEscalatedAt: null,
          reopenedReason: 'The photo is not the right ward',
          reopenedById: CREATOR,
        }),
      );
      expect(data.slaStartAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(data['slaLimitAt']).toEqual(plusHours(data.slaStartAt, 40));
      expect(data['dueAt']).toEqual(data['slaLimitAt']);
      expect(told().map((n) => n.userId)).toEqual([ASSIGNEE, OTHER]);
      expect(told()[0]).toEqual(
        expect.objectContaining({
          titleEn: 'Task reopened',
          titleAr: 'أُعيد فتح مهمة',
          bodyEn: expect.stringMatching(/^Yasser reopened "Collect the audit sample", now due .+\. Reason: The photo is not the right ward$/),
          bodyAr: expect.stringContaining('السبب: The photo is not the right ward'),
        }),
      );
    });

    it('takes an earlier due date in the same call, and refuses one past the restarted limit', async () => {
      const earlier = hoursFromNow(5);
      await service.reopen('task-1', { reason: 'x', dueDate: earlier.toISOString() }, creator, ORG_A);
      expect(updateData()['dueAt']).toEqual(earlier);
      expect(updateData()['dueDateOverridden']).toBe(true);

      mockPrisma.task.update.mockClear();
      const late = await captureError(
        service.reopen('task-1', { reason: 'x', dueDate: hoursFromNow(41).toISOString() }, creator, ORG_A),
      );
      expect(late).toBeInstanceOf(BadRequestException);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('leaves off anyone no longer ACTIVE, and goes to UNASSIGNED when nobody is left (no pool)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      await service.reopen('task-1', { reason: 'x' }, creator, ORG_A);
      // The completer, gone since, is not handed it back.
      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ta-assignee'] } },
        data: { removedAt: expect.any(Date) },
      });
      expect(updateData()['status']).toBe('UNASSIGNED');
    });

    it('returns to its pool, with the pick-up clock, when nobody is left and it has one', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.committeeMember.findMany.mockResolvedValue([]);
      mockPrisma.task.findFirst.mockResolvedValue(completed({ assignedOrgUnitId: 'u1', assignedPositionId: 'p1' }));
      await service.reopen('task-1', { reason: 'x' }, creator, ORG_A);
      expect(updateData()).toEqual(
        expect.objectContaining({ status: 'PENDING', pooledAt: expect.any(Date), poolEscalateAt: expect.any(Date) }),
      );
    });

    it.each([
      ['CANCELLED', 'A cancelled task cannot be reopened'],
      ['PENDING', 'Only a completed task can be reopened'],
      ['REJECTED', 'Only a completed task can be reopened'],
    ])('refuses a %s task (409)', async (status, message) => {
      mockPrisma.task.findFirst.mockResolvedValue(completed({ status }));
      const error = await captureError(service.reopen('task-1', { reason: 'x' }, creator, ORG_A));
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(message);
    });

    it('reopens a stage task while its record is still in that step and the workflow runs', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(completed({ sourceStageId: 's1', workflowInstanceId: 'i1' }));
      mockPrisma.workflowInstance.findFirst.mockResolvedValue({ status: 'IN_PROGRESS', currentStageId: 's1' });
      await expect(service.reopen('task-1', { reason: 'x' }, creator, ORG_A)).resolves.toBeDefined();
      expect(mockPrisma.workflowInstance.findFirst).toHaveBeenCalledWith({
        where: { id: 'i1', organizationId: ORG_A },
        select: { status: true, currentStageId: true },
      });
    });

    it.each([
      ['the record moved on', { status: 'IN_PROGRESS', currentStageId: 's2' }],
      ['the workflow finished', { status: 'COMPLETED', currentStageId: 's1' }],
      ['the workflow was cancelled', { status: 'CANCELLED', currentStageId: 's1' }],
    ])('refuses a stage task when %s (409)', async (_why, instance) => {
      mockPrisma.task.findFirst.mockResolvedValue(completed({ sourceStageId: 's1', workflowInstanceId: 'i1' }));
      mockPrisma.workflowInstance.findFirst.mockResolvedValue(instance);
      const error = await captureError(service.reopen('task-1', { reason: 'x' }, creator, ORG_A));
      expect((error as ConflictException).message).toBe('The workflow has moved past this step');
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('reopen', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);
      await expect(service.reopen('task-1', { reason: 'x' }, creator, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  // ── canManage on the lists ───────────────────────────────────────────────
  describe('canManage', () => {
    const listRow = (createdById: string, creatorStatus = 'ACTIVE') => ({
      ...task({ id: `task-${createdById}-${creatorStatus}`, createdById, createdBy: { status: creatorStatus } }),
      _count: { evidence: 0 },
      assignedOrgUnit: null,
      assignedPosition: null,
      assignedCommittee: null,
      assignedCommitteeRoleValue: null,
      requests: [],
      rejectedBy: null,
      cancelledBy: null,
    });
    const rows = [listRow(CREATOR), listRow(OUTSIDER), listRow('departed', 'INACTIVE')];

    beforeEach(() =>
      mockPrisma.task.findMany.mockResolvedValue(
        rows.map((r) => ({ ...r, assignees: [{ ...row(ASSIGNEE), pickedAt: null, user: { id: ASSIGNEE, name: 'Sara' } }] })),
      ),
    );

    it.each([
      ['the creator', creator, [true, false, false]],
      ['whoever acts for the creator', delegate, [true, false, false]],
      ['a tasks:reassign holder — only where the creator is gone', admin, [false, false, true]],
      ['anyone else', outsider, [false, true, false]],
    ])('on My tasks, for %s', async (_who, viewer, expected) => {
      const result = await service.getMyTasks(viewer.id, ORG_A, {}, viewer.permissions);
      expect(result.map((r) => r.canManage)).toEqual(expected);
      // Decided once for the page, not once per row.
      expect(mockAuthority.creatorsCoveredBy).toHaveBeenCalledTimes(1);
      expect(mockAuthority.canActForCreator).not.toHaveBeenCalled();
    });

    it("on the record's list, with who cancelled a cancelled task", async () => {
      const result = await service.getForSource('COMMITTEE', 'committee-1', ORG_A, ['committees:view'], DELEGATE);
      expect(result.map((r) => r.canManage)).toEqual([true, false, false]);
      expect(result[0]).toHaveProperty('cancelledBy', null);
      expect(mockAuthority.creatorsCoveredBy).toHaveBeenCalledTimes(1);
    });
  });

  // ── Edit's preview ───────────────────────────────────────────────────────
  it("previews every priority from the task's SLA start, the current one at the limit in force", async () => {
    const kept = plusHours(START, 55); // a pre-ACC-174 due date the backfill kept
    mockPrisma.task.findFirst.mockResolvedValue(task({ slaLimitAt: kept }));
    const preview = await service.slaPreviewForTask('task-1', creator, ORG_A);
    expect(preview['MEDIUM']).toEqual({ dueAt: plusHours(START, 40), limitAt: kept });
    expect(preview['HIGH']).toEqual({ dueAt: plusHours(START, 16), limitAt: plusHours(START, 16) });
  });

  it("Reopen's preview counts from now, for every priority, with no extension", async () => {
    mockPrisma.task.findFirst.mockResolvedValue(task({ slaExtendedTo: plusHours(START, 90) }));
    const before = Date.now();
    const preview = await service.slaPreviewForTask('task-1', creator, ORG_A, true);
    const start = preview['MEDIUM']!.dueAt.getTime() - 40 * HOUR;
    expect(start).toBeGreaterThanOrEqual(before);
    expect(preview['MEDIUM']!.limitAt).toEqual(preview['MEDIUM']!.dueAt);
  });

  itEnforcesTenantIsolation('slaPreviewForTask', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null);
    await expect(service.slaPreviewForTask('task-1', creator, ORG_B)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
    );
  });
});
