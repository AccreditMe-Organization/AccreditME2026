import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StoredFileService } from './stored-file.service';
import { StorageRefusalException } from './storage-refusal';
import { IRecycleBinItem } from './interfaces/recycle-bin.interface';

/** How long a deleted file waits in the bin before the daily job purges it. */
export const RECYCLE_BIN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** At most this many files in one purge request. */
export const PURGE_MAX_FILES = 100;

/**
 * ACC-177 — the recycle bin (Ahmad, 7 Oct). Deleting a file, from ANY record,
 * is a 30-day soft delete: StoredFileService.softDeleteInTx() hides it at once
 * and keeps its bytes. From here a tenant admin (tenant:manage_config) can:
 *
 *   list    — deleted, unpurged files, with the record each came from, who
 *             deleted it and when, and the days left;
 *   restore — back to its record (task evidence: the evidence row too), even
 *             if that record has since closed; refused if it no longer exists;
 *   purge   — 1 to 100 files, all or nothing: bytes deleted now, purgedAt set.
 *
 * The daily worker (StoragePurgeProcessor) purges anything deleted more than
 * 30 days ago. A restored file has deletedAt null again, so it is never
 * touched. A deleted file can never be viewed or downloaded meanwhile.
 *
 * WHICH RECORD A FILE CAME FROM is read straight from that record's table,
 * one case per owner type — the same choice Setup health's detectors make,
 * so this module adds no dependency edge back into the modules that use it.
 * Deleted links and record references never come here: they hold no file.
 */
@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storedFiles: StoredFileService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(organizationId: string, now: Date = new Date()): Promise<IRecycleBinItem[]> {
    const files = await this.prisma.storedFile.findMany({
      where: { organizationId, deletedAt: { not: null }, purgedAt: null },
      include: { deletedBy: { select: { id: true, name: true } } },
      orderBy: { deletedAt: 'desc' },
    });
    const taskIds = files.filter((f) => f.ownerType === 'TASK').map((f) => f.ownerId);
    const tasks = taskIds.length
      ? await this.prisma.task.findMany({ where: { organizationId, id: { in: taskIds } }, select: { id: true, title: true } })
      : [];
    const taskTitle = new Map(tasks.map((t) => [t.id, t.title]));

    return files.map((file) => {
      const deletedAt = file.deletedAt!;
      const purgesAt = new Date(deletedAt.getTime() + RECYCLE_BIN_DAYS * DAY_MS);
      return {
        id: file.id,
        name: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        record: { type: file.ownerType, id: file.ownerId, name: taskTitle.get(file.ownerId) ?? null },
        deletedBy: file.deletedBy,
        deletedAt,
        purgesAt,
        daysLeft: Math.max(0, Math.ceil((purgesAt.getTime() - now.getTime()) / DAY_MS)),
      };
    });
  }

  async restore(organizationId: string, fileId: string, actorId: string): Promise<IRecycleBinItem[]> {
    const restored = await this.prisma.$transaction(async (tx) => {
      const file = await tx.storedFile.findFirst({
        where: { id: fileId, organizationId, deletedAt: { not: null }, purgedAt: null },
      });
      if (!file) throw new NotFoundException('File not found');

      // The record must still exist. A closed one is fine: the file goes back
      // to it as it was.
      if (file.ownerType === 'TASK') {
        const task = await tx.task.findFirst({ where: { id: file.ownerId, organizationId }, select: { id: true } });
        if (!task) throw new StorageRefusalException('FILE_RECORD_GONE');
      }

      const now = new Date();
      await tx.storedFile.update({
        where: { id: file.id, organizationId },
        data: { deletedAt: null, deletedById: null, restoredAt: now, restoredById: actorId },
      });
      if (file.ownerType === 'TASK') {
        await tx.taskEvidence.updateMany({
          where: { storedFileId: file.id, organizationId },
          data: { deletedAt: null, deletedById: null },
        });
      }
      return file;
    });

    await this.auditLog.log({
      action: 'RESTORE',
      objectType: 'StoredFile',
      objectId: restored.id,
      actorId,
      tenantId: organizationId,
      before: { deletedAt: restored.deletedAt?.toISOString(), deletedById: restored.deletedById },
      after: { deletedAt: null },
      metadata: { record: { type: restored.ownerType, id: restored.ownerId }, name: restored.originalName },
    });
    return this.list(organizationId);
  }

  /**
   * Purges the given files — ALL OR NOTHING. Every id must be a deleted,
   * unpurged file of THIS organisation, or the whole request is the same 404 and
   * nothing changes. `actorId` null is the daily job.
   */
  async purge(organizationId: string, fileIds: readonly string[], actorId: string | null): Promise<{ purged: number }> {
    const ids = [...new Set(fileIds)];
    const files = await this.prisma.$transaction(async (tx) => {
      const found = await tx.storedFile.findMany({
        where: { id: { in: ids }, organizationId, deletedAt: { not: null }, purgedAt: null },
      });
      if (found.length !== ids.length) throw new NotFoundException('File not found');
      // Guarded on the same state, so a restore that lands meanwhile makes the
      // count differ and the whole purge rolls back.
      const updated = await tx.storedFile.updateMany({
        where: { id: { in: ids }, organizationId, deletedAt: { not: null }, purgedAt: null },
        data: { purgedAt: new Date() },
      });
      if (updated.count !== ids.length) throw new NotFoundException('File not found');
      return found;
    });

    for (const file of files) {
      await this.storedFiles.removeBytes(file);
      await this.auditLog.log({
        action: 'DELETE',
        objectType: 'StoredFile',
        objectId: file.id,
        ...(actorId ? { actorId } : {}),
        tenantId: organizationId,
        before: { name: file.originalName, sizeBytes: file.sizeBytes, sha256: file.sha256, provider: file.provider },
        metadata: {
          event: 'purged',
          by: actorId ? 'tenant_admin' : `daily_job_after_${RECYCLE_BIN_DAYS}_days`,
          record: { type: file.ownerType, id: file.ownerId },
        },
      });
    }
    // Purged bytes stop counting toward the quota.
    await this.storedFiles.reviewWarning(organizationId);
    return { purged: files.length };
  }

  /**
   * The daily job: every file deleted more than RECYCLE_BIN_DAYS ago and not
   * yet purged, per organisation, in batches. A failing organisation is logged
   * and the rest still run.
   */
  async purgeExpired(now: Date = new Date()): Promise<{ purged: number; failedOrganizations: string[] }> {
    const cutoff = new Date(now.getTime() - RECYCLE_BIN_DAYS * DAY_MS);
    const expired = await this.prisma.storedFile.findMany({
      where: { deletedAt: { not: null, lt: cutoff }, purgedAt: null },
      select: { id: true, organizationId: true },
    });
    const byOrg = new Map<string, string[]>();
    for (const f of expired) byOrg.set(f.organizationId, [...(byOrg.get(f.organizationId) ?? []), f.id]);

    let purged = 0;
    const failedOrganizations: string[] = [];
    for (const [organizationId, ids] of byOrg) {
      try {
        for (let i = 0; i < ids.length; i += PURGE_MAX_FILES) {
          purged += (await this.purge(organizationId, ids.slice(i, i + PURGE_MAX_FILES), null)).purged;
        }
      } catch (error) {
        failedOrganizations.push(organizationId);
        this.logger.error(`Expired-file purge failed for org ${organizationId}: ${(error as Error).message}`);
      }
    }
    return { purged, failedOrganizations };
  }
}
