import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { StorageSettingsService } from './storage-settings.service';
import { StorageResolverService } from './storage-resolver.service';
import { StoredFileService } from './stored-file.service';
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

describe('StorageSettingsService (ACC-177)', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
  };
  const storedFiles = {
    usageBytes: jest.fn().mockResolvedValue(1234),
    liveFilesAt: jest.fn().mockResolvedValue(0),
  };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const resolver = new StorageResolverService(prisma as unknown as PrismaService);
  const service = new StorageSettingsService(
    prisma as unknown as PrismaService,
    resolver,
    storedFiles as unknown as StoredFileService,
    auditLog as unknown as AuditLogService,
  );
  const saved = { key: process.env['ENCRYPTION_KEY'], base: process.env['LOCAL_STORAGE_BASE'], priv: process.env['STORAGE_ALLOW_PRIVATE_ENDPOINTS'] };
  let base: string;

  const org = (storageProvider: string, config: object | null) =>
    prisma.organization.findFirst.mockResolvedValue({
      storageProvider,
      storageConfig: config ? writeStorageConfig(config) : null,
      maxStorageGb: 10,
    });
  const savedConfig = () => readStorageConfig((prisma.organization.update.mock.calls[0]![0] as { data: { storageConfig: string } }).data.storageConfig);

  beforeAll(async () => {
    process.env['ENCRYPTION_KEY'] = 'e'.repeat(64);
    base = await mkdtemp(join(tmpdir(), 'acc177-settings-'));
  });
  afterAll(async () => {
    process.env['ENCRYPTION_KEY'] = saved.key;
    if (saved.base === undefined) delete process.env['LOCAL_STORAGE_BASE'];
    else process.env['LOCAL_STORAGE_BASE'] = saved.base;
    if (saved.priv === undefined) delete process.env['STORAGE_ALLOW_PRIVATE_ENDPOINTS'];
    else process.env['STORAGE_ALLOW_PRIVATE_ENDPOINTS'] = saved.priv;
    await rm(base, { recursive: true, force: true });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    delete process.env['LOCAL_STORAGE_BASE'];
    delete process.env['STORAGE_ALLOW_PRIVATE_ENDPOINTS'];
  });

  describe('get', () => {
    it('answers the secrets as "set" — never their values', async () => {
      org('MINIO', { minio: MINIO });
      const settings = await service.get('org-a');

      expect(settings.minio).toEqual({
        endpoint: MINIO.endpoint,
        region: MINIO.region,
        bucket: MINIO.bucket,
        accessKeyId: 'set',
        secretAccessKey: 'set',
      });
      expect(JSON.stringify(settings)).not.toContain('minio-secret-key');
      expect(JSON.stringify(settings)).not.toContain('minio-access');
      expect(settings.usage).toEqual({ usedBytes: 1234, maxStorageGb: 10 });
      expect(settings.offeredProviders).toEqual(['S3', 'MINIO']);
    });

    it('answers null for a secret never set', async () => {
      org('S3', null);
      expect((await service.get('org-a')).minio.secretAccessKey).toBeNull();
    });
  });

  describe('update', () => {
    it('keeps a stored secret the request omits, and audits field NAMES only', async () => {
      org('MINIO', { minio: MINIO });
      await service.update('org-a', { provider: 'MINIO', minio: { region: 'eu-west-1' } }, 'admin-1');

      expect(savedConfig().minio).toEqual({ ...MINIO, region: 'eu-west-1' });
      const audit = auditLog.log.mock.calls[0]![0] as Record<string, unknown>;
      expect(audit['metadata']).toEqual({ event: 'storage_settings_updated', changedFields: ['minio.region'] });
      expect(JSON.stringify(audit)).not.toContain('minio-secret-key');
    });

    it('replacing the keys for the same endpoint and bucket is allowed, with files there', async () => {
      org('MINIO', { minio: MINIO });
      storedFiles.liveFilesAt.mockResolvedValue(4);
      await service.update('org-a', { provider: 'MINIO', minio: { accessKeyId: 'new-access', secretAccessKey: 'new-secret-key' } }, 'admin-1');
      expect(savedConfig().minio?.secretAccessKey).toBe('new-secret-key');
    });

    it('changing the endpoint or bucket while files are stored there is refused, naming how many', async () => {
      org('MINIO', { minio: MINIO });
      storedFiles.liveFilesAt.mockResolvedValue(3);
      let error: unknown;
      try {
        await service.update('org-a', { provider: 'MINIO', minio: { bucket: 'another-bucket' } }, 'admin-1');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(StorageRefusalException);
      expect((error as StorageRefusalException).getResponse()).toEqual(
        expect.objectContaining({
          statusCode: 409,
          code: 'STORAGE_LOCATION_IN_USE',
          fileCount: 3,
          message: '3 files are stored at this location. Changing it would make them unreadable.',
        }),
      );
      expect(storedFiles.liveFilesAt).toHaveBeenCalledWith('org-a', {
        provider: 'MINIO',
        endpoint: MINIO.endpoint,
        bucket: MINIO.bucket,
        rootPath: null,
      });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('changing the Local root while files are stored there is refused', async () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      org('LOCAL_FILESYSTEM', { local: { rootPath: 'hospital-a' } });
      storedFiles.liveFilesAt.mockResolvedValue(1);
      await expect(
        service.update('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'hospital-b' } }, 'admin-1'),
      ).rejects.toThrow('1 file is stored at this location. Changing it would make it unreadable.');
    });

    it('switching provider is allowed and keeps the old MinIO settings, so its files stay readable', async () => {
      org('MINIO', { minio: MINIO });
      storedFiles.liveFilesAt.mockResolvedValue(7);
      await service.update('org-a', { provider: 'S3' }, 'admin-1');

      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-a' }, data: expect.objectContaining({ storageProvider: 'S3' }) }),
      );
      expect(savedConfig().minio).toEqual(MINIO);
    });

    it('MinIO without every field is refused', async () => {
      org('S3', null);
      await expect(service.update('org-a', { provider: 'MINIO', minio: { endpoint: MINIO.endpoint } }, 'admin-1')).rejects.toThrow(
        'Fill in every setting this storage option needs',
      );
    });

    it('a Local folder is refused where the installation does not offer it', async () => {
      org('S3', null);
      await expect(service.update('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'x' } }, 'admin-1')).rejects.toThrow(
        "This storage option isn't available on this installation",
      );
    });

    itEnforcesTenantIsolation('update reads and writes the caller\'s own organisation only', async () => {
      org('S3', null);
      await service.update('org-b', { provider: 'S3' }, 'admin-1');
      expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
      expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    });
  });

  describe('test connection — saves nothing', () => {
    it('writes, reads back, verifies and deletes a probe in a local folder', async () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      org('S3', null);
      const result = await service.test('org-a', { provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'probe-root' } });

      expect(result).toEqual({ ok: true, provider: 'LOCAL_FILESYSTEM', passed: ['configure', 'write', 'read', 'verify', 'delete'], failedStep: null, code: null, message: null });
      expect(await readdir(join(base, 'probe-root', 'org-a', '_probe'))).toEqual([]);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('reports configure when the settings themselves are unusable', async () => {
      org('S3', null);
      const result = await service.test('org-a', { provider: 'MINIO', minio: { ...MINIO, endpoint: 'https://10.0.0.5' } });
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'configure', code: 'STORAGE_ENDPOINT_NOT_ALLOWED', passed: [] }));
    });

    it('reports write, without the provider\'s own words', async () => {
      org('MINIO', { minio: MINIO });
      jest.spyOn(resolver, 'forCandidate').mockReturnValue({
        provider: {
          put: jest.fn().mockRejectedValue(Object.assign(new Error('AccessDenied for minio.example.com'), { name: 'AccessDenied' })),
          getStream: jest.fn(),
          delete: jest.fn(),
        },
        location: { provider: 'MINIO', bucket: 'evidence', endpoint: MINIO.endpoint, rootPath: null },
      });
      const result = await service.test('org-a', {});
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'write', code: 'STORAGE_UNAVAILABLE', passed: ['configure'] }));
      expect(JSON.stringify(result)).not.toContain('minio.example.com');
    });

    it('reports verify when what comes back is not what was written, and cleans up', async () => {
      org('MINIO', { minio: MINIO });
      const del = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(resolver, 'forCandidate').mockReturnValue({
        provider: { put: jest.fn().mockResolvedValue(undefined), getStream: jest.fn().mockResolvedValue(Readable.from([Buffer.from('other')])), delete: del },
        location: { provider: 'MINIO', bucket: 'evidence', endpoint: MINIO.endpoint, rootPath: null },
      });
      const result = await service.test('org-a', {});
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: 'verify', passed: ['configure', 'write', 'read'] }));
      expect(del).toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('test writes its probe under the caller\'s own organisation', async () => {
      org('MINIO', { minio: MINIO });
      const put = jest.fn().mockResolvedValue(undefined);
      jest.spyOn(resolver, 'forCandidate').mockReturnValue({
        provider: { put, getStream: jest.fn().mockRejectedValue(new Error('x')), delete: jest.fn() },
        location: { provider: 'MINIO', bucket: 'evidence', endpoint: MINIO.endpoint, rootPath: null },
      });
      await service.test('org-b', {});
      expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
      expect(put.mock.calls[0]![0]).toMatch(/^org-b\/_probe\//);
    });
  });
});
