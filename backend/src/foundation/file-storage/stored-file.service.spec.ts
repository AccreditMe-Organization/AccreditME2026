import { StoredFileService } from './stored-file.service';
import { StorageRefusalException } from './storage-refusal';
import { StorageResolverService } from './storage-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { readDownloadToken } from './download-token';

const GIB = 1024 ** 3;
const PDF = { originalname: 'محضر.pdf', mimetype: 'application/octet-stream', size: 9, buffer: Buffer.from('%PDF-1.7\n') };
const OWNER = { type: 'TASK' as const, id: 'task1', module: 'tasks' };

async function refusal(promise: Promise<unknown>): Promise<{ code: string; body: Record<string, unknown> } | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageRefusalException) return { code: error.code, body: error.getResponse() as Record<string, unknown> };
    throw error;
  }
  return undefined;
}

describe('StoredFileService (ACC-177)', () => {
  const provider = {
    put: jest.fn().mockResolvedValue(undefined),
    getStream: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    signedDownloadUrl: jest.fn().mockResolvedValue('https://signed.example/x'),
  };
  const location = { provider: 'S3' as const, bucket: 'accreditme-files', endpoint: null, rootPath: null };
  const resolver = {
    forUpload: jest.fn().mockResolvedValue({ provider, location }),
    forFile: jest.fn().mockResolvedValue(provider),
  };
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue({ maxStorageGb: 10 }) },
    storedFile: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      create: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'file-1', ...args.data })),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const service = new StoredFileService(prisma as unknown as PrismaService, resolver as unknown as StorageResolverService);
  const savedCap = process.env['MAX_UPLOAD_MB'];
  const savedKey = process.env['ENCRYPTION_KEY'];

  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = 'd'.repeat(64);
  });
  afterAll(() => {
    process.env['ENCRYPTION_KEY'] = savedKey;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    if (savedCap === undefined) delete process.env['MAX_UPLOAD_MB'];
    else process.env['MAX_UPLOAD_MB'] = savedCap;
  });

  describe('prepare', () => {
    it('judges the file, keeps its Arabic name, decides its type and builds a server-side key', async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);

      expect(prepared.originalName).toBe('محضر.pdf');
      expect(prepared.mimeType).toBe('application/pdf'); // not the client's octet-stream
      expect(prepared.storageKey).toMatch(/^org-a\/tasks\/task1\/[0-9a-f]{20}-file\.pdf$/);
      expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prepared.location).toEqual(location);
    });

    it.each([
      ['no file', undefined, 'FILE_MISSING'],
      ['an empty file', { ...PDF, size: 0, buffer: Buffer.alloc(0) }, 'FILE_EMPTY'],
      ['a type not on the list', { ...PDF, originalname: 'x.svg' }, 'FILE_TYPE_NOT_ALLOWED'],
      ['content that is not what the name says', { ...PDF, buffer: Buffer.from('MZ\x90') }, 'FILE_TYPE_NOT_ALLOWED'],
    ])('refuses %s before storage is touched', async (_label, file, code) => {
      expect((await refusal(service.prepare('org-a', OWNER, file)))?.code).toBe(code);
      expect(resolver.forUpload).not.toHaveBeenCalled();
    });

    it('refuses a file over the 25 MB cap, naming the cap', async () => {
      const big = { ...PDF, size: 25 * 1024 * 1024 + 1 };
      const result = await refusal(service.prepare('org-a', OWNER, big));
      expect(result?.code).toBe('FILE_TOO_LARGE');
      expect(result?.body['maxBytes']).toBe(25 * 1024 * 1024);
    });

    it('honours MAX_UPLOAD_MB', async () => {
      process.env['MAX_UPLOAD_MB'] = '1';
      const result = await refusal(service.prepare('org-a', OWNER, { ...PDF, size: 1024 * 1024 + 1 }));
      expect(result?.body['maxBytes']).toBe(1024 * 1024);
    });

    it('refuses an upload that would pass the organisation\'s storage limit, counted from live files', async () => {
      prisma.storedFile.aggregate.mockResolvedValueOnce({ _sum: { sizeBytes: 10 * GIB - 4 } });
      expect((await refusal(service.prepare('org-a', OWNER, PDF)))?.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(prisma.storedFile.aggregate).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', deletedAt: null },
        _sum: { sizeBytes: true },
      });
    });
  });

  describe('recordInTx', () => {
    it('takes the organisation\'s quota lock, checks again, then writes the row with its location', async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);
      const row = await service.recordInTx(prisma as never, prepared, 'user-1');

      const [fragments, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(fragments.join('?')).toContain('pg_advisory_xact_lock');
      expect(values).toEqual(['stored-file-quota:org-a']);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.storedFile.create.mock.invocationCallOrder[0]!);
      expect(row).toEqual(
        expect.objectContaining({
          organizationId: 'org-a',
          provider: 'S3',
          bucket: 'accreditme-files',
          ownerType: 'TASK',
          ownerId: 'task1',
          uploadedById: 'user-1',
          sizeBytes: 9,
        }),
      );
    });

    it('two uploads racing for the last bytes: the second is refused under the lock', async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);
      prisma.storedFile.aggregate.mockResolvedValueOnce({ _sum: { sizeBytes: 10 * GIB - 5 } });
      expect((await refusal(service.recordInTx(prisma as never, prepared, 'user-1')))?.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(prisma.storedFile.create).not.toHaveBeenCalled();
    });
  });

  it('put() failing is "storage couldn\'t be reached", and the provider\'s words stay in the log', async () => {
    const prepared = await service.prepare('org-a', OWNER, PDF);
    provider.put.mockRejectedValueOnce(Object.assign(new Error('NoSuchBucket: accreditme-files'), { name: 'NoSuchBucket' }));
    const result = await refusal(service.put(prepared));
    expect(result?.code).toBe('STORAGE_UNAVAILABLE');
    expect(JSON.stringify(result?.body)).not.toContain('accreditme-files');
  });

  it('discard() deletes what put() wrote and never throws', async () => {
    const prepared = await service.prepare('org-a', OWNER, PDF);
    provider.delete.mockRejectedValueOnce(new Error('gone'));
    await expect(service.discard(prepared)).resolves.toBeUndefined();
    expect(provider.delete).toHaveBeenCalledWith(prepared.storageKey);
  });

  describe('openDownload', () => {
    const file = {
      id: 'file-1',
      organizationId: 'org-a',
      provider: 'S3' as const,
      bucket: 'accreditme-files',
      endpoint: null,
      rootPath: null,
      storageKey: 'org-a/tasks/task1/x-file.pdf',
      originalName: 'محضر.pdf',
      mimeType: 'application/pdf',
    };

    it('S3 and MinIO: a pre-signed URL valid fifteen minutes, carrying the original name', async () => {
      const download = await service.openDownload(file);
      expect(download).toEqual({ url: 'https://signed.example/x', viaApi: false, expiresAt: expect.any(String) });
      expect(provider.signedDownloadUrl).toHaveBeenCalledWith(file.storageKey, 900, {
        fileName: 'محضر.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('a local folder: a token URL on this API naming that file in that organisation', async () => {
      resolver.forFile.mockResolvedValueOnce({ ...provider, signedDownloadUrl: undefined });
      const download = await service.openDownload({ ...file, provider: 'LOCAL_FILESYSTEM', rootPath: 'root' });
      expect(download.viaApi).toBe(true);
      const token = download.url.replace('files/stream/', '');
      expect(readDownloadToken(token)).toEqual({ fileId: 'file-1', organizationId: 'org-a' });
    });
  });

  itEnforcesTenantIsolation('usageBytes counts only the organisation\'s own live files', async () => {
    await service.usageBytes(prisma as never, 'org-b');
    expect(prisma.storedFile.aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'org-b', deletedAt: null },
      _sum: { sizeBytes: true },
    });
  });

  itEnforcesTenantIsolation('liveFilesAt counts only the organisation\'s own files at that location', async () => {
    await service.liveFilesAt('org-b', { provider: 'MINIO', bucket: 'b', endpoint: 'https://m', rootPath: null });
    expect(prisma.storedFile.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-b', deletedAt: null, provider: 'MINIO', bucket: 'b', endpoint: 'https://m', rootPath: null },
    });
  });

  itEnforcesTenantIsolation('softDeleteInTx updates by id AND organisation', async () => {
    await service.softDeleteInTx(prisma as never, 'file-1', 'org-b', 'user-1');
    expect(prisma.storedFile.update).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-b' },
      data: { deletedAt: expect.any(Date), deletedById: 'user-1' },
    });
  });
});
