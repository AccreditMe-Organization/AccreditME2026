import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageResolverService } from './storage-resolver.service';
import { StorageRefusalException } from './storage-refusal';
import { writeStorageConfig } from './storage-config';
import { S3CompatibleStorageProvider } from '../../providers/storage/s3-compatible-storage.provider';
import { LocalFilesystemStorageProvider } from '../../providers/storage/local-filesystem-storage.provider';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { PrismaService } from '../../prisma/prisma.service';

const ENV_KEYS = [
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_S3_ENDPOINT',
  'AWS_S3_FORCE_PATH_STYLE',
  'LOCAL_STORAGE_BASE',
  'STORAGE_ALLOW_PRIVATE_ENDPOINTS',
  'ENCRYPTION_KEY',
];

const MINIO = {
  endpoint: 'https://minio.example.com',
  region: 'us-east-1',
  bucket: 'evidence',
  accessKeyId: 'minio-access',
  secretAccessKey: 'minio-secret-key',
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof StorageRefusalException) return error.code;
    throw error;
  }
  return undefined;
}

async function codeOfAsync(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageRefusalException) return error.code;
    throw error;
  }
  return undefined;
}

describe('StorageResolverService (ACC-177)', () => {
  const saved: Record<string, string | undefined> = {};
  const prisma = { organization: { findFirst: jest.fn() } };
  const resolver = new StorageResolverService(prisma as unknown as PrismaService);
  let base: string;

  beforeAll(async () => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    base = await mkdtemp(join(tmpdir(), 'acc177-base-'));
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(base, { recursive: true, force: true });
  });
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
    jest.clearAllMocks();
  });

  const setPlatformS3 = () => {
    process.env['AWS_REGION'] = 'eu-central-1';
    process.env['AWS_S3_BUCKET'] = 'accreditme-files';
    process.env['AWS_ACCESS_KEY_ID'] = 'AKIA';
    process.env['AWS_SECRET_ACCESS_KEY'] = 'secret';
  };

  describe('S3 — AccreditMe\'s own bucket', () => {
    it('refuses "File storage isn\'t set up yet" when any platform value is missing — never a default region', () => {
      setPlatformS3();
      delete process.env['AWS_REGION'];
      expect(codeOf(() => resolver.forCandidate('S3', {}))).toBe('STORAGE_NOT_CONFIGURED');

      setPlatformS3();
      delete process.env['AWS_S3_BUCKET'];
      expect(codeOf(() => resolver.forCandidate('S3', {}))).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('builds from platform env and records the bucket as the file\'s location', () => {
      setPlatformS3();
      const resolved = resolver.forCandidate('S3', {});
      expect(resolved.provider).toBeInstanceOf(S3CompatibleStorageProvider);
      expect(resolved.location).toEqual({ provider: 'S3', bucket: 'accreditme-files', endpoint: null, rootPath: null });
    });
  });

  describe('MinIO — the customer\'s endpoint', () => {
    it('needs every field', () => {
      expect(codeOf(() => resolver.forCandidate('MINIO', { minio: { ...MINIO, secretAccessKey: undefined } }))).toBe(
        'STORAGE_NOT_CONFIGURED',
      );
    });

    it('is HTTPS only on the cloud tier', () => {
      expect(codeOf(() => resolver.forCandidate('MINIO', { minio: { ...MINIO, endpoint: 'http://minio.example.com' } }))).toBe(
        'STORAGE_ENDPOINT_NOT_ALLOWED',
      );
    });

    it('refuses a private IP literal on the cloud tier', () => {
      expect(codeOf(() => resolver.forCandidate('MINIO', { minio: { ...MINIO, endpoint: 'https://10.0.0.5:9000' } }))).toBe(
        'STORAGE_ENDPOINT_NOT_ALLOWED',
      );
      expect(codeOf(() => resolver.forCandidate('MINIO', { minio: { ...MINIO, endpoint: 'https://169.254.169.254' } }))).toBe(
        'STORAGE_ENDPOINT_NOT_ALLOWED',
      );
    });

    it('allows a private http endpoint where the installation says so (Tier 2/3)', () => {
      process.env['STORAGE_ALLOW_PRIVATE_ENDPOINTS'] = 'true';
      const resolved = resolver.forCandidate('MINIO', { minio: { ...MINIO, endpoint: 'http://10.0.0.5:9000' } });
      expect(resolved.location).toEqual({ provider: 'MINIO', bucket: 'evidence', endpoint: 'http://10.0.0.5:9000', rootPath: null });
    });
  });

  describe('Local folder', () => {
    it('is not offered unless LOCAL_STORAGE_BASE is set', () => {
      expect(resolver.offeredProviders()).toEqual(['S3', 'MINIO']);
      expect(codeOf(() => resolver.forCandidate('LOCAL_FILESYSTEM', { local: { rootPath: 'org' } }))).toBe(
        'STORAGE_PROVIDER_NOT_ALLOWED',
      );
    });

    it('confines the root inside the base', () => {
      process.env['LOCAL_STORAGE_BASE'] = base;
      expect(resolver.offeredProviders()).toContain('LOCAL_FILESYSTEM');
      expect(resolver.forCandidate('LOCAL_FILESYSTEM', { local: { rootPath: 'hospital-a' } }).provider).toBeInstanceOf(
        LocalFilesystemStorageProvider,
      );
      for (const rootPath of ['../elsewhere', '/etc', 'a/../../b']) {
        expect(codeOf(() => resolver.forCandidate('LOCAL_FILESYSTEM', { local: { rootPath } }))).toBe(
          'STORAGE_PROVIDER_NOT_ALLOWED',
        );
      }
    });
  });

  describe('forFile — each file reads from where it was written', () => {
    it('an S3 file whose bucket is no longer the platform\'s is unavailable, not read from the new one', async () => {
      setPlatformS3();
      const code = await codeOfAsync(
        resolver.forFile({ organizationId: 'org-a', provider: 'S3', bucket: 'old-bucket', endpoint: null, rootPath: null }),
      );
      expect(code).toBe('FILE_UNAVAILABLE');
    });

    it('a MinIO file is read with the organisation\'s MinIO settings while its endpoint and bucket match', async () => {
      prisma.organization.findFirst.mockResolvedValue({ storageConfig: writeStorageConfig({ minio: MINIO }) });
      const provider = await resolver.forFile({
        organizationId: 'org-a',
        provider: 'MINIO',
        bucket: 'evidence',
        endpoint: 'https://minio.example.com',
        rootPath: null,
      });
      expect(provider).toBeInstanceOf(S3CompatibleStorageProvider);

      const code = await codeOfAsync(
        resolver.forFile({ organizationId: 'org-a', provider: 'MINIO', bucket: 'other', endpoint: MINIO.endpoint, rootPath: null }),
      );
      expect(code).toBe('FILE_UNAVAILABLE');
    });

    itEnforcesTenantIsolation('forFile reads the storage settings of the FILE\'S organisation only', async () => {
      prisma.organization.findFirst.mockResolvedValue({ storageConfig: writeStorageConfig({ minio: MINIO }) });
      await resolver.forFile({ organizationId: 'org-b', provider: 'MINIO', bucket: 'evidence', endpoint: MINIO.endpoint, rootPath: null });
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { id: 'org-b' }, select: { storageConfig: true } });
    });

    itEnforcesTenantIsolation('forUpload reads the calling organisation\'s provider only', async () => {
      setPlatformS3();
      prisma.organization.findFirst.mockResolvedValue({ storageProvider: 'S3', storageConfig: null });
      await resolver.forUpload('org-a');
      expect(prisma.organization.findFirst).toHaveBeenCalledWith({
        where: { id: 'org-a' },
        select: { storageProvider: true, storageConfig: true },
      });
    });
  });
});
