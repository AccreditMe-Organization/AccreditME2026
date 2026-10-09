import { StoredFileService } from './stored-file.service';
import { StorageRefusalException } from './storage-refusal';
import { StorageResolverService } from './storage-resolver.service';
import { StorageNoticesService } from './storage-notices.service';
import { SharePointAccessService } from './sharepoint-access.service';
import { writeStorageConfig } from './storage-config';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { SharePointConnector } from '../../providers/storage/sharepoint/sharepoint-connector';
import { MicrosoftIdentity } from '../../providers/storage/sharepoint/microsoft-identity';
import { GraphClient } from '../../providers/storage/sharepoint/graph-client';
import { FAKE_DRIVE_ID, FAKE_LIST_ID, FAKE_SITE_ID, FAKE_TENANT_ID, fakeMicrosoft, FakeMicrosoftOptions } from '../../providers/storage/sharepoint/testing/fake-microsoft';

const PDF = { originalname: 'محضر.pdf', mimetype: 'application/octet-stream', size: 9, buffer: Buffer.from('%PDF-1.7\n') };
const OWNER = { type: 'TASK' as const, id: 'task1', module: 'tasks' };
const RESOLVED = {
  tenantId: FAKE_TENANT_ID,
  siteId: FAKE_SITE_ID,
  siteName: 'Quality',
  siteWebUrl: null,
  listId: FAKE_LIST_ID,
  driveId: FAKE_DRIVE_ID,
  libraryName: 'AccreditMe Files',
  libraryWebUrl: null,
  resolvedAt: '2026-10-08T00:00:00.000Z',
};
const CONFIG = {
  sharepoint: {
    tenant: FAKE_TENANT_ID,
    clientId: '99999999-8888-7777-6666-555555555555',
    clientSecret: 'secret-value-123',
    siteUrl: 'https://contoso.sharepoint.com/sites/Quality',
    libraryName: 'AccreditMe Files',
    resolved: RESOLVED,
  },
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageRefusalException) return error.code;
    throw error;
  }
  return undefined;
}

describe('SharePoint files — resolver and StoredFileService (ACC-185)', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    storedFile: {
      aggregate: jest.fn(),
      create: jest.fn((args: { data: Record<string, unknown> }) => Promise.resolve({ id: 'file-1', ...args.data })),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const notices = { storageAlmostFull: jest.fn(), sharePointAccessLost: jest.fn().mockResolvedValue(undefined) };
  const savedKey = process.env['ENCRYPTION_KEY'];

  const setup = (microsoft: FakeMicrosoftOptions = {}) => {
    const ms = fakeMicrosoft(microsoft);
    const connector = new SharePointConnector(new MicrosoftIdentity(ms.fetchFn), new GraphClient(ms.fetchFn, async () => undefined));
    const resolver = new StorageResolverService(prisma as unknown as PrismaService, connector);
    const access = new SharePointAccessService(prisma as unknown as PrismaService, resolver, notices as unknown as StorageNoticesService);
    const files = new StoredFileService(prisma as unknown as PrismaService, resolver, notices as unknown as StorageNoticesService, access);
    return { ms, resolver, files };
  };
  const org = (over: Record<string, unknown> = {}) =>
    prisma.organization.findFirst.mockResolvedValue({
      storageProvider: 'SHAREPOINT',
      storageConfirmedAt: new Date('2026-10-08'),
      storageConfig: writeStorageConfig(CONFIG),
      maxStorageGb: 10,
      ...over,
    });

  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = 'e'.repeat(64);
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env['ENCRYPTION_KEY'];
    else process.env['ENCRYPTION_KEY'] = savedKey;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('the resolver', () => {
    it('builds the upload provider from the ids Confirm recorded — no lookup', async () => {
      const { ms, resolver } = setup();
      org();
      const { location } = await resolver.forUpload('org-a');
      expect(location).toEqual({ provider: 'SHAREPOINT', bucket: null, endpoint: null, rootPath: null, msSiteId: FAKE_SITE_ID, msDriveId: FAKE_DRIVE_ID });
      expect(ms.calls).toEqual([]);
    });

    it('refuses a confirmed SharePoint organisation whose recorded location is missing', async () => {
      const { resolver } = setup();
      org({ storageConfig: writeStorageConfig({ sharepoint: { ...CONFIG.sharepoint, resolved: undefined } }) });
      expect(await codeOf(resolver.forUpload('org-a'))).toBe('STORAGE_NOT_CONFIGURED');
    });

    it('reads a file from its own library, and refuses one written to another', async () => {
      const { resolver } = setup();
      org();
      const file = { organizationId: 'org-a', provider: 'SHAREPOINT' as const, bucket: null, endpoint: null, rootPath: null };
      await expect(resolver.forFile({ ...file, msDriveId: FAKE_DRIVE_ID })).resolves.toBeDefined();
      expect(await codeOf(resolver.forFile({ ...file, msDriveId: 'b!another-library' }))).toBe('FILE_UNAVAILABLE');
      expect(await codeOf(resolver.forFile({ ...file, msDriveId: null }))).toBe('FILE_UNAVAILABLE');
    });
  });

  describe('upload, record, download, purge', () => {
    it('stores the file and records its site, library and item ids', async () => {
      const { ms, files } = setup();
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      await files.put(prepared);
      const row = await files.recordInTx(prisma as never, prepared, 'user-1');

      const put = ms.calls.find((c) => c.method === 'PUT')!;
      expect(decodeURIComponent(put.url)).toContain('/root:/AccreditMe/tasks/task1/');
      expect(row).toEqual(expect.objectContaining({ provider: 'SHAREPOINT', msSiteId: FAKE_SITE_ID, msDriveId: FAKE_DRIVE_ID, msItemId: 'item-1' }));
      // The per-organisation lock a racing Disconnect also takes.
      expect(prisma.$queryRaw).toHaveBeenCalled();
      // SharePoint files never count toward AccreditMe's quota.
      expect(prisma.storedFile.aggregate).not.toHaveBeenCalled();
    });

    it('refuses to record when the organisation left that library meanwhile — the caller discards the bytes', async () => {
      const { files } = setup();
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      await files.put(prepared);
      org({ storageProvider: 'S3', storageConfirmedAt: null, storageConfig: null });
      expect(await codeOf(files.recordInTx(prisma as never, prepared, 'user-1'))).toBe('STORAGE_NOT_CONFIRMED');
      expect(prisma.storedFile.create).not.toHaveBeenCalled();
    });

    it('a withdrawn grant refuses the upload STORAGE_ACCESS_WITHDRAWN, stamped once', async () => {
      const { files } = setup({ writeStatuses: [403] });
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      expect(await codeOf(files.put(prepared))).toBe('STORAGE_ACCESS_WITHDRAWN');
      expect(notices.sharePointAccessLost).toHaveBeenCalledTimes(1);
    });

    it('an expired secret refuses the upload the same way', async () => {
      const { files } = setup({ tokenErrorCodes: [7000222] });
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      expect(await codeOf(files.put(prepared))).toBe('STORAGE_ACCESS_WITHDRAWN');
      expect(prisma.organization.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ storageAccessLostReason: 'SECRET_INVALID' }) }),
      );
    });

    it('a throttled upload that outlasts the retries is STORAGE_UNAVAILABLE — not a withdrawal', async () => {
      const { files } = setup({ writeStatuses: [429, 429, 429], retryAfter: '1' });
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      expect(await codeOf(files.put(prepared))).toBe('STORAGE_UNAVAILABLE');
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('a download goes through the API — SharePoint has no signed URL', async () => {
      const { files } = setup();
      org();
      const download = await files.openDownload({
        id: 'file-1', organizationId: 'org-a', provider: 'SHAREPOINT', bucket: null, endpoint: null, rootPath: null,
        msDriveId: FAKE_DRIVE_ID, msItemId: 'item-1', storageKey: 'org-a/tasks/task1/x.pdf', originalName: 'x.pdf', mimeType: 'application/pdf', deletedAt: null,
      });
      expect(download.viaApi).toBe(true);
      expect(download.url).toMatch(/^files\/stream\//);
    });

    it('a purge deletes by item id — into the customer’s SharePoint recycle bin', async () => {
      const { ms, files } = setup();
      org();
      const prepared = await files.prepare('org-a', OWNER, PDF);
      await files.put(prepared);
      await files.removeBytes({
        organizationId: 'org-a', provider: 'SHAREPOINT', bucket: null, endpoint: null, rootPath: null,
        msDriveId: FAKE_DRIVE_ID, msItemId: 'item-1', storageKey: prepared.storageKey,
      });
      expect(ms.calls.at(-1)).toEqual(expect.objectContaining({ method: 'DELETE', url: expect.stringContaining('/items/item-1') }));
    });
  });

  itEnforcesTenantIsolation('a SharePoint upload is recorded against the uploading organisation only', async () => {
    const { files } = setup();
    org();
    const prepared = await files.prepare('org-b', OWNER, PDF);
    await files.put(prepared);
    await files.recordInTx(prisma as never, prepared, 'user-1');
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    expect(prisma.storedFile.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-b' }) }));
  });
});
