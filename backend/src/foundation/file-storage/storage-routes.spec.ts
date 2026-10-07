import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { StorageSettingsController } from './storage-settings.controller';
import { RecycleBinController } from './recycle-bin.controller';
import { StorageSettingsService } from './storage-settings.service';
import { RecycleBinService } from './recycle-bin.service';

// ACC-177 — the tenant-admin storage routes over real HTTP, behind the real
// PermissionGuard and ValidationPipe: each needs tenant:manage_config, each
// acts on the caller's own organisation (from the session, never the body),
// and the purge body is bounded.
describe('Storage settings and recycle bin routes (ACC-177)', () => {
  let app: INestApplication<App>;
  let permissions: string[] = [];
  const settings = {
    get: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    confirm: jest.fn().mockResolvedValue({}),
    requestChange: jest.fn().mockResolvedValue({}),
    test: jest.fn().mockResolvedValue({}),
  };
  const recycleBin = {
    list: jest.fn().mockResolvedValue([]),
    restore: jest.fn().mockResolvedValue([]),
    purge: jest.fn().mockResolvedValue({ purged: 1 }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StorageSettingsController, RecycleBinController],
      providers: [
        { provide: StorageSettingsService, useValue: settings },
        { provide: RecycleBinService, useValue: recycleBin },
      ],
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
    permissions = [];
  });

  const call = (method: string, path: string, body?: object): request.Test => {
    const agent = request(app.getHttpServer()) as unknown as Record<string, (p: string) => request.Test>;
    const req = agent[method]!(path);
    return body ? req.send(body) : req;
  };

  // Every row has THREE entries: a two-entry row leaves the test function's
  // third parameter unfilled, and Jest then treats it as a done() callback.
  const routes: [string, string, object | undefined][] = [
    ['get', '/tenant/storage', undefined],
    ['patch', '/tenant/storage', { provider: 'S3' }],
    ['post', '/tenant/storage/confirm', { provider: 'S3' }],
    ['post', '/tenant/storage/change-request', { message: 'Please move us' }],
    ['post', '/tenant/storage/test', {}],
    ['get', '/tenant/recycle-bin', undefined],
    ['post', '/tenant/recycle-bin/f1/restore', undefined],
    ['post', '/tenant/recycle-bin/purge', { fileIds: ['f1'] }],
  ];

  it.each(routes)('%s %s needs tenant:manage_config', async (method, path, body) => {
    const res = await call(method, path, body);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('tenant:manage_config');
  });

  it.each(routes)('%s %s acts on the session organisation for an admin', async (method, path, body) => {
    permissions = ['tenant:manage_config'];
    const res = await call(method, path, body);
    expect(res.status).toBe(200);
    const calls = [...Object.values(settings), ...Object.values(recycleBin)].flatMap((m) => m.mock.calls);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('org-a');
  });

  it('confirm and change-request are recorded as the signed-in admin', async () => {
    permissions = ['tenant:manage_config'];
    await request(app.getHttpServer()).post('/tenant/storage/confirm').send({ provider: 'S3' });
    expect(settings.confirm).toHaveBeenCalledWith('org-a', { provider: 'S3' }, 'admin-1');
    await request(app.getHttpServer()).post('/tenant/storage/change-request').send({});
    expect(settings.requestChange).toHaveBeenCalledWith('org-a', {}, 'admin-1');
  });

  it.each([
    ['no ids', []],
    ['101 ids', Array.from({ length: 101 }, (_, i) => `f${i}`)],
  ])('purge refuses %s', async (_label, fileIds) => {
    permissions = ['tenant:manage_config'];
    const res = await request(app.getHttpServer()).post('/tenant/recycle-bin/purge').send({ fileIds });
    expect(res.status).toBe(400);
    expect(recycleBin.purge).not.toHaveBeenCalled();
  });

  it('a change-request message over 1,000 characters is refused', async () => {
    permissions = ['tenant:manage_config'];
    const res = await request(app.getHttpServer()).post('/tenant/storage/change-request').send({ message: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });

  it('an organisationId in the body is refused, never used', async () => {
    permissions = ['tenant:manage_config'];
    const res = await request(app.getHttpServer()).post('/tenant/storage/confirm').send({ provider: 'S3', organizationId: 'org-b' });
    expect(res.status).toBe(400);
    expect(settings.confirm).not.toHaveBeenCalled();
  });
});
