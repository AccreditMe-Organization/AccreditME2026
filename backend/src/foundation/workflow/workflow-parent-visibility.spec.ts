// ACC-101 — the same defect as task-parent-visibility.spec.ts, on the workflow
// reads. Written and run against the unmodified service first; the recorded
// failures are in the commit that added the check.
//
// GET /workflows/instances?objectType=COMMITTEE&objectId=… and
// GET /workflows/instances/:id/stage-history were governed by workflows:view
// alone. Stage history is the richer of the two: it names WHO acted at each
// stage and resolves ACC-40's delegation stamps, so it discloses more about a
// committee than the committee list does — behind a permission that says
// nothing about committees.
//
// SUBJECT, constructed the same way as the task test and for the same reason:
// it HOLDS workflows:view and LACKS committees:view. PermissionGuard admits it,
// so only the parent check can refuse it. A caller holding nothing would be
// refused identically before and after this change and would prove nothing.
//
// Both refusals are 403, so every assertion here reads the MESSAGE. That is the
// difference between testing a gate and testing a status code.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { OrganizationService } from '../organization/organization.service';
import { RoleService } from '../roles/role.service';
import { TaskService } from '../task/task.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

const TENANT_ID = 'org-a';
const COMMITTEE_ID = 'committee-1';
const INSTANCE_ID = 'instance-1';

const INSTANCE_ROW = {
  id: INSTANCE_ID,
  organizationId: TENANT_ID,
  workflowTemplateId: 'template-1',
  objectType: 'COMMITTEE',
  objectId: COMMITTEE_ID,
  currentStageId: 'stage-1',
  status: 'ACTIVE',
  startedById: 'user-starter',
  startedAt: new Date('2026-09-01'),
  completedAt: null,
  createdAt: new Date('2026-09-01'),
  updatedAt: new Date('2026-09-01'),
};

describe('Workflow reads gated by their parent object (ACC-101)', () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];
  // Held so a test can make the same id resolve to nothing, for the
  // hidden-versus-missing comparison below.
  let prismaRef: { workflowInstance: { findFirst: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    callerPermissions = [];

    const prisma = {
      workflowInstance: {
        findFirst: jest.fn().mockResolvedValue(INSTANCE_ROW),
        findMany: jest.fn().mockResolvedValue([INSTANCE_ROW]),
      },
      workflowInstanceStage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'visit-1',
            workflowInstanceId: INSTANCE_ID,
            stageId: 'stage-1',
            actorId: 'user-actor',
            enteredAt: new Date('2026-09-01'),
            exitedAt: null,
            outcome: null,
            comment: null,
            delegationReason: null,
            delegationContextId: null,
            stage: { id: 'stage-1', nameEn: 'Formation', nameAr: 'التكوين' },
          },
        ]),
      },
      workflowStage: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'stage-1', nameEn: 'Formation', nameAr: 'التكوين', order: 1 }]),
      },
      workflowTransition: { findMany: jest.fn().mockResolvedValue([]) },
      // The actor name the history discloses — asserted absent on refusal.
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-actor', name: 'Dr. Hessa Al-Dosari' }]) },
      orgUnit: { findMany: jest.fn().mockResolvedValue([]) },
      committee: {
        findFirst: jest.fn().mockResolvedValue({ id: COMMITTEE_ID, organizationId: TENANT_ID }),
      },
      meeting: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    prismaRef = prisma as unknown as typeof prismaRef;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [
        WorkflowService,
        DelegationLabelService,
        // REAL — the refusal under test is this service's.
        ObjectVisibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: WorkingCalendarService, useValue: { calculateDeadline: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: TaskService, useValue: {} },
        { provide: RoleService, useValue: {} },
        { provide: OrganizationService, useValue: {} },
        { provide: getQueueToken('workflow-actions'), useValue: { add: jest.fn() } },
      ],
    })
      // PermissionGuard stays real; only TenantGuard is stubbed.
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{
            tenantId: string;
            userId: string;
            userPermissions: string[];
          }>();
          req.tenantId = TENANT_ID;
          req.userId = 'user-caller';
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

  const instancesByObject = () =>
    request(app.getHttpServer()).get(`/workflows/instances?objectType=COMMITTEE&objectId=${COMMITTEE_ID}`);
  const stageHistory = () =>
    request(app.getHttpServer()).get(`/workflows/instances/${INSTANCE_ID}/stage-history`);
  const instanceById = () => request(app.getHttpServer()).get(`/workflows/instances/${INSTANCE_ID}`);

  describe('a caller holding workflows:view but NOT committees:view', () => {
    beforeEach(() => {
      callerPermissions = ['workflows:view'];
    });

    it("refuses a committee's workflow instances", async () => {
      const response = await instancesByObject();

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('committees:view');
    });

    it("refuses a committee's stage history, and discloses no actor name", async () => {
      const response = await stageHistory();

      // 404, not 403 — read-first, so the refusal is shaped as not-found.
      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain('Dr. Hessa Al-Dosari');
      expect(JSON.stringify(response.body)).not.toContain('committees:view');
    });

    it('refuses the instance row itself, which names the object it belongs to', async () => {
      const response = await instanceById();

      expect(response.status).toBe(404);
      expect(JSON.stringify(response.body)).not.toContain(COMMITTEE_ID);
      expect(JSON.stringify(response.body)).not.toContain('committees:view');
    });
  });

  // THE ORACLE TEST. Both reads above must load the row before they can learn
  // which object it belongs to, so the refusal has to be indistinguishable from
  // not-found — otherwise a caller holding an id from a link, a log or an
  // export learns the record exists and is hidden from them.
  //
  // Compares the WHOLE response, not the status: a body naming the parent type
  // or the required permission would rebuild the oracle after the status closed
  // it.
  describe('a hidden record is indistinguishable from one that does not exist', () => {
    beforeEach(() => {
      callerPermissions = ['workflows:view'];
    });

    it('answers identically for an instance that exists behind a hidden parent and one that does not exist', async () => {
      const hidden = await instanceById();

      // Same caller, same endpoint, an id with nothing behind it.
      prismaRef.workflowInstance.findFirst.mockResolvedValue(null);
      const missing = await request(app.getHttpServer()).get('/workflows/instances/no-such-instance');

      expect(hidden.status).toBe(missing.status);
      expect(hidden.body).toEqual(missing.body);
    });

    it('answers identically for stage history, hidden versus missing', async () => {
      const hidden = await stageHistory();

      prismaRef.workflowInstance.findFirst.mockResolvedValue(null);
      const missing = await request(app.getHttpServer()).get(
        '/workflows/instances/no-such-instance/stage-history',
      );

      expect(hidden.status).toBe(missing.status);
      expect(hidden.body).toEqual(missing.body);
    });
  });

  // CONTROL — the child gate still refuses, with its OWN message. Distinguishes
  // the two 403s; passes before and after the check existed.
  it('refuses a caller holding no permissions at all, at the child gate', async () => {
    callerPermissions = [];

    const response = await stageHistory();

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('workflows:view');
    expect(response.body.message).not.toContain('committees:view');
  });

  // CONTROL — the harness can return 200, so the refusals above are real.
  it('serves a caller holding both the child and the parent permission', async () => {
    callerPermissions = ['workflows:view', 'committees:view'];

    const [instances, history] = await Promise.all([instancesByObject(), stageHistory()]);

    expect(instances.status).toBe(200);
    expect(instances.body).toHaveLength(1);
    expect(history.status).toBe(200);
    expect(history.body.visits[0].actorName).toBe('Dr. Hessa Al-Dosari');
  });
});
