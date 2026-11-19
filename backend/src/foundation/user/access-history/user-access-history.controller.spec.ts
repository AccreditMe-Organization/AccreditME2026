// ACC-216 part 2 — GET /users/:userId/access-history over HTTP, through the real
// controller, PermissionGuard and main.ts's ValidationPipe. The route carries no
// @Permissions(), so only the service's gate refuses: a 403 naming users:view,
// before any read.
import { ExecutionContext, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserService } from '../user.service';
import { UserAccessHistoryController } from './user-access-history.controller';
import { UserAccessHistoryService } from './user-access-history.service';

const TENANT_ID = 'org-a';
const CALLER_ID = 'user-caller';
const COLLEAGUE_ID = 'user-colleague';

describe('GET /users/:userId/access-history (ACC-216 part 2)', () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];
  let getById: jest.Mock;
  let findMany: jest.Mock;
  let count: jest.Mock;

  beforeEach(async () => {
    callerPermissions = [];
    getById = jest.fn((id: string, organizationId: string) =>
      organizationId === TENANT_ID && [CALLER_ID, COLLEAGUE_ID].includes(id)
        ? Promise.resolve({ id, organizationId })
        : Promise.reject(new NotFoundException('User not found')),
    );
    findMany = jest.fn().mockResolvedValue([
      {
        id: 'a1',
        action: 'UPDATE',
        objectType: 'User',
        actorId: null,
        before: null,
        after: null,
        metadata: { event: 'password_reset' },
        createdAt: new Date('2026-11-10T08:00:00.000Z'),
      },
    ]);
    count = jest.fn().mockResolvedValue(1);
    const moduleRef = await Test.createTestingModule({
      controllers: [UserAccessHistoryController],
      providers: [
        UserAccessHistoryService,
        { provide: UserService, useValue: { getById } },
        { provide: PrismaService, useValue: { auditLog: { findMany, count } } },
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: false } }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const historyOf = (userId: string, query = '') => request(app.getHttpServer()).get(`/users/${userId}/access-history${query}`);

  it("a colleague's, without users:view: 403 naming users:view, before any read", async () => {
    callerPermissions = ['roles:view'];
    const response = await historyOf(COLLEAGUE_ID);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Required permission: users:view');
    expect(getById).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('your own, with no permission: 200, the page as the service builds it', async () => {
    const response = await historyOf(CALLER_ID, '?skip=0&take=5');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      rows: [{ id: 'audit:a1', at: '2026-11-10T08:00:00.000Z', kind: 'PASSWORD_RESET', actor: null }],
      total: 1,
      skip: 0,
      take: 5,
    });
  });

  it('take is 1 to 50 and skip at least 0: anything else is a 400, before any read', async () => {
    callerPermissions = ['users:view'];
    for (const query of ['?take=51', '?take=0', '?skip=-1', '?take=five', '?other=1']) {
      const response = await historyOf(COLLEAGUE_ID, query);
      expect({ query, status: response.status }).toEqual({ query, status: 400 });
    }
    expect(getById).not.toHaveBeenCalled();
  });

  it("another organisation's person, or an invented id: the identical 404", async () => {
    callerPermissions = ['users:view'];
    const invented = await historyOf('user-invented');
    expect(invented.status).toBe(404);
    expect(invented.body.message).toBe('User not found');
    expect(getById).toHaveBeenCalledWith('user-invented', TENANT_ID);
    expect(findMany).not.toHaveBeenCalled();
  });
});
