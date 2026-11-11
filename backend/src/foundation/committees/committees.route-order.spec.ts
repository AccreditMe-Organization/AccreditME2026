// ACC-279 — GET /committees/mine reaches its own handler and is not swallowed
// by GET /committees/:id (Nest matches in declaration order). Over real HTTP,
// behind the real PermissionGuard, for a caller holding NO permission. Since
// ACC-281 ':id' carries no route permission, so the proof is which handler ran.
// Same shape as task.route-order.spec.ts.
import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CommitteesController } from './committees.controller';
import { CommitteesService } from './committees.service';
import { CommitteeListsService } from './committee-lists.service';
import { CommitteeFormChoicesService } from './committee-form-choices.service';
import { CommitteeHomeService } from './committee-home.service';
import { CommitteeMembershipsService } from './committee-memberships.service';

describe('Committee routes — /committees/mine is not swallowed by :id (ACC-279)', () => {
  let app: INestApplication<App>;
  const service = { getCommitteeDetail: jest.fn().mockResolvedValue({}) };
  const home = { mine: jest.fn().mockResolvedValue({ total: 0, rows: [] }) };
  const memberships = { forUser: jest.fn().mockResolvedValue({ total: 0, rows: [] }) };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CommitteesController],
      providers: [
        { provide: CommitteesService, useValue: service },
        { provide: CommitteeListsService, useValue: {} },
        { provide: CommitteeFormChoicesService, useValue: {} },
        { provide: CommitteeHomeService, useValue: home },
        { provide: CommitteeMembershipsService, useValue: memberships },
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
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  // ACC-281 — ':id' has no route permission any more (the service decides
  // view-or-member), so the control is that a real id DOES reach the detail
  // read: 'mine' reaching it instead is what the next test rules out.
  it('control: GET /committees/c-1 reaches the detail read, with the caller as viewer', async () => {
    await request(app.getHttpServer()).get('/committees/c-1').expect(200);
    expect(service.getCommitteeDetail).toHaveBeenCalledWith('c-1', 'org-a', { id: 'user-1', permissions: [] });
  });

  it('GET /committees/mine answers from the caller\'s own memberships, with no permission', async () => {
    await request(app.getHttpServer()).get('/committees/mine').expect(200, { total: 0, rows: [] });
    expect(home.mine).toHaveBeenCalledWith('org-a', 'user-1');
    expect(service.getCommitteeDetail).not.toHaveBeenCalled();
  });

  // ACC-295 — 'memberships' is a route of its own, declared above ':id'. This caller
  // holds no permission: ':id' (no route permission) would answer 200 from the detail
  // read, so the route's OWN committees:view refusal proves 'memberships' got there.
  it('GET /committees/memberships?userId= reaches its own route (its committees:view gate), never the detail read', async () => {
    const res = await request(app.getHttpServer()).get('/committees/memberships?userId=user-9').expect(403);
    expect(JSON.stringify(res.body)).toContain('committees:view');
    expect(service.getCommitteeDetail).not.toHaveBeenCalled();
    expect(memberships.forUser).not.toHaveBeenCalled();
  });
});
