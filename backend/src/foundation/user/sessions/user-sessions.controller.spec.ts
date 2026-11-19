// ACC-216 Sessions PR 1 — the three routes over HTTP, through the real
// controllers and PermissionGuard (TenantGuard stubbed to name the caller).
// The read carries no @Permissions(): only the service's gate refuses it, before
// any read. "Sign out everywhere" carries users:manage_sessions. Your own routes
// sit under /auth/sessions, where the refresh cookie arrives.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { OwnSessionsController, UserSessionsController } from './user-sessions.controller';
import { UserSessionsService } from './user-sessions.service';

const TENANT_ID = 'org-a';
const CALLER_ID = 'user-caller';
const COLLEAGUE_ID = 'user-colleague';

describe('Sessions routes over HTTP (ACC-216)', () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];
  let userFindFirst: jest.Mock;
  let rtFindFirst: jest.Mock;
  let rtUpdateMany: jest.Mock;

  beforeEach(async () => {
    callerPermissions = [];
    userFindFirst = jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
      Promise.resolve(
        where.organizationId === TENANT_ID && [CALLER_ID, COLLEAGUE_ID].includes(where.id)
          ? { id: where.id, status: 'ACTIVE', tokenVersion: 0, authUserId: null, ownedOrganizations: [] }
          : null,
      ),
    );
    rtFindFirst = jest.fn().mockResolvedValue({ id: 'rt-now', sessionStartedAt: new Date('2026-11-17T08:00:00.000Z') });
    rtUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: { findFirst: userFindFirst },
      refreshToken: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: rtFindFirst, updateMany: rtUpdateMany },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UserSessionsController, OwnSessionsController],
      providers: [
        UserSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: SecurityNoticeService, useValue: { enqueue: jest.fn().mockResolvedValue(undefined) } },
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
    app.use(cookieParser());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it("GET a colleague's sign-ins without the keys: 403 naming the first missing one, before any read", async () => {
    callerPermissions = ['users:view'];
    const res = await request(server()).get(`/users/${COLLEAGUE_ID}/sessions`);
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Required permission: users:manage_sessions');
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('GET your own sign-ins with no permission: 200', async () => {
    const res = await request(server()).get(`/users/${CALLER_ID}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 0, rows: [] });
  });

  it("GET another organisation's person, or an invented id: the identical 404", async () => {
    callerPermissions = ['users:view', 'users:manage_sessions'];
    const res = await request(server()).get('/users/user-invented/sessions');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('User not found');
  });

  it('POST end-all without users:manage_sessions: refused by its @Permissions, before any read', async () => {
    callerPermissions = ['users:view'];
    const res = await request(server()).post(`/users/${COLLEAGUE_ID}/sessions/end-all`);
    expect(res.status).toBe(403);
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  it('POST /auth/sessions/end-others reads the refresh cookie, by hash, and needs no permission', async () => {
    const res = await request(server()).post('/auth/sessions/end-others').set('Cookie', 'refresh_token=raw-refresh-value');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ended: 1 });
    const where = (rtFindFirst.mock.calls[0]![0] as { where: { tokenHash: string; userId: string; organizationId: string } }).where;
    expect(where).toMatchObject({ userId: CALLER_ID, organizationId: TENANT_ID });
    expect(where.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('POST /auth/sessions/end-others without the cookie: 409 CURRENT_SESSION_UNKNOWN', async () => {
    const res = await request(server()).post('/auth/sessions/end-others');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CURRENT_SESSION_UNKNOWN');
    expect(rtUpdateMany).not.toHaveBeenCalled();
  });
});
