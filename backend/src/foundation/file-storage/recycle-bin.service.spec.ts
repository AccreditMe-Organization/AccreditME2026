import { NotFoundException } from '@nestjs/common';
import { RecycleBinService, RECYCLE_BIN_DAYS } from './recycle-bin.service';
import { StoredFileService } from './stored-file.service';
import { SharePointAccessService } from './sharepoint-access.service';
import { StorageRefusalException } from './storage-refusal';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-07T12:00:00Z');

const file = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  organizationId: 'org-a',
  provider: 'S3',
  bucket: 'b',
  endpoint: null,
  rootPath: null,
  storageKey: `org-a/tasks/task-1/${id}-file.pdf`,
  originalName: `${id}.pdf`,
  mimeType: 'application/pdf',
  sizeBytes: 1000,
  sha256: 'a'.repeat(64),
  ownerType: 'TASK',
  ownerId: 'task-1',
  deletedAt: new Date(NOW.getTime() - 5 * DAY),
  deletedById: 'user-1',
  deletedBy: { id: 'user-1', name: 'Sara' },
  purgedAt: null,
  ...overrides,
});

describe('RecycleBinService (ACC-177)', () => {
  const prisma = {
    storedFile: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    task: { findMany: jest.fn(), findFirst: jest.fn() },
    taskEvidence: { updateMany: jest.fn() },
  };
  (prisma as unknown as Record<string, unknown>)['$transaction'] = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));
  const storedFiles = { removeBytes: jest.fn().mockResolvedValue(undefined), reviewWarning: jest.fn().mockResolvedValue(undefined) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  // ACC-185 — only a SharePoint purge asks; these files are S3.
  const sharePointAccess = { assertReachable: jest.fn().mockResolvedValue(undefined) };
  const service = new RecycleBinService(
    prisma as unknown as PrismaService,
    storedFiles as unknown as StoredFileService,
    auditLog as unknown as AuditLogService,
    sharePointAccess as unknown as SharePointAccessService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.storedFile.findMany.mockResolvedValue([file('f1')]);
    prisma.task.findMany.mockResolvedValue([{ id: 'task-1', title: 'Collect the audit sample' }]);
    prisma.task.findFirst.mockResolvedValue({ id: 'task-1' });
    prisma.storedFile.findFirst.mockResolvedValue(file('f1'));
    prisma.storedFile.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('list', () => {
    it('lists deleted, unpurged files with their record, who deleted them, and the days left', async () => {
      const items = await service.list('org-a', NOW);
      expect(prisma.storedFile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-a', deletedAt: { not: null }, purgedAt: null } }),
      );
      expect(items).toEqual([
        expect.objectContaining({
          id: 'f1',
          name: 'f1.pdf',
          sizeBytes: 1000,
          mimeType: 'application/pdf',
          record: { type: 'TASK', id: 'task-1', name: 'Collect the audit sample' },
          deletedBy: { id: 'user-1', name: 'Sara' },
          daysLeft: RECYCLE_BIN_DAYS - 5,
        }),
      ]);
      expect(JSON.stringify(items)).not.toContain('storageKey');
    });
  });

  describe('restore', () => {
    it('returns the file to its record — the evidence row too — stamped and audited', async () => {
      await service.restore('org-a', 'f1', 'admin-1');
      expect(prisma.storedFile.update).toHaveBeenCalledWith({
        where: { id: 'f1', organizationId: 'org-a' },
        data: { deletedAt: null, deletedById: null, restoredAt: expect.any(Date), restoredById: 'admin-1' },
      });
      expect(prisma.taskEvidence.updateMany).toHaveBeenCalledWith({
        where: { storedFileId: 'f1', organizationId: 'org-a' },
        data: { deletedAt: null, deletedById: null },
      });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'RESTORE', objectType: 'StoredFile', objectId: 'f1', actorId: 'admin-1' }));
    });

    it('restores into a closed record — the record only has to exist', async () => {
      // The task read selects nothing about status: closed is fine.
      await service.restore('org-a', 'f1', 'admin-1');
      expect(prisma.task.findFirst).toHaveBeenCalledWith({ where: { id: 'task-1', organizationId: 'org-a' }, select: { id: true } });
    });

    it('refuses, with a reason, when the record no longer exists', async () => {
      prisma.task.findFirst.mockResolvedValue(null);
      await expect(service.restore('org-a', 'f1', 'admin-1')).rejects.toEqual(expect.any(StorageRefusalException));
      await expect(service.restore('org-a', 'f1', 'admin-1')).rejects.toThrow('The record this file came from no longer exists');
      expect(prisma.storedFile.update).not.toHaveBeenCalled();
    });

    it('a file not in the bin (live, purged, or unknown) is "File not found"', async () => {
      prisma.storedFile.findFirst.mockResolvedValue(null);
      await expect(service.restore('org-a', 'nope', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('purge', () => {
    it('purges every file asked for: purgedAt set, bytes deleted, one audit row each', async () => {
      prisma.storedFile.findMany.mockResolvedValue([file('f1'), file('f2')]);
      prisma.storedFile.updateMany.mockResolvedValue({ count: 2 });
      expect(await service.purge('org-a', ['f1', 'f2', 'f2'], 'admin-1')).toEqual({ purged: 2 });

      expect(prisma.storedFile.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['f1', 'f2'] }, organizationId: 'org-a', deletedAt: { not: null }, purgedAt: null },
        data: { purgedAt: expect.any(Date) },
      });
      expect(storedFiles.removeBytes).toHaveBeenCalledTimes(2);
      expect(auditLog.log).toHaveBeenCalledTimes(2);
      expect(auditLog.log.mock.calls[0]![0]).toEqual(expect.objectContaining({ action: 'DELETE', objectType: 'StoredFile', metadata: expect.objectContaining({ event: 'purged', by: 'tenant_admin' }) }));
      expect(storedFiles.reviewWarning).toHaveBeenCalledWith('org-a');
    });

    it('is all or nothing — one id not in the bin and nothing is purged', async () => {
      prisma.storedFile.findMany.mockResolvedValue([file('f1')]);
      await expect(service.purge('org-a', ['f1', 'f-other'], 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.storedFile.updateMany).not.toHaveBeenCalled();
      expect(storedFiles.removeBytes).not.toHaveBeenCalled();
    });

    it('a restore landing mid-purge rolls the whole purge back', async () => {
      prisma.storedFile.findMany.mockResolvedValue([file('f1'), file('f2')]);
      prisma.storedFile.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.purge('org-a', ['f1', 'f2'], 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(storedFiles.removeBytes).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpired — the daily job', () => {
    it('purges files deleted more than 30 days ago, per organisation, as the system', async () => {
      prisma.storedFile.findMany
        .mockResolvedValueOnce([
          { id: 'old-a', organizationId: 'org-a' },
          { id: 'old-b', organizationId: 'org-b' },
        ])
        .mockResolvedValueOnce([file('old-a')])
        .mockResolvedValueOnce([file('old-b', { organizationId: 'org-b' })]);
      expect(await service.purgeExpired(NOW)).toEqual({ purged: 2, failedOrganizations: [], deferredOrganizations: [] });

      // Deleted (deletedAt set) before the cutoff and unpurged — a RESTORED file
      // has deletedAt null and is never selected.
      expect(prisma.storedFile.findMany.mock.calls[0]![0]).toEqual({
        where: { deletedAt: { not: null, lt: new Date(NOW.getTime() - 30 * DAY) }, purgedAt: null },
        select: { id: true, organizationId: true },
      });
      expect(auditLog.log.mock.calls[0]![0]).not.toHaveProperty('actorId');
      expect(auditLog.log.mock.calls[0]![0]).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ by: 'daily_job_after_30_days' }) }));
    });

    it('one failing organisation does not stop the rest', async () => {
      prisma.storedFile.findMany
        .mockResolvedValueOnce([
          { id: 'x', organizationId: 'org-a' },
          { id: 'y', organizationId: 'org-b' },
        ])
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([file('y', { organizationId: 'org-b' })]);
      expect(await service.purgeExpired(NOW)).toEqual({ purged: 1, failedOrganizations: ['org-a'], deferredOrganizations: [] });
    });

    it('nothing expired, nothing done', async () => {
      prisma.storedFile.findMany.mockResolvedValueOnce([]);
      expect(await service.purgeExpired(NOW)).toEqual({ purged: 0, failedOrganizations: [], deferredOrganizations: [] });
      expect(prisma.storedFile.updateMany).not.toHaveBeenCalled();
    });
  });

  itEnforcesTenantIsolation("list reads only the organisation's own bin", async () => {
    await service.list('org-b', NOW);
    expect(prisma.storedFile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-b' }) }));
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-b' }) }));
  });

  itEnforcesTenantIsolation("restore finds the file only in the caller's own bin", async () => {
    prisma.storedFile.findFirst.mockResolvedValue(null); // f1 is org-a's
    await expect(service.restore('org-b', 'f1', 'admin-1')).rejects.toThrow('File not found');
    expect(prisma.storedFile.findFirst).toHaveBeenCalledWith({ where: { id: 'f1', organizationId: 'org-b', deletedAt: { not: null }, purgedAt: null } });
  });

  itEnforcesTenantIsolation("purge gives another organisation's ids the identical 404 and changes nothing", async () => {
    prisma.storedFile.findMany.mockResolvedValue([]);
    await expect(service.purge('org-b', ['f1'], 'admin-1')).rejects.toThrow('File not found');
    expect(prisma.storedFile.findMany).toHaveBeenCalledWith({ where: { id: { in: ['f1'] }, organizationId: 'org-b', deletedAt: { not: null }, purgedAt: null } });
    expect(prisma.storedFile.updateMany).not.toHaveBeenCalled();
  });
});
