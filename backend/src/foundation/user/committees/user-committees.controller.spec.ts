// ACC-216 — GET /users/:userId/committees over HTTP, through the real controller
// and PermissionGuard: the route carries no @Permissions(), so only the service's
// gate refuses, each refusal a 403 naming the missing permission, before any read.
import { ExecutionContext, INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { LookupService } from '../../lookup/lookup.service';
import { UserService } from '../user.service';
import { UserCommitteesController } from './user-committees.controller';
import { UserCommitteesService } from './user-committees.service';

const TENANT_ID = 'org-a';
const CALLER_ID = 'user-caller';
const COLLEAGUE_ID = 'user-colleague';

describe('GET /users/:userId/committees (ACC-216)', () => {
  let app: INestApplication<App>;
  let callerPermissions: string[];
  let getById: jest.Mock;
  let findMany: jest.Mock;

  beforeEach(async () => {
    callerPermissions = [];
    getById = jest.fn((id: string, organizationId: string) =>
      organizationId === TENANT_ID && [CALLER_ID, COLLEAGUE_ID].includes(id)
        ? Promise.resolve({ id, organizationId })
        : Promise.reject(new NotFoundException('User not found')),
    );
    findMany = jest.fn(({ select }: { select: Record<string, unknown> }) =>
      Promise.resolve(
        select['committeeId']
          ? [{ committeeId: 'c1' }]
          : [
              {
                roleValueId: 'seat-member',
                joinedAt: new Date('2026-03-01T00:00:00.000Z'),
                leftAt: null,
                committee: { id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
              },
            ],
      ),
    );
    const moduleRef = await Test.createTestingModule({
      controllers: [UserCommitteesController],
      providers: [
        UserCommitteesService,
        { provide: UserService, useValue: { getById } },
        { provide: PrismaService, useValue: { committeeMember: { findMany, count: jest.fn().mockResolvedValue(1) }, lookupValue: { findMany: jest.fn() } } },
        {
          provide: LookupService,
          useValue: {
            getValues: jest.fn().mockResolvedValue([{ id: 'seat-member', labelEn: 'Member', labelAr: 'عضو', layer: 'SYSTEM' }]),
          },
        },
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

  const committeesOf = (userId: string) => request(app.getHttpServer()).get(`/users/${userId}/committees`);

  it('without committees:view: 403 naming it, even for yourself, before any read', async () => {
    callerPermissions = ['users:view'];
    for (const id of [CALLER_ID, COLLEAGUE_ID]) {
      const response = await committeesOf(id);
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Required permission: committees:view');
    }
    expect(getById).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("a colleague's, without users:view: 403 naming users:view, before any read", async () => {
    callerPermissions = ['committees:view'];
    const response = await committeesOf(COLLEAGUE_ID);
    expect(response.status).toBe(403);
    expect(response.body.message).toBe('Required permission: users:view');
    expect(getById).not.toHaveBeenCalled();
  });

  it('your own, with committees:view alone: 200', async () => {
    callerPermissions = ['committees:view'];
    const response = await committeesOf(CALLER_ID);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      total: 1,
      rows: [
        {
          committee: { id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
          seat: { id: 'seat-member', labelEn: 'Member', labelAr: 'عضو', layer: 'SYSTEM' },
          joinedAt: '2026-03-01T00:00:00.000Z',
          leftAt: null,
          current: true,
        },
      ],
    });
  });

  it("another organisation's user, or an invented id: the identical 404", async () => {
    callerPermissions = ['committees:view', 'users:view'];
    const invented = await committeesOf('user-invented');
    expect(invented.status).toBe(404);
    expect(invented.body.message).toBe('User not found');
    expect(getById).toHaveBeenCalledWith('user-invented', TENANT_ID);
  });
});
