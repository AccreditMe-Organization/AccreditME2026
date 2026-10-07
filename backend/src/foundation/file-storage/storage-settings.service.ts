import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StorageProvider } from '../../providers/storage/storage.provider';
import { completeMinio, IStorageConfig, readStorageConfig, writeStorageConfig } from './storage-config';
import { maxUploadBytes, platformS3Settings } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';
import { isPrivateEndpointRefusal, StoredFileService } from './stored-file.service';
import { IStorageLocation, StorageProviderKind, StorageResolverService } from './storage-resolver.service';
import { TestStorageSettingsDto, UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { IStorageSettings, IStorageTestResult, StorageTestStep } from './interfaces/storage-settings.interface';

const STEP_TIMEOUT_MS = 10_000;

/**
 * ACC-177 — a tenant admin's storage settings (tenant:manage_config). The
 * screen is lane A's; this is its API.
 *
 * SECRETS ARE WRITE-ONLY. The read answers "set" or null; an update that
 * omits a key keeps the stored one; the audit row names the fields changed,
 * never a value.
 *
 * A LOCATION IN USE CANNOT BE CHANGED (Ahmad, 7 Oct): changing the MinIO
 * endpoint or bucket, or the Local root, while live files are stored there is
 * refused, naming how many. New keys for the same endpoint and bucket are
 * fine, and so is switching provider — each file keeps its own location, and
 * the other provider's settings stay stored so its files remain readable.
 */
@Injectable()
export class StorageSettingsService {
  private readonly logger = new Logger(StorageSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: StorageResolverService,
    private readonly storedFiles: StoredFileService,
    private readonly auditLog: AuditLogService,
  ) {}

  async get(organizationId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const config = readStorageConfig(org.storageConfig);
    return {
      provider: org.storageProvider,
      offeredProviders: this.resolver.offeredProviders(),
      platformStorageReady: platformS3Settings() !== null,
      minio: {
        endpoint: config.minio?.endpoint ?? null,
        region: config.minio?.region ?? null,
        bucket: config.minio?.bucket ?? null,
        accessKeyId: config.minio?.accessKeyId ? 'set' : null,
        secretAccessKey: config.minio?.secretAccessKey ? 'set' : null,
      },
      local: { rootPath: config.local?.rootPath ?? null },
      usage: {
        usedBytes: await this.storedFiles.usageBytes(this.prisma, organizationId),
        maxStorageGb: org.maxStorageGb,
      },
      maxUploadBytes: maxUploadBytes(),
    };
  }

  async update(organizationId: string, dto: UpdateStorageSettingsDto, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const next = this.merge(stored, dto);
    this.assertUsable(dto.provider, next);

    await this.assertLocationNotStranded(organizationId, stored, next);

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { storageProvider: dto.provider, storageConfig: writeStorageConfig(next) },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      actorId,
      tenantId: organizationId,
      before: { storageProvider: org.storageProvider },
      after: { storageProvider: dto.provider },
      metadata: { event: 'storage_settings_updated', changedFields: changedFields(stored, next) },
    });

    return this.get(organizationId);
  }

  /**
   * Writes a probe object, reads it back, compares it, deletes it — against
   * the candidate settings if any were sent, the stored ones otherwise.
   * SAVES NOTHING. Reports the first step that failed.
   */
  async test(organizationId: string, dto: TestStorageSettingsDto = {}): Promise<IStorageTestResult> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const provider: StorageProviderKind = dto?.provider ?? org.storageProvider;
    const candidate = this.merge(stored, dto);
    const passed: StorageTestStep[] = [];
    const fail = (step: StorageTestStep, error: unknown): IStorageTestResult => {
      const refusal = this.asRefusal(error, step);
      const body = refusal.getResponse() as { code: string; message: string };
      return { ok: false, provider, passed, failedStep: step, code: body.code, message: body.message };
    };

    let target: StorageProvider;
    try {
      this.assertUsable(provider, candidate);
      target = this.resolver.forCandidate(provider, candidate).provider;
      passed.push('configure');
    } catch (error) {
      return fail('configure', error);
    }

    const key = `${organizationId}/_probe/${randomBytes(12).toString('hex')}.txt`;
    const probe = Buffer.from(`AccreditMe storage check ${randomBytes(16).toString('hex')}\n`, 'utf8');

    try {
      await withTimeout(target.put(key, probe, 'text/plain'));
      passed.push('write');
    } catch (error) {
      return fail('write', error);
    }

    let readBack: Buffer;
    try {
      readBack = await withTimeout(target.getStream(key).then(readAll));
      passed.push('read');
    } catch (error) {
      await this.bestEffortDelete(target, key);
      return fail('read', error);
    }

    if (sha256(readBack) !== sha256(probe)) {
      await this.bestEffortDelete(target, key);
      return {
        ok: false,
        provider,
        passed,
        failedStep: 'verify',
        code: 'STORAGE_UNAVAILABLE',
        message: 'The file read back did not match the file written',
      };
    }
    passed.push('verify');

    try {
      await withTimeout(target.delete(key));
      passed.push('delete');
    } catch (error) {
      return fail('delete', error);
    }

    return { ok: true, provider, passed, failedStep: null, code: null, message: null };
  }

  // Stored settings with the sent ones on top. An omitted field — a secret
  // above all — keeps its stored value.
  private merge(stored: IStorageConfig, dto: TestStorageSettingsDto): IStorageConfig {
    const defined = <T extends object>(value: T | undefined): Partial<T> =>
      Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>;
    const minio = { ...stored.minio, ...defined(dto.minio) };
    const local = { ...stored.local, ...defined(dto.local) };
    return {
      ...(Object.keys(minio).length ? { minio } : {}),
      ...(Object.keys(local).length ? { local } : {}),
    };
  }

  // The chosen provider must be usable as configured. S3 needs nothing from
  // the tenant (it is AccreditMe's bucket); MinIO needs every field and an
  // allowed endpoint; Local needs this installation to offer it and a root
  // inside its base.
  private assertUsable(provider: StorageProviderKind, config: IStorageConfig): void {
    if (provider === 'MINIO') {
      const minio = completeMinio(config);
      if (!minio) throw new StorageRefusalException('STORAGE_SETTINGS_INCOMPLETE');
      this.resolver.assertMinioEndpointAllowed(minio.endpoint);
    }
    if (provider === 'LOCAL_FILESYSTEM') {
      if (!this.resolver.offeredProviders().includes('LOCAL_FILESYSTEM')) {
        throw new StorageRefusalException('STORAGE_PROVIDER_NOT_ALLOWED');
      }
      if (!config.local?.rootPath) throw new StorageRefusalException('STORAGE_SETTINGS_INCOMPLETE');
      this.resolver.localRoot(config.local.rootPath);
    }
    // A MinIO endpoint stored but not selected is still checked, so nothing
    // disallowed is ever saved.
    if (provider !== 'MINIO' && config.minio?.endpoint) {
      this.resolver.assertMinioEndpointAllowed(config.minio.endpoint);
    }
  }

  private async assertLocationNotStranded(organizationId: string, stored: IStorageConfig, next: IStorageConfig): Promise<void> {
    const checks: IStorageLocation[] = [];
    if (
      stored.minio?.endpoint &&
      stored.minio.bucket &&
      (stored.minio.endpoint !== next.minio?.endpoint || stored.minio.bucket !== next.minio?.bucket)
    ) {
      checks.push({ provider: 'MINIO', endpoint: stored.minio.endpoint, bucket: stored.minio.bucket, rootPath: null });
    }
    if (stored.local?.rootPath && stored.local.rootPath !== next.local?.rootPath) {
      checks.push({ provider: 'LOCAL_FILESYSTEM', endpoint: null, bucket: null, rootPath: stored.local.rootPath });
    }
    for (const location of checks) {
      const fileCount = await this.storedFiles.liveFilesAt(organizationId, location);
      if (fileCount > 0) throw new StorageRefusalException('STORAGE_LOCATION_IN_USE', { fileCount });
    }
  }

  private asRefusal(error: unknown, step: StorageTestStep): StorageRefusalException {
    if (error instanceof StorageRefusalException) return error;
    if (isPrivateEndpointRefusal(error)) return new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
    // The provider's own words go to the log only — they can name a host.
    this.logger.warn(`Storage test failed at ${step}: ${(error as Error)?.name ?? 'Error'} ${(error as Error)?.message ?? ''}`);
    return new StorageRefusalException('STORAGE_UNAVAILABLE');
  }

  private async bestEffortDelete(target: StorageProvider, key: string): Promise<void> {
    try {
      await withTimeout(target.delete(key));
    } catch {
      // The probe is a few bytes under _probe/; nothing else to do.
    }
  }

  private async loadOrg(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { storageProvider: true, storageConfig: true, maxStorageGb: true },
    });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}

// The field names that differ, secrets included BY NAME only.
function changedFields(before: IStorageConfig, after: IStorageConfig): string[] {
  const names: string[] = [];
  for (const block of ['minio', 'local'] as const) {
    const a = (before[block] ?? {}) as Record<string, unknown>;
    const b = (after[block] ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] !== b[key]) names.push(`${block}.${key}`);
    }
  }
  return names;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The storage did not answer in time')), STEP_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
