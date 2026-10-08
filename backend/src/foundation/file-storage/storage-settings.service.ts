import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { StorageProvider } from '../../providers/storage/storage.provider';
import { GraphError } from '../../providers/storage/sharepoint/graph-client';
import { MicrosoftSignInError } from '../../providers/storage/sharepoint/microsoft-identity';
import { ISharePointLocation, SharePointStepError } from '../../providers/storage/sharepoint/sharepoint-connector';
import { NotFoundInSharePointError, SiteUrlRefusedError } from '../../providers/storage/sharepoint/sharepoint-locator';
import { completeMinio, completeSharePoint, IStorageConfig, readStorageConfig, StorageChoice, writeStorageConfig } from './storage-config';
import { StorageRefusalCode } from './storage-refusal';
import { maxUploadBytes } from './storage-platform-env';
import { StorageRefusalException } from './storage-refusal';
import { isPrivateEndpointRefusal, StoredFileService } from './stored-file.service';
import { StorageProviderKind, StorageResolverService } from './storage-resolver.service';
import { SharePointAccessLostReason, StorageNoticesService } from './storage-notices.service';
import { StorageChangeRequestDto, TestStorageSettingsDto, UpdateStorageSettingsDto } from './dto/update-storage-settings.dto';
import { IStorageSettings, IStorageTestResult, StorageTestStep } from './interfaces/storage-settings.interface';

const STEP_TIMEOUT_MS = 10_000;

/** What a tenant may still change once a location is confirmed — credentials only. */
const REPLACEABLE_AFTER_CONFIRM: Readonly<Record<StorageProviderKind, ReadonlySet<string>>> = {
  S3: new Set(),
  LOCAL_FILESYSTEM: new Set(),
  MINIO: new Set(['minio.accessKeyId', 'minio.secretAccessKey']),
  SHAREPOINT: new Set(['sharepoint.clientId', 'sharepoint.clientSecret', 'sharepoint.secretExpiresOn']),
};
/** Changing only these is a note, not a credential: no connection test. */
const EXPIRY_FIELDS: ReadonlySet<string> = new Set(['sharepoint.secretExpiresOn']);
// A SharePoint step may wait out Microsoft's throttling (up to 20 s across
// 3 attempts) on top of the request itself.
const SHAREPOINT_STEP_TIMEOUT_MS = 60_000;

type SettingsOrg = {
  storageProvider: StorageProviderKind;
  storageConfig: string | null;
  maxStorageGb: number;
  storageConfirmedAt: Date | null;
  storageConfirmedBy: { id: string; name: string } | null;
  storageChangeRequestedAt: Date | null;
  storageChangeRequestedBy: { id: string; name: string } | null;
  storageAccessLostAt: Date | null;
  storageAccessLostReason: string | null;
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
 *
 * ONLY CONFIRM WRITES Organization.storageProvider (ACC-185, Ahmad's Q6), for
 * every option. A draft records the option being set up as `draftProvider`
 * inside the config, and a test writes nothing at all. SharePoint is tested
 * here, but confirmed only once the database enum carries it (ACC-185 stage 3).
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
    const resolved = config.sharepoint?.resolved;
    // SharePoint files not yet purged — live or in the recycle bin.
    const filesStored = await this.prisma.storedFile.count({
      where: { organizationId, provider: 'SHAREPOINT', purgedAt: null },
    });
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
      // The customer's own tenant, site and library may be shown to them; the
      // secret only as "set".
      sharepoint: {
        tenant: config.sharepoint?.tenant ?? null,
        clientId: config.sharepoint?.clientId ?? null,
        clientSecret: config.sharepoint?.clientSecret ? 'set' : null,
        siteUrl: config.sharepoint?.siteUrl ?? null,
        libraryName: config.sharepoint?.libraryName ?? null,
        siteId: config.sharepoint?.siteId ?? null,
        listId: config.sharepoint?.listId ?? null,
        secretExpiresOn: config.sharepoint?.secretExpiresOn ?? null,
        // What Confirm recorded — the location from then on.
        tenantId: resolved?.tenantId ?? null,
        siteName: resolved?.siteName ?? null,
        siteWebUrl: resolved?.siteWebUrl ?? null,
        libraryWebUrl: resolved?.libraryWebUrl ?? null,
        accessLostAt: org.storageAccessLostAt,
        accessLostReason: (org.storageAccessLostReason as SharePointAccessLostReason | null) ?? null,
        filesStored,
        // Before confirmation: whenever there is a SharePoint draft to clear.
        // After: only on SharePoint, and only with nothing stored there.
        disconnectAllowed: org.storageConfirmedAt
          ? org.storageProvider === 'SHAREPOINT' && filesStored === 0
          : Boolean(config.sharepoint) || config.draftProvider === 'SHAREPOINT',
      },
      draftProvider: org.storageConfirmedAt ? null : (config.draftProvider ?? null),
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
    const provider: StorageProviderKind = dto.provider;
    const stored = readStorageConfig(org.storageConfig);
    let next = this.merge(stored, dto);
    this.assertUsable(provider, next);
    if (provider !== 'S3') {
      const result = await this.assertTestPasses(organizationId, provider, next);
      // ACC-185 — what the passing test found BECOMES the location: every
      // upload, download and purge uses these ids from now on, and a replaced
      // secret must reach exactly this tenant, site and library.
      if (provider === 'SHAREPOINT' && result.sharepoint) {
        next = { ...next, sharepoint: { ...next.sharepoint, resolved: { ...result.sharepoint, resolvedAt: new Date().toISOString() } } };
      }
    }

    const now = new Date();
    // Guarded on storageConfirmedAt still being null, so two admins confirming
    // at once cannot both win. The ONE place a provider is chosen (Q6);
    // Disconnect is the only other writer, and only returns it to the default.
    const saved = await this.prisma.organization.updateMany({
      where: { id: organizationId, storageConfirmedAt: null },
      data: {
        storageProvider: provider,
        storageConfig: writeStorageConfig({ ...next, draftProvider: undefined }),
        storageConfirmedAt: now,
        storageConfirmedById: actorId,
        storageAccessLostAt: null,
        storageAccessLostReason: null,
        storageSecretWarnedAt: null,
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
      after: { storageProvider: provider, storageConfirmedAt: now.toISOString() },
      metadata: { event: 'storage_confirmed', changedFields: changedFields(stored, next) },
    });
    return this.get(organizationId);
  }

  /**
   * Before confirmation: saves a draft (it unlocks nothing), recording the
   * option being set up as `draftProvider`. After: only new keys for the same
   * MinIO endpoint and bucket, after a passing test — anything else is
   * AccreditMe's to change.
   *
   * NEVER writes Organization.storageProvider (Q6): a draft only names its
   * option, and once confirmed the provider cannot change here at all.
   */
  async update(organizationId: string, dto: UpdateStorageSettingsDto, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const merged = this.merge(stored, dto);

    let next: IStorageConfig;
    // ACC-185 — what a confirmed SharePoint save also resets.
    const extra: { storageAccessLostAt?: null; storageAccessLostReason?: null; storageSecretWarnedAt?: null } = {};
    if (org.storageConfirmedAt) {
      this.assertOnlyKeysChange(org.storageProvider, stored, dto.provider, merged);
      const changed = changedFields(stored, merged);
      // Credentials changed: they must pass the test — and for SharePoint reach
      // the SAME tenant, site and library Confirm recorded. A new expiry date
      // alone is a note, not a credential, and needs no test.
      if (changed.some((field) => !EXPIRY_FIELDS.has(field))) {
        const result = await this.assertTestPasses(organizationId, dto.provider, merged);
        if (org.storageProvider === 'SHAREPOINT') {
          this.assertSameSharePointLocation(stored, result);
          // A secret that works again ends a withdrawal at once; the hourly
          // probe would have, an hour later.
          extra.storageAccessLostAt = null;
          extra.storageAccessLostReason = null;
        }
      }
      // A new expiry date re-arms the 30-day warning for it.
      if (changed.includes('sharepoint.secretExpiresOn')) extra.storageSecretWarnedAt = null;
      next = merged;
    } else {
      this.assertUsable(dto.provider, merged);
      next = { ...merged, draftProvider: dto.provider };
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { storageConfig: writeStorageConfig(next), ...extra },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      actorId,
      tenantId: organizationId,
      before: org.storageConfirmedAt
        ? { storageProvider: org.storageProvider }
        : { draftProvider: stored.draftProvider ?? null },
      after: org.storageConfirmedAt ? { storageProvider: org.storageProvider } : { draftProvider: dto.provider },
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
   * ACC-185 — Disconnect SharePoint (Ahmad, 8 Oct; Q5: SharePoint only here).
   *
   *   - Before confirmation: clears the SharePoint draft.
   *   - After confirmation: only while NO SharePoint file is stored there,
   *     live or in the recycle bin (anything not yet purged) — otherwise
   *     STORAGE_LOCKED_BY_FILES. It returns the organisation to UNCONFIRMED
   *     AccreditMe cloud, so uploads are refused until someone confirms again.
   *
   * The count and the switch run in one transaction under the same
   * per-organisation lock an upload records under (StoredFileService
   * .recordInTx), so an upload landing meanwhile is either counted here or
   * refused there — never stranded on a location the organisation left.
   *
   * The app registration and its grant live in the customer's tenant;
   * AccreditMe cannot remove them, and the guide says how.
   */
  async disconnect(organizationId: string, actorId: string): Promise<IStorageSettings> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const without: IStorageConfig = {
      ...stored,
      sharepoint: undefined,
      draftProvider: stored.draftProvider === 'SHAREPOINT' ? undefined : stored.draftProvider,
    };

    if (!org.storageConfirmedAt) {
      if (!stored.sharepoint && stored.draftProvider !== 'SHAREPOINT') return this.get(organizationId);
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { storageConfig: writeStorageConfig(without) },
      });
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Organization',
        objectId: organizationId,
        actorId,
        tenantId: organizationId,
        before: { draftProvider: stored.draftProvider ?? null },
        after: { draftProvider: without.draftProvider ?? null },
        metadata: { event: 'storage_sharepoint_draft_cleared' },
      });
      return this.get(organizationId);
    }

    if (org.storageProvider !== 'SHAREPOINT') throw new StorageRefusalException('STORAGE_CHANGE_BY_PLATFORM');
    const location = stored.sharepoint?.resolved ?? null;

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`stored-file-quota:${organizationId}`}))::text`;
      const filesStored = await tx.storedFile.count({
        where: { organizationId, provider: 'SHAREPOINT', purgedAt: null },
      });
      if (filesStored > 0) throw new StorageRefusalException('STORAGE_LOCKED_BY_FILES', { filesStored });
      const switched = await tx.organization.updateMany({
        where: { id: organizationId, storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null } },
        data: {
          storageProvider: 'S3',
          storageConfirmedAt: null,
          storageConfirmedById: null,
          storageConfig: writeStorageConfig({ ...without, draftProvider: undefined }),
          storageAccessLostAt: null,
          storageAccessLostReason: null,
          storageSecretWarnedAt: null,
        },
      });
      if (switched.count !== 1) throw new StorageRefusalException('STORAGE_CHANGE_BY_PLATFORM');
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      actorId,
      tenantId: organizationId,
      before: {
        storageProvider: 'SHAREPOINT',
        storageConfirmedAt: org.storageConfirmedAt.toISOString(),
        tenantId: location?.tenantId ?? null,
        siteId: location?.siteId ?? null,
        listId: location?.listId ?? null,
        libraryName: location?.libraryName ?? null,
      },
      after: { storageProvider: 'S3', storageConfirmedAt: null },
      metadata: { event: 'storage_disconnected' },
    });
    return this.get(organizationId);
  }

  /**
   * Writes a probe object, reads it back, compares it, deletes it — against
   * the candidate settings if any were sent, the stored ones otherwise.
   * SAVES NOTHING, and writes nothing to the organisation (Q6). Reports the
   * first step that failed.
   *
   * Which option is tested: the one named, else the confirmed provider, else
   * the draft being set up.
   */
  async test(organizationId: string, dto: TestStorageSettingsDto = {}): Promise<IStorageTestResult> {
    const org = await this.loadOrg(organizationId);
    const stored = readStorageConfig(org.storageConfig);
    const provider: StorageChoice =
      dto.provider ?? (org.storageConfirmedAt ? org.storageProvider : (stored.draftProvider ?? org.storageProvider));
    return this.runTest(organizationId, provider, this.merge(stored, dto));
  }

  private async runTest(organizationId: string, provider: StorageChoice, candidate: IStorageConfig): Promise<IStorageTestResult> {
    const passed: StorageTestStep[] = [];
    let sharepoint: ISharePointLocation | null = null;
    const fail = (step: StorageTestStep, error: unknown): IStorageTestResult => {
      const refusal = this.asRefusal(error, step, provider);
      const body = refusal.getResponse() as { code: string; message: string };
      return { ok: false, provider, passed, failedStep: step, code: body.code, message: body.message, sharepoint: sharepointView(sharepoint) };
    };

    let target: StorageProvider;
    let timeoutMs = STEP_TIMEOUT_MS;
    try {
      this.assertUsable(provider, candidate);
      if (provider !== 'SHAREPOINT') target = this.resolver.forCandidate(provider, candidate).provider;
      passed.push('configure');
    } catch (error) {
      return fail('configure', error);
    }

    if (provider === 'SHAREPOINT') {
      // token → site → library, each reported as it passes.
      timeoutMs = SHAREPOINT_STEP_TIMEOUT_MS;
      try {
        const connected = await withTimeout(
          this.resolver.connectSharePoint(candidate, (step) => passed.push(step)),
          timeoutMs,
        );
        target = connected.provider;
        sharepoint = connected.location;
      } catch (error) {
        const step: StorageTestStep = error instanceof SharePointStepError ? error.step : nextSharePointStep(passed);
        return fail(step, error);
      }
    }

    const key = `${organizationId}/_probe/${randomBytes(12).toString('hex')}.txt`;
    const probe = Buffer.from(`AccreditMe storage check ${randomBytes(16).toString('hex')}\n`, 'utf8');

    try {
      await withTimeout(target!.put(key, probe, 'text/plain'), timeoutMs);
      passed.push('write');
    } catch (error) {
      return fail('write', error);
    }

    let readBack: Buffer;
    try {
      readBack = await withTimeout(target!.getStream(key).then(readAll), timeoutMs);
      passed.push('read');
    } catch (error) {
      await this.bestEffortDelete(target!, key);
      return fail('read', error);
    }

    if (sha256(readBack) !== sha256(probe)) {
      await this.bestEffortDelete(target!, key);
      return {
        ok: false,
        provider,
        passed,
        failedStep: 'verify',
        code: 'STORAGE_UNAVAILABLE',
        message: 'The file read back did not match the file written',
        sharepoint: sharepointView(sharepoint),
      };
    }
    passed.push('verify');

    try {
      await withTimeout(target!.delete(key), timeoutMs);
      passed.push('delete');
    } catch (error) {
      return fail('delete', error);
    }

    return { ok: true, provider, passed, failedStep: null, code: null, message: null, sharepoint: sharepointView(sharepoint) };
  }

  private async assertTestPasses(organizationId: string, provider: StorageChoice, candidate: IStorageConfig): Promise<IStorageTestResult> {
    const result = await this.runTest(organizationId, provider, candidate);
    if (!result.ok) {
      throw new StorageRefusalException('STORAGE_TEST_FAILED', {
        failedStep: result.failedStep ?? undefined,
        cause: result.code ?? undefined,
      });
    }
    return result;
  }

  // Once confirmed, the location belongs to AccreditMe: the same provider,
  // and for MinIO the same endpoint, region and bucket; for a local folder
  // the same root; for SharePoint the same tenant, site and library. Only the
  // credentials may differ — MinIO's two keys; SharePoint's client ID and
  // secret, and the secret's expiry date — as with a key rotation.
  private assertOnlyKeysChange(
    storedProvider: StorageProviderKind,
    stored: IStorageConfig,
    nextProvider: StorageChoice,
    next: IStorageConfig,
  ): void {
    const changed = changedFields(stored, next);
    const replaceable = REPLACEABLE_AFTER_CONFIRM[storedProvider];
    if (nextProvider !== storedProvider || changed.some((field) => !replaceable.has(field))) {
      throw new StorageRefusalException('STORAGE_CHANGE_BY_PLATFORM');
    }
  }

  /**
   * ACC-185 — a replaced SharePoint client ID or secret passed the test; it
   * must also have reached exactly the tenant, site and library Confirm
   * recorded. Another library is another location, which is AccreditMe's to
   * change.
   */
  private assertSameSharePointLocation(stored: IStorageConfig, result: IStorageTestResult): void {
    const was = stored.sharepoint?.resolved;
    const now = result.sharepoint;
    if (
      !was ||
      !now ||
      was.tenantId !== now.tenantId ||
      was.siteId !== now.siteId ||
      was.listId !== now.listId ||
      was.driveId !== now.driveId
    ) {
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
    const sharepoint = { ...stored.sharepoint, ...defined(dto.sharepoint) };
    return {
      ...(Object.keys(minio).length ? { minio } : {}),
      ...(Object.keys(local).length ? { local } : {}),
      ...(Object.keys(sharepoint).length ? { sharepoint } : {}),
      ...(stored.draftProvider ? { draftProvider: stored.draftProvider } : {}),
    };
  }

  // The chosen provider must be usable as configured. S3 needs nothing from
  // the tenant (it is AccreditMe's bucket); MinIO needs every field and an
  // allowed endpoint; Local needs this installation to offer it and a root
  // inside its base; SharePoint needs the app's three values and either the
  // site URL and library name or the two ids, with a .sharepoint.com site.
  private assertUsable(provider: StorageChoice, config: IStorageConfig): void {
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
    if (provider === 'SHAREPOINT' && !completeSharePoint(config)) {
      throw new StorageRefusalException('STORAGE_SETTINGS_INCOMPLETE');
    }
    // Settings stored but not selected are still checked, so nothing
    // disallowed is ever saved.
    if (provider !== 'MINIO' && config.minio?.endpoint) {
      this.resolver.assertMinioEndpointAllowed(config.minio.endpoint);
    }
    if (config.sharepoint?.siteUrl) this.resolver.assertSharePointSiteAllowed(config.sharepoint.siteUrl);
  }

  private asRefusal(error: unknown, step: StorageTestStep, provider: StorageChoice): StorageRefusalException {
    if (error instanceof StorageRefusalException) return error;
    if (isPrivateEndpointRefusal(error)) return new StorageRefusalException('STORAGE_ENDPOINT_NOT_ALLOWED');
    // The provider's own words go to the log only — they can name a host. Our
    // SharePoint errors carry a status, a Graph code and AADSTS numbers, never
    // a secret, a token or a request body.
    this.logger.warn(`Storage test failed at ${step}: ${describe(error)}`);
    if (provider === 'SHAREPOINT') {
      const code = sharePointRefusal(error, step);
      if (code) return new StorageRefusalException(code);
    }
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
        storageAccessLostAt: true,
        storageAccessLostReason: true,
      },
    });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}

// The field names that differ, secrets included BY NAME only. draftProvider is
// not a setting, so it never counts as a change.
function changedFields(before: IStorageConfig, after: IStorageConfig): string[] {
  const names: string[] = [];
  for (const block of ['minio', 'local', 'sharepoint'] as const) {
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

function withTimeout<T>(work: Promise<T>, ms: number = STEP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The storage did not answer in time')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The first SharePoint connection step not yet passed — for a timeout. */
function nextSharePointStep(passed: StorageTestStep[]): StorageTestStep {
  return (['token', 'site', 'library'] as const).find((s) => !passed.includes(s)) ?? 'library';
}

/**
 * ACC-185 — one plain reason per SharePoint failure, by step. Undefined means
 * "not something the customer can fix": Microsoft or the network failed, and
 * the generic STORAGE_UNAVAILABLE is the honest answer.
 */
function sharePointRefusal(error: unknown, step: StorageTestStep): StorageRefusalCode | undefined {
  const cause = error instanceof SharePointStepError ? error.cause : error;
  if (cause instanceof SiteUrlRefusedError) return 'SHAREPOINT_SITE_URL_INVALID';
  if (cause instanceof MicrosoftSignInError) {
    switch (cause.reason) {
      case 'TENANT_NOT_FOUND':
        return 'SHAREPOINT_TENANT_NOT_FOUND';
      case 'CLIENT_NOT_FOUND':
        return 'SHAREPOINT_CLIENT_NOT_FOUND';
      case 'SECRET_INVALID':
        return 'SHAREPOINT_SECRET_INVALID';
      case 'APP_DISABLED':
        return 'SHAREPOINT_APP_DISABLED';
      default:
        return undefined;
    }
  }
  if (cause instanceof NotFoundInSharePointError) {
    return cause.what === 'site' ? 'SHAREPOINT_SITE_NOT_FOUND' : 'SHAREPOINT_LIBRARY_NOT_FOUND';
  }
  if (cause instanceof GraphError) {
    const denied = cause.status === 401 || cause.status === 403;
    const missing = cause.status === 404 || cause.status === 400;
    if (step === 'site' && (denied || missing)) return 'SHAREPOINT_SITE_NOT_FOUND';
    if (step === 'library' && (denied || missing)) return 'SHAREPOINT_LIBRARY_NOT_FOUND';
    if (step === 'write' && denied) return 'SHAREPOINT_NO_WRITE_ACCESS';
    if (step === 'write' && cause.status === 404) return 'SHAREPOINT_LIBRARY_NOT_FOUND';
  }
  return undefined;
}

/** For the log: a name and a message our own errors keep free of secrets. */
function describe(error: unknown): string {
  if (error instanceof SharePointStepError) return `${error.step}: ${describe(error.cause)}`;
  return `${(error as Error)?.name ?? 'Error'} ${(error as Error)?.message ?? ''}`.trim();
}

/** What a test found in the customer's SharePoint — theirs, so shown to them. */
function sharepointView(location: ISharePointLocation | null): IStorageTestResult['sharepoint'] {
  if (!location) return null;
  return {
    tenantId: location.tenantId,
    siteId: location.siteId,
    siteName: location.siteName,
    siteWebUrl: location.siteWebUrl,
    listId: location.listId,
    driveId: location.driveId,
    libraryName: location.libraryName,
    libraryWebUrl: location.libraryWebUrl,
    resolvedBy: location.resolvedBy,
  };
}
