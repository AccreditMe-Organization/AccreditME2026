import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageProvider } from '../../providers/storage/storage.provider';
import { judgeFileContent } from './file-content';
import { buildStorageKey, displayFileName, keySafeName } from './stored-file-names';
import { IStorageLocation, IStoredFileLocation, StorageResolverService } from './storage-resolver.service';
import { maxUploadBytes } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';
import { DOWNLOAD_TTL_SECONDS, issueDownloadToken } from './download-token';
import { StorageNoticesService } from './storage-notices.service';
import { IFileDownload, IStoredFileSummary, IUploadedFile } from './interfaces/stored-file.interface';

// A Prisma transaction client, as handed to a $transaction callback.
export type StoredFileTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** What a caller is attaching a file to. */
export interface IStoredFileOwner {
  type: 'TASK';
  id: string;
  /** The key's module segment ("tasks"). */
  module: string;
}

/** A validated upload, ready to write. Built by prepare(), consumed once. */
export interface IPreparedUpload {
  organizationId: string;
  owner: IStoredFileOwner;
  provider: StorageProvider;
  location: IStorageLocation;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  body: Buffer;
}

const GIB = 1024 ** 3;

/** The share of maxStorageGb at which the tenant admins are told (once). */
export const STORAGE_WARNING_RATIO = 0.9;

/**
 * ACC-177 — every stored file goes through here: validate, write, record,
 * read back, delete. A module attaching files (task evidence today; meetings
 * and documents later) calls these in order and never touches a provider.
 *
 * NOTHING IS STORED UNTIL THE ORGANISATION HAS CONFIRMED WHERE (Ahmad, 7 Oct):
 * prepare() refuses STORAGE_NOT_CONFIRMED first, before anything else is
 * looked at.
 *
 * THE UPLOAD ORDER, and why:
 *   1. prepare()  — confirmation, then the file is judged (size, type from
 *                   content), the key built, the provider resolved and — on
 *                   AccreditMe cloud — the quota pre-checked. Nothing written.
 *   2. put()      — the bytes go to storage, OUTSIDE any transaction: a slow
 *                   upload must never hold a row lock.
 *   3. recordInTx() — inside the caller's transaction, under a per-
 *                   organisation advisory lock: the quota is checked again and
 *                   the StoredFile row written. Two uploads racing for the
 *                   last megabyte cannot both pass.
 *   4. discard()  — if step 3 (or anything else in the caller's transaction)
 *                   throws, the caller deletes the bytes again.
 *   5. afterUpload() — after commit: the 90% warning.
 * A crash between 2 and 3 leaves an object no row names (ACC-179).
 *
 * THE QUOTA COUNTS ACCREDITME CLOUD ONLY — a customer's own MinIO or folder
 * is theirs to size — and counts DELETED files until they are purged: a
 * deleted file's bytes are still stored for its 30 days (RecycleBinService).
 */
@Injectable()
export class StoredFileService {
  private readonly logger = new Logger(StoredFileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: StorageResolverService,
    private readonly notices: StorageNoticesService,
  ) {}

  async prepare(organizationId: string, owner: IStoredFileOwner, file: IUploadedFile | undefined): Promise<IPreparedUpload> {
    await this.assertConfirmed(organizationId);
    if (!file) throw new StorageRefusalException('FILE_MISSING');
    const cap = maxUploadBytes();
    if (file.size > cap || file.buffer.length > cap) {
      throw new StorageRefusalException('FILE_TOO_LARGE', { maxBytes: cap });
    }
    const originalName = displayFileName(file.originalname);
    const verdict = judgeFileContent(originalName, file.buffer);
    if (!verdict.ok) {
      throw new StorageRefusalException(verdict.reason === 'empty' ? 'FILE_EMPTY' : 'FILE_TYPE_NOT_ALLOWED');
    }

    const { provider, location } = await this.resolver.forUpload(organizationId);
    if (location.provider === 'S3') {
      await this.assertWithinQuota(this.prisma, organizationId, file.buffer.length);
    }

    return {
      organizationId,
      owner,
      provider,
      location,
      storageKey: buildStorageKey({
        organizationId,
        module: owner.module,
        recordId: owner.id,
        safeName: keySafeName(originalName, verdict.extension),
      }),
      originalName,
      mimeType: verdict.mimeType,
      sizeBytes: file.buffer.length,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
      body: file.buffer,
    };
  }

  async put(prepared: IPreparedUpload): Promise<void> {
    try {
      await prepared.provider.put(prepared.storageKey, prepared.body, prepared.mimeType);
    } catch (error) {
      throw this.providerFailure(error, 'write');
    }
  }

  /** Inside the caller's transaction: the authoritative quota check, then the row. */
  async recordInTx(tx: StoredFileTx, prepared: IPreparedUpload, uploadedById: string) {
    if (prepared.location.provider === 'S3') {
      // One lock per organisation for the duration of this transaction, so the
      // sum below and the insert after it are one step.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`stored-file-quota:${prepared.organizationId}`}))::text`;
      await this.assertWithinQuota(tx, prepared.organizationId, prepared.sizeBytes);
    }
    return tx.storedFile.create({
      data: {
        organizationId: prepared.organizationId,
        provider: prepared.location.provider,
        bucket: prepared.location.bucket,
        endpoint: prepared.location.endpoint,
        rootPath: prepared.location.rootPath,
        storageKey: prepared.storageKey,
        originalName: prepared.originalName,
        mimeType: prepared.mimeType,
        sizeBytes: prepared.sizeBytes,
        sha256: prepared.sha256,
        ownerType: prepared.owner.type,
        ownerId: prepared.owner.id,
        uploadedById,
      },
    });
  }

  /** After commit: the 90% warning, for a file stored on AccreditMe cloud. */
  async afterUpload(prepared: IPreparedUpload): Promise<void> {
    if (prepared.location.provider !== 'S3') return;
    try {
      await this.reviewWarning(prepared.organizationId);
    } catch (error) {
      this.logger.error(`The storage warning check failed for org ${prepared.organizationId}: ${(error as Error).message}`);
    }
  }

  /**
   * At 90% or more of maxStorageGb: stamp storageWarnedAt and tell the tenant
   * admins — ONCE, because only the call that moves the stamp from null to set
   * sends. Below 90%: clear the stamp, so the next crossing tells them again.
   * Called after an upload and after a purge.
   */
  async reviewWarning(organizationId: string): Promise<void> {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId }, select: { maxStorageGb: true } });
    if (!org) return;
    const limit = org.maxStorageGb * GIB;
    const used = await this.cloudUsageBytes(this.prisma, organizationId);
    if (limit > 0 && used >= limit * STORAGE_WARNING_RATIO) {
      const stamped = await this.prisma.organization.updateMany({
        where: { id: organizationId, storageWarnedAt: null },
        data: { storageWarnedAt: new Date() },
      });
      if (stamped.count === 1) await this.notices.storageAlmostFull(organizationId, used, limit);
    } else {
      await this.prisma.organization.updateMany({
        where: { id: organizationId, storageWarnedAt: { not: null } },
        data: { storageWarnedAt: null },
      });
    }
  }

  /** Undo put() after the record was refused. Never throws; a failure is logged. */
  async discard(prepared: IPreparedUpload): Promise<void> {
    try {
      await prepared.provider.delete(prepared.storageKey);
    } catch (error) {
      this.logger.error(
        `Could not remove an unrecorded upload in org ${prepared.organizationId} (${prepared.location.provider}, key ${prepared.storageKey}): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Bytes on AccreditMe cloud that count toward maxStorageGb: every S3 file not
   * yet purged — a deleted one included, since its bytes are still stored.
   * Counted from the rows, never cached.
   */
  async cloudUsageBytes(client: Pick<PrismaService, 'storedFile'>, organizationId: string): Promise<number> {
    const total = await client.storedFile.aggregate({
      where: { organizationId, provider: 'S3', purgedAt: null },
      _sum: { sizeBytes: true },
    });
    return total._sum.sizeBytes ?? 0;
  }

  /**
   * A download for a file the CALLER HAS ALREADY BEEN ENTITLED TO — this
   * checks nothing about who is asking. A deleted file is refused here as
   * well, whatever the caller checked: it can never be viewed or downloaded.
   * S3/MinIO: a pre-signed URL. Local: a token URL on this API. Both valid
   * fifteen minutes.
   */
  async openDownload(
    file: IStoredFileLocation & { id: string; storageKey: string; originalName: string; mimeType: string; deletedAt: Date | null },
  ): Promise<IFileDownload> {
    if (file.deletedAt) throw new StorageRefusalException('FILE_UNAVAILABLE');
    const provider = await this.resolver.forFile(file);
    if (provider.signedDownloadUrl) {
      try {
        const url = await provider.signedDownloadUrl(file.storageKey, DOWNLOAD_TTL_SECONDS, {
          fileName: file.originalName,
          mimeType: file.mimeType,
        });
        return { url, viaApi: false, expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString() };
      } catch (error) {
        throw this.providerFailure(error, 'sign');
      }
    }
    const { token, expiresAt } = issueDownloadToken(file.id, file.organizationId);
    return { url: `files/stream/${token}`, viaApi: true, expiresAt: expiresAt.toISOString() };
  }

  /**
   * A delete, inside the caller's transaction. It HIDES the file at once and
   * KEEPS its bytes: the file is in the recycle bin for 30 days, restorable by
   * a tenant admin, and purged after (RecycleBinService). The caller writes
   * the audit row.
   */
  async softDeleteInTx(tx: Pick<PrismaService, 'storedFile'>, fileId: string, organizationId: string, actorId: string) {
    return tx.storedFile.update({
      where: { id: fileId, organizationId },
      data: { deletedAt: new Date(), deletedById: actorId },
    });
  }

  /**
   * A purged file's bytes. After commit; a failure is logged, not raised — the
   * row already says the file is purged, and an orphan object is the
   * reconciler's to find (ACC-179).
   */
  async removeBytes(file: IStoredFileLocation & { storageKey: string }): Promise<void> {
    try {
      const provider = await this.resolver.forFile(file);
      await provider.delete(file.storageKey);
    } catch (error) {
      this.logger.error(
        `Could not remove the bytes of a purged file in org ${file.organizationId} (${file.provider}, key ${file.storageKey}): ${(error as Error).message}`,
      );
    }
  }

  summary(file: { id: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: Date }): IStoredFileSummary {
    return {
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedAt: file.uploadedAt,
    };
  }

  private async assertConfirmed(organizationId: string): Promise<void> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageConfirmedAt: true },
    });
    if (!org?.storageConfirmedAt) throw new StorageRefusalException('STORAGE_NOT_CONFIRMED');
  }

  private async assertWithinQuota(client: Pick<PrismaService, 'storedFile' | 'organization'>, organizationId: string, adding: number): Promise<void> {
    const org = await client.organization.findFirst({ where: { id: organizationId }, select: { maxStorageGb: true } });
    const limit = (org?.maxStorageGb ?? 0) * GIB;
    const used = await this.cloudUsageBytes(client, organizationId);
    if (used + adding > limit) {
      throw new StorageRefusalException('STORAGE_QUOTA_EXCEEDED', { maxBytes: limit });
    }
  }

  // A provider's own error, reduced to a refusal a person can act on. The
  // provider's message goes to the log only: it can name a bucket or host.
  private providerFailure(error: unknown, step: string): StorageRefusalException {
    if (error instanceof StorageRefusalException) return error;
    if (isPrivateEndpointRefusal(error)) return new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
    this.logger.error(`Storage ${step} failed: ${(error as Error)?.name ?? 'Error'} ${(error as Error)?.message ?? ''}`);
    return new StorageRefusalException('STORAGE_UNAVAILABLE');
  }
}

/** The connect-time guard's refusal, wherever the SDK wrapped it. */
export function isPrivateEndpointRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as Error).name === 'PrivateEndpointRefusedError') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
