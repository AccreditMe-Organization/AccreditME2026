// ACC-272 — GET /users/:userId/permissions, over HTTP: the same rule as
// GET /users/:userId/roles (ACC-101). roles:view at the route; users:view as
// well unless the caller is reading themselves, checked BEFORE any read so the
// refusal is the same for a real colleague and an invented id; then the user is
// confirmed in this tenant (a foreign user is a 404, never an empty list); then
// ONE read.
//
// SUBJECT as in the roles spec: it holds roles:view and lacks users:view, so
// PermissionGuard admits it and only the parent check can refuse. Assertions
// read the MESSAGE, because both refusals are 403.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
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
import { StagePoolService } from '../workflow/stage-pool.service';

const TENANT_ID = 'org-a';
const CALLER_ID = 'user-caller';
const COLLEAGUE_ID = 'user-colleague';
const FOREIGN_ID = 'user-other-org';

const GRANTS = [{ id: 'ur-1', role: { id: 'role-1', nameEn: 'Quality Editor' }, permissions: ['users:view'] }];

describe("GET /users/:userId/permissions follows the user's own visibility (ACC-272)", () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];
  let findUser: jest.Mock;
  let getGrants: jest.Mock;

  beforeEach(async () => {
    callerPermissions = [];
    // Only users in TENANT_ID exist; the foreign id is in another organisation.
    findUser = jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(where.id === FOREIGN_ID || where.organizationId !== TENANT_ID ? null : { id: where.id, organizationId: TENANT_ID }),
    );
    getGrants = jest.fn().mockResolvedValue(GRANTS);

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        UserService,
        StagePoolService,
        { provide: PrismaService, useValue: { user: { findFirst: findUser } } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: NotificationService, useValue: { create: jest.fn() } },
        { provide: RoleService, useValue: { getUserPermissionGrants: getGrants } },
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
          const req = ctx.switchToHttp().getRequest<{ tenantId: string; userId: string; userPermissions: string[] }>();
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

  const permissionsOf = (userId: string) => request(app.getHttpServer()).get(`/users/${userId}/permissions`);

  it("refuses a colleague's permissions to a caller who holds roles:view but not users:view, before any read", async () => {
    callerPermissions = ['roles:view'];

    const response = await permissionsOf(COLLEAGUE_ID);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('users:view');
    expect(findUser).not.toHaveBeenCalled();
    expect(getGrants).not.toHaveBeenCalled();
  });

  it('serves a caller their own permissions without users:view', async () => {
    callerPermissions = ['roles:view'];

    const response = await permissionsOf(CALLER_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(GRANTS);
  });

  it("serves a colleague's permissions to a caller who also holds users:view, in two reads", async () => {
    callerPermissions = ['roles:view', 'users:view'];

    const response = await permissionsOf(COLLEAGUE_ID);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(GRANTS);
    // The user check, then ONE grants read.
    expect(findUser).toHaveBeenCalledTimes(1);
    expect(findUser).toHaveBeenCalledWith({ where: { id: COLLEAGUE_ID, organizationId: TENANT_ID } });
    expect(getGrants).toHaveBeenCalledTimes(1);
    expect(getGrants).toHaveBeenCalledWith(COLLEAGUE_ID, TENANT_ID);
  });

  it('refuses a caller with neither permission at the route, naming roles:view', async () => {
    callerPermissions = [];

    const response = await permissionsOf(CALLER_ID);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('roles:view');
    expect(getGrants).not.toHaveBeenCalled();
  });

  it('should NOT return records belonging to a different tenant', async () => {
    callerPermissions = ['roles:view', 'users:view'];

    const response = await permissionsOf(FOREIGN_ID);

    // A user of another organisation is a 404, never an empty list that reads
    // as "holds no roles", and no grants are read.
    expect(response.status).toBe(404);
    expect(findUser).toHaveBeenCalledWith({ where: { id: FOREIGN_ID, organizationId: TENANT_ID } });
    expect(getGrants).not.toHaveBeenCalled();
  });
});
