import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { ITaskSlaSettings } from '../tenant/interfaces/tenant.interface';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
// ACC-101 — what the route hands the service. Its content is irrelevant here
// (the visibility stub below admits everyone); it exists so these tests call
// the same signature the controller does.
// ACC-101 — org:view and users:view are here because the delegation-label
// tests below are about RESOLUTION, and a viewer entitled to neither now sees
// no label at all. The entitlement rules themselves are tested in
// delegation-label.service.spec.ts and at the route.
const VIEWER_PERMISSIONS = ['tasks:view', 'committees:view', 'org:view', 'users:view'];
// ACC-101 — who is reading, for the delegation-label entitlement check.
const VIEWER_ID = 'viewer-id';
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
  requiresEvidence: false,
  rejectedReason: null,
  rejectedAt: null,
  rejectedById: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignees: [{ id: 'ta-1', taskId: 'task-1', userId: USER_A, assignedAt: new Date(), assignedById: ACTOR, removedAt: null }],
  // ACC-163 — what the two LIST queries include (`_count: { evidence }`). The
  // single-row reads never ask for it and never read it.
  _count: { evidence: 0 },
};

const mockPrisma = {
  task: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    // ACC-163 — reject() re-reads a task that other assignees still hold.
    findFirstOrThrow: jest.fn(),
    update: jest.fn(),
    // ACC-68 — cancelForStage()/cancelForInstance() flip the whole matched
    // set in one write rather than per-row.
    updateMany: jest.fn(),
    // ACC-52 — hasUnassignedStageTasks()'s cheap existence check.
    count: jest.fn(),
  },
  taskAssignee: {
    updateMany: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  // ACC-173 — the request lifecycle. No pending request unless a test sets one.
  taskRequest: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn(),
    update: jest.fn(),
  },
  taskEvidence: {
    create: jest.fn(),
    // ACC-163 — complete()'s evidence-required check.
    count: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    // ACC-163 — the rejecter's name, for the creator's notification.
    findFirst: jest.fn(),
  },
  // ACC-163 — the record a rejected task belongs to, named in that notification.
  committee: {
    findFirst: jest.fn(),
  },
  // ACC-76 — DelegationLabelService resolves an ACTING_HEAD stamp's
  // contextId against OrgUnit (and an OUT_OF_OFFICE_COVERAGE one against
  // user, above).
  orgUnit: {
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

// ACC-163 — the row lock every task action takes before it reads. A tagged
// template, so a call is ([sqlFragments], ...values).
const mockQueryRaw = jest.fn();
(mockPrisma as unknown as Record<string, unknown>)['$queryRaw'] = mockQueryRaw;

// The lock call's SQL and its two bound values, for asserting what it locked.
function lockCall(index = 0): { sql: string; values: unknown[] } {
  const [fragments, ...values] = mockQueryRaw.mock.calls[index] as [TemplateStringsArray, ...unknown[]];
  return { sql: fragments.join('?'), values };
}

// Resolves to whatever the promise rejected with, so two refusals can be
// compared body to body. Fails the test if the promise resolves instead.
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected the call to be refused, but it succeeded');
}

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
    mockPrisma.orgUnit.findMany.mockResolvedValue([]);
    mockQueryRaw.mockResolvedValue([]);
    mockPrisma.taskEvidence.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        // ACC-167 — REAL, over the same mockPrisma: it decides where a chosen
        // target lands, and a stub would leave those tests asserting a mock.
        TaskAssignmentService,
        // ACC-173 — the creator acts for themself; covering is pinned in
        // task-authority.service.spec.ts.
        {
          provide: TaskAuthorityService,
          useValue: { canActForCreator: jest.fn(async (createdById: string, viewerId: string) => createdById === viewerId) },
        },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        // The REAL service, not a mock — it takes only PrismaService, and
        // mocking it would hide the tenant scoping its own isolation test
        // exists to prove.
        DelegationLabelService,
        // ACC-101 — a permissive stub, deliberately. These tests exercise the
        // DATA path; the parent check is proven where it lives, in
        // object-visibility.service.spec.ts and the route-level defect test in
        // task-parent-visibility.spec.ts. A real one here would refuse every
        // 'DOCUMENT'-sourced fixture below (no Document module exists to own
        // them) and turn data assertions into authorization assertions.
        {
          provide: ObjectVisibilityService,
          useValue: { assertCanView: jest.fn(), assertCanViewOrNotFound: jest.fn() },
        },
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

    // ACC-82 — an UNASSIGNED task no longer pages every Tenant Admin; it is a
    // Setup health condition (SYSTEM-REFERENCE §13.7). An admin is mocked so
    // "nobody notified" proves the removal rather than an empty admin list.
    it('creates status UNASSIGNED and no TaskAssignee rows when the resolved assignee list is empty, notifying no one', async () => {
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
      expect(mockNotificationService.create).not.toHaveBeenCalled();
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

  // ACC-163 — evidence-required is set at creation and defaults off, so a
  // workflow task (which never sends it) stays false.
  describe('create — requiresEvidence (ACC-163)', () => {
    const DTO = {
      title: 'Collect the audit sample',
      sourceType: 'COMMITTEE' as const,
      sourceId: 'committee-1',
      assigneeUserIds: [USER_A],
    };

    beforeEach(() => {
      mockPrisma.task.create.mockResolvedValue({ ...BASE_TASK, assignees: [] });
    });

    it('stores requiresEvidence when the form sends it', async () => {
      await service.create({ ...DTO, requiresEvidence: true }, ORG_A, ACTOR);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ requiresEvidence: true }) }),
      );
    });

    it('defaults requiresEvidence to false when it is not sent', async () => {
      await service.create(DTO, ORG_A, ACTOR);

      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ requiresEvidence: false }) }),
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

    // ACC-163 — OVERDUE is no longer written, but rows written before this
    // shipped keep it until the backfill runs. Every one is an Assigned task.
    it('matches legacy OVERDUE rows when filtering by PENDING (Assigned)', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.getMyTasks(USER_A, ORG_A, { status: 'PENDING' });

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ AND: [{ status: { in: ['PENDING', 'OVERDUE'] } }] }),
        }),
      );
    });

    it('filters any other status exactly', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.getMyTasks(USER_A, ORG_A, { status: 'IN_PROGRESS' });

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ AND: [{ status: 'IN_PROGRESS' }] }) }),
      );
    });

    // Q8 — overdue is a flag: an OPEN task past its due time, whatever its
    // status. Combined with a status filter, both apply.
    it('filters overdue as an open task past its due time, combinable with a status', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.getMyTasks(USER_A, ORG_A, { status: 'IN_PROGRESS', overdue: true });

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              { status: 'IN_PROGRESS' },
              { dueAt: { lt: expect.any(Date) }, status: { notIn: ['COMPLETED', 'CANCELLED', 'ON_HOLD'] } },
            ],
          }),
        }),
      );
    });

    it('returns each task with its evidence count, and without the raw _count', async () => {
      mockPrisma.task.findMany.mockResolvedValue([{ ...BASE_TASK, _count: { evidence: 2 } }]);

      const [task] = await service.getMyTasks(USER_A, ORG_A);

      expect(task!.evidenceCount).toBe(2);
      expect(task).not.toHaveProperty('_count');
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

    // ACC-162 — the caller is still an active assignee in both cases (the
    // completer's own row is never stamped; ACC-68 leaves a cancelled task's
    // assignees attached), so only the status check stands between them and
    // overwriting the record.
    it.each(['COMPLETED', 'CANCELLED'])(
      'throws ConflictException for a %s task, even from an active assignee',
      async (status) => {
        mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status });

        await expect(service.complete('task-1', USER_A, ORG_A)).rejects.toThrow(ConflictException);
        expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
        expect(mockPrisma.task.update).not.toHaveBeenCalled();
        expect(mockAuditLog.log).not.toHaveBeenCalled();
      },
    );

    // ACC-163 — the evidence-required refusal. Checked after the assignee and
    // closed-task checks, so only the person who could complete it learns why.
    it('refuses with 409 when evidence is required and the task has none, writing nothing', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, requiresEvidence: true });
      mockPrisma.taskEvidence.count.mockResolvedValue(0);

      const error = await captureError(service.complete('task-1', USER_A, ORG_A));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'Evidence is required before this task can be completed',
      );
      expect(mockPrisma.taskEvidence.count).toHaveBeenCalledWith({
        where: { taskId: 'task-1', organizationId: ORG_A },
      });
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('completes a task that requires evidence once it has some', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, requiresEvidence: true });
      mockPrisma.taskEvidence.count.mockResolvedValue(1);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED' });

      await service.complete('task-1', USER_A, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('does not count evidence for a task that does not require it', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED' });

      await service.complete('task-1', USER_A, ORG_A);

      expect(mockPrisma.taskEvidence.count).not.toHaveBeenCalled();
    });

    // ACC-163 — the first row lock: taken BEFORE the read, scoped to the
    // caller's tenant, so the checks see the locked state.
    it('locks the task row, scoped by id and tenant, before reading it', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED' });

      await service.complete('task-1', USER_A, ORG_A);

      const { sql, values } = lockCall();
      expect(sql).toMatch(/FOR UPDATE/);
      expect(sql).toMatch(/"organizationId"/);
      expect(values).toEqual(['task-1', ORG_A]);
      expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.task.findFirst.mock.invocationCallOrder[0]!,
      );
    });

    // ACC-162 — ACC-101 clause (b): a task the caller is not on must read
    // exactly like a task that does not exist, or the 404 confirms the id.
    it('returns an identical 404 body for a missing task and for a non-assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.complete('task-1', USER_A, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(BASE_TASK);
      const notAssigned = await captureError(service.complete('task-1', USER_B, ORG_A));

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(notAssigned).toBeInstanceOf(NotFoundException);
      expect((notAssigned as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
    });
  });

  // ACC-163 — Assigned → In progress, by an active assignee.
  describe('start', () => {
    it('moves an Assigned task to In progress and audits it', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'IN_PROGRESS' });

      const result = await service.start('task-1', USER_A, ORG_A);

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS' },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'Task',
          objectId: 'task-1',
          actorId: USER_A,
          tenantId: ORG_A,
          metadata: { event: 'started', startedBy: USER_A },
        }),
      );
    });

    // OVERDUE was only ever written over PENDING, so a legacy row is an
    // Assigned task and starts like one.
    it('starts a legacy OVERDUE task exactly like an Assigned one', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status: 'OVERDUE' });
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'IN_PROGRESS' });

      await service.start('task-1', USER_A, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'IN_PROGRESS' },
      });
    });

    it('refuses with 409 when the task is already in progress', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status: 'IN_PROGRESS' });

      const error = await captureError(service.start('task-1', USER_A, ORG_A));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe('This task is already in progress');
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it.each(['COMPLETED', 'CANCELLED'])('refuses with 409 for a %s task', async (status) => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status });

      await expect(service.start('task-1', USER_A, ORG_A)).rejects.toThrow(ConflictException);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    it('returns an identical 404 for a missing task, a non-assignee and a removed assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.start('task-1', USER_A, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(BASE_TASK);
      const notAssigned = await captureError(service.start('task-1', USER_B, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce({
        ...BASE_TASK,
        assignees: [{ ...BASE_TASK.assignees[0], removedAt: new Date('2026-01-15') }],
      });
      const removed = await captureError(service.start('task-1', USER_A, ORG_A));

      for (const error of [missing, notAssigned, removed]) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual(
          (missing as NotFoundException).getResponse(),
        );
      }
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('start', async () => {
      // The lock and the read both scope by the CALLER's tenant, so another
      // tenant's task locks nothing and reads as no row at all.
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.start('task-1', USER_A, ORG_B)).rejects.toThrow(NotFoundException);
      expect(lockCall().values).toEqual(['task-1', ORG_B]);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });
  });

  // ACC-163 — an active assignee hands the task back with a reason (Q4).
  describe('reject', () => {
    const REASON = { reason: 'This belongs to Pharmacy, not my unit' };
    const COMMITTEE_TASK = { ...BASE_TASK, sourceType: 'COMMITTEE', sourceId: 'committee-1' };

    beforeEach(() => {
      mockPrisma.user.findFirst.mockResolvedValue({ name: 'Sarah Al-Harbi' });
      mockPrisma.committee.findFirst.mockResolvedValue({ nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' });
    });

    it('marks the task REJECTED when the last active assignee rejects, storing the reason and who rejected', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(COMMITTEE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...COMMITTEE_TASK, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_A, ORG_A);

      // Only the caller's own row is stamped.
      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1', userId: USER_A, removedAt: null },
        data: { removedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          status: 'REJECTED',
          rejectedReason: REASON.reason,
          rejectedAt: expect.any(Date),
          rejectedById: USER_A,
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REJECT',
          objectType: 'Task',
          objectId: 'task-1',
          actorId: USER_A,
          tenantId: ORG_A,
          metadata: { reason: REASON.reason, rejectedBy: USER_A, lastAssigneeRejected: true },
        }),
      );
    });

    it('notifies the creator, naming the rejecter, the reason and the record, in English and Arabic', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(COMMITTEE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...COMMITTEE_TASK, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_A, ORG_A);

      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        {
          userId: ACTOR,
          titleEn: 'Task rejected',
          titleAr: 'تم رفض مهمة',
          bodyEn: `Sarah Al-Harbi rejected "Review document" on the committee "Quality Committee". Reason: ${REASON.reason}`,
          bodyAr: `رفض Sarah Al-Harbi المهمة "Review document" في اللجنة "لجنة الجودة". السبب: ${REASON.reason}`,
          objectType: 'Task',
          objectId: 'task-1',
        },
        ORG_A,
      );
      // Both lookups are tenant-scoped.
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: USER_A, organizationId: ORG_A } }),
      );
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'committee-1', organizationId: ORG_A } }),
      );
    });

    // ACC-160 — a committee with no Arabic name is named in English.
    it('names a committee with no Arabic name in English in the Arabic text', async () => {
      mockPrisma.committee.findFirst.mockResolvedValue({ nameEn: 'Quality Committee', nameAr: null });
      mockPrisma.task.findFirst.mockResolvedValue(COMMITTEE_TASK);
      mockPrisma.task.update.mockResolvedValue({ ...COMMITTEE_TASK, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_A, ORG_A);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ bodyAr: expect.stringContaining('اللجنة "Quality Committee"') }),
        ORG_A,
      );
    });

    it('leaves the task open, unchanged, when other assignees remain — and tells nobody', async () => {
      const shared = {
        ...COMMITTEE_TASK,
        assignees: [
          ...COMMITTEE_TASK.assignees,
          { id: 'ta-2', taskId: 'task-1', userId: USER_B, assignedAt: new Date(), assignedById: ACTOR, removedAt: null },
        ],
      };
      mockPrisma.task.findFirst.mockResolvedValue(shared);
      mockPrisma.task.findFirstOrThrow.mockResolvedValue(COMMITTEE_TASK);

      const result = await service.reject('task-1', REASON, USER_A, ORG_A);

      expect(result.status).toBe('PENDING');
      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith({
        where: { taskId: 'task-1', userId: USER_A, removedAt: null },
        data: { removedAt: expect.any(Date) },
      });
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      // Still audited: a person declined work they were given.
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REJECT',
          metadata: { reason: REASON.reason, rejectedBy: USER_A, lastAssigneeRejected: false },
        }),
      );
    });

    it('does not notify a creator who rejected their own task', async () => {
      const own = { ...COMMITTEE_TASK, createdById: USER_A };
      mockPrisma.task.findFirst.mockResolvedValue(own);
      mockPrisma.task.update.mockResolvedValue({ ...own, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_A, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it.each(['IN_PROGRESS', 'OVERDUE'])('may reject a %s task', async (status) => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...COMMITTEE_TASK, status });
      mockPrisma.task.update.mockResolvedValue({ ...COMMITTEE_TASK, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_A, ORG_A);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });

    it.each(['COMPLETED', 'CANCELLED'])('refuses with 409 for a %s task, writing nothing', async (status) => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...COMMITTEE_TASK, status });

      await expect(service.reject('task-1', REASON, USER_A, ORG_A)).rejects.toThrow(ConflictException);
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('returns an identical 404 for a missing task and a non-assignee, writing nothing', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.reject('task-1', REASON, USER_A, ORG_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(COMMITTEE_TASK);
      const notAssigned = await captureError(service.reject('task-1', REASON, USER_B, ORG_A));

      expect(missing).toBeInstanceOf(NotFoundException);
      expect((notAssigned as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
    });

    // The race the lock exists for: the two last assignees reject together.
    // Each runs against the state the other committed, so the second one —
    // reading after the first stamped its row — must see nobody remaining.
    it('the second of two last assignees to reject, reading the locked state, makes the task REJECTED', async () => {
      const afterFirstRejected = {
        ...COMMITTEE_TASK,
        assignees: [
          { ...COMMITTEE_TASK.assignees[0], removedAt: new Date() },
          { id: 'ta-2', taskId: 'task-1', userId: USER_B, assignedAt: new Date(), assignedById: ACTOR, removedAt: null },
        ],
      };
      mockPrisma.task.findFirst.mockResolvedValue(afterFirstRejected);
      mockPrisma.task.update.mockResolvedValue({ ...COMMITTEE_TASK, status: 'REJECTED' });

      await service.reject('task-1', REASON, USER_B, ORG_A);

      expect(mockQueryRaw).toHaveBeenCalled();
      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectedById: USER_B }) }),
      );
    });

    itEnforcesTenantIsolation('reject', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.reject('task-1', REASON, USER_A, ORG_B)).rejects.toThrow(NotFoundException);
      expect(lockCall().values).toEqual(['task-1', ORG_B]);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  // ACC-162 — evidence follows the assignee, not a permission. The route is
  // ungated, so these refusals are the whole of the access control.
  describe('addEvidence', () => {
    const TEXT_EVIDENCE = { type: 'LINK' as const, url: 'https://intranet/minutes/2026-02' };

    beforeEach(() => {
      mockPrisma.taskEvidence.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'evidence-1', ...data }),
      );
    });

    it('creates and audits the evidence when called by an active assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      const result = await service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_A);

      expect(result.id).toBe('evidence-1');
      expect(mockPrisma.taskEvidence.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_A,
          taskId: 'task-1',
          type: 'LINK',
          url: TEXT_EVIDENCE.url,
          linkTitle: null,
          uploadedById: USER_A,
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          objectType: 'TaskEvidence',
          objectId: 'evidence-1',
          actorId: USER_A,
          tenantId: ORG_A,
        }),
      );
    });

    it('throws NotFoundException when the caller is not an assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await expect(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_B)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.taskEvidence.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    // removedAt is stamped when a colleague completes the task or it is
    // reassigned away — that person no longer holds the work.
    it('throws NotFoundException when the caller is a removed assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        ...BASE_TASK,
        assignees: [{ ...BASE_TASK.assignees[0], removedAt: new Date('2026-01-15') }],
      });

      await expect(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.taskEvidence.create).not.toHaveBeenCalled();
    });

    // The caller is still an active assignee in both cases — for COMPLETED
    // because the completer's own row is never stamped, for CANCELLED because
    // ACC-68 leaves assignees attached — so the status check is what refuses.
    it.each(['COMPLETED', 'CANCELLED'])(
      'throws ConflictException for a %s task, even from an active assignee',
      async (status) => {
        mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status });

        await expect(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_A)).rejects.toThrow(
          ConflictException,
        );
        expect(mockPrisma.taskEvidence.create).not.toHaveBeenCalled();
        expect(mockAuditLog.log).not.toHaveBeenCalled();
      },
    );

    // A non-assignee meets the 404 before the status check, so a closed task
    // reads exactly like any other task they do not hold.
    it('throws NotFoundException, not ConflictException, for a non-assignee on a closed task', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status: 'COMPLETED' });

      await expect(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_B)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an identical 404 body for a missing task and for a non-assignee', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_A));
      mockPrisma.task.findFirst.mockResolvedValueOnce(BASE_TASK);
      const notAssigned = await captureError(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_B));

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(notAssigned).toBeInstanceOf(NotFoundException);
      expect((notAssigned as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
    });

    // ACC-163 — only the fields of the evidence's own type are written.
    it('writes only the reference fields for an INTERNAL_REFERENCE, never a URL', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.addEvidence(
        'task-1',
        { type: 'INTERNAL_REFERENCE', refType: 'DOCUMENT', refId: 'doc-9', url: 'https://ignored' },
        ORG_A,
        USER_A,
      );

      expect(mockPrisma.taskEvidence.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_A,
          taskId: 'task-1',
          type: 'INTERNAL_REFERENCE',
          refType: 'DOCUMENT',
          refId: 'doc-9',
          refDisplay: 'doc-9',
          uploadedById: USER_A,
        },
      });
    });

    it('locks the task row before reading it, so evidence cannot land on a task being completed', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.addEvidence('task-1', TEXT_EVIDENCE, ORG_A, USER_A);

      expect(lockCall().values).toEqual(['task-1', ORG_A]);
    });

    itEnforcesTenantIsolation('addEvidence', async () => {
      // The query scopes by the CALLER's tenant, so another tenant's task
      // comes back as no row at all.
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.addEvidence('task-1', TEXT_EVIDENCE, ORG_B, USER_A)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskEvidence.create).not.toHaveBeenCalled();
    });
  });

  describe('reassign', () => {
    const DTO = { newAssigneeUserIds: [USER_B], reason: 'Ahmad is on leave' };
    const HOLDER = ['tasks:reassign'];
    // Neither the creator nor a holder of tasks:reassign.
    const OUTSIDER = 'outsider-id';

    beforeEach(() => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_B }]);
      mockPrisma.task.update.mockResolvedValue({ ...BASE_TASK, status: 'PENDING' });
    });

    it('lets a tasks:reassign holder reassign, creating the new assignee row', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.reassign('task-1', DTO, ORG_A, OUTSIDER, HOLDER);

      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId: USER_B, assignedById: OUTSIDER },
      });
    });

    // ACC-163 (Q4) — a rejected task comes back to its creator, who reassigns
    // it without holding tasks:reassign.
    it("lets the task's creator reassign without tasks:reassign", async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK); // createdById: ACTOR

      await service.reassign('task-1', DTO, ORG_A, ACTOR, []);

      expect(mockPrisma.taskAssignee.create).toHaveBeenCalledWith({
        data: { taskId: 'task-1', userId: USER_B, assignedById: ACTOR },
      });
    });

    // ACC-101 clause (b): entitlement is only knowable from the row, so a
    // refusal must be indistinguishable from not-found.
    it('refuses anyone else with a 404 identical to a missing task, writing nothing', async () => {
      mockPrisma.task.findFirst.mockResolvedValueOnce(null);
      const missing = await captureError(service.reassign('task-1', DTO, ORG_A, OUTSIDER, HOLDER));
      mockPrisma.task.findFirst.mockResolvedValueOnce(BASE_TASK);
      const notEntitled = await captureError(service.reassign('task-1', DTO, ORG_A, OUTSIDER, []));

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(notEntitled).toBeInstanceOf(NotFoundException);
      expect((notEntitled as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
    });

    // ACC-163 — reassigning a closed task used to reopen it as PENDING.
    it.each(['COMPLETED', 'CANCELLED'])('refuses a %s task with 409, writing nothing', async (status) => {
      mockPrisma.task.findFirst.mockResolvedValue({ ...BASE_TASK, status });

      const error = await captureError(service.reassign('task-1', DTO, ORG_A, ACTOR, HOLDER));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        `A ${status.toLowerCase()} task cannot be reassigned`,
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('clears the rejection and sets the task back to Assigned', async () => {
      mockPrisma.task.findFirst.mockResolvedValue({
        ...BASE_TASK,
        status: 'REJECTED',
        rejectedReason: 'Not my unit',
        rejectedAt: new Date(),
        rejectedById: USER_A,
        assignees: [{ ...BASE_TASK.assignees[0], removedAt: new Date() }],
      });

      await service.reassign('task-1', DTO, ORG_A, ACTOR, []);

      expect(mockPrisma.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING',
            rejectedReason: null,
            rejectedAt: null,
            rejectedById: null,
          }),
        }),
      );
    });

    it('removes the previous assignees', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.reassign('task-1', DTO, ORG_A, ACTOR, HOLDER);

      expect(mockPrisma.taskAssignee.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { taskId: 'task-1', removedAt: null } }),
      );
    });

    // ACC-163 — reassigning back to someone who held the task before reuses
    // their row. TaskAssignee is unique on (taskId, userId), so creating a
    // second row is what used to fail.
    it('reactivates a returning assignee in place, clearing any delegation stamp, instead of creating a duplicate', async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: USER_A }]);
      mockPrisma.task.findFirst.mockResolvedValue({
        ...BASE_TASK,
        assignees: [
          {
            ...BASE_TASK.assignees[0],
            removedAt: new Date('2026-01-15'),
            delegationReason: 'OUT_OF_OFFICE_COVERAGE',
            delegationContextId: 'absent-user',
          },
        ],
      });

      await service.reassign('task-1', { newAssigneeUserIds: [USER_A], reason: 'Back from leave' }, ORG_A, ACTOR, HOLDER);

      expect(mockPrisma.taskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'ta-1' },
        data: {
          removedAt: null,
          assignedAt: expect.any(Date),
          assignedById: ACTOR,
          delegationReason: null,
          delegationContextId: null,
          // ACC-167 — a reassignment is not a pick.
          pickedAt: null,
        },
      });
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
    });

    // The A → B → A sequence end to end, against a small stateful fake that
    // enforces TaskAssignee's (taskId, userId) uniqueness the way the
    // database does — so a duplicate row fails here exactly as it did live.
    it('reassigns A → B → A without ever creating a second row for A', async () => {
      type Row = { id: string; taskId: string; userId: string; removedAt: Date | null; assignedById: string };
      const rows: Row[] = [
        { id: 'ta-1', taskId: 'task-1', userId: USER_A, removedAt: null, assignedById: ACTOR },
      ];
      const snapshot = () => ({ ...BASE_TASK, assignees: rows.map((r) => ({ ...r })) });

      mockPrisma.task.findFirst.mockImplementation(() => Promise.resolve(snapshot()));
      mockPrisma.user.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      );
      mockPrisma.taskAssignee.updateMany.mockImplementation(() => {
        rows.filter((r) => r.removedAt === null).forEach((r) => (r.removedAt = new Date()));
        return Promise.resolve({ count: 1 });
      });
      mockPrisma.taskAssignee.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          Object.assign(rows.find((r) => r.id === where.id)!, data);
          return Promise.resolve({});
        },
      );
      mockPrisma.taskAssignee.create.mockImplementation(({ data }: { data: Row }) => {
        if (rows.some((r) => r.taskId === data.taskId && r.userId === data.userId)) {
          return Promise.reject(new Error('Unique constraint failed on (taskId, userId)'));
        }
        rows.push({ ...data, id: `ta-${rows.length + 1}`, removedAt: null });
        return Promise.resolve({});
      });

      try {
        await service.reassign('task-1', { newAssigneeUserIds: [USER_B], reason: 'Cover' }, ORG_A, ACTOR, HOLDER);
        await service.reassign('task-1', { newAssigneeUserIds: [USER_A], reason: 'Back' }, ORG_A, ACTOR, HOLDER);

        expect(rows.filter((r) => r.userId === USER_A)).toHaveLength(1);
        expect(rows.find((r) => r.userId === USER_A)!.removedAt).toBeNull();
        expect(rows.find((r) => r.userId === USER_B)!.removedAt).not.toBeNull();
      } finally {
        // clearAllMocks() keeps implementations, so this fake would otherwise
        // follow every later test.
        for (const mock of [
          mockPrisma.task.findFirst,
          mockPrisma.user.findMany,
          mockPrisma.taskAssignee.updateMany,
          mockPrisma.taskAssignee.update,
          mockPrisma.taskAssignee.create,
        ]) {
          mock.mockReset();
        }
      }
    });

    it('logs a full before/after audit entry with the reason, keeping the earlier state', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.reassign('task-1', DTO, ORG_A, ACTOR, HOLDER);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELEGATE',
          before: BASE_TASK,
          metadata: expect.objectContaining({ reason: 'Ahmad is on leave' }),
        }),
      );
    });

    it('locks the task row before reading it', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(BASE_TASK);

      await service.reassign('task-1', DTO, ORG_A, ACTOR, HOLDER);

      expect(lockCall().values).toEqual(['task-1', ORG_A]);
      expect(mockQueryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockPrisma.task.findFirst.mock.invocationCallOrder[0]!,
      );
    });

    itEnforcesTenantIsolation('reassign', async () => {
      mockPrisma.task.findFirst.mockResolvedValue(null);

      await expect(service.reassign('task-1', DTO, ORG_B, ACTOR, HOLDER)).rejects.toThrow(NotFoundException);
      expect(lockCall().values).toEqual(['task-1', ORG_B]);
      expect(mockPrisma.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
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
      expect(result).toEqual({ reassignedCount: 1, unassignedCount: 0, returnedToPoolCount: 0 });
    });

    it('flags a task UNASSIGNED when no acting user is given and no other assignee remains', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);

      const result = await service.reassignAllForUser(USER_A, null, ORG_A, ACTOR);

      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { status: 'UNASSIGNED' },
      });
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 1, returnedToPoolCount: 0 });
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
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0, returnedToPoolCount: 0 });
    });

    it('falls back to UNASSIGNED when the requested acting user is not active in this tenant', async () => {
      mockPrisma.taskAssignee.findMany.mockResolvedValue([ASSIGNMENT_SOLO]);
      mockPrisma.user.findMany.mockResolvedValue([]); // acting user not found/inactive

      const result = await service.reassignAllForUser(USER_A, 'inactive-user', ORG_A, ACTOR);

      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 1, returnedToPoolCount: 0 });
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

      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 0, returnedToPoolCount: 0 });
    });
  });

  describe('getForSource', () => {
    // Same near-miss title fix as getMyTasks() above (ACC-33 item 1).
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.task.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? [BASE_TASK] : []),
      );

      const result = await service.getForSource('DOCUMENT', 'doc-1', ORG_B, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result).toHaveLength(0);
    });

    // ACC-76 — the populated path. Before this ticket no list endpoint
    // returned assignees at all, so nothing here ever exercised it: the
    // isolation test above only ever asserted the EMPTY result.
    it('returns each assignee with a resolved user name', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        {
          ...BASE_TASK,
          assignees: [
            { ...BASE_TASK.assignees[0], user: { id: USER_A, name: 'Sarah' } },
          ],
        },
      ]);

      const result = await service.getForSource('COMMITTEE', 'committee-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result[0]!.assignees).toEqual([
        { userId: USER_A, userName: 'Sarah', delegation: null },
      ]);
    });

    // ACC-163 — the record list names who rejected a task, and both lists
    // carry the evidence count.
    it('returns the evidence count and who rejected the task', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        {
          ...BASE_TASK,
          status: 'REJECTED',
          assignees: [],
          rejectedBy: { id: USER_A, name: 'Sarah' },
          _count: { evidence: 3 },
        },
      ]);

      const [task] = await service.getForSource('COMMITTEE', 'committee-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(task!.evidenceCount).toBe(3);
      expect(task!.rejectedBy).toEqual({ id: USER_A, name: 'Sarah' });
      expect(task).not.toHaveProperty('_count');
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            rejectedBy: { select: { id: true, name: true } },
            _count: { select: { evidence: true } },
          }),
        }),
      );
    });

    // complete() stamps removedAt rather than deleting, so without this
    // filter a completed task would list everyone ever assigned to it as
    // though they still were.
    it('asks the database for active assignees only', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.getForSource('COMMITTEE', 'committee-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      const args = mockPrisma.task.findMany.mock.calls[0]![0];
      expect(args.include.assignees.where).toEqual({ removedAt: null });
    });

    // ACC-40 §2.6.3's stamp, surfaced for the first time. The qualifier is
    // what lets a page read "Sarah — Acting Head of Cardiology" rather than
    // implying Sarah holds the position outright.
    it('resolves an ACTING_HEAD assignee to its org unit', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: 'unit-cardiology', nameEn: 'Cardiology', nameAr: 'القلب' },
      ]);
      mockPrisma.task.findMany.mockResolvedValue([
        {
          ...BASE_TASK,
          assignees: [
            {
              ...BASE_TASK.assignees[0],
              delegationReason: 'ACTING_HEAD',
              delegationContextId: 'unit-cardiology',
              user: { id: USER_A, name: 'Sarah' },
            },
          ],
        },
      ]);

      const result = await service.getForSource('COMMITTEE', 'committee-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(result[0]!.assignees[0]!.delegation).toEqual({
        reason: 'ACTING_HEAD',
        contextId: 'unit-cardiology',
        contextLabelEn: 'Cardiology',
        contextLabelAr: 'القلب',
      });
    });

    // One resolve call for the whole page, not one per task — at ~110ms per
    // round trip the difference is visible to a user.
    it('resolves delegation labels once across every task on the page', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([
        { id: 'unit-cardiology', nameEn: 'Cardiology', nameAr: null },
      ]);
      const stampedAssignee = {
        ...BASE_TASK.assignees[0],
        delegationReason: 'ACTING_HEAD',
        delegationContextId: 'unit-cardiology',
        user: { id: USER_A, name: 'Sarah' },
      };
      mockPrisma.task.findMany.mockResolvedValue([
        { ...BASE_TASK, id: 'task-1', assignees: [stampedAssignee] },
        { ...BASE_TASK, id: 'task-2', assignees: [stampedAssignee] },
        { ...BASE_TASK, id: 'task-3', assignees: [stampedAssignee] },
      ]);

      await service.getForSource('COMMITTEE', 'committee-1', ORG_A, VIEWER_PERMISSIONS, VIEWER_ID);

      expect(mockPrisma.orgUnit.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('listUnassigned (ACC-34)', () => {
    // Two queries since ACC-167: UNASSIGNED tasks, and tasks waiting in a pool
    // (status IN [...]) — each answered by its own shape of where-clause.
    const answerTaskQueries = (unassigned: unknown[], waitingInPool: unknown[], byId: unknown[] = []) =>
      mockPrisma.task.findMany.mockImplementation(({ where }: { where: { status?: unknown; id?: unknown } }) =>
        Promise.resolve(
          where.status === 'UNASSIGNED' ? unassigned : where.id ? byId : waitingInPool,
        ),
      );

    it('returns only status: UNASSIGNED tasks, tenant-wide, when no pool is stranded', async () => {
      const unassignedTask = { ...BASE_TASK, status: 'UNASSIGNED', assignees: [] };
      answerTaskQueries([unassignedTask], []);

      const result = await service.listUnassigned(ORG_A);

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, status: 'UNASSIGNED' },
        }),
      );
      expect(result).toEqual([unassignedTask]);
    });

    // ACC-167 — a pool nobody is in is work nobody can pick up, exactly as an
    // UNASSIGNED task is; Setup health's Fix opens it on this screen.
    it('also lists an open pool task whose pool nobody is in, and not one whose pool is staffed', async () => {
      const stranded = { ...BASE_TASK, id: 'task-empty', assignedOrgUnitId: 'u1', assignedPositionId: 'p-empty' };
      const staffed = { ...BASE_TASK, id: 'task-staffed', assignedOrgUnitId: 'u1', assignedPositionId: 'p-held' };
      answerTaskQueries([], [stranded, staffed], [stranded]);
      mockPrisma.user.findMany.mockResolvedValue([{ positionId: 'p-held', primaryOrgUnitId: 'u1' }]);

      const result = await service.listUnassigned(ORG_A);

      expect(result.map((t) => t.id)).toEqual(['task-empty']);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A, id: { in: ['task-empty'] } } }),
      );
    });

    it('is not scoped to the calling user — no assignees filter applied', async () => {
      answerTaskQueries([], []);

      await service.listUnassigned(ORG_A);

      const call = mockPrisma.task.findMany.mock.calls[0][0];
      expect(call.where).not.toHaveProperty('assignees');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      const unassignedTask = { ...BASE_TASK, status: 'UNASSIGNED', assignees: [] };
      mockPrisma.task.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A && where.status === 'UNASSIGNED' ? [unassignedTask] : []),
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

    // The contract that actually matters, and the one a mock-per-assertion
    // test cannot prove: after recovery, the newly-eligible assignee can
    // genuinely COMPLETE the task. complete() rejects any caller without an
    // active TaskAssignee row, so this runs both methods back-to-back against
    // a small stateful fake that really records what was written, rather than
    // asserting on two independent mocks that never see each other's effects.
    it('end-to-end: the newly-eligible assignee can actually complete the task afterward', async () => {
      const store = {
        task: {
          ...UNASSIGNED_TASK,
          assignees: [] as { id: string; taskId: string; userId: string; removedAt: Date | null }[],
        },
      };

      mockPrisma.task.findMany.mockImplementation(({ where }: { where: { status?: string } }) =>
        Promise.resolve(where.status === 'UNASSIGNED' && store.task.status === 'UNASSIGNED' ? [store.task] : []),
      );
      mockPrisma.taskAssignee.create.mockImplementation(({ data }: { data: { taskId: string; userId: string } }) => {
        store.task.assignees.push({ id: 'ta-new', taskId: data.taskId, userId: data.userId, removedAt: null });
        return Promise.resolve(store.task.assignees.at(-1));
      });
      mockPrisma.task.update.mockImplementation(({ data }: { data: { status?: string } }) => {
        if (data.status) store.task.status = data.status;
        return Promise.resolve(store.task);
      });
      // complete()'s own reads, served from the same store.
      mockPrisma.task.findFirst.mockImplementation(() => Promise.resolve(store.task));
      mockPrisma.taskAssignee.updateMany.mockResolvedValue({ count: 0 });

      // Before recovery: the task exists, but USER_A cannot complete it —
      // this is the inert state the whole ticket is about.
      await expect(service.complete(store.task.id, USER_A, ORG_A)).rejects.toThrow(NotFoundException);

      await service.attachAssigneesToUnassignedStageTasks(INSTANCE_ID, STAGE_ID, [USER_A], ORG_A);

      expect(store.task.status).toBe('PENDING');
      expect(store.task.assignees).toHaveLength(1);
      expect(store.task.assignees[0]).toMatchObject({ userId: USER_A, removedAt: null });

      // After recovery: the same call now succeeds.
      await expect(service.complete(store.task.id, USER_A, ORG_A)).resolves.toBeDefined();
      expect(store.task.status).toBe('COMPLETED');
    });

    // ACC-52 — the property that lets the caller drop its one-shot guard:
    // calling this repeatedly, once nothing is orphaned, must be a true
    // no-op — no writes, and critically no duplicate assignee notification.
    it('is a no-op with no writes and no notification when nothing is orphaned — safe to call every sweep', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]); // already recovered

      const recovered = await service.attachAssigneesToUnassignedStageTasks(
        INSTANCE_ID,
        STAGE_ID,
        [USER_A],
        ORG_A,
      );

      expect(recovered).toBe(0);
      expect(mockPrisma.task.update).not.toHaveBeenCalled();
      expect(mockPrisma.taskAssignee.create).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
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

  // ACC-52 — the cheap pre-check that keeps idempotent recovery affordable.
  describe('hasUnassignedStageTasks', () => {
    const INSTANCE_ID = 'wf-instance-1';
    const STAGE_ID = 'stage-1';

    it('returns true when an orphaned UNASSIGNED task exists for the stage', async () => {
      mockPrisma.task.count.mockResolvedValue(1);

      const result = await service.hasUnassignedStageTasks(INSTANCE_ID, STAGE_ID, ORG_A);

      expect(result).toBe(true);
      expect(mockPrisma.task.count).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          workflowInstanceId: INSTANCE_ID,
          sourceStageId: STAGE_ID,
          status: 'UNASSIGNED',
        },
      });
    });

    it('returns false when nothing is orphaned — the common healthy-tenant path', async () => {
      mockPrisma.task.count.mockResolvedValue(0);

      expect(await service.hasUnassignedStageTasks(INSTANCE_ID, STAGE_ID, ORG_A)).toBe(false);
    });

    itEnforcesTenantIsolation(
      'hasUnassignedStageTasks only counts orphaned tasks within the requested tenant',
      async () => {
        mockPrisma.task.count.mockImplementation(({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? 1 : 0),
        );

        expect(await service.hasUnassignedStageTasks(INSTANCE_ID, STAGE_ID, ORG_B)).toBe(false);
        expect(mockPrisma.task.count).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
        );
      },
    );
  });

  // ACC-68 — TaskStatus.CANCELLED had no producer before these two methods.
  describe('cancelForStage', () => {
    const INSTANCE_ID = 'wf-instance-1';
    const STAGE_ID = 'stage-1';

    const openTask = (id: string, status = 'PENDING') => ({
      ...BASE_TASK,
      id,
      status,
      workflowInstanceId: INSTANCE_ID,
      sourceStageId: STAGE_ID,
    });

    it('cancels every open task for the stage and returns the count', async () => {
      mockPrisma.task.findMany.mockResolvedValue([openTask('t-1'), openTask('t-2', 'IN_PROGRESS')]);

      const cancelled = await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT');

      expect(cancelled).toBe(2);
      expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t-1', 't-2'] }, organizationId: ORG_A },
        data: { status: 'CANCELLED', heldAt: null, onHoldUntil: null, heldFromStatus: null },
      });
    });

    it('treats COMPLETED and CANCELLED as not open — matching the ACC-65 gate exactly', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT');

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { notIn: ['COMPLETED', 'CANCELLED'] } }),
        }),
      );
    });

    it('scopes to the instance as well as the stage, so another object at the same stage is untouched', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT');

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workflowInstanceId: INSTANCE_ID,
            sourceStageId: STAGE_ID,
          }),
        }),
      );
    });

    it('writes nothing and skips audit when no open task exists', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      expect(await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT')).toBe(0);
      expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('leaves assignees attached, so the task stays visible in the assignee list', async () => {
      mockPrisma.task.findMany.mockResolvedValue([openTask('t-1')]);

      await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT');

      // complete() detaches the other assignees; cancellation deliberately
      // must not, or getMyTasks()'s removedAt: null filter would hide it.
      expect(mockPrisma.taskAssignee.updateMany).not.toHaveBeenCalled();
    });

    it('audits once per task, naming the reason', async () => {
      mockPrisma.task.findMany.mockResolvedValue([openTask('t-1'), openTask('t-2')]);

      await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_A, ACTOR, 'STAGE_EXIT');

      expect(mockAuditLog.log).toHaveBeenCalledTimes(2);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          objectType: 'Task',
          objectId: 't-1',
          tenantId: ORG_A,
          metadata: expect.objectContaining({ reason: 'STAGE_EXIT' }),
        }),
      );
    });

    itEnforcesTenantIsolation(
      'open stage tasks in cancelForStage',
      async () => {
        mockPrisma.task.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? [openTask('t-1')] : []),
        );

        expect(await service.cancelForStage(INSTANCE_ID, STAGE_ID, ORG_B, ACTOR, 'STAGE_EXIT')).toBe(0);
        expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
        );
        expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('cancelForInstance', () => {
    const INSTANCE_ID = 'wf-instance-1';

    const openTask = (id: string, sourceStageId: string) => ({
      ...BASE_TASK,
      id,
      workflowInstanceId: INSTANCE_ID,
      sourceStageId,
    });

    it('cancels open tasks across every stage of the instance, not just one', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        openTask('t-1', 'stage-1'),
        openTask('t-2', 'stage-2'),
      ]);

      expect(await service.cancelForInstance(INSTANCE_ID, ORG_A, ACTOR)).toBe(2);
      // No sourceStageId in the predicate — that is the whole difference
      // from cancelForStage().
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A,
            workflowInstanceId: INSTANCE_ID,
            status: { notIn: ['COMPLETED', 'CANCELLED'] },
          },
        }),
      );
    });

    it('audits each cancelled task with the INSTANCE_CANCELLED reason', async () => {
      mockPrisma.task.findMany.mockResolvedValue([openTask('t-1', 'stage-1')]);

      await service.cancelForInstance(INSTANCE_ID, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          objectId: 't-1',
          metadata: expect.objectContaining({ reason: 'INSTANCE_CANCELLED' }),
        }),
      );
    });

    itEnforcesTenantIsolation(
      'open instance tasks in cancelForInstance',
      async () => {
        mockPrisma.task.findMany.mockImplementation(({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? [openTask('t-1', 'stage-1')] : []),
        );

        expect(await service.cancelForInstance(INSTANCE_ID, ORG_B, ACTOR)).toBe(0);
        expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
        );
        expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
