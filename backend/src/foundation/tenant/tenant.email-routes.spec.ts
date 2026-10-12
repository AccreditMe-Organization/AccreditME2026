import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-181 — the email settings routes over real HTTP, behind the real
// PermissionGuard and ValidationPipe: each needs tenant:manage_config, the body
// is typed per provider, and every call acts on the session's organisation.
describe('Email settings routes (ACC-181)', () => {
  let app: INestApplication<App>;
  let permissions: string[] = [];
  const masked = { provider: null, settings: null, secretsSetAt: {}, defaultSender: null };
  const service = {
    getEmailConfig: jest.fn().mockResolvedValue(masked),
    updateEmailConfig: jest.fn().mockResolvedValue(masked),
    disconnectEmailConfig: jest.fn().mockResolvedValue(masked),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [{ provide: TenantService, useValue: service }],
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

  const smtp = {
    host: 'mail.example.test',
    port: 587,
    encryption: 'STARTTLS',
    fromAddress: 'quality@example.test',
  };
  const patch = (body: object) => request(app.getHttpServer()).patch('/tenant/email-config').send(body);

  // 12 — every route, DELETE included.
  it.each([
    ['get', '/tenant/email-config'],
    ['patch', '/tenant/email-config'],
    ['delete', '/tenant/email-config'],
  ])('%s %s needs tenant:manage_config', async (method, path) => {
    permissions = ['tenant:view'];
    const agent = request(app.getHttpServer()) as unknown as Record<string, (p: string) => request.Test>;
    const req = agent[method]!(path);
    const res = await (method === 'patch' ? req.send({ provider: 'smtp', smtp }) : req);
    expect(res.status).toBe(403);
    expect(service.getEmailConfig).not.toHaveBeenCalled();
    expect(service.updateEmailConfig).not.toHaveBeenCalled();
    expect(service.disconnectEmailConfig).not.toHaveBeenCalled();
  });

  it('DELETE disconnects the session organisation', async () => {
    const res = await request(app.getHttpServer()).delete('/tenant/email-config');
    expect(res.status).toBe(200);
    expect(service.disconnectEmailConfig).toHaveBeenCalledWith('org-a', 'admin-1');
  });

  // 10 — the typed body.
  it('accepts a well-formed SMTP save', async () => {
    const res = await patch({ provider: 'smtp', smtp: { ...smtp, username: 'svc', password: 'pw' } });
    expect(res.status).toBe(200);
    expect(service.updateEmailConfig).toHaveBeenCalledWith('org-a', expect.objectContaining({ provider: 'smtp' }), 'admin-1');
  });

  it.each([
    ['a bad sender address', { provider: 'smtp', smtp: { ...smtp, fromAddress: 'not-an-address' } }],
    ['a port above 65535', { provider: 'smtp', smtp: { ...smtp, port: 70000 } }],
    ['a port of 0', { provider: 'smtp', smtp: { ...smtp, port: 0 } }],
    ['an unknown encryption', { provider: 'smtp', smtp: { ...smtp, encryption: 'TLS1.0' } }],
    ['a bad host', { provider: 'smtp', smtp: { ...smtp, host: 'mail example test' } }],
    ['the old config field', { provider: 'smtp', config: { host: 'x' } }],
    ['the old emailProvider field', { emailProvider: 'smtp', smtp }],
    ['an unknown provider', { provider: 'mailgun' }],
    ['a field the provider does not have', { provider: 'smtp', smtp: { ...smtp, apiKey: 'x' } }],
    ['an Office 365 tenant ID that is not a GUID', { provider: 'office365', office365: { tenantId: 'contoso' } }],
    ['an AWS region that is not one', { provider: 'ses', ses: { region: 'Frankfurt' } }],
  ])('refuses %s with 400 and never reaches the service', async (_what, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(service.updateEmailConfig).not.toHaveBeenCalled();
  });

  it('an ordinary field sent empty passes validation (it means clear)', async () => {
    const res = await patch({ provider: 'resend', resend: { fromAddress: 'q@example.test', fromName: '' } });
    expect(res.status).toBe(200);
  });

  // 13
  itEnforcesTenantIsolation('email settings routes act on the session organisation, never one in the body', async () => {
    const refused = await patch({ provider: 'smtp', smtp, organizationId: 'org-b' });
    expect(refused.status).toBe(400);
    expect(service.updateEmailConfig).not.toHaveBeenCalled();

    await request(app.getHttpServer()).get('/tenant/email-config');
    await patch({ provider: 'smtp', smtp });
    await request(app.getHttpServer()).delete('/tenant/email-config');
    expect(service.getEmailConfig).toHaveBeenCalledWith('org-a');
    expect(service.updateEmailConfig.mock.calls[0]![0]).toBe('org-a');
    expect(service.disconnectEmailConfig.mock.calls[0]![0]).toBe('org-a');
  });
});
