import { RecycleBinService } from './recycle-bin.service';
import { StoredFileService } from './stored-file.service';
import { SharePointAccessService } from './sharepoint-access.service';
import { StorageRefusalException } from './storage-refusal';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-20T12:00:00Z');

const file = (id: string, provider: string) => ({
  id,
  organizationId: 'org-a',
  provider,
  bucket: null,
  endpoint: null,
  rootPath: null,
  msDriveId: provider === 'SHAREPOINT' ? 'b!drive' : null,
  msItemId: provider === 'SHAREPOINT' ? `item-${id}` : null,
  storageKey: `org-a/tasks/task-1/${id}-file.pdf`,
  originalName: `${id}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
  ownerType: 'TASK',
  ownerId: 'task-1',
  deletedAt: new Date(NOW.getTime() - 40 * DAY),
  purgedAt: null,
});

// ACC-185 — a SharePoint purge needs the library reachable BEFORE anything is
// marked purged; withdrawn access leaves every row unpurged for tomorrow.
describe('RecycleBinService — SharePoint files (ACC-185)', () => {
  const prisma = {
    storedFile: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  (prisma as unknown as Record<string, unknown>)['$transaction'] = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  const storedFiles = { removeBytes: jest.fn().mockResolvedValue(undefined), reviewWarning: jest.fn().mockResolvedValue(undefined) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const sharePointAccess = { assertReachable: jest.fn() };
  const service = new RecycleBinService(
    prisma as unknown as PrismaService,
    storedFiles as unknown as StoredFileService,
    auditLog as unknown as AuditLogService,
    sharePointAccess as unknown as SharePointAccessService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storedFile.updateMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => ({ count: args.where.id.in.length }));
  });

  it('checks the library is reachable before marking a SharePoint file purged, then deletes it by item id', async () => {
    prisma.storedFile.findMany.mockResolvedValue([file('f1', 'SHAREPOINT')]);
    sharePointAccess.assertReachable.mockResolvedValue(undefined);
    await service.purge('org-a', ['f1'], 'admin-1');
    expect(sharePointAccess.assertReachable).toHaveBeenCalledWith('org-a');
    const checkedAt = sharePointAccess.assertReachable.mock.invocationCallOrder[0]!;
    const markedAt = prisma.storedFile.updateMany.mock.invocationCallOrder[0]!;
    expect(checkedAt).toBeLessThan(markedAt);
    expect(storedFiles.removeBytes).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', msItemId: 'item-f1' }));
  });

  it('refuses the whole purge when access is withdrawn — nothing is marked, nothing deleted', async () => {
    prisma.storedFile.findMany.mockResolvedValue([file('f1', 'SHAREPOINT'), file('f2', 'S3')]);
    sharePointAccess.assertReachable.mockRejectedValue(new StorageRefusalException('STORAGE_ACCESS_WITHDRAWN'));
    await expect(service.purge('org-a', ['f1', 'f2'], 'admin-1')).rejects.toMatchObject({ code: 'STORAGE_ACCESS_WITHDRAWN' });
    expect(prisma.storedFile.updateMany).not.toHaveBeenCalled();
    expect(storedFiles.removeBytes).not.toHaveBeenCalled();
  });

  it('never asks for files that are not on SharePoint', async () => {
    prisma.storedFile.findMany.mockResolvedValue([file('f1', 'S3')]);
    await service.purge('org-a', ['f1'], 'admin-1');
    expect(sharePointAccess.assertReachable).not.toHaveBeenCalled();
  });

  it('the daily job DEFERS an organisation whose SharePoint cannot be reached — not a failure', async () => {
    prisma.storedFile.findMany.mockResolvedValue([file('f1', 'SHAREPOINT')]);
    sharePointAccess.assertReachable.mockRejectedValue(new StorageRefusalException('STORAGE_ACCESS_WITHDRAWN'));
    expect(await service.purgeExpired(NOW)).toEqual({ purged: 0, failedOrganizations: [], deferredOrganizations: ['org-a'] });
    expect(prisma.storedFile.updateMany).not.toHaveBeenCalled();
  });
});
