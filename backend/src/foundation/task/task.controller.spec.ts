import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskRequestService } from './task-request.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { ITask } from './interfaces/task.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';
// ACC-101 — the permission set the route decorator supplies.
const VIEWER_PERMISSIONS = ['tasks:view', 'committees:view'];

const MOCK_TASK: ITask = {
  id: 'task-1',
  organizationId: TENANT_ID,
  title: 'Review document',
  description: null,
  sourceType: 'DOCUMENT',
  sourceId: 'doc-1',
  sourceStageId: null,
  workflowInstanceId: null,
  meetingId: null,
  createdById: USER_ID,
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
  slaStartAt: null,
  slaLimitAt: null,
  slaExtendedTo: null,
  cancelledReason: null,
  cancelledAt: null,
  cancelledById: null,
  reopenedReason: null,
  reopenedAt: null,
  reopenedById: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('TaskController', () => {
  let controller: TaskController;
  let service: {
    getMyTasks: jest.Mock;
    getForSource: jest.Mock;
    getById: jest.Mock;
    getByIdForViewer: jest.Mock;
    create: jest.Mock;
    complete: jest.Mock;
    start: jest.Mock;
    reject: jest.Mock;
    pick: jest.Mock;
    release: jest.Mock;
    getAvailableToPick: jest.Mock;
    reassign: jest.Mock;
    addEvidence: jest.Mock;
    listUnassigned: jest.Mock;
    update: jest.Mock;
    cancel: jest.Mock;
    reopen: jest.Mock;
    slaPreview: jest.Mock;
    slaPreviewForTask: jest.Mock;
  };

  let assignment: {
    listUnits: jest.Mock;
    listPositions: jest.Mock;
    listHolders: jest.Mock;
    listCommitteeRoles: jest.Mock;
    listCommitteeMembers: jest.Mock;
  };

  const requests = {
    create: jest.fn(),
    withdraw: jest.fn(),
    approve: jest.fn(),
    decline: jest.fn(),
    resume: jest.fn(),
    awaitingDecision: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    assignment = {
      listUnits: jest.fn().mockResolvedValue([]),
      listPositions: jest.fn().mockResolvedValue([]),
      listHolders: jest.fn().mockResolvedValue([]),
      listCommitteeRoles: jest.fn().mockResolvedValue([]),
      listCommitteeMembers: jest.fn().mockResolvedValue([]),
    };
    service = {
      getMyTasks: jest.fn().mockResolvedValue([MOCK_TASK]),
      getForSource: jest.fn().mockResolvedValue([MOCK_TASK]),
      getById: jest.fn().mockResolvedValue(MOCK_TASK),
      getByIdForViewer: jest.fn().mockResolvedValue(MOCK_TASK),
      create: jest.fn().mockResolvedValue(MOCK_TASK),
      complete: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'COMPLETED' }),
      start: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'IN_PROGRESS' }),
      reject: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'REJECTED' }),
      pick: jest.fn().mockResolvedValue(MOCK_TASK),
      release: jest.fn().mockResolvedValue(MOCK_TASK),
      getAvailableToPick: jest.fn().mockResolvedValue([]),
      reassign: jest.fn().mockResolvedValue(MOCK_TASK),
      addEvidence: jest.fn().mockResolvedValue({ id: 'evidence-1' }),
      listUnassigned: jest.fn().mockResolvedValue([{ ...MOCK_TASK, status: 'UNASSIGNED' }]),
      update: jest.fn().mockResolvedValue(MOCK_TASK),
      cancel: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'CANCELLED' }),
      reopen: jest.fn().mockResolvedValue(MOCK_TASK),
      slaPreview: jest.fn().mockResolvedValue({}),
      slaPreviewForTask: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: service },
        { provide: TaskAssignmentService, useValue: assignment },
        { provide: TaskRequestService, useValue: requests },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TaskController);
  });

  afterEach(() => jest.clearAllMocks());

  it('getMyTasks delegates to the service, passing the validated query through', async () => {
    const query = { status: 'PENDING' as const, overdue: true };
    const result = await controller.getMyTasks(TENANT_ID, USER_ID, query, VIEWER_PERMISSIONS);

    // ACC-174 — the permissions travel too, for each row's canManage.
    expect(service.getMyTasks).toHaveBeenCalledWith(USER_ID, TENANT_ID, query, VIEWER_PERMISSIONS);
    expect(result).toEqual([MOCK_TASK]);
  });

  // ACC-70 — asserts the decorator metadata directly, because this is a
  // deliberate authorization decision that would otherwise be silently
  // reverted by anyone "restoring" the missing decorator for consistency
  // with its neighbours. my-tasks is self-scoped (assignees.some(userId =
  // caller)); the neighbours are not, and stay gated.
  it('my-tasks requires NO permission — it is self-scoped, like the notification inbox', () => {
    const reflector = new Reflector();
    const required = reflector.get<string[] | undefined>(
      PERMISSIONS_KEY,
      TaskController.prototype.getMyTasks,
    );

    expect(required).toBeUndefined();
  });

  // ACC-76 — same reasoning as my-tasks above, and the same warning against
  // "restoring" the decorator for consistency with its neighbours.
  // TaskService.complete() 404s anyone who is not a currently-active assignee,
  // so tasks:complete gated nothing the service did not already enforce. It
  // DID break the engine: tasks:complete was never seeded to BASE_USER, and
  // MEETING.minutes_review assigns to BASE_USER tenant-wide, so the engine
  // handed out work its own permission model forbade finishing. (ACC-162
  // retired tasks:complete altogether.)
  it('complete requires NO permission — it is self-scoped to an active assignee', () => {
    const reflector = new Reflector();
    const required = reflector.get<string[] | undefined>(
      PERMISSIONS_KEY,
      TaskController.prototype.complete,
    );

    expect(required).toBeUndefined();
  });

  // ACC-162 — evidence is self-scoped exactly as complete() is: the service
  // refuses anyone but a currently-active assignee. Gating it locked out the
  // assignees the engine actually hands work to.
  it('addEvidence requires NO permission — it is self-scoped to an active assignee', () => {
    const reflector = new Reflector();
    const required = reflector.get<string[] | undefined>(
      PERMISSIONS_KEY,
      TaskController.prototype.addEvidence,
    );

    expect(required).toBeUndefined();
  });

  // ACC-163 — start and reject are self-scoped for complete()'s reason.
  it.each(['start', 'reject'] as const)(
    '%s requires NO permission — it is self-scoped to an active assignee',
    (method) => {
      const reflector = new Reflector();
      const required = reflector.get<string[] | undefined>(
        PERMISSIONS_KEY,
        TaskController.prototype[method],
      );

      expect(required).toBeUndefined();
    },
  );

  // ACC-163 — reassign carries no decorator, but it is NOT ungated: the
  // service checks tasks:reassign OR creator-ness, and only the row can tell
  // the second. A decorator would refuse a rejected task's creator before the
  // row was read. The service spec proves the refusal.
  it('reassign carries no route permission — tasks:reassign is checked in the service, alongside creator-ness', () => {
    const reflector = new Reflector();
    const required = reflector.get<string[] | undefined>(
      PERMISSIONS_KEY,
      TaskController.prototype.reassign,
    );

    expect(required).toBeUndefined();
  });

  it('the non-self-scoped task endpoints remain permission-gated', () => {
    const reflector = new Reflector();

    // getForSource() and getById() can return ANY task in the tenant.
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getForSource)).toEqual([
      TASKS_PERMISSIONS.VIEW,
    ]);
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getById)).toEqual([
      TASKS_PERMISSIONS.VIEW,
    ]);
  });

  // ACC-101 — both reads now forward the caller's permission set, which is what
  // lets the service refuse a caller who cannot see the parent record. These
  // assert the FORWARDING; the refusal itself is proven at the route in
  // task-parent-visibility.spec.ts.
  it('getForSource delegates to the service, forwarding the caller permissions', async () => {
    const result = await controller.getForSource(TENANT_ID, 'DOCUMENT', 'doc-1', VIEWER_PERMISSIONS, USER_ID);

    expect(service.getForSource).toHaveBeenCalledWith(
      'DOCUMENT',
      'doc-1',
      TENANT_ID,
      VIEWER_PERMISSIONS,
      USER_ID,
    );
    expect(result).toEqual([MOCK_TASK]);
  });

  it('getById delegates to the viewer-aware read, forwarding the caller permissions', async () => {
    const result = await controller.getById('task-1', TENANT_ID, VIEWER_PERMISSIONS, USER_ID);

    expect(service.getByIdForViewer).toHaveBeenCalledWith('task-1', TENANT_ID, VIEWER_PERMISSIONS, USER_ID);
    expect(result).toEqual(MOCK_TASK);
  });

  it('create delegates to the service with tenant and actor', async () => {
    const dto = { title: 'Task', sourceType: 'DOCUMENT' as const, sourceId: 'doc-1', assigneeUserIds: ['u1'] };
    const result = await controller.create(dto, TENANT_ID, USER_ID);

    expect(service.create).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_TASK);
  });

  it('complete delegates to the service with tenant and actor', async () => {
    const result = await controller.complete('task-1', TENANT_ID, USER_ID);

    expect(service.complete).toHaveBeenCalledWith('task-1', USER_ID, TENANT_ID);
    expect(result.status).toBe('COMPLETED');
  });

  it('reassign delegates to the service with tenant, actor and the caller permissions', async () => {
    const dto = { newAssigneeUserIds: ['u2'], reason: 'Ahmad is on leave' };
    await controller.reassign('task-1', dto, TENANT_ID, USER_ID, ['tasks:reassign']);

    expect(service.reassign).toHaveBeenCalledWith('task-1', dto, TENANT_ID, USER_ID, ['tasks:reassign']);
  });

  it('start delegates to the service with tenant and actor', async () => {
    const result = await controller.start('task-1', TENANT_ID, USER_ID);

    expect(service.start).toHaveBeenCalledWith('task-1', USER_ID, TENANT_ID);
    expect(result.status).toBe('IN_PROGRESS');
  });

  it('reject delegates to the service with the reason, tenant and actor', async () => {
    const dto = { reason: 'Not my unit' };
    const result = await controller.reject('task-1', dto, TENANT_ID, USER_ID);

    expect(service.reject).toHaveBeenCalledWith('task-1', dto, USER_ID, TENANT_ID);
    expect(result.status).toBe('REJECTED');
  });

  it('addEvidence delegates to the service with tenant and actor', async () => {
    const dto = { type: 'LINK' as const, url: 'https://intranet/minutes' };
    const result = await controller.addEvidence('task-1', dto, TENANT_ID, USER_ID);

    expect(service.addEvidence).toHaveBeenCalledWith('task-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual({ id: 'evidence-1' });
  });

  it('getUnassigned delegates to the service with the current tenant', async () => {
    const result = await controller.getUnassigned(TENANT_ID);

    expect(service.listUnassigned).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual([{ ...MOCK_TASK, status: 'UNASSIGNED' }]);
  });

  // ACC-167 — none of these carries a route permission. Pick and release are
  // scoped to the pool and the picker by the service; the available list is
  // self-scoped; the picker's gate is "tasks:create, or entitled to reassign
  // the named task", whose second half only the row can answer.
  it.each([
    'pick',
    'release',
    'getAvailable',
    'getAssignableUnits',
    'getAssignablePositions',
    'getAssignableCommitteeRoles',
    'getCommitteeAssignees',
    'getAssignees',
    // ACC-173 — asking is an assignee's, withdrawing the asker's, deciding the
    // creator's (or their cover's, or a tasks:reassign holder's): only the row
    // can say, so the service decides.
    'getAwaitingDecision',
    'createRequest',
    'withdrawRequest',
    'approveRequest',
    'declineRequest',
    'resume',
    // ACC-174 — edit, cancel and reopen are the creator's (or their cover's,
    // or a tasks:reassign holder's while the creator is gone): only the row
    // can say, so the service decides. Edit's preview is the same.
    'update',
    'cancel',
    'reopen',
    'getTaskSlaPreview',
  ] as const)('%s carries no route permission', (method) => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype[method])).toBeUndefined();
  });

  it('pick and release delegate with the caller and tenant', async () => {
    await controller.pick('task-1', TENANT_ID, USER_ID);
    expect(service.pick).toHaveBeenCalledWith('task-1', USER_ID, TENANT_ID);

    await controller.release('task-1', { reason: 'Back to the pool' }, TENANT_ID, USER_ID);
    expect(service.release).toHaveBeenCalledWith('task-1', { reason: 'Back to the pool' }, USER_ID, TENANT_ID);
  });

  it('the picker endpoints forward the viewer, tenant and optional task', async () => {
    const perms = ['tasks:create'];
    const viewer = { id: USER_ID, permissions: perms };

    await controller.getAssignableUnits({ taskId: 'task-1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listUnits).toHaveBeenCalledWith(viewer, TENANT_ID, 'task-1');

    await controller.getAssignablePositions({ orgUnitId: 'u1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listPositions).toHaveBeenCalledWith(viewer, TENANT_ID, 'u1', undefined);

    await controller.getAssignees({ orgUnitId: 'u1', positionId: 'p1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listHolders).toHaveBeenCalledWith(viewer, TENANT_ID, 'u1', 'p1', undefined);

    await controller.getAssignableCommitteeRoles({ committeeId: 'c1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listCommitteeRoles).toHaveBeenCalledWith(viewer, TENANT_ID, 'c1', undefined);

    await controller.getCommitteeAssignees({ committeeId: 'c1', roleValueId: 'r1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listCommitteeMembers).toHaveBeenCalledWith(viewer, TENANT_ID, 'c1', 'r1', undefined);
  });

  it('the request routes delegate with the caller, their permissions and the tenant', async () => {
    const perms = ['tasks:reassign'];
    const viewer = { id: USER_ID, permissions: perms };
    const dto = { type: 'EXTENSION' as const, requestedDueAt: '2026-10-20T13:00:00.000Z', reason: 'Lab is late' };

    await controller.createRequest('task-1', dto, TENANT_ID, USER_ID);
    expect(requests.create).toHaveBeenCalledWith('task-1', dto, USER_ID, TENANT_ID);

    await controller.withdrawRequest('task-1', 'req-1', TENANT_ID, USER_ID);
    expect(requests.withdraw).toHaveBeenCalledWith('task-1', 'req-1', USER_ID, TENANT_ID);

    await controller.approveRequest('task-1', 'req-1', { note: 'ok' }, TENANT_ID, USER_ID, perms);
    expect(requests.approve).toHaveBeenCalledWith('task-1', 'req-1', { note: 'ok' }, viewer, TENANT_ID);

    await controller.declineRequest('task-1', 'req-1', { note: 'no' }, TENANT_ID, USER_ID, perms);
    expect(requests.decline).toHaveBeenCalledWith('task-1', 'req-1', { note: 'no' }, viewer, TENANT_ID);

    await controller.resume('task-1', TENANT_ID, USER_ID, perms);
    expect(requests.resume).toHaveBeenCalledWith('task-1', viewer, TENANT_ID);

    await controller.getAwaitingDecision(TENANT_ID, USER_ID, perms);
    expect(requests.awaitingDecision).toHaveBeenCalledWith(viewer, TENANT_ID);
  });

  // ACC-174 — New task's preview names no task, so it is gated like creating
  // one: clause (a), a 403 naming the permission.
  it('the New task SLA preview requires tasks:create', () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getSlaPreview)).toEqual(['tasks:create']);
  });

  it("the creator's routes delegate with the caller, their permissions and the tenant", async () => {
    const perms = ['tasks:reassign'];
    const viewer = { id: USER_ID, permissions: perms };

    await controller.update('task-1', { priority: 'HIGH' }, TENANT_ID, USER_ID, perms);
    expect(service.update).toHaveBeenCalledWith('task-1', { priority: 'HIGH' }, viewer, TENANT_ID);

    await controller.cancel('task-1', { reason: 'No longer needed' }, TENANT_ID, USER_ID, perms);
    expect(service.cancel).toHaveBeenCalledWith('task-1', { reason: 'No longer needed' }, viewer, TENANT_ID);

    await controller.reopen('task-1', { reason: 'Evidence is wrong' }, TENANT_ID, USER_ID, perms);
    expect(service.reopen).toHaveBeenCalledWith('task-1', { reason: 'Evidence is wrong' }, viewer, TENANT_ID);

    await controller.getTaskSlaPreview('task-1', TENANT_ID, USER_ID, perms);
    expect(service.slaPreviewForTask).toHaveBeenCalledWith('task-1', viewer, TENANT_ID);

    await controller.getSlaPreview(TENANT_ID);
    expect(service.slaPreview).toHaveBeenCalledWith(TENANT_ID);
  });
});
