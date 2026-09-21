// ACC-101 — the defect test, written and observed FAILING before the check
// existed. See the ticket for the full report; the defect in one line:
//
//   GET /tasks?sourceType=COMMITTEE&sourceId=… returns a committee's tasks,
//   with assignee names and delegation labels, to any caller holding
//   tasks:view — with no check that they may see the committee.
//
// WHY THIS IS AN HTTP-LEVEL TEST rather than a service unit test. The rule
// being proven is "the child gate is necessary and no longer sufficient", and
// both gates only exist together at the route: PermissionGuard reads
// @Permissions() metadata, the parent check reads the caller's permission set.
// A service test would assert the second half against a signature it also
// defines, and could not show the first half passing at all.
//
// THE SUBJECT IS CONSTRUCTED DELIBERATELY, because the obvious subject proves
// nothing. A caller holding NO role is refused by the CHILD gate, identically
// before and after this change, and a test using one would pass for the wrong
// reason forever. So the subject here holds tasks:view and lacks
// committees:view: PermissionGuard admits it, and the only thing left that can
// refuse it is the parent check.
//
// This paragraph used to say "on dev, 45 of 47 tenant users hold no role at
// all", which was the state that forced the construction. ACC-107 ended it —
// every seeded system role now has a credentialed holder — so the fact is
// corrected here rather than left to read as current. The construction itself
// is unchanged and still right: this spec must not depend on seed data, which
// it does not, and picking a real persona would tie an authorization proof to
// a fixture that is free to change.
//
// The two control tests below exist to keep that true. They fail if the harness
// ever stops exercising the real guard, and they distinguish the two refusals
// BY MESSAGE, not merely by status — both are 403, and reading them as
// interchangeable is how this test would quietly stop testing anything.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TenantService } from '../tenant/tenant.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { TaskController } from './task.controller';
import { TaskService } from './task.service';

const TENANT_ID = 'org-a';
const COMMITTEE_ID = 'committee-1';
const CALLER_ID = 'user-caller';

// The payload the defect exposes: a name, and a delegation label that says who
// is absent. Present in the mock so a regression shows what actually leaks.
const TASK_ROW = {
  id: 'task-1',
  organizationId: TENANT_ID,
  title: 'Approve Q3 minutes',
  sourceType: 'COMMITTEE',
  sourceId: COMMITTEE_ID,
  assignees: [
    {
      userId: 'user-assignee',
      removedAt: null,
      delegationReason: 'OUT_OF_OFFICE_COVERAGE',
      delegationContextId: 'user-absent',
      user: { id: 'user-assignee', name: 'Sara Al-Otaibi' },
    },
  ],
};

describe('Child list gated by its parent (ACC-101)', () => {
  let app: INestApplication<App>;
  // Mutable so each test picks its own subject without rebuilding the app.
  let callerPermissions: string[];
  // Held so a test can make the same id resolve to nothing, for the
  // hidden-versus-missing comparison.
  let prismaRef: { task: { findMany: jest.Mock; findFirst: jest.Mock } };

  beforeEach(async () => {
    callerPermissions = [];

    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([TASK_ROW]),
        findFirst: jest.fn().mockResolvedValue(TASK_ROW),
      },
      // The committee EXISTS and belongs to this tenant: the refusal under test
      // must be about entitlement, never about a missing record.
      committee: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: COMMITTEE_ID, organizationId: TENANT_ID, nameEn: 'Quality Committee' }),
      },
      orgUnit: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-absent', name: 'Ahmad Al-Najjar' }]) },
    };
    prismaRef = prisma as unknown as typeof prismaRef;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        TaskService,
        DelegationLabelService,
        // REAL, not a stub: the refusal under test is this service's, and a
        // stub here would leave the test asserting its own mock.
        ObjectVisibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: WorkingCalendarService, useValue: { calculateDeadline: jest.fn() } },
        { provide: TenantService, useValue: { getTaskSlaSettings: jest.fn() } },
      ],
    })
      // TenantGuard alone is replaced — it does JWT and database work this test
      // has no opinion about. PermissionGuard stays REAL, so the child gate is
      // genuinely exercised rather than assumed.
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{
            tenantId: string;
            userId: string;
            userPermissions: string[];
          }>();
          req.tenantId = TENANT_ID;
          req.userId = CALLER_ID;
          req.userPermissions = callerPermissions;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const getCommitteeTasks = () =>
    request(app.getHttpServer()).get(`/tasks?sourceType=COMMITTEE&sourceId=${COMMITTEE_ID}`);

  // THE DEFECT TEST.
  it("refuses a committee's tasks to a caller who holds tasks:view but cannot see the committee", async () => {
    callerPermissions = ['tasks:view'];

    const response = await getCommitteeTasks();

    expect(response.status).toBe(403);
    // Not the child gate's message — see the control below. If this assertion
    // ever reads "Required permission: tasks:view", the subject has lost the
    // permission that makes this test discriminating.
    expect(response.body.message).toContain('committees:view');
    expect(JSON.stringify(response.body)).not.toContain('Sara Al-Otaibi');
    expect(JSON.stringify(response.body)).not.toContain('Ahmad Al-Najjar');
  });

  // THE OTHER SHAPE OF ENDPOINT. GET /tasks/:id cannot check before reading —
  // a task's parent is only knowable from the row — so its refusal is shaped as
  // NOT-FOUND, identical to an id with nothing behind it. Otherwise a caller
  // holding a task id from a link, a log or an export learns the task exists
  // and is hidden from them, which is the fact the check exists to withhold.
  //
  // The whole response is compared, not the status: a body naming the parent
  // type or the required permission would rebuild the oracle in the body after
  // closing it in the status.
  it('answers identically for a task hidden behind its parent and a task that does not exist', async () => {
    callerPermissions = ['tasks:view'];
    prismaRef.task.findFirst.mockResolvedValue(TASK_ROW);

    const hidden = await request(app.getHttpServer()).get(`/tasks/${TASK_ROW.id}`);

    prismaRef.task.findFirst.mockResolvedValue(null);
    const missing = await request(app.getHttpServer()).get('/tasks/no-such-task');

    expect(hidden.status).toBe(404);
    expect(hidden.status).toBe(missing.status);
    expect(hidden.body).toEqual(missing.body);
    expect(JSON.stringify(hidden.body)).not.toContain('committees:view');
    expect(JSON.stringify(hidden.body)).not.toContain('Sara Al-Otaibi');
  });

  // CONTROL — the same read succeeds for a caller entitled to the parent, so
  // the 404 above is a refusal rather than a broken fixture.
  it('serves the single task to a caller who can see its parent', async () => {
    callerPermissions = ['tasks:view', 'committees:view'];
    prismaRef.task.findFirst.mockResolvedValue(TASK_ROW);

    const response = await request(app.getHttpServer()).get(`/tasks/${TASK_ROW.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(TASK_ROW.id);
  });

  // CONTROL 1 — the child gate still works, and refuses with its own message.
  // Passes before and after the fix; its job is to prove the two refusals are
  // distinguishable.
  it('refuses a caller holding no permissions at all, at the child gate', async () => {
    callerPermissions = [];

    const response = await getCommitteeTasks();

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('tasks:view');
  });

  // CONTROL 2 — the harness can return 200, so the 403 above is a real refusal
  // and not a broken test fixture. Passes before and after the fix.
  it('returns the tasks to a caller who holds both the child and the parent permission', async () => {
    callerPermissions = ['tasks:view', 'committees:view'];

    const response = await getCommitteeTasks();

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].assignees[0].userName).toBe('Sara Al-Otaibi');

    // ACC-101 — but NOT the delegation label. This caller can see the committee
    // and its tasks; they hold no users:view, so they are not told which
    // colleague is absent. The assignee's own name is part of the task (it is
    // who owes the work); the absent third party is not.
    expect(response.body[0].assignees[0].delegation).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('Ahmad Al-Najjar');
  });

  it('gives the delegation label to a caller who may also see the person it names', async () => {
    callerPermissions = ['tasks:view', 'committees:view', 'users:view'];

    const response = await getCommitteeTasks();

    expect(response.status).toBe(200);
    expect(response.body[0].assignees[0].delegation.contextLabelEn).toBe('Ahmad Al-Najjar');
  });
});
