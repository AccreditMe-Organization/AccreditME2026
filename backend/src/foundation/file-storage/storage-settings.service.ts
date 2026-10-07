import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StorageProvider } from '../../providers/storage/storage.provider';
import { completeMinio, IStorageConfig, readStorageConfig, writeStorageConfig } from './storage-config';
import { maxUploadBytes } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';
import { isPrivateEndpointRefusal, StoredFileService } from './stored-file.service';
import { StorageProviderKind, StorageResolverService } from './storage-resolver.service';
import { StorageNoticesService } from './storage-notices.service';
import { StorageChangeRequestDto, TestStorageSettingsDto, UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { IStorageSettings, IStorageTestResult, StorageTestStep } from './interfaces/storage-settings.interface';

const STEP_TIMEOUT_MS = 10_000;

type SettingsOrg = {
  storageProvider: StorageProviderKind;
  storageConfig: string | null;
  maxStorageGb: number;
  storageConfirmedAt: Date | null;
  storageConfirmedBy: { id: string; name: string } | null;
  storageChangeRequestedAt: Date | null;
  storageChangeRequestedBy: { id: string; name: string } | null;
};

/**
 * ACC-177 — a tenant admin's storage settings (tenant:manage_config). The
 * screens are lane A's; this is their API.
 *
 * CONFIRM, THEN IT IS ACCREDITME'S (Ahmad, 7 Oct):
 *   - Every organisation starts on AccreditMe cloud and UNCONFIRMED; nothing
 *     can be uploaded until a tenant admin confirms where files go (confirm()).
 *     MinIO and a local folder must pass a connection test to be confirmed.
 *   - Once confirmed, the location is AccreditMe's to change: update() refuses
 *     a different provider, MinIO endpoint or bucket, or local root with 403
 *     STORAGE_CHANGE_BY_PLATFORM. Only new keys for the SAME MinIO endpoint
 *     and bucket are accepted, after a passing test. A tenant ASKS for a change
 *     (requestChange()), and every platform admin is told.
 *
 * SECRETS ARE WRITE-ONLY, and ACCREDITME'S OWN SETTINGS ARE NEVER SHOWN: for
 * AccreditMe cloud a tenant sees only the provider, never its region, bucket
 * or endpoint.
 */
@Injectable()
export class StorageSettingsService {
  private readonly logger = new Logger(StorageSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: StorageResolverService,
    private readonly storedFiles: StoredFileService,
    private readonly auditLog: AuditLogService,
    private readonly notices: StorageNoticesService,
  ) {}

  async get(organizationId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const config = readStorageConfig(org.storageConfig);
    return {
      provider: org.storageProvider,
      offeredProviders: this.resolver.offeredProviders(),
      confirmed: org.storageConfirmedAt !== null,
      confirmedAt: org.storageConfirmedAt,
      confirmedBy: org.storageConfirmedBy,
      changeRequestedAt: org.storageChangeRequestedAt,
      changeRequestedBy: org.storageChangeRequestedBy,
      minio: {
        endpoint: config.minio?.endpoint ?? null,
        region: config.minio?.region ?? null,
        bucket: config.minio?.bucket ?? null,
        accessKeyId: config.minio?.accessKeyId ? 'set' : null,
        secretAccessKey: config.minio?.secretAccessKey ? 'set' : null,
      },
      local: { rootPath: config.local?.rootPath ?? null },
      usage: {
        // AccreditMe cloud only — the only storage that counts toward the limit.
        usedBytes: await this.storedFiles.cloudUsageBytes(this.prisma, organizationId),
        maxStorageGb: org.maxStorageGb,
      },
      maxUploadBytes: maxUploadBytes(),
    };
  }

  /**
   * Confirms where files are stored, ONCE. AccreditMe cloud needs nothing from
   * the tenant; MinIO and a local folder must pass the connection test first.
   */
  async confirm(organizationId: string, dto: UpdateStorageSettingsDto, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    if (org.storageConfirmedAt) throw new StorageRefusalException('STORAGE_ALREADY_CONFIRMED');
    const stored = readStorageConfig(org.storageConfig);
    const next = this.merge(stored, dto);
    this.assertUsable(dto.provider, next);
    if (dto.provider !== 'S3') await this.assertTestPasses(organizationId, dto.provider, next);

    const now = new Date();
    // Guarded on storageConfirmedAt still being null, so two admins confirming
    // at once cannot both win.
    const saved = await this.prisma.organization.updateMany({
      where: { id: organizationId, storageConfirmedAt: null },
      data: {
        storageProvider: dto.provider,
        storageConfig: writeStorageConfig(next),
        storageConfirmedAt: now,
        storageConfirmedById: actorId,
      },
    });
    if (saved.count !== 1) throw new StorageRefusalException('STORAGE_ALREADY_CONFIRMED');

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      actorId,
      tenantId: organizationId,
      before: { storageProvider: org.storageProvider, storageConfirmedAt: null },
      after: { storageProvider: dto.provider, storageConfirmedAt: now.toISOString() },
      metadata: { event: 'storage_confirmed', changedFields: changedFields(stored, next) },
    });
    return this.get(organizationId);
  }

  /**
   * Before confirmation: saves a draft (it unlocks nothing). After: only new
   * keys for the same MinIO endpoint and bucket, after a passing test —
   * anything else is AccreditMe's to change.
   */
  async update(organizationId: string, dto: UpdateStorageSettingsDto, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const next = this.merge(stored, dto);

    if (org.storageConfirmedAt) {
      this.assertOnlyKeysChange(org.storageProvider, stored, dto.provider, next);
      if (changedFields(stored, next).length > 0) {
        await this.assertTestPasses(organizationId, dto.provider, next);
      }
    } else {
      this.assertUsable(dto.provider, next);
    }

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
      metadata: {
        event: org.storageConfirmedAt ? 'storage_keys_replaced' : 'storage_settings_updated',
        changedFields: changedFields(stored, next),
      },
    });
    return this.get(organizationId);
  }

  /**
   * A tenant asks AccreditMe to change where its files are stored — only once
   * confirmed. A repeat request moves the date and tells the platform admins
   * again. The switch itself is done by AccreditMe (ACC-182).
   */
  async requestChange(organizationId: string, dto: StorageChangeRequestDto, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    if (!org.storageConfirmedAt) throw new StorageRefusalException('STORAGE_NOT_CONFIRMED');
    const now = new Date();
    const message = dto.message?.trim() || null;
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { storageChangeRequestedAt: now, storageChangeRequestedById: actorId },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      actorId,
      tenantId: organizationId,
      after: { storageChangeRequestedAt: now.toISOString() },
      metadata: { event: 'storage_change_requested', message },
    });
    // After the change is committed; a failed notice is logged inside.
    await this.notices.storageChangeRequested(organizationId, actorId, now, message);
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
    return this.runTest(organizationId, dto.provider ?? org.storageProvider, this.merge(stored, dto));
  }

  private async runTest(organizationId: string, provider: StorageProviderKind, candidate: IStorageConfig): Promise<IStorageTestResult> {
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

  private async assertTestPasses(organizationId: string, provider: StorageProviderKind, candidate: IStorageConfig): Promise<void> {
    const result = await this.runTest(organizationId, provider, candidate);
    if (!result.ok) {
      throw new StorageRefusalException('STORAGE_TEST_FAILED', {
        failedStep: result.failedStep ?? undefined,
        cause: result.code ?? undefined,
      });
    }
  }

  // Once confirmed, the location belongs to AccreditMe: the same provider,
  // and for MinIO the same endpoint, region and bucket; for a local folder
  // the same root. Only the two MinIO keys may differ.
  private assertOnlyKeysChange(
    storedProvider: StorageProviderKind,
    stored: IStorageConfig,
    nextProvider: StorageProviderKind,
    next: IStorageConfig,
  ): void {
    const keys = new Set(['minio.accessKeyId', 'minio.secretAccessKey']);
    const changed = changedFields(stored, next);
    if (nextProvider !== storedProvider || changed.some((field) => !keys.has(field))) {
      throw new StorageRefusalException('STORAGE_CHANGE_BY_PLATFORM');
    }
    if (changed.length > 0 && storedProvider !== 'MINIO') {
      throw new StorageRefusalException('STORAGE_CHANGE_BY_PLATFORM');
    }
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

  private async loadOrg(organizationId: string): Promise<SettingsOrg> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: {
        storageProvider: true,
        storageConfig: true,
        maxStorageGb: true,
        storageConfirmedAt: true,
        storageConfirmedBy: { select: { id: true, name: true } },
        storageChangeRequestedAt: true,
        storageChangeRequestedBy: { select: { id: true, name: true } },
      },
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
