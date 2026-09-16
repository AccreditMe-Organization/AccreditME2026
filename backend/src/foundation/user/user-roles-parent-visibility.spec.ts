// ACC-101 — the third instance of the same defect, and the one whose parent
// rule is a different shape.
//
// GET /users/:userId/roles was gated on roles:view alone, while the record it
// belongs to — the user — is gated on users:view OR being that user. So a
// caller holding roles:view and nothing else could read ANY colleague's role
// assignments: which is to say, what each person is permitted to do.
//
// WHY THIS ONE DOES NOT USE ObjectVisibilityService. The registry answers "which
// permission does this object TYPE require". The parent here is a person, and
// the rule is self-OR-permission, which no type permission expresses. It reuses
// the check UserService.getByIdForViewer() already makes (ACC-43) — the rule
// being "you may read the roles of a user whose record you may read", rather
// than a second, parallel notion of who a user is.
//
// SUBJECT, constructed as in the task and workflow tests: it HOLDS roles:view
// and LACKS users:view, so PermissionGuard admits it and only the parent check
// can refuse. Assertions read the MESSAGE — both refusals are 403.
//
// This is the parent-NAMED shape (the id is in the path, and the check runs
// before any read), so the refusal stays 403 and names the permission. It is
// existence-neutral already: identical for a real colleague and an invented id.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AUTH_PROVIDER } from '../../providers/auth/auth.provider';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { OrganizationService } from '../organization/organization.service';
import { RoleService } from '../roles/role.service';
import { TaskService } from '../task/task.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

const TENANT_ID = 'org-a';
const CALLER_ID = 'user-caller';
const COLLEAGUE_ID = 'user-colleague';

const ROLES = [{ id: 'role-1', key: 'QUALITY_MANAGER', nameEn: 'Quality Manager' }];

describe("A user's roles are gated by that user's own visibility (ACC-101)", () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];

  beforeEach(async () => {
    callerPermissions = [];

    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: COLLEAGUE_ID, organizationId: TENANT_ID }),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: RoleService, useValue: { getUserRoles: jest.fn().mockResolvedValue(ROLES) } },
        { provide: TaskService, useValue: {} },
        { provide: OrganizationService, useValue: {} },
        { provide: AUTH_PROVIDER, useValue: {} },
        { provide: OrgUnitHeadService, useValue: {} },
        { provide: OrgPositionService, useValue: {} },
      ],
    })
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

  const rolesOf = (userId: string) =>
    request(app.getHttpServer()).get(`/users/${userId}/roles`);

  // THE DEFECT TEST.
  it("refuses a colleague's roles to a caller who holds roles:view but cannot see that user", async () => {
    callerPermissions = ['roles:view'];

    const response = await rolesOf(COLLEAGUE_ID);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('users:view');
    expect(JSON.stringify(response.body)).not.toContain('QUALITY_MANAGER');
  });

  // THE SELF PATH, which is the reason this is not simply "require users:view".
  // A person reading their OWN roles needs no permission over other people.
  it('serves a caller their own roles without users:view', async () => {
    callerPermissions = ['roles:view'];

    const response = await rolesOf(CALLER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(ROLES);
  });

  // CONTROL — the child gate still refuses, with its own message.
  it('refuses a caller holding no permissions at all, at the child gate', async () => {
    callerPermissions = [];

    const response = await rolesOf(CALLER_ID);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('roles:view');
    expect(response.body.message).not.toContain('users:view');
  });

  // CONTROL — an administrator still reads anyone's roles.
  it("serves a colleague's roles to a caller who can see users", async () => {
    callerPermissions = ['roles:view', 'users:view'];

    const response = await rolesOf(COLLEAGUE_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(ROLES);
  });
});
