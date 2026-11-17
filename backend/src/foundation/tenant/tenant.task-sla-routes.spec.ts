import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TaskSlaPolicyService } from './task-sla-policy.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-313 — the task SLA section routes and the history over real HTTP,
// behind the real PermissionGuard and ValidationPipe: each needs
// tenant:manage_config, a section's body takes only its own fields, and every
// call acts on the session's organisation.
describe('Task SLA section routes (ACC-313)', () => {
  let app: INestApplication<App>;
  let permissions: string[] = [];
  const saved = { LOW: {}, MEDIUM: {}, HIGH: {}, CRITICAL: {} };
  const policy = {
    saveLimits: jest.fn().mockResolvedValue(saved),
    saveEscalation: jest.fn().mockResolvedValue(saved),
    replaceAll: jest.fn().mockResolvedValue(saved),
    history: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [{ provide: TenantService, useValue: {} }, { provide: TaskSlaPolicyService, useValue: policy }],
    })
      .overrideGuard(TenantGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ tenantId: string; userId: string; userPermissions: string[] }>();
          req.tenantId = 'org-a';
          req.userId = 'admin-1';
          req.userPermissions = permissions;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    permissions = ['tenant:manage_config'];
  });

  const limits = { LOW: { dueAfterHours: 80 }, MEDIUM: { dueAfterHours: 40 }, HIGH: { dueAfterHours: 16 }, CRITICAL: { dueAfterHours: 4 } };
  const tier = { managerEscalationAfterHours: 8, headEscalationAfterHours: 16 };
  const escalation = { LOW: tier, MEDIUM: tier, HIGH: tier, CRITICAL: tier };
  const http = () => request(app.getHttpServer());

  it.each([
    ['patch', '/tenant/task-sla/limits', limits],
    ['patch', '/tenant/task-sla/escalation', escalation],
    ['get', '/tenant/task-sla/history', null],
  ])('%s %s needs tenant:manage_config', async (method, path, body) => {
    permissions = ['tenant:view'];
    const res = method === 'get' ? await http().get(path) : await http().patch(path).send(body as object);
    expect(res.status).toBe(403);
    expect(policy.saveLimits).not.toHaveBeenCalled();
    expect(policy.saveEscalation).not.toHaveBeenCalled();
    expect(policy.history).not.toHaveBeenCalled();
  });

  it('a limits save reaches the policy with the session organisation and actor', async () => {
    const res = await http().patch('/tenant/task-sla/limits').send(limits);
    expect(res.status).toBe(200);
    expect(policy.saveLimits).toHaveBeenCalledWith('org-a', limits, 'admin-1');
  });

  it.each([
    ['a limit of 0', { ...limits, HIGH: { dueAfterHours: 0 } }],
    ['a missing priority', { LOW: limits.LOW, MEDIUM: limits.MEDIUM, HIGH: limits.HIGH }],
    ['an escalation field, which is the other section’s', { ...limits, HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8 } }],
    ['an organisation id in the body', { ...limits, organizationId: 'org-b' }],
  ])('a limits save with %s is refused, and nothing is saved', async (_case, body) => {
    const res = await http().patch('/tenant/task-sla/limits').send(body);
    expect(res.status).toBe(400);
    expect(policy.saveLimits).not.toHaveBeenCalled();
  });

  it.each([
    ['a negative hour', { ...escalation, LOW: { ...tier, headEscalationAfterHours: -1 } }],
    ['a limit, which is the other section’s', { ...escalation, LOW: { ...tier, dueAfterHours: 10 } }],
  ])('an escalation save with %s is refused, and nothing is saved', async (_case, body) => {
    const res = await http().patch('/tenant/task-sla/escalation').send(body);
    expect(res.status).toBe(400);
    expect(policy.saveEscalation).not.toHaveBeenCalled();
  });

  it('the history takes skip and take as numbers, and refuses a page over 50', async () => {
    expect((await http().get('/tenant/task-sla/history?skip=20&take=20')).status).toBe(200);
    expect(policy.history).toHaveBeenCalledWith('org-a', 20, 20);
    expect((await http().get('/tenant/task-sla/history?take=51')).status).toBe(400);
    expect((await http().get('/tenant/task-sla/history?skip=-1')).status).toBe(400);
    expect(policy.history).toHaveBeenCalledTimes(1);
  });

  itEnforcesTenantIsolation('the task SLA routes act on the session organisation only', async () => {
    await http().patch('/tenant/task-sla/escalation').send(escalation);
    await http().get('/tenant/task-sla/history');
    expect(policy.saveEscalation).toHaveBeenCalledWith('org-a', escalation, 'admin-1');
    expect(policy.history).toHaveBeenCalledWith('org-a', undefined, undefined);
  });
});
