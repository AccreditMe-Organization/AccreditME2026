import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { TaskController } from './task.controller';
import { TaskWorkloadService } from './workload/task-workload.service';
import { WorkloadHintService } from './workload/workload-hint.service';
import { TaskService } from './task.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskRequestService } from './task-request.service';
import { TaskEvidenceService } from './task-evidence.service';
import { TaskDraftService } from '../ai-task-draft/task-draft.service';
import { TaskPageService } from './task-page.service';
import { RATE_LIMITS } from '../../common/throttle/rate-limits';
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
  workflowInstanceStageId: null,
  stageTaskDefinitionId: null,
  isMandatory: false,
  titleAr: null,
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
    listCommitteeRoleCatalogue: jest.Mock;
    listCommitteeMembers: jest.Mock;
  };

  // ACC-199 — the people lists go through the workload service (counts on
  // the record); "Suggest someone" through the hint service.
  const workload = {
    listHolders: jest.fn().mockResolvedValue([]),
    listCommitteeMembers: jest.fn().mockResolvedValue([]),
  };
  const workloadHint = {
    availability: jest.fn().mockResolvedValue({ available: true }),
    suggest: jest.fn().mockResolvedValue({}),
  };

  // ACC-177 — file evidence, the evidence list, downloads and deletes.
  // ACC-197
  const drafts = {
    availability: jest.fn().mockResolvedValue({ available: true }),
    draft: jest.fn().mockResolvedValue({ draftId: 'log-1', title: null, lines: [], description: '' }),
  };
  const evidence = {
    addFile: jest.fn().mockResolvedValue({ id: 'evidence-2' }),
    list: jest.fn().mockResolvedValue({ items: [], canAdd: true }),
    download: jest.fn().mockResolvedValue({ url: 'https://signed', viaApi: false, expiresAt: '2026-10-07T10:15:00.000Z' }),
    openView: jest.fn().mockResolvedValue({ url: 'https://signed', viaApi: false, expiresAt: '2026-10-07T10:15:00.000Z' }),
    remove: jest.fn().mockResolvedValue(undefined),
    getSummary: jest.fn().mockResolvedValue({ available: true, inProgress: false, summary: null }),
    makeSummary: jest.fn().mockResolvedValue({ available: true, inProgress: false, summary: null }),
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
      listCommitteeRoleCatalogue: jest.fn().mockResolvedValue([]),
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
        { provide: TaskEvidenceService, useValue: evidence },
        { provide: TaskDraftService, useValue: drafts },
        { provide: TaskWorkloadService, useValue: workload },
        { provide: WorkloadHintService, useValue: workloadHint },
        { provide: TaskPageService, useValue: { view: jest.fn(), history: jest.fn() } },
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

  // ACC-197 — "Draft with AI" is gated like creating a task, both routes.
  describe('task drafting (ACC-197)', () => {
    it('both draft routes require tasks:create', () => {
      const reflector = new Reflector();
      expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getDraftAvailability)).toEqual([TASKS_PERMISSIONS.CREATE]);
      expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.draft)).toEqual([TASKS_PERMISSIONS.CREATE]);
    });

    it('POST /tasks/draft carries its own per-user limit: ten a minute (Q3)', () => {
      const handler = Object.getOwnPropertyDescriptor(TaskController.prototype, 'draft')!.value as object;
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(RATE_LIMITS.taskDraft.limit);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(RATE_LIMITS.taskDraft.ttl);
      expect(RATE_LIMITS.taskDraft).toEqual({ limit: 10, ttl: 60_000 });
    });

    it("availability is asked for the caller’s own organisation", async () => {
      await expect(controller.getDraftAvailability('org-a')).resolves.toEqual({ available: true });
      expect(drafts.availability).toHaveBeenCalledWith('org-a');
    });

    it('draft forwards the caller, their permissions and their organisation — never one from the body', async () => {
      const dto = { note: 'follow up hand rub stock', language: 'en' as const, sourceType: 'COMMITTEE' as const, sourceId: 'c1' };
      await controller.draft(dto, 'org-a', 'user-1', ['tasks:create', 'committees:view']);
      expect(drafts.draft).toHaveBeenCalledWith({ id: 'user-1', permissions: ['tasks:create', 'committees:view'] }, 'org-a', dto);
    });
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

  // ACC-228 — the task page is relationship-scoped (Q4): an assignee without
  // tasks:view opens their own task, so no route permission may sit in front.
  it('the task page routes carry no route permission', () => {
    const reflector = new Reflector();
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getPage)).toBeUndefined();
    expect(reflector.get(PERMISSIONS_KEY, TaskController.prototype.getHistory)).toBeUndefined();
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

  // ACC-177 — the evidence routes carry no route permission: who may is
  // decided from the task row, exactly as addEvidence() is.
  it.each(['addFileEvidence', 'listEvidence', 'downloadEvidence', 'viewEvidence', 'removeEvidence', 'getEvidenceSummary', 'makeEvidenceSummary'] as const)(
    '%s requires NO route permission — the service decides from the task',
    (method) => {
      const required = new Reflector().get<string[] | undefined>(PERMISSIONS_KEY, TaskController.prototype[method]);
      expect(required).toBeUndefined();
    },
  );

  it('the evidence routes delegate with the tenant and the caller', async () => {
    const file = { originalname: 'minutes.pdf', mimetype: 'application/pdf', size: 4, buffer: Buffer.from('%PDF') };
    await controller.addFileEvidence('task-1', file, TENANT_ID, USER_ID);
    expect(evidence.addFile).toHaveBeenCalledWith('task-1', file, TENANT_ID, USER_ID);

    await controller.listEvidence('task-1', TENANT_ID, USER_ID, VIEWER_PERMISSIONS);
    expect(evidence.list).toHaveBeenCalledWith('task-1', TENANT_ID, { id: USER_ID, permissions: VIEWER_PERMISSIONS });

    await controller.downloadEvidence('task-1', 'ev-1', TENANT_ID, USER_ID, VIEWER_PERMISSIONS);
    expect(evidence.download).toHaveBeenCalledWith('task-1', 'ev-1', TENANT_ID, { id: USER_ID, permissions: VIEWER_PERMISSIONS });

    // ACC-189 — the viewer's mint takes exactly what the download takes.
    await controller.viewEvidence('task-1', 'ev-1', TENANT_ID, USER_ID, VIEWER_PERMISSIONS);
    expect(evidence.openView).toHaveBeenCalledWith('task-1', 'ev-1', TENANT_ID, { id: USER_ID, permissions: VIEWER_PERMISSIONS });

    await controller.removeEvidence('task-1', 'ev-1', TENANT_ID, USER_ID);
    expect(evidence.remove).toHaveBeenCalledWith('task-1', 'ev-1', TENANT_ID, USER_ID);

    // ACC-193 — the AI summary takes exactly what the view takes, plus the reader's language.
    await controller.getEvidenceSummary('task-1', 'ev-1', { language: 'ar' }, TENANT_ID, USER_ID, VIEWER_PERMISSIONS);
    expect(evidence.getSummary).toHaveBeenCalledWith('task-1', 'ev-1', TENANT_ID, { id: USER_ID, permissions: VIEWER_PERMISSIONS }, 'ar');
    await controller.makeEvidenceSummary('task-1', 'ev-1', { language: 'en' }, TENANT_ID, USER_ID, VIEWER_PERMISSIONS);
    expect(evidence.makeSummary).toHaveBeenCalledWith('task-1', 'ev-1', TENANT_ID, { id: USER_ID, permissions: VIEWER_PERMISSIONS }, 'en');
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
    expect(workload.listHolders).toHaveBeenCalledWith(viewer, TENANT_ID, {
      orgUnitId: 'u1',
      positionId: 'p1',
      taskId: undefined,
      record: null,
    });
    // ACC-199 — a record named whole reaches the service; half a record is no record.
    await controller.getAssignees(
      { orgUnitId: 'u1', positionId: 'p1', sourceType: 'COMMITTEE', sourceId: 'c1' },
      TENANT_ID,
      USER_ID,
      perms,
    );
    expect(workload.listHolders).toHaveBeenLastCalledWith(viewer, TENANT_ID, {
      orgUnitId: 'u1',
      positionId: 'p1',
      taskId: undefined,
      record: { sourceType: 'COMMITTEE', sourceId: 'c1' },
    });
    await controller.getAssignees({ orgUnitId: 'u1', positionId: 'p1', sourceType: 'COMMITTEE' }, TENANT_ID, USER_ID, perms);
    expect(workload.listHolders).toHaveBeenLastCalledWith(viewer, TENANT_ID, expect.objectContaining({ record: null }));

    await controller.getAssignableCommitteeRoles({ committeeId: 'c1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listCommitteeRoles).toHaveBeenCalledWith(viewer, TENANT_ID, 'c1', undefined);
    expect(assignment.listCommitteeRoleCatalogue).not.toHaveBeenCalled();

    // ACC-208 (B5) — catalogue goes to its own method, with or without a committee.
    await controller.getAssignableCommitteeRoles({ catalogue: true }, TENANT_ID, USER_ID, perms);
    expect(assignment.listCommitteeRoleCatalogue).toHaveBeenCalledWith(viewer, TENANT_ID, undefined, undefined);
    await controller.getAssignableCommitteeRoles({ catalogue: true, committeeId: 'c1' }, TENANT_ID, USER_ID, perms);
    expect(assignment.listCommitteeRoleCatalogue).toHaveBeenCalledWith(viewer, TENANT_ID, 'c1', undefined);
    expect(assignment.listCommitteeRoles).toHaveBeenCalledTimes(1);

    await controller.getCommitteeAssignees({ committeeId: 'c1', roleValueId: 'r1' }, TENANT_ID, USER_ID, perms);
    expect(workload.listCommitteeMembers).toHaveBeenCalledWith(viewer, TENANT_ID, {
      committeeId: 'c1',
      roleValueId: 'r1',
      taskId: undefined,
      record: null,
    });
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
    expect(service.slaPreviewForTask).toHaveBeenCalledWith('task-1', viewer, TENANT_ID, false);

    await controller.getTaskSlaPreview('task-1', TENANT_ID, USER_ID, perms, 'true');
    expect(service.slaPreviewForTask).toHaveBeenLastCalledWith('task-1', viewer, TENANT_ID, true);

    await controller.getSlaPreview(TENANT_ID);
    expect(service.slaPreview).toHaveBeenCalledWith(TENANT_ID);
  });
});
