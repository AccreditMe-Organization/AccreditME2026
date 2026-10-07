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
import { TaskRequestService } from './task-request.service';
import { TaskEvidenceService } from './task-evidence.service';

describe('Task routes — static paths are not swallowed by :id (ACC-167)', () => {
  let app: INestApplication<App>;
  const taskService = {
    getMyTasks: jest.fn().mockResolvedValue([]),
    getAvailableToPick: jest.fn().mockResolvedValue([]),
    listUnassigned: jest.fn().mockResolvedValue([]),
    getByIdForViewer: jest.fn().mockResolvedValue({}),
    pick: jest.fn().mockResolvedValue({}),
    release: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    cancel: jest.fn().mockResolvedValue({}),
    reopen: jest.fn().mockResolvedValue({}),
    slaPreview: jest.fn().mockResolvedValue({}),
    slaPreviewForTask: jest.fn().mockResolvedValue({}),
  };
  const requests = {
    create: jest.fn().mockResolvedValue({}),
    withdraw: jest.fn().mockResolvedValue({}),
    approve: jest.fn().mockResolvedValue({}),
    decline: jest.fn().mockResolvedValue({}),
    resume: jest.fn().mockResolvedValue({}),
    awaitingDecision: jest.fn().mockResolvedValue([]),
  };
  // ACC-177
  const evidence = {
    addFile: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    list: jest.fn().mockResolvedValue({ items: [], canAdd: false }),
    download: jest.fn().mockResolvedValue({ url: 'https://signed', viaApi: false, expiresAt: '' }),
    remove: jest.fn().mockResolvedValue(undefined),
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
        { provide: TaskRequestService, useValue: requests },
        { provide: TaskEvidenceService, useValue: evidence },
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
    // ACC-173
    ['/tasks/requests/awaiting-decision', () => requests.awaitingDecision],
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
    // ACC-173 — the service decides who may; none carries a route permission.
    ['/tasks/task-1/requests', () => requests.create],
    ['/tasks/task-1/requests/req-1/withdraw', () => requests.withdraw],
    ['/tasks/task-1/requests/req-1/approve', () => requests.approve],
    ['/tasks/task-1/requests/req-1/decline', () => requests.decline],
    ['/tasks/task-1/resume', () => requests.resume],
    // ACC-174 — the creator's actions; the service decides who may.
    ['/tasks/task-1/cancel', () => taskService.cancel],
    ['/tasks/task-1/reopen', () => taskService.reopen],
  ])('POST %s reaches its handler with no route permission', async (path, delegate) => {
    const res = await request(app.getHttpServer()).post(path).send({ reason: 'Back to the pool' });

    expect(res.status).toBe(201);
    expect(delegate()).toHaveBeenCalledTimes(1);
  });

  // ACC-174 — the New task preview is gated by tasks:create, which this caller
  // lacks. A refusal NAMING tasks:create proves the static path reached its own
  // handler's guard: swallowed by ':id', it would name tasks:view.
  it('GET /tasks/sla-preview is its own route, gated by tasks:create', async () => {
    const res = await request(app.getHttpServer()).get('/tasks/sla-preview');

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('tasks:create');
    expect(taskService.getByIdForViewer).not.toHaveBeenCalled();
  });

  it('GET /tasks/:id/sla-preview and PATCH /tasks/:id reach their handlers with no route permission', async () => {
    const preview = await request(app.getHttpServer()).get('/tasks/task-1/sla-preview');
    expect(preview.status).toBe(200);
    expect(taskService.slaPreviewForTask).toHaveBeenCalledTimes(1);

    const edit = await request(app.getHttpServer()).patch('/tasks/task-1').send({ title: 'Renamed' });
    expect(edit.status).toBe(200);
    expect(taskService.update).toHaveBeenCalledTimes(1);
  });

  // ACC-177 — the evidence routes reach their own handlers, with no route
  // permission (this caller holds none); a path swallowed by ':id' would be a
  // 403 naming tasks:view.
  it('GET /tasks/:id/evidence and its download reach their handlers with no route permission', async () => {
    const list = await request(app.getHttpServer()).get('/tasks/task-1/evidence');
    expect(list.status).toBe(200);
    expect(evidence.list).toHaveBeenCalledWith('task-1', 'org-a', { id: 'user-1', permissions: [] });

    const download = await request(app.getHttpServer()).get('/tasks/task-1/evidence/ev-1/download');
    expect(download.status).toBe(200);
    expect(evidence.download).toHaveBeenCalledTimes(1);
    expect(taskService.getByIdForViewer).not.toHaveBeenCalled();
  });

  it('DELETE /tasks/:id/evidence/:evidenceId reaches its handler and answers 204', async () => {
    const res = await request(app.getHttpServer()).delete('/tasks/task-1/evidence/ev-1');
    expect(res.status).toBe(204);
    expect(evidence.remove).toHaveBeenCalledWith('task-1', 'ev-1', 'org-a', 'user-1');
  });

  // ACC-177 — the upload transport, over real multipart, through the real
  // interceptor. The service is mocked; what is under test is what reaches it.
  describe('POST /tasks/:id/evidence/file', () => {
    const originalCap = process.env['MAX_UPLOAD_MB'];
    afterEach(() => {
      if (originalCap === undefined) delete process.env['MAX_UPLOAD_MB'];
      else process.env['MAX_UPLOAD_MB'] = originalCap;
    });

    it('hands the service the file with its Arabic name intact', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks/task-1/evidence/file')
        .attach('file', Buffer.from('%PDF-1.7 test'), { filename: 'محضر الاجتماع.pdf', contentType: 'application/pdf' });

      expect({ status: res.status, body: res.body }).toEqual(expect.objectContaining({ status: 201 }));
      const [taskId, file, tenant, user] = evidence.addFile.mock.calls[0] as [string, { originalname: string; buffer: Buffer }, string, string];
      expect([taskId, tenant, user]).toEqual(['task-1', 'org-a', 'user-1']);
      expect(file.originalname).toBe('محضر الاجتماع.pdf');
      expect(file.buffer.toString()).toBe('%PDF-1.7 test');
    });

    it('refuses a file over the cap with FILE_TOO_LARGE and the cap, before the service runs', async () => {
      process.env['MAX_UPLOAD_MB'] = '0.001'; // 1048 bytes
      const res = await request(app.getHttpServer())
        .post('/tasks/task-1/evidence/file')
        .attach('file', Buffer.alloc(2_000, 0x41), { filename: 'big.txt', contentType: 'text/plain' });

      expect(res.status).toBe(413);
      expect(res.body).toEqual(expect.objectContaining({ code: 'FILE_TOO_LARGE', maxBytes: 1048 }));
      expect(evidence.addFile).not.toHaveBeenCalled();
    });

    it('refuses a second file, or an extra field', async () => {
      const twoFiles = await request(app.getHttpServer())
        .post('/tasks/task-1/evidence/file')
        .attach('file', Buffer.from('a'), 'a.txt')
        .attach('file', Buffer.from('b'), 'b.txt');
      expect(twoFiles.status).toBe(400);

      const extraField = await request(app.getHttpServer())
        .post('/tasks/task-1/evidence/file')
        .field('path', '../../etc/passwd')
        .attach('file', Buffer.from('a'), 'a.txt');
      expect(extraField.status).toBe(400);
      expect(evidence.addFile).not.toHaveBeenCalled();
    });

    it('a request with no file reaches the service with none, which refuses it', async () => {
      const res = await request(app.getHttpServer()).post('/tasks/task-1/evidence/file').send({});
      expect(res.status).toBe(201); // the mocked service accepted; the real one answers FILE_MISSING
      expect(evidence.addFile.mock.calls[0]![1]).toBeUndefined();
    });
  });
});
