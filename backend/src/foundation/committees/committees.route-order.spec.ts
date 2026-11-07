// ACC-279 — GET /committees/mine reaches its own handler and is not swallowed
// by GET /committees/:id (Nest matches in declaration order). Over real HTTP,
// behind the real PermissionGuard, for a caller holding NO permission: ':id'
// needs committees:view, so a swallowed path would answer 403. The control test
// pins that ':id' really refuses this caller. Same shape as task.route-order.spec.ts.
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

describe('Committee routes — /committees/mine is not swallowed by :id (ACC-279)', () => {
  let app: INestApplication<App>;
  const service = { getCommitteeDetail: jest.fn().mockResolvedValue({}) };
  const home = { mine: jest.fn().mockResolvedValue({ total: 0, rows: [] }) };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [CommitteesController],
      providers: [
        { provide: CommitteesService, useValue: service },
        { provide: CommitteeListsService, useValue: {} },
        { provide: CommitteeFormChoicesService, useValue: {} },
        { provide: CommitteeHomeService, useValue: home },
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

  it('control: GET /committees/:id refuses a caller without committees:view', async () => {
    await request(app.getHttpServer()).get('/committees/c-1').expect(403);
    expect(service.getCommitteeDetail).not.toHaveBeenCalled();
  });

  it('GET /committees/mine answers from the caller\'s own memberships, with no permission', async () => {
    await request(app.getHttpServer()).get('/committees/mine').expect(200, { total: 0, rows: [] });
    expect(home.mine).toHaveBeenCalledWith('org-a', 'user-1');
    expect(service.getCommitteeDetail).not.toHaveBeenCalled();
  });
});
