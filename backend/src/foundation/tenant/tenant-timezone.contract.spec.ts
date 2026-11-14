import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-97 — ONE TIME ZONE PER ORGANISATION, AT THE HTTP BOUNDARY.
//
// The organisation's time zone is the working calendar's: the SLA engine
// computes due dates in it and every displayed date uses it. PATCH /tenant used
// to accept `timezone` and write it to Organization.timezone, a second copy
// nothing computing a date read. It is refused now, and the refusal comes from
// the global pipe's forbidNonWhitelisted, so the service is never reached and
// nothing is written.
//
// The service is mocked because the claim is about the pipe. What GET /tenant
// returns is the real mapper's, pinned in tenant.service.spec.ts.
//
// The pipe options MUST mirror main.ts (ACC-78's reason): if they drift, this
// goes on passing while production behaves differently.
describe('PATCH /tenant — timezone (ACC-97)', () => {
  let app: INestApplication;
  const ORG = 'org-a-id';
  const ACTOR = 'user-1';
  const service = { update: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [{ provide: TenantService, useValue: service }],
    })
      // The guards are not under test. This one sets what the real TenantGuard
      // would, so the controller receives a real tenant and actor.
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ tenantId: string; userId: string }>();
          req.tenantId = ORG;
          req.userId = ACTOR;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => await app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    service.update.mockResolvedValue({ id: ORG, language: 'ar' });
  });

  // THE NON-VACUITY GUARD, first: an allowed field reaches the service, so the
  // refusals below are the pipe refusing timezone, not every PATCH failing.
  it('passes an allowed field through to the service', async () => {
    const res = await request(app.getHttpServer()).patch('/tenant').send({ language: 'ar' });

    expect(res.status).toBe(200);
    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith(ORG, { language: 'ar' }, ACTOR);
  });

  it('refuses timezone with 400 and writes nothing', async () => {
    const res = await request(app.getHttpServer()).patch('/tenant').send({ timezone: 'Asia/Dubai' });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('property timezone should not exist');
    expect(service.update).not.toHaveBeenCalled();
  });

  // The whole body is refused, so a valid field beside it is not written either.
  it('refuses timezone beside an allowed field, writing neither', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tenant')
      .send({ language: 'ar', timezone: 'Asia/Dubai' });

    expect(res.status).toBe(400);
    expect(service.update).not.toHaveBeenCalled();
  });
});
