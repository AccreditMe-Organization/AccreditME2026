// ACC-167 — every static GET under /tasks reaches its own handler, and none is
// swallowed by GET /tasks/:id.
//
// WHY THIS NEEDS A REAL HTTP APP. Nest matches routes in declaration order, so
// a static route declared after ':id' is captured by it with the segment as an
// id ("available", "assignment"…). A controller unit test calls methods
// directly and cannot see that at all. This boots the real controller behind
// the real PermissionGuard and calls each path over HTTP.
//
// WHY THE CALLER HOLDS NO PERMISSION. GET /tasks/:id requires tasks:view, so a
// path it swallowed would answer 403 here, and the handler it should have
// reached would not run. The new routes carry no route permission, so they
// answer 200. Each test checks BOTH the delegate that ran and that the ':id'
// handler did not — the control test pins that ':id' really refuses this
// caller, so a 200 below cannot mean "':id' let it through".
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';
import { TaskAssignmentService } from './task-assignment.service';

describe('Task routes — static paths are not swallowed by :id (ACC-167)', () => {
  let app: INestApplication<App>;
  const taskService = {
    getMyTasks: jest.fn().mockResolvedValue([]),
    getAvailableToPick: jest.fn().mockResolvedValue([]),
    listUnassigned: jest.fn().mockResolvedValue([]),
    getByIdForViewer: jest.fn().mockResolvedValue({}),
    pick: jest.fn().mockResolvedValue({}),
    release: jest.fn().mockResolvedValue({}),
  };
  const assignment = {
    listUnits: jest.fn().mockResolvedValue([]),
    listPositions: jest.fn().mockResolvedValue([]),
    listHolders: jest.fn().mockResolvedValue([]),
    listCommitteeRoles: jest.fn().mockResolvedValue([]),
    listCommitteeMembers: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        { provide: TaskService, useValue: taskService },
        { provide: TaskAssignmentService, useValue: assignment },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ tenantId: string; userId: string; userPermissions: string[] }>();
          req.tenantId = 'org-a';
          req.userId = 'user-1';
          req.userPermissions = [];
          return true;
        },
      })
      .compile();
    // PermissionGuard is deliberately NOT overridden.
    expect(moduleRef.get(PermissionGuard, { strict: false })).toBeDefined();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('control: GET /tasks/:id refuses this caller, so a swallowed path would be a 403', async () => {
    const res = await request(app.getHttpServer()).get('/tasks/task-1');

    expect(res.status).toBe(403);
    expect(taskService.getByIdForViewer).not.toHaveBeenCalled();
  });

  it.each([
    ['/tasks/available', () => taskService.getAvailableToPick],
    ['/tasks/assignment/units', () => assignment.listUnits],
    ['/tasks/assignment/positions?orgUnitId=u1', () => assignment.listPositions],
    ['/tasks/assignment/committee-roles?committeeId=c1', () => assignment.listCommitteeRoles],
    ['/tasks/assignees/committee?committeeId=c1&roleValueId=r1', () => assignment.listCommitteeMembers],
    ['/tasks/assignees?orgUnitId=u1&positionId=p1', () => assignment.listHolders],
    ['/tasks/my-tasks', () => taskService.getMyTasks],
  ])('GET %s reaches its own handler', async (path, delegate) => {
    const res = await request(app.getHttpServer()).get(path);

    expect(res.status).toBe(200);
    expect(delegate()).toHaveBeenCalledTimes(1);
    expect(taskService.getByIdForViewer).not.toHaveBeenCalled();
  });

  it('forwards the query parameters, so the handler reached is the one that reads them', async () => {
    await request(app.getHttpServer()).get('/tasks/assignees?orgUnitId=u1&positionId=p1&taskId=t1');

    expect(assignment.listHolders).toHaveBeenCalledWith(
      { id: 'user-1', permissions: [] },
      'org-a',
      'u1',
      'p1',
      't1',
    );
  });

  it.each([
    ['/tasks/task-1/pick', () => taskService.pick],
    ['/tasks/task-1/release', () => taskService.release],
  ])('POST %s reaches its handler with no route permission', async (path, delegate) => {
    const res = await request(app.getHttpServer()).post(path).send({ reason: 'Back to the pool' });

    expect(res.status).toBe(201);
    expect(delegate()).toHaveBeenCalledTimes(1);
  });
});
