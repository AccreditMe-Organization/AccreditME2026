import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
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
    reassign: jest.Mock;
    addEvidence: jest.Mock;
    listUnassigned: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getMyTasks: jest.fn().mockResolvedValue([MOCK_TASK]),
      getForSource: jest.fn().mockResolvedValue([MOCK_TASK]),
      getById: jest.fn().mockResolvedValue(MOCK_TASK),
      getByIdForViewer: jest.fn().mockResolvedValue(MOCK_TASK),
      create: jest.fn().mockResolvedValue(MOCK_TASK),
      complete: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'COMPLETED' }),
      start: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'IN_PROGRESS' }),
      reject: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'REJECTED' }),
      reassign: jest.fn().mockResolvedValue(MOCK_TASK),
      addEvidence: jest.fn().mockResolvedValue({ id: 'evidence-1' }),
      listUnassigned: jest.fn().mockResolvedValue([{ ...MOCK_TASK, status: 'UNASSIGNED' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [{ provide: TaskService, useValue: service }],
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
    const result = await controller.getMyTasks(TENANT_ID, USER_ID, query);

    expect(service.getMyTasks).toHaveBeenCalledWith(USER_ID, TENANT_ID, query);
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
});
