import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { StorageSettingsService } from './storage-settings.service';
import { StorageResolverService } from './storage-resolver.service';
import { StoredFileService } from './stored-file.service';
import { StorageNoticesService } from './storage-notices.service';
import { StorageRefusalException } from './storage-refusal';
import { readStorageConfig, writeStorageConfig } from './storage-config';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const MINIO = {
  endpoint: 'https://minio.example.com',
  region: 'us-east-1',
  bucket: 'evidence',
  accessKeyId: 'minio-access',
  secretAccessKey: 'minio-secret-key',
};
const ADMIN = { id: 'admin-1', name: 'Hessa' };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageRefusalException) return error.code;
    throw error;
  }
  return undefined;
}

describe('StorageSettingsService (ACC-177)', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
    // ACC-185 — GET counts SharePoint files not yet purged.
    storedFile: { count: jest.fn().mockResolvedValue(0) },
  };
  const storedFiles = { cloudUsageBytes: jest.fn().mockResolvedValue(1234) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const notices = { storageChangeRequested: jest.fn().mockResolvedValue(undefined) };
  const resolver = new StorageResolverService(prisma as unknown as PrismaService);
  const service = new StorageSettingsService(
    prisma as unknown as PrismaService,
    resolver,
    storedFiles as unknown as StoredFileService,
    auditLog as unknown as AuditLogService,
    notices as unknown as StorageNoticesService,
  );
  const ENV = ['ENCRYPTION_KEY', 'LOCAL_STORAGE_BASE', 'STORAGE_ALLOW_PRIVATE_ENDPOINTS', 'AWS_REGION', 'AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const saved: Record<string, string | undefined> = {};
  let base: string;

  const org = (storageProvider: string, config: object | null, confirmed = false) =>
    prisma.organization.findFirst.mockResolvedValue({
      storageProvider,
      storageConfig: config ? writeStorageConfig(config) : null,
      maxStorageGb: 10,
      storageConfirmedAt: confirmed ? new Date('2026-10-07T08:00:00Z') : null,
      storageConfirmedBy: confirmed ? ADMIN : null,
      storageChangeRequestedAt: null,
      storageChangeRequestedBy: null,
    });
  const savedConfig = (call: { data: { storageConfig: string } }) => readStorageConfig(call.data.storageConfig);
  // A provider whose put/read/delete pass or fail as told — the test without a network.
  const fakeProvider = (opts: { failPut?: boolean; readBack?: string } = {}) => {
    let written: Buffer = Buffer.alloc(0);
    return {
      put: jest.fn(async (_k: string, body: Buffer) => {
        if (opts.failPut) throw Object.assign(new Error('AccessDenied for minio.example.com'), { name: 'AccessDenied' });
        written = body;
      }),
      getStream: jest.fn(async () => Readable.from([opts.readBack ? Buffer.from(opts.readBack) : written])),
      delete: jest.fn().mockResolvedValue(undefined),
    };
  };
  const useProvider = (p: ReturnType<typeof fakeProvider>) =>
    jest.spyOn(resolver, 'forCandidate').mockReturnValue({ provider: p, location: { provider: 'MINIO', bucket: 'evidence', endpoint: MINIO.endpoint, rootPath: null } });

  beforeAll(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    base = await mkdtemp(join(tmpdir(), 'acc177-settings-'));
  });
  afterAll(async () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(base, { recursive: true, force: true });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    for (const k of ENV) delete process.env[k];
    process.env['ENCRYPTION_KEY'] = 'e'.repeat(64);
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('get', () => {
    it('answers secrets as "set", says whether storage is confirmed and by whom', async () => {
      org('MINIO', { minio: MINIO }, true);
      const settings = await service.get('org-a');
      expect(settings.minio).toEqual({ endpoint: MINIO.endpoint, region: MINIO.region, bucket: MINIO.bucket, accessKeyId: 'set', secretAccessKey: 'set' });
      expect(settings).toEqual(expect.objectContaining({ confirmed: true, confirmedBy: ADMIN, changeRequestedAt: null }));
      expect(JSON.stringify(settings)).not.toContain('minio-secret-key');
    });

    it("never shows AccreditMe's own region, bucket or endpoint — for AccreditMe cloud, only the provider", async () => {
      process.env['AWS_REGION'] = 'eu-central-1';
      process.env['AWS_S3_BUCKET'] = 'accreditme-files-prod';
      process.env['AWS_ACCESS_KEY_ID'] = 'AKIA';
      process.env['AWS_SECRET_ACCESS_KEY'] = 'x';
      org('S3', null);
      const text = JSON.stringify(await service.get('org-a'));
      expect(text).toContain('"provider":"S3"');
      expect(text).not.toContain('eu-central-1');
      expect(text).not.toContain('accreditme-files-prod');
      expect(text).toContain('"confirmed":false');
    });
  });

  describe('confirm', () => {
    it('confirms AccreditMe cloud with no test, stamping who and when, audited', async () => {
      org('S3', null);
      await service.confirm('org-a', { provider: 'S3' }, 'admin-1');
      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-a', storageConfirmedAt: null },
        data: expect.objectContaining({ storageProvider: 'S3', storageConfig: null, storageConfirmedAt: expect.any(Date), storageConfirmedById: 'admin-1' }),
      });
      expect(auditLog.log.mock.calls[0]![0]).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ event: 'storage_confirmed' }) }));
    });

    it('confirms a local folder only after the connection test passes in it', async () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      org('S3', null);
      await service.confirm('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'hospital-a' } }, 'admin-1');
      expect(await readdir(join(base, 'hospital-a', 'org-a', '_probe'))).toEqual([]); // probe written, then deleted
      expect(prisma.organization.updateMany).toHaveBeenCalled();
    });

    it('refuses MinIO whose test fails, naming the step, and saves nothing', async () => {
      org('S3', null);
      useProvider(fakeProvider({ failPut: true }));
      let error: unknown;
      try {
        await service.confirm('org-a', { provider: 'MINIO', minio: MINIO }, 'admin-1');
      } catch (e) {
        error = e;
      }
      expect((error as StorageRefusalException).getResponse()).toEqual(
        expect.objectContaining({ statusCode: 400, code: 'STORAGE_TEST_FAILED', failedStep: 'write', cause: 'STORAGE_UNAVAILABLE' }),
      );
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('confirms once — a second confirmation is refused, and so is the loser of a race', async () => {
      org('S3', null, true);
      expect(await codeOf(service.confirm('org-a', { provider: 'S3' }, 'admin-1'))).toBe('STORAGE_ALREADY_CONFIRMED');

      org('S3', null);
      prisma.organization.updateMany.mockResolvedValueOnce({ count: 0 });
      expect(await codeOf(service.confirm('org-a', { provider: 'S3' }, 'admin-2'))).toBe('STORAGE_ALREADY_CONFIRMED');
    });
  });

  describe('update — once confirmed, the location is AccreditMe\'s to change', () => {
    it.each([
      ['another provider', { provider: 'S3' as const }],
      ['another MinIO bucket', { provider: 'MINIO' as const, minio: { bucket: 'another-bucket' } }],
      ['another MinIO endpoint', { provider: 'MINIO' as const, minio: { endpoint: 'https://other.example.com' } }],
      ['another MinIO region', { provider: 'MINIO' as const, minio: { region: 'eu-west-1' } }],
    ])('refuses %s with 403 STORAGE_CHANGE_BY_PLATFORM', async (_label, dto) => {
      org('MINIO', { minio: MINIO }, true);
      let error: unknown;
      try {
        await service.update('org-a', dto, 'admin-1');
      } catch (e) {
        error = e;
      }
      expect((error as StorageRefusalException).getResponse()).toEqual(
        expect.objectContaining({ statusCode: 403, code: 'STORAGE_CHANGE_BY_PLATFORM', message: 'Changing where files are stored is done by AccreditMe. Contact support.' }),
      );
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('refuses another local root', async () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      org('LOCAL_FILESYSTEM', { local: { rootPath: 'hospital-a' } }, true);
      expect(await codeOf(service.update('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'hospital-b' } }, 'admin-1'))).toBe(
        'STORAGE_CHANGE_BY_PLATFORM',
      );
    });

    it('accepts new keys for the SAME endpoint and bucket, after a passing test, auditing names only', async () => {
      org('MINIO', { minio: MINIO }, true);
      useProvider(fakeProvider());
      await service.update('org-a', { provider: 'MINIO', minio: { accessKeyId: 'new-access', secretAccessKey: 'new-secret-key' } }, 'admin-1');
      expect(savedConfig(prisma.organization.update.mock.calls[0]![0])).toEqual({ minio: { ...MINIO, accessKeyId: 'new-access', secretAccessKey: 'new-secret-key' } });
      const audit = auditLog.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(audit['metadata']).toEqual({ event: 'storage_keys_replaced', changedFields: ['minio.accessKeyId', 'minio.secretAccessKey'] });
      expect(JSON.stringify(audit)).not.toContain('new-secret-key');
    });

    it('refuses new keys that fail the test', async () => {
      org('MINIO', { minio: MINIO }, true);
      useProvider(fakeProvider({ failPut: true }));
      expect(await codeOf(service.update('org-a', { provider: 'MINIO', minio: { secretAccessKey: 'wrong-secret-key' } }, 'admin-1'))).toBe('STORAGE_TEST_FAILED');
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('before confirmation, saves a draft that unlocks nothing', async () => {
      org('S3', null);
      await service.update('org-a', { provider: 'MINIO', minio: MINIO }, 'admin-1');
      expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: 'org-a' }, data: expect.not.objectContaining({ storageConfirmedAt: expect.anything() }) });
    });
  });

  describe('requestChange', () => {
    it('is refused until storage is confirmed', async () => {
      org('S3', null);
      expect(await codeOf(service.requestChange('org-a', { message: 'x' }, 'admin-1'))).toBe('STORAGE_NOT_CONFIRMED');
    });

    it('stamps who and when, audits the message, then tells the platform admins — and again on a repeat', async () => {
      org('S3', null, true);
      await service.requestChange('org-a', { message: '  Move us to our MinIO  ' }, 'admin-1');
      await service.requestChange('org-a', {}, 'admin-1');

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-a' },
        data: { storageChangeRequestedAt: expect.any(Date), storageChangeRequestedById: 'admin-1' },
      });
      expect(auditLog.log.mock.calls[0]![0]).toEqual(expect.objectContaining({ metadata: { event: 'storage_change_requested', message: 'Move us to our MinIO' } }));
      expect(notices.storageChangeRequested).toHaveBeenNthCalledWith(1, 'org-a', 'admin-1', expect.any(Date), 'Move us to our MinIO');
      expect(notices.storageChangeRequested).toHaveBeenNthCalledWith(2, 'org-a', 'admin-1', expect.any(Date), null);
      // Notified after the change was written.
      expect(prisma.organization.update.mock.invocationCallOrder[0]).toBeLessThan(notices.storageChangeRequested.mock.invocationCallOrder[0]!);
    });
  });

  describe('test connection — saves nothing', () => {
    it('writes, reads back, verifies and deletes a probe in a local folder', async () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      org('S3', null);
      const result = await service.test('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'probe-root' } });
      expect(result).toEqual({ ok: true, provider: 'LOCAL_FILESYSTEM', passed: ['configure', 'write', 'read', 'verify', 'delete'], failedStep: null, code: null, message: null, sharepoint: null });
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('reports configure when the settings themselves are unusable', async () => {
      org('S3', null);
      const result = await service.test('org-a', { provider: 'MINIO', minio: { ...MINIO, endpoint: 'https://10.0.0.5' } });
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'configure', code: 'STORAGE_ENDPOINT_NOT_ALLOWED', passed: [] }));
    });

    it("reports write, without the provider's own words", async () => {
      org('MINIO', { minio: MINIO });
      useProvider(fakeProvider({ failPut: true }));
      const result = await service.test('org-a', {});
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'write', code: 'STORAGE_UNAVAILABLE', passed: ['configure'] }));
      expect(JSON.stringify(result)).not.toContain('minio.example.com');
    });

    it('reports verify when what comes back is not what was written', async () => {
      org('MINIO', { minio: MINIO });
      useProvider(fakeProvider({ readBack: 'other' }));
      const result = await service.test('org-a', {});
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'verify', passed: ['configure', 'write', 'read'] }));
    });
  });

  itEnforcesTenantIsolation("confirm reads and writes the caller's own organisation only", async () => {
    org('S3', null);
    await service.confirm('org-b', { provider: 'S3' }, 'admin-1');
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    expect(prisma.organization.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b', storageConfirmedAt: null } }));
  });

  itEnforcesTenantIsolation("update reads and writes the caller's own organisation only", async () => {
    org('S3', null);
    await service.update('org-b', { provider: 'S3' }, 'admin-1');
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
  });

  itEnforcesTenantIsolation("requestChange stamps the caller's own organisation only", async () => {
    org('S3', null, true);
    await service.requestChange('org-b', {}, 'admin-1');
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    expect(notices.storageChangeRequested).toHaveBeenCalledWith('org-b', 'admin-1', expect.any(Date), null);
  });

  itEnforcesTenantIsolation("test writes its probe under the caller's own organisation", async () => {
    org('MINIO', { minio: MINIO });
    const p = fakeProvider();
    useProvider(p);
    await service.test('org-b', {});
    expect(p.put.mock.calls[0]![0]).toMatch(/^org-b\/_probe\//);
  });
});
