import { Test, TestingModule } from '@nestjs/testing';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { ITask } from './interfaces/task.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

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
  escalationUserId: null,
  escalationAfterHours: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('TaskController', () => {
  let controller: TaskController;
  let service: {
    getMyTasks: jest.Mock;
    getForSource: jest.Mock;
    getById: jest.Mock;
    create: jest.Mock;
    complete: jest.Mock;
    reassign: jest.Mock;
    addEvidence: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getMyTasks: jest.fn().mockResolvedValue([MOCK_TASK]),
      getForSource: jest.fn().mockResolvedValue([MOCK_TASK]),
      getById: jest.fn().mockResolvedValue(MOCK_TASK),
      create: jest.fn().mockResolvedValue(MOCK_TASK),
      complete: jest.fn().mockResolvedValue({ ...MOCK_TASK, status: 'COMPLETED' }),
      reassign: jest.fn().mockResolvedValue(MOCK_TASK),
      addEvidence: jest.fn().mockResolvedValue({ id: 'evidence-1' }),
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

  it('getMyTasks delegates to the service', async () => {
    const result = await controller.getMyTasks(TENANT_ID, USER_ID, 'PENDING');

    expect(service.getMyTasks).toHaveBeenCalledWith(USER_ID, TENANT_ID, { status: 'PENDING' });
    expect(result).toEqual([MOCK_TASK]);
  });

  it('getForSource delegates to the service', async () => {
    const result = await controller.getForSource(TENANT_ID, 'DOCUMENT', 'doc-1');

    expect(service.getForSource).toHaveBeenCalledWith('DOCUMENT', 'doc-1', TENANT_ID);
    expect(result).toEqual([MOCK_TASK]);
  });

  it('getById delegates to the service', async () => {
    const result = await controller.getById('task-1', TENANT_ID);

    expect(service.getById).toHaveBeenCalledWith('task-1', TENANT_ID);
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

  it('reassign delegates to the service with tenant and actor', async () => {
    const dto = { newAssigneeUserIds: ['u2'], reason: 'Ahmad is on leave' };
    await controller.reassign('task-1', dto, TENANT_ID, USER_ID);

    expect(service.reassign).toHaveBeenCalledWith('task-1', dto, TENANT_ID, USER_ID);
  });

  it('addEvidence delegates to the service with tenant and actor', async () => {
    const dto = { type: 'TEXT' as const, content: 'Done' };
    const result = await controller.addEvidence('task-1', dto, TENANT_ID, USER_ID);

    expect(service.addEvidence).toHaveBeenCalledWith('task-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual({ id: 'evidence-1' });
  });
});
