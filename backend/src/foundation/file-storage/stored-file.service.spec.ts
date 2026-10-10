import { StoredFileService } from './stored-file.service';
import { StorageRefusalException } from './storage-refusal';
import { StorageResolverService } from './storage-resolver.service';
import { StorageNoticesService } from './storage-notices.service';
import { SharePointAccessService } from './sharepoint-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { readDownloadToken } from './download-token';

const GIB = 1024 ** 3;
const PDF = { originalname: 'محضر.pdf', mimetype: 'application/octet-stream', size: 9, buffer: Buffer.from('%PDF-1.7\n') };
const OWNER = { type: 'TASK' as const, id: 'task1', module: 'tasks' };
const CONFIRMED = { maxStorageGb: 10, storageConfirmedAt: new Date('2026-10-07T08:00:00Z') };

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
  const s3 = { provider: 'S3' as const, bucket: 'accreditme-files', endpoint: null, rootPath: null };
  const minio = { provider: 'MINIO' as const, bucket: 'evidence', endpoint: 'https://minio.example.com', rootPath: null };
  const resolver = {
    forUpload: jest.fn(),
    forFile: jest.fn(),
  };
  const prisma = {
    organization: { findFirst: jest.fn(), updateMany: jest.fn() },
    storedFile: {
      aggregate: jest.fn(),
      create: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'file-1', ...args.data })),
      update: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const notices = { storageAlmostFull: jest.fn().mockResolvedValue(undefined) };
  // ACC-185 — S3/MinIO/local failures are never a SharePoint withdrawal.
  const sharePointAccess = { refusalFor: jest.fn().mockResolvedValue(null) };
  const service = new StoredFileService(
    prisma as unknown as PrismaService,
    resolver as unknown as StorageResolverService,
    notices as unknown as StorageNoticesService,
    sharePointAccess as unknown as SharePointAccessService,
  );
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
    prisma.organization.findFirst.mockResolvedValue(CONFIRMED);
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });
    prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
    resolver.forUpload.mockResolvedValue({ provider, location: s3 });
    resolver.forFile.mockResolvedValue(provider);
  });

  describe('prepare', () => {
    it('refuses every upload until the organisation has confirmed where files go — before anything else', async () => {
      prisma.organization.findFirst.mockResolvedValue({ maxStorageGb: 10, storageConfirmedAt: null });
      const result = await refusal(service.prepare('org-a', OWNER, undefined));
      expect(result?.code).toBe('STORAGE_NOT_CONFIRMED');
      expect(result?.body['message']).toBe("File storage isn't set up yet. Ask your administrator.");
      expect(resolver.forUpload).not.toHaveBeenCalled();
    });

    it('judges the file, keeps its Arabic name, decides its type and builds a server-side key', async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);

      expect(prepared.originalName).toBe('محضر.pdf');
      expect(prepared.mimeType).toBe('application/pdf'); // not the client's octet-stream
      expect(prepared.storageKey).toMatch(/^org-a\/tasks\/task1\/[0-9a-f]{20}-file\.pdf$/);
      expect(prepared.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(prepared.location).toEqual(s3);
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
      const result = await refusal(service.prepare('org-a', OWNER, { ...PDF, size: 25 * 1024 * 1024 + 1 }));
      expect(result?.code).toBe('FILE_TOO_LARGE');
      expect(result?.body['maxBytes']).toBe(25 * 1024 * 1024);
    });

    it('honours MAX_UPLOAD_MB', async () => {
      process.env['MAX_UPLOAD_MB'] = '1';
      const result = await refusal(service.prepare('org-a', OWNER, { ...PDF, size: 1024 * 1024 + 1 }));
      expect(result?.body['maxBytes']).toBe(1024 * 1024);
    });

    it('refuses an upload that would pass the limit — counting AccreditMe-cloud files not yet purged, deleted ones included', async () => {
      prisma.storedFile.aggregate.mockResolvedValueOnce({ _sum: { sizeBytes: 10 * GIB - 4 } });
      expect((await refusal(service.prepare('org-a', OWNER, PDF)))?.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(prisma.storedFile.aggregate).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', provider: 'S3', purgedAt: null },
        _sum: { sizeBytes: true },
      });
    });

    it("does not count a customer's own MinIO against the limit", async () => {
      resolver.forUpload.mockResolvedValue({ provider, location: minio });
      prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 50 * GIB } });
      await expect(service.prepare('org-a', OWNER, PDF)).resolves.toEqual(expect.objectContaining({ location: minio }));
      expect(prisma.storedFile.aggregate).not.toHaveBeenCalled();
    });
  });

  describe('recordInTx', () => {
    it("takes the organisation's quota lock, checks again, then writes the row with its location", async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);
      const row = await service.recordInTx(prisma as never, prepared, 'user-1');

      const [fragments, ...values] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
      expect(fragments.join('?')).toContain('pg_advisory_xact_lock');
      expect(values).toEqual(['stored-file-quota:org-a']);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.storedFile.create.mock.invocationCallOrder[0]!);
      expect(row).toEqual(
        expect.objectContaining({ organizationId: 'org-a', provider: 'S3', bucket: 'accreditme-files', ownerType: 'TASK', ownerId: 'task1', uploadedById: 'user-1', sizeBytes: 9 }),
      );
    });

    it('two uploads racing for the last bytes: the second is refused under the lock', async () => {
      const prepared = await service.prepare('org-a', OWNER, PDF);
      prisma.storedFile.aggregate.mockResolvedValueOnce({ _sum: { sizeBytes: 10 * GIB - 5 } });
      expect((await refusal(service.recordInTx(prisma as never, prepared, 'user-1')))?.code).toBe('STORAGE_QUOTA_EXCEEDED');
      expect(prisma.storedFile.create).not.toHaveBeenCalled();
    });
  });

  describe('the 90% warning', () => {
    it('stamps storageWarnedAt and tells the tenant admins once, when usage reaches 90%', async () => {
      prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 9 * GIB } });
      prisma.organization.updateMany.mockResolvedValueOnce({ count: 1 });
      await service.reviewWarning('org-a');

      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-a', storageWarnedAt: null },
        data: { storageWarnedAt: expect.any(Date) },
      });
      expect(notices.storageAlmostFull).toHaveBeenCalledWith('org-a', 9 * GIB, 10 * GIB);
    });

    it('does not tell them again while the stamp is set', async () => {
      prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 9.5 * GIB } });
      prisma.organization.updateMany.mockResolvedValueOnce({ count: 0 });
      await service.reviewWarning('org-a');
      expect(notices.storageAlmostFull).not.toHaveBeenCalled();
    });

    it('clears the stamp when usage drops below 90%, so the next crossing tells them again', async () => {
      prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 8 * GIB } });
      await service.reviewWarning('org-a');
      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-a', storageWarnedAt: { not: null } },
        data: { storageWarnedAt: null },
      });
      expect(notices.storageAlmostFull).not.toHaveBeenCalled();
    });

    it("an upload to a customer's own MinIO never warns", async () => {
      resolver.forUpload.mockResolvedValue({ provider, location: minio });
      const prepared = await service.prepare('org-a', OWNER, PDF);
      await service.afterUpload(prepared);
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });
  });

  it("put() failing is \"storage couldn't be reached\", and the provider's words stay in the log", async () => {
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
    expect(provider.delete).toHaveBeenCalledWith(prepared.storageKey, null);
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
      deletedAt: null,
    };

    it('S3 and MinIO: a pre-signed URL valid fifteen minutes, carrying the original name', async () => {
      const download = await service.openDownload(file);
      expect(download).toEqual({ url: 'https://signed.example/x', viaApi: false, expiresAt: expect.any(String) });
      expect(provider.signedDownloadUrl).toHaveBeenCalledWith(file.storageKey, 900, { fileName: 'محضر.pdf', mimeType: 'application/pdf' });
    });

    it('a local folder: a token URL on this API naming that file in that organisation', async () => {
      resolver.forFile.mockResolvedValueOnce({ ...provider, signedDownloadUrl: undefined });
      const download = await service.openDownload({ ...file, provider: 'LOCAL_FILESYSTEM', rootPath: 'root' });
      expect(download.viaApi).toBe(true);
      expect(readDownloadToken(download.url.replace('files/stream/', ''))).toEqual({ fileId: 'file-1', organizationId: 'org-a' });
    });

    it('a deleted file can never be downloaded, whatever the caller checked', async () => {
      expect((await refusal(service.openDownload({ ...file, deletedAt: new Date() })))?.code).toBe('FILE_UNAVAILABLE');
      expect(provider.signedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('openView (ACC-189)', () => {
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
      deletedAt: null,
    };

    it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'text/csv'])(
      '%s: the same fifteen-minute URL a download gets (still an attachment)',
      async (mimeType) => {
        const view = await service.openView({ ...file, mimeType });
        expect(view).toEqual({ url: 'https://signed.example/x', viaApi: false, expiresAt: expect.any(String) });
        expect(provider.signedDownloadUrl).toHaveBeenCalledWith(file.storageKey, 900, { fileName: 'محضر.pdf', mimeType });
      },
    );

    it.each([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'image/heic',
      'image/heif',
    ])('%s: 409 PREVIEW_NOT_AVAILABLE, and nothing is signed', async (mimeType) => {
      const r = await refusal(service.openView({ ...file, mimeType }));
      expect(r?.code).toBe('PREVIEW_NOT_AVAILABLE');
      expect(r?.body['statusCode']).toBe(409);
      expect(provider.signedDownloadUrl).not.toHaveBeenCalled();
    });

    it('a deleted file is refused before its type is looked at', async () => {
      const r = await refusal(service.openView({ ...file, mimeType: 'image/heic', deletedAt: new Date() }));
      expect(r?.code).toBe('FILE_UNAVAILABLE');
      expect(provider.signedDownloadUrl).not.toHaveBeenCalled();
    });
  });

  it('a delete hides the file and keeps its bytes — it is in the recycle bin', async () => {
    await service.softDeleteInTx(prisma as never, 'file-1', 'org-a', 'user-1');
    expect(prisma.storedFile.update).toHaveBeenCalledWith({
      where: { id: 'file-1', organizationId: 'org-a' },
      data: { deletedAt: expect.any(Date), deletedById: 'user-1' },
    });
    expect(provider.delete).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("cloudUsageBytes counts only the organisation's own files", async () => {
    await service.cloudUsageBytes(prisma as never, 'org-b');
    expect(prisma.storedFile.aggregate).toHaveBeenCalledWith({
      where: { organizationId: 'org-b', provider: 'S3', purgedAt: null },
      _sum: { sizeBytes: true },
    });
  });

  itEnforcesTenantIsolation('the confirmation and the warning read and stamp only the caller organisation', async () => {
    prisma.storedFile.aggregate.mockResolvedValue({ _sum: { sizeBytes: 9.9 * GIB } });
    await service.reviewWarning('org-b');
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { id: 'org-b' }, select: { maxStorageGb: true } });
    expect(prisma.organization.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b', storageWarnedAt: null } }));
  });

  itEnforcesTenantIsolation('softDeleteInTx updates by id AND organisation', async () => {
    await service.softDeleteInTx(prisma as never, 'file-1', 'org-b', 'user-1');
    expect(prisma.storedFile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'file-1', organizationId: 'org-b' } }));
  });
});
