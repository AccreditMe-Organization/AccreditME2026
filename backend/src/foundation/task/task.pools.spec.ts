import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-167 — pools: a task assigned to a position in a unit (or a committee
// role) with nobody on it until a member picks it up. Who is in the pool is
// resolved at READ time, so these tests answer membership from the mock's own
// holder list on every query, exactly as the database would.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const CREATOR = 'creator';
const HOLDER_A = 'holder-a';
const HOLDER_B = 'holder-b';
const OUTSIDER = 'outsider';
const ESCALATE_AT = DateTime.fromISO('2026-10-08T09:00:00Z');

const LABELS = {
  assignedOrgUnit: { nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
  assignedPosition: { nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة' },
  assignedCommittee: null,
  assignedCommitteeRoleValue: null,
};

const poolTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  organizationId: ORG_A,
  title: 'Collect the audit sample',
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
  createdById: CREATOR,
  status: 'PENDING',
  priority: 'MEDIUM',
  requiresEvidence: false,
  assignedOrgUnitId: 'unit-1',
  assignedPositionId: 'pos-qo',
  assignedCommitteeId: null,
  assignedCommitteeRoleValueId: null,
  pooledAt: new Date('2026-10-06T08:00:00Z'),
  poolEscalateAt: new Date('2026-10-07T08:00:00Z'),
  poolEscalatedAt: null,
  assignees: [] as Record<string, unknown>[],
  ...LABELS,
  ...overrides,
});

const row = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id: `ta-${userId}`,
  taskId: 'task-1',
  userId,
  assignedAt: new Date(),
  assignedById: userId,
  removedAt: null,
  pickedAt: new Date(),
  delegationReason: null,
  delegationContextId: null,
  ...overrides,
});

// The holders of pos-qo in unit-1, right now. Every membership query is
// answered from this list, so "who is in the pool" stays one fact per test.
let holders: string[];

const mockPrisma = {
  task: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  taskAssignee: { create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  // ACC-173 — the request lifecycle. No pending request unless a test sets one.
  taskRequest: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn(),
    update: jest.fn(),
  },
  taskEvidence: { count: jest.fn() },
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  committeeMember: { findMany: jest.fn(), count: jest.fn() },
  orgUnit: { findFirst: jest.fn(), findMany: jest.fn() },
  orgPosition: { findFirst: jest.fn() },
  committee: { findFirst: jest.fn() },
  lookupValue: { findFirst: jest.fn() },
};
const mockQueryRaw = jest.fn();
(mockPrisma as unknown as Record<string, unknown>)['$queryRaw'] = mockQueryRaw;
(mockPrisma as unknown as Record<string, unknown>)['$transaction'] = jest.fn(
  (callback: (tx: unknown) => unknown) => callback(mockPrisma),
);

const mockAuditLog = { log: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockCalendar = { calculateDeadline: jest.fn() };
const mockTenant = {
  getTaskSla: jest.fn().mockResolvedValue({
    CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
    HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 },
    MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
    LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  }),
};

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

describe('TaskService — pools (ACC-167)', () => {
  let service: TaskService;

  beforeEach(async () => {
    jest.clearAllMocks();
    holders = [HOLDER_A, HOLDER_B, CREATOR];
    mockQueryRaw.mockResolvedValue([]);
    mockCalendar.calculateDeadline.mockResolvedValue(ESCALATE_AT);
    mockPrisma.task.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'task-1', title: data['title'], ...data, assignees: [] }),
    );
    mockPrisma.task.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...poolTask(), ...data }),
    );
    // Membership answered from `holders`, by tenant — as the database would.
    mockPrisma.user.count.mockImplementation(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.organizationId === ORG_A && holders.includes(where.id) ? 1 : 0),
    );
    mockPrisma.user.findMany.mockImplementation(
      ({ where }: { where: { organizationId: string; id?: { in: string[] } } }) => {
        if (where.organizationId !== ORG_A) return Promise.resolve([]);
        const ids = where.id?.in ?? holders;
        return Promise.resolve(ids.filter((id) => holders.includes(id) || id === OUTSIDER).map((id) => ({ id })));
      },
    );
    mockPrisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-1' });
    mockPrisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-qo', isSingleAssignee: false });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        TaskAssignmentService,
        // ACC-173 — the creator acts for themself; covering is pinned in
        // task-authority.service.spec.ts.
        {
          provide: TaskAuthorityService,
          useValue: { canActForCreator: jest.fn(async (createdById: string, viewerId: string) => createdById === viewerId) },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        DelegationLabelService,
        {
          provide: ObjectVisibilityService,
          useValue: { assertCanView: jest.fn(), assertCanViewOrNotFound: jest.fn() },
        },
        { provide: WorkingCalendarService, useValue: mockCalendar },
        { provide: NotificationService, useValue: mockNotifications },
        { provide: TenantService, useValue: mockTenant },
      ],
    }).compile();
    service = module.get(TaskService);
  });

  const notifiedUsers = () =>
    (mockNotifications.create.mock.calls as [{ userId: string; titleEn: string }][]).map(([n]) => n.userId);

  // ── create ───────────────────────────────────────────────────────────────
  describe('create with a unit and position', () => {
    const DTO = {
      title: 'Collect the audit sample',
      sourceType: 'COMMITTEE' as const,
      sourceId: 'committee-1',
      assignTo: { kind: 'POSITION' as const, orgUnitId: 'unit-1', positionId: 'pos-qo' },
    };

    it('makes a POOL task — target set, nobody assigned, the pick-up clock started — for a multi-holder position', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      await service.create(DTO, ORG_A, CREATOR);

      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).toMatchObject({
        status: 'PENDING',
        assignedOrgUnitId: 'unit-1',
        assignedPositionId: 'pos-qo',
        assignedCommitteeId: null,
        pooledAt: expect.any(Date),
        poolEscalateAt: ESCALATE_AT.toJSDate(),
        poolEscalatedAt: null,
      });
      expect(data['assignees']).toBeUndefined();
      // Counted in working hours from the priority's manager threshold.
      expect(mockCalendar.calculateDeadline).toHaveBeenCalledWith(expect.anything(), 24, ORG_A);
    });

    it('tells the current pool members once, in English and Arabic — never the creator', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      await service.create(DTO, ORG_A, CREATOR);

      expect(notifiedUsers().sort()).toEqual([HOLDER_A, HOLDER_B]);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          titleEn: 'New task to pick up',
          titleAr: 'مهمة جديدة متاحة للاستلام',
          bodyEn: '"Collect the audit sample" is waiting for someone in Quality Officer, Pharmacy to pick it up.',
          bodyAr: 'المهمة "Collect the audit sample" بانتظار أن يستلمها أحد من مسؤول الجودة، الصيدلية.',
        }),
        ORG_A,
      );
    });

    it('goes straight to a chosen member, remembers the pool, and sends only the assignment notice', async () => {
      await service.create({ ...DTO, assignTo: { ...DTO.assignTo, userId: HOLDER_A } }, ORG_A, CREATOR);

      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).toMatchObject({ status: 'PENDING', assignedPositionId: 'pos-qo', pooledAt: null });
      expect(data['assignees']).toEqual({ create: [expect.objectContaining({ userId: HOLDER_A })] });
      expect(notifiedUsers()).toEqual([HOLDER_A]);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ titleEn: 'New task assigned' }),
        ORG_A,
      );
    });

    it('refuses a chosen person who does not hold the position there (400)', async () => {
      const error = await captureError(
        service.create({ ...DTO, assignTo: { ...DTO.assignTo, userId: OUTSIDER } }, ORG_A, CREATOR),
      );
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('The chosen person does not hold that position in that unit');
      expect(mockPrisma.task.create).not.toHaveBeenCalled();
    });

    it('assigns a single-holder position straight to its holder', async () => {
      holders = [HOLDER_A];
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-head', isSingleAssignee: true });

      await service.create(DTO, ORG_A, CREATOR);

      const { data } = mockPrisma.task.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data['assignees']).toEqual({ create: [expect.objectContaining({ userId: HOLDER_A })] });
      expect(data['pooledAt']).toBeNull();
    });

    it('makes a single-holder position with no holder UNASSIGNED, still remembering the pool', async () => {
      holders = [];
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-head', isSingleAssignee: true });

      await service.create(DTO, ORG_A, CREATOR);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'UNASSIGNED', assignedPositionId: 'pos-head' }),
        }),
      );
    });

    // Decision 3 — a pool is not "unassigned" for having nobody in it today.
    it('creates an empty multi-holder pool as a pool, not as UNASSIGNED', async () => {
      holders = [];

      await service.create(DTO, ORG_A, CREATOR);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING', pooledAt: expect.any(Date) }) }),
      );
    });

    it('refuses both a target and named people (400)', async () => {
      await expect(
        service.create({ ...DTO, assigneeUserIds: [HOLDER_A] }, ORG_A, CREATOR),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a committee role on a task that is not that committee\'s (400)', async () => {
      const error = await captureError(
        service.create(
          { ...DTO, sourceId: 'committee-OTHER', assignTo: { kind: 'COMMITTEE_ROLE', committeeId: 'committee-1', roleValueId: 'role-sec' } },
          ORG_A,
          CREATOR,
        ),
      );
      expect((error as BadRequestException).message).toBe(
        'A committee role can only be chosen for a task on that committee',
      );
    });

    it('pools a committee role — even one held by a single member: roles have no single-holder shortcut', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-1' });
      mockPrisma.lookupValue.findFirst.mockResolvedValue({ id: 'role-sec' });
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: HOLDER_A }]);
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ assignedOrgUnitId: null, assignedPositionId: null }));

      await service.create(
        { ...DTO, assignTo: { kind: 'COMMITTEE_ROLE', committeeId: 'committee-1', roleValueId: 'role-sec' } },
        ORG_A,
        CREATOR,
      );

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assignedCommitteeId: 'committee-1',
            assignedCommitteeRoleValueId: 'role-sec',
            assignedPositionId: null,
            pooledAt: expect.any(Date),
          }),
        }),
      );
    });
  });

  // ── pick ─────────────────────────────────────────────────────────────────
  describe('pick', () => {
    it('lets a current member take a waiting task: a row stamped pickedAt, the task theirs', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      await service.pick('task-1', HOLDER_A, ORG_A);

      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId: HOLDER_A, assignedById: HOLDER_A, pickedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { status: 'PENDING' } });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: HOLDER_A, metadata: { event: 'picked', pickedBy: HOLDER_A } }),
      );
    });

    // Release then pick again (A → B → A) reuses the row: TaskAssignee is
    // unique on (taskId, userId).
    it('reuses the row of a member who released it earlier', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(
        poolTask({ assignees: [row(HOLDER_A, { removedAt: new Date('2026-10-05') })] }),
      );

      await service.pick('task-1', HOLDER_A, ORG_A);

      expect(mockPrisma.taskAssignee.update).toHaveBeenCalledWith({
        where: { id: `ta-${HOLDER_A}` },
        data: expect.objectContaining({ removedAt: null, pickedAt: expect.any(Date), assignedById: HOLDER_A }),
      });
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
    });

    it('refuses a second member with 409 "This task has already been picked up"', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ assignees: [row(HOLDER_A)] }));

      const error = await captureError(service.pick('task-1', HOLDER_B, ORG_A));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('This task has already been picked up');
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
    });

    // Note 2 — a non-member must never learn whether a task was picked: the
    // membership check comes before every 409, so an outsider gets the same
    // 404 for a picked task, a closed one, and one that does not exist.
    it('gives a non-member the identical 404 — for a missing task, a picked one, a closed one and a non-pool one', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.pick('task-1', OUTSIDER, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(poolTask({ assignees: [row(HOLDER_A)] }));
      const picked = await captureError(service.pick('task-1', OUTSIDER, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(poolTask({ status: 'COMPLETED' }));
      const closed = await captureError(service.pick('task-1', OUTSIDER, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(poolTask({ assignedOrgUnitId: null, assignedPositionId: null }));
      const notAPool = await captureError(service.pick('task-1', HOLDER_A, ORG_A));

      for (const error of [missing, picked, closed, notAPool]) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
      }
    });

    it('stops seeing a task the moment the member leaves the position — read time, no write needed', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());
      holders = [HOLDER_B];

      await expect(service.pick('task-1', HOLDER_A, ORG_A)).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['COMPLETED', 'A completed task cannot be picked up'],
      ['CANCELLED', 'A cancelled task cannot be picked up'],
      ['REJECTED', 'A rejected task cannot be picked up'],
    ])('tells a member a %s task cannot be picked up (409)', async (status, message) => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ status }));

      const error = await captureError(service.pick('task-1', HOLDER_A, ORG_A));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(message);
    });

    // A single-holder position's task made UNASSIGNED for want of a holder:
    // the holder who appears later picks it up.
    it('lets a holder who appeared later pick up an UNASSIGNED single-holder task, which becomes Assigned', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ status: 'UNASSIGNED' }));

      await service.pick('task-1', HOLDER_A, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({ where: { id: 'task-1' }, data: { status: 'PENDING' } });
    });

    it('takes the row lock, scoped by id and tenant, before reading', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      await service.pick('task-1', HOLDER_A, ORG_A);

      const [fragments, ...values] = mockQueryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(fragments.join('?')).toMatch(/FOR UPDATE/);
      expect(values).toEqual(['task-1', ORG_A]);
      expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.task.findFirst.mock.invocationCallOrder[0]!,
      );
    });

    itEnforcesTenantIsolation('pick', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.pick('task-1', HOLDER_A, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
    });
  });

  // ── release ──────────────────────────────────────────────────────────────
  describe('release', () => {
    const REASON = { reason: 'On leave from tomorrow' };

    it('stamps the picker\'s row (never deletes it) and returns the task to its pool with a fresh clock', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ status: 'IN_PROGRESS', assignees: [row(HOLDER_A)] }));

      await service.release('task-1', REASON, HOLDER_A, ORG_A);

      expect(mockPrisma.taskAssignee.update).toHaveBeenCalledWith({
        where: { id: `ta-${HOLDER_A}` },
        data: { removedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'PENDING',
          pooledAt: expect.any(Date),
          poolEscalateAt: ESCALATE_AT.toJSDate(),
          poolEscalatedAt: null,
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { event: 'released', releasedBy: HOLDER_A, reason: REASON.reason, returnedToPool: true },
        }),
      );
    });

    it('tells the pool once, in both languages — never the person who released it', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ assignees: [row(HOLDER_A)] }));

      await service.release('task-1', REASON, HOLDER_A, ORG_A);

      expect(notifiedUsers().sort()).toEqual([CREATOR, HOLDER_B]);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          titleEn: 'Task handed back to pick up',
          titleAr: 'أُعيدت مهمة لتُستلم',
          bodyEn: `"Collect the audit sample" was handed back to Quality Officer, Pharmacy. Reason: ${REASON.reason}`,
        }),
        ORG_A,
      );
    });

    it('refuses a person the assigner chose directly — they reject instead (409)', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ assignees: [row(HOLDER_A, { pickedAt: null })] }));

      const error = await captureError(service.release('task-1', REASON, HOLDER_A, ORG_A));

      expect((error as ConflictException).message).toBe('Only a task picked up from a pool can be released');
      expect(mockPrisma.taskAssignee.update).not.toHaveBeenCalled();
    });

    it('gives anyone not holding the task the identical 404', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.release('task-1', REASON, HOLDER_B, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(poolTask({ assignees: [row(HOLDER_A)] }));
      const notMine = await captureError(service.release('task-1', REASON, HOLDER_B, ORG_A));

      expect((notMine as NotFoundException).getResponse()).toEqual((missing as NotFoundException).getResponse());
    });

    it('refuses a closed task (409)', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(poolTask({ status: 'COMPLETED', assignees: [row(HOLDER_A)] }));

      await expect(service.release('task-1', REASON, HOLDER_A, ORG_A)).rejects.toThrow(ConflictException);
    });

    itEnforcesTenantIsolation('release', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.release('task-1', REASON, HOLDER_A, ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskAssignee.update).not.toHaveBeenCalled();
    });
  });

  // ── reassign onto a pool ─────────────────────────────────────────────────
  describe('reassign onto a pool', () => {
    it('removes everyone, assigns nobody, sets the pool and restarts its clock, and tells the pool', async () => {
      // First read: the task as it stands. Later reads (the post-commit
      // notification) see it in its new pool.
      mockPrisma.task.findFirst
        .mockResolvedValueOnce(
          poolTask({ status: 'REJECTED', assignedOrgUnitId: null, assignedPositionId: null, assignees: [row(OUTSIDER, { pickedAt: null })] }),
        )
        .mockResolvedValue(poolTask());

      await service.reassign(
        'task-1',
        { assignTo: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-qo' }, reason: 'Pharmacy owns this' },
        ORG_A,
        CREATOR,
        [],
      );

      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1', removedAt: null },
        data: { removedAt: expect.any(Date) },
      });
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            assignedOrgUnitId: 'unit-1',
            assignedPositionId: 'pos-qo',
            rejectedReason: null,
            pooledAt: expect.any(Date),
          }),
        }),
      );
      expect(notifiedUsers().sort()).toEqual([HOLDER_A, HOLDER_B]);
    });

    it('refuses both a target and named people, or neither (400)', async () => {
      await expect(
        service.reassign('task-1', { reason: 'x' }, ORG_A, CREATOR, []),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reassign(
          'task-1',
          { reason: 'x', newAssigneeUserIds: [HOLDER_A], assignTo: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-qo' } },
          ORG_A,
          CREATOR,
          [],
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── available to pick up ─────────────────────────────────────────────────
  describe('getAvailableToPick', () => {
    it('looks only in the pools the caller is in right now — their position in their unit, and their committee roles', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ positionId: 'pos-qo', primaryOrgUnitId: 'unit-1' });
      mockPrisma.committeeMember.findMany.mockResolvedValue([{ committeeId: 'committee-1', roleValueId: 'role-sec' }]);
      mockPrisma.task.findMany.mockResolvedValue([{ ...poolTask(), _count: { evidence: 0 } }]);

      const [task] = await service.getAvailableToPick(HOLDER_A, ORG_A);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_A,
            assignees: { none: { removedAt: null } },
            AND: [
              {
                OR: [
                  { assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-qo' },
                  { assignedCommitteeId: 'committee-1', assignedCommitteeRoleValueId: 'role-sec' },
                ],
              },
            ],
          }),
        }),
      );
      expect(task!.pool).toEqual(
        expect.objectContaining({ kind: 'POSITION', positionNameEn: 'Quality Officer', orgUnitNameEn: 'Pharmacy' }),
      );
      expect(task).not.toHaveProperty('assignedOrgUnit');
    });

    it('asks nothing of the task table for someone in no pool', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ positionId: null, primaryOrgUnitId: null });
      mockPrisma.committeeMember.findMany.mockResolvedValue([]);

      await expect(service.getAvailableToPick(HOLDER_A, ORG_A)).resolves.toEqual([]);
      expect(mockPrisma.task.findMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('getAvailableToPick', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ positionId: 'pos-qo', primaryOrgUnitId: 'unit-1' });
      mockPrisma.committeeMember.findMany.mockResolvedValue([]);
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.getAvailableToPick(HOLDER_A, ORG_B);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });
  });

  // ── departure ────────────────────────────────────────────────────────────
  describe('departure (reassignAllForUser)', () => {
    const departing = (task: ReturnType<typeof poolTask>) => [{ id: `ta-${HOLDER_A}`, task }];

    it.each([
      ['picked up', new Date()],
      ['was chosen for', null],
    ])('returns an open task the departing person %s to its pool — no row for the acting user', async (_l, pickedAt) => {
      const task = poolTask({ assignees: [row(HOLDER_A, { pickedAt })] });
      mockPrisma.taskAssignee.findMany.mockResolvedValue(departing(task));
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      const result = await service.reassignAllForUser(HOLDER_A, OUTSIDER, ORG_A, 'admin');

      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0, returnedToPoolCount: 1 });
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: expect.objectContaining({ status: 'PENDING', pooledAt: expect.any(Date), poolEscalatedAt: null }),
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { event: 'departure_returned_to_pool', fromUserId: HOLDER_A } }),
      );
    });

    // UserService.deactivate() makes the leaver INACTIVE first, so the pool no
    // longer holds them. Even if it did, they are excluded: the holder list
    // below still names HOLDER_A, and only the others are told.
    it('tells the pool members, and only them, once — in English and Arabic', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(departing(poolTask({ assignees: [row(HOLDER_A)] })));
      mockPrisma.task.findFirst.mockResolvedValue(poolTask());

      await service.reassignAllForUser(HOLDER_A, null, ORG_A, 'admin');

      expect(notifiedUsers().sort()).toEqual([CREATOR, HOLDER_B]);
      expect(mockNotifications.create).toHaveBeenCalledWith(
        {
          userId: HOLDER_B,
          titleEn: 'Task back to pick up',
          titleAr: 'أُعيدت مهمة لتُستلم',
          bodyEn: '"Collect the audit sample" is back with Quality Officer, Pharmacy because the person working on it has left.',
          bodyAr: 'عادت المهمة "Collect the audit sample" إلى مسؤول الجودة، الصيدلية لأن الشخص الذي كان يعمل عليها غادر.',
          objectType: 'Task',
          objectId: 'task-1',
        },
        ORG_A,
      );
      // After the task's writes, not before them.
      expect(mockNotifications.create.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockPrisma.task.update.mock.invocationCallOrder[0]!,
      );
    });

    // Someone else is still on it: the task stays with them. Not returned, not
    // counted, nobody told — and audited as what it is.
    it('leaves a task that others are still on with them — not counted, nobody told', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(
        departing(poolTask({ assignees: [row(HOLDER_A), row(HOLDER_B)] })),
      );

      const result = await service.reassignAllForUser(HOLDER_A, null, ORG_A, 'admin');

      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0, returnedToPoolCount: 0 });
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { event: 'departure_left_with_others', fromUserId: HOLDER_A } }),
      );
      expect(mockAuditLog.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ event: 'departure_returned_to_pool' }) }),
      );
    });

    // This loop also reaches closed tasks (ACC-165's scope). Returning one to
    // its pool would reopen it, so a closed task keeps the old behaviour.
    it('never returns a CLOSED pool task to its pool', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue(departing(poolTask({ status: 'COMPLETED', assignees: [row(HOLDER_A)] })));

      const result = await service.reassignAllForUser(HOLDER_A, null, ORG_A, 'admin');

      expect(result.returnedToPoolCount).toBe(0);
      expect(mockPrisma.task.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pooledAt: expect.any(Date) }) }),
      );
    });
  });
});
