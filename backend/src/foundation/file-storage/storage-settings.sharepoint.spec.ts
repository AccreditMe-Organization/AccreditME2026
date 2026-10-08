import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageSettingsService } from './storage-settings.service';
import { StorageResolverService } from './storage-resolver.service';
import { StoredFileService } from './stored-file.service';
import { StorageNoticesService } from './storage-notices.service';
import { StorageRefusalException } from './storage-refusal';
import { readStorageConfig, writeStorageConfig } from './storage-config';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { SharePointConnector } from '../../providers/storage/sharepoint/sharepoint-connector';
import { MicrosoftIdentity } from '../../providers/storage/sharepoint/microsoft-identity';
import { GraphClient } from '../../providers/storage/sharepoint/graph-client';
import {
  FAKE_ACCESS_TOKEN,
  FAKE_DRIVE_ID,
  FAKE_LIST_ID,
  FAKE_SITE_ID,
  FAKE_TENANT_ID,
  fakeMicrosoft,
  FakeMicrosoftOptions,
} from '../../providers/storage/sharepoint/testing/fake-microsoft';

const SECRET = 'S3cr3t~value-that-must-never-be-logged';
const SHAREPOINT = {
  tenant: 'contoso.onmicrosoft.com',
  clientId: '99999999-8888-7777-6666-555555555555',
  clientSecret: SECRET,
  siteUrl: 'https://contoso.sharepoint.com/sites/Quality',
  libraryName: 'AccreditMe Files',
};
const MINIO = { endpoint: 'https://minio.example.com', region: 'us-east-1', bucket: 'evidence', accessKeyId: 'ak', secretAccessKey: 'minio-secret-key' };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof StorageRefusalException) return error.code;
    throw error;
  }
  return undefined;
}

describe('StorageSettingsService — SharePoint, and only Confirm writes the provider (ACC-185)', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn() },
    // ACC-185 — GET counts SharePoint files not yet purged.
    storedFile: { count: jest.fn().mockResolvedValue(0) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  const storedFiles = { cloudUsageBytes: jest.fn().mockResolvedValue(0) };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const notices = { storageChangeRequested: jest.fn().mockResolvedValue(undefined) };
  let base: string;
  const savedEnv: Record<string, string | undefined> = {};

  const serviceWith = (options: FakeMicrosoftOptions = {}) => {
    const ms = fakeMicrosoft(options);
    const connector = new SharePointConnector(new MicrosoftIdentity(ms.fetchFn), new GraphClient(ms.fetchFn, async () => undefined));
    const resolver = new StorageResolverService(prisma as unknown as PrismaService, connector);
    const service = new StorageSettingsService(
      prisma as unknown as PrismaService,
      resolver,
      storedFiles as unknown as StoredFileService,
      auditLog as unknown as AuditLogService,
      notices as unknown as StorageNoticesService,
    );
    return { ms, service };
  };
  const org = (storageProvider: string, config: object | null, confirmed = false) =>
    prisma.organization.findFirst.mockResolvedValue({
      storageProvider,
      storageConfig: config ? writeStorageConfig(config) : null,
      maxStorageGb: 10,
      storageConfirmedAt: confirmed ? new Date('2026-10-07T08:00:00Z') : null,
      storageConfirmedBy: confirmed ? { id: 'admin-1', name: 'Hessa' } : null,
      storageChangeRequestedAt: null,
      storageChangeRequestedBy: null,
      storageAccessLostAt: null,
      storageAccessLostReason: null,
    });
  /** Every `data` object the organisation was written with, by any method. */
  const organisationWrites = (): Array<Record<string, unknown>> =>
    [...prisma.organization.update.mock.calls, ...prisma.organization.updateMany.mock.calls].map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );

  beforeAll(async () => {
    for (const k of ['ENCRYPTION_KEY', 'LOCAL_STORAGE_BASE']) savedEnv[k] = process.env[k];
    base = await mkdtemp(join(tmpdir(), 'acc185-settings-'));
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(base, { recursive: true, force: true });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['ENCRYPTION_KEY'] = 'e'.repeat(64);
    process.env['LOCAL_STORAGE_BASE'] = base;
    prisma.organization.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('Q6 — only Confirm writes Organization.storageProvider', () => {
    it.each([
      ['S3', {}],
      ['MINIO', { minio: MINIO }],
      ['LOCAL_FILESYSTEM', { local: { rootPath: 'org-a' } }],
      ['SHAREPOINT', { sharepoint: SHAREPOINT }],
    ])('saving a %s draft writes the config and NOT the provider', async (provider, body) => {
      const { service } = serviceWith();
      org('S3', null);
      await service.update('org-a', { provider: provider as 'S3', ...body }, 'admin-1');

      const writes = organisationWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]).not.toHaveProperty('storageProvider');
      const saved = readStorageConfig(writes[0]!['storageConfig'] as string | null);
      // An AccreditMe-cloud draft is the default, so there is nothing to keep.
      expect(saved.draftProvider).toBe(provider === 'S3' ? undefined : provider);
    });

    it('a SharePoint connection test writes nothing to the organisation at all', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      const result = await service.test('org-a', { provider: 'SHAREPOINT' });
      expect(result.ok).toBe(true);
      expect(organisationWrites()).toEqual([]);
    });

    it('Confirm is the one call that writes it — and it clears the draft', async () => {
      const { service } = serviceWith();
      org('S3', { draftProvider: 'LOCAL_FILESYSTEM', local: { rootPath: 'org-a' } });
      await service.confirm('org-a', { provider: 'LOCAL_FILESYSTEM' }, 'admin-1');
      const writes = organisationWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual(expect.objectContaining({ storageProvider: 'LOCAL_FILESYSTEM', storageConfirmedById: 'admin-1' }));
      expect(readStorageConfig(writes[0]!['storageConfig'] as string).draftProvider).toBeUndefined();
    });

    it('Confirm writes SHAREPOINT and records what the passing test found as the location', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      await service.confirm('org-a', { provider: 'SHAREPOINT' }, 'admin-1');
      const writes = organisationWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual(expect.objectContaining({ storageProvider: 'SHAREPOINT', storageConfirmedById: 'admin-1', storageAccessLostAt: null }));
      const saved = readStorageConfig(writes[0]!['storageConfig'] as string);
      expect(saved.draftProvider).toBeUndefined();
      expect(saved.sharepoint?.resolved).toEqual(
        expect.objectContaining({ tenantId: FAKE_TENANT_ID, siteId: FAKE_SITE_ID, listId: FAKE_LIST_ID, driveId: FAKE_DRIVE_ID }),
      );
    });

    it('Confirm refuses SharePoint whose test fails — and nothing is written', async () => {
      const { service } = serviceWith({ tokenErrorCodes: [7000215] });
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      expect(await codeOf(service.confirm('org-a', { provider: 'SHAREPOINT' }, 'admin-1'))).toBe('STORAGE_TEST_FAILED');
      expect(organisationWrites()).toEqual([]);
    });

    it('GET names the draft before confirmation, and stops once confirmed', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      expect((await service.get('org-a')).draftProvider).toBe('SHAREPOINT');
      org('MINIO', { minio: MINIO }, true);
      expect((await service.get('org-a')).draftProvider).toBeNull();
    });

    it('Test with no provider named tests the draft being set up', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      expect((await service.test('org-a')).provider).toBe('SHAREPOINT');
    });
  });

  describe('the settings', () => {
    it('shows the customer’s own values and the secret only as "set"', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: { ...SHAREPOINT, secretExpiresOn: '2027-04-30' }, draftProvider: 'SHAREPOINT' });
      const settings = await service.get('org-a');
      expect(settings.sharepoint).toEqual({
        tenant: SHAREPOINT.tenant,
        clientId: SHAREPOINT.clientId,
        clientSecret: 'set',
        siteUrl: SHAREPOINT.siteUrl,
        libraryName: SHAREPOINT.libraryName,
        siteId: null,
        listId: null,
        secretExpiresOn: '2027-04-30',
        tenantId: null,
        siteName: null,
        siteWebUrl: null,
        libraryWebUrl: null,
        accessLostAt: null,
        accessLostReason: null,
        filesStored: 0,
        disconnectAllowed: true,
      });
      expect(JSON.stringify(settings)).not.toContain(SECRET);
    });

    it('keeps the stored secret when a save omits it — the secret is write-only', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      await service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { libraryName: 'Other Library' } }, 'admin-1');
      const saved = readStorageConfig(organisationWrites()[0]!['storageConfig'] as string);
      expect(saved.sharepoint).toEqual(expect.objectContaining({ clientSecret: SECRET, libraryName: 'Other Library' }));
    });

    it('audits a SharePoint save by field NAME — the secret’s value never reaches the audit trail', async () => {
      const { service } = serviceWith();
      org('S3', null);
      await service.update('org-a', { provider: 'SHAREPOINT', sharepoint: SHAREPOINT }, 'admin-1');
      const entry = auditLog.log.mock.calls[0]![0] as { metadata: { changedFields: string[] }; after: unknown };
      expect(entry.metadata.changedFields).toEqual(expect.arrayContaining(['sharepoint.clientSecret', 'sharepoint.tenant']));
      expect(JSON.stringify(auditLog.log.mock.calls)).not.toContain(SECRET);
    });

    it('refuses to save a site address that is not https on .sharepoint.com', async () => {
      const { service } = serviceWith();
      org('S3', null);
      expect(
        await codeOf(service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { ...SHAREPOINT, siteUrl: 'https://intranet.contoso.local/sites/Quality' } }, 'admin-1')),
      ).toBe('SHAREPOINT_SITE_URL_INVALID');
      expect(organisationWrites()).toEqual([]);
    });

    it('once a location is confirmed, a SharePoint save is AccreditMe’s to do', async () => {
      const { service } = serviceWith();
      org('MINIO', { minio: MINIO }, true);
      expect(await codeOf(service.update('org-a', { provider: 'SHAREPOINT', sharepoint: SHAREPOINT }, 'admin-1'))).toBe('STORAGE_CHANGE_BY_PLATFORM');
      expect(organisationWrites()).toEqual([]);
    });
  });

  describe('the connection test — a plain reason for each step', () => {
    it('passes every step and says what it found', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT' });
      const result = await service.test('org-a', { provider: 'SHAREPOINT' });
      expect(result).toEqual({
        ok: true,
        provider: 'SHAREPOINT',
        passed: ['configure', 'token', 'site', 'library', 'write', 'read', 'verify', 'delete'],
        failedStep: null,
        code: null,
        message: null,
        sharepoint: expect.objectContaining({
          tenantId: FAKE_TENANT_ID,
          siteId: FAKE_SITE_ID,
          listId: FAKE_LIST_ID,
          driveId: FAKE_DRIVE_ID,
          libraryName: 'AccreditMe Files',
          resolvedBy: 'URL_AND_NAME',
        }),
      });
    });

    it('writes the probe under AccreditMe/_probe and removes it', async () => {
      const { ms, service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT });
      await service.test('org-a', { provider: 'SHAREPOINT' });
      const put = ms.calls.find((c) => c.method === 'PUT')!;
      expect(decodeURIComponent(put.url)).toMatch(/\/root:\/AccreditMe\/_probe\/[0-9a-f]{24}\.txt:\/content/);
      expect(ms.files.size).toBe(0);
    });

    it('tests a candidate on top of the stored values — the Site ID and Library ID fallback', async () => {
      const { service } = serviceWith({ siteStatus: 403 });
      org('S3', { sharepoint: SHAREPOINT });
      // By URL the site cannot be read …
      expect((await service.test('org-a', { provider: 'SHAREPOINT' })).failedStep).toBe('site');
      // … by ids, the library is reachable all the same.
      const byIds = await service.test('org-a', { provider: 'SHAREPOINT', sharepoint: { siteId: FAKE_SITE_ID, listId: FAKE_LIST_ID } });
      expect(byIds).toEqual(expect.objectContaining({ ok: true, sharepoint: expect.objectContaining({ resolvedBy: 'IDS', siteName: null }) }));
    });

    it.each([
      [{ tokenErrorCodes: [90002] }, {}, 'token', 'SHAREPOINT_TENANT_NOT_FOUND'],
      [{ tokenErrorCodes: [700016] }, {}, 'token', 'SHAREPOINT_CLIENT_NOT_FOUND'],
      [{ tokenErrorCodes: [7000215] }, {}, 'token', 'SHAREPOINT_SECRET_INVALID'],
      [{ tokenErrorCodes: [7000222] }, {}, 'token', 'SHAREPOINT_SECRET_INVALID'],
      [{ tokenErrorCodes: [7000112] }, {}, 'token', 'SHAREPOINT_APP_DISABLED'],
      [{ metadataStatus: 400 }, {}, 'token', 'SHAREPOINT_TENANT_NOT_FOUND'],
      [{ siteStatus: 403 }, {}, 'site', 'SHAREPOINT_SITE_NOT_FOUND'],
      [{ siteStatus: 404 }, {}, 'site', 'SHAREPOINT_SITE_NOT_FOUND'],
      [{}, { libraryName: 'Not There' }, 'library', 'SHAREPOINT_LIBRARY_NOT_FOUND'],
      [{ listsStatus: 403 }, {}, 'library', 'SHAREPOINT_LIBRARY_NOT_FOUND'],
      [{ writeStatuses: [403] }, {}, 'write', 'SHAREPOINT_NO_WRITE_ACCESS'],
      [{ writeStatuses: [429, 429, 429], retryAfter: '1' }, {}, 'write', 'STORAGE_UNAVAILABLE'],
    ])('Microsoft answering %p fails at %s: %s', async (microsoft, override, step, code) => {
      const { service } = serviceWith(microsoft as FakeMicrosoftOptions);
      org('S3', { sharepoint: { ...SHAREPOINT, ...override } });
      const result = await service.test('org-a', { provider: 'SHAREPOINT' });
      expect(result).toEqual(expect.objectContaining({ ok: false, failedStep: step, code }));
      expect(result.message).not.toMatch(/AADSTS|details that must not leak|echoes request/);
    });

    it('fails at configure, with nothing sent to Microsoft, when a value is missing', async () => {
      const { ms, service } = serviceWith();
      org('S3', { sharepoint: { ...SHAREPOINT, clientSecret: undefined } });
      const result = await service.test('org-a', { provider: 'SHAREPOINT' });
      expect(result).toEqual(expect.objectContaining({ failedStep: 'configure', code: 'STORAGE_SETTINGS_INCOMPLETE' }));
      expect(ms.calls).toEqual([]);
    });

    it('fails at configure for a site address off .sharepoint.com', async () => {
      const { ms, service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT });
      const result = await service.test('org-a', { provider: 'SHAREPOINT', sharepoint: { siteUrl: 'http://contoso.sharepoint.com/sites/Quality' } });
      expect(result).toEqual(expect.objectContaining({ failedStep: 'configure', code: 'SHAREPOINT_SITE_URL_INVALID' }));
      expect(ms.calls).toEqual([]);
    });
  });

  it('never logs the secret, the token or the token request — across passing and failing tests', async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    const spies = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(capture),
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(capture),
      jest.spyOn(console, 'log').mockImplementation(capture),
      jest.spyOn(console, 'warn').mockImplementation(capture),
      jest.spyOn(console, 'error').mockImplementation(capture),
    ];
    try {
      for (const microsoft of [{}, { tokenErrorCodes: [7000215] }, { siteStatus: 403 }, { writeStatuses: [403] }, { listsStatus: 500 }] as FakeMicrosoftOptions[]) {
        const { service } = serviceWith(microsoft);
        org('S3', { sharepoint: SHAREPOINT });
        await service.test('org-a', { provider: 'SHAREPOINT' });
      }
      // The run logged something, so the absence below means something.
      expect(lines.length).toBeGreaterThan(0);
      const all = lines.join('\n');
      expect(all).not.toContain(SECRET);
      expect(all).not.toContain(encodeURIComponent(SECRET));
      expect(all).not.toContain(FAKE_ACCESS_TOKEN);
      expect(all).not.toContain('client_secret');
      expect(all).not.toMatch(/Bearer /);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  itEnforcesTenantIsolation("a SharePoint test reads the caller's own organisation's settings only", async () => {
    const { ms, service } = serviceWith();
    prisma.organization.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      storageProvider: 'S3',
      storageConfig: writeStorageConfig({
        sharepoint: where.id === 'org-b' ? { ...SHAREPOINT, clientId: '22222222-2222-2222-2222-222222222222' } : SHAREPOINT,
      }),
      maxStorageGb: 10,
      storageConfirmedAt: null,
      storageConfirmedBy: null,
      storageChangeRequestedAt: null,
      storageChangeRequestedBy: null,
    }));
    await service.test('org-b', { provider: 'SHAREPOINT' });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    const tokenCall = ms.calls.find((c) => c.url.endsWith('/oauth2/v2.0/token'))!;
    expect(new URLSearchParams(tokenCall.body!).get('client_id')).toBe('22222222-2222-2222-2222-222222222222');
  });

  describe('after Confirm — the tenant, site and library are locked; credentials are not', () => {
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
    const confirmed = (over: Record<string, unknown> = {}) =>
      org('SHAREPOINT', { sharepoint: { ...SHAREPOINT, secretExpiresOn: '2027-06-04', resolved: RESOLVED, ...over } }, true);

    it('replaces the secret after a passing test against the SAME library — and ends a withdrawal', async () => {
      const { service } = serviceWith();
      confirmed();
      await service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { clientSecret: 'a-brand-new-secret' } }, 'admin-1');
      const writes = organisationWrites();
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual(expect.objectContaining({ storageAccessLostAt: null, storageAccessLostReason: null }));
      expect(writes[0]).not.toHaveProperty('storageProvider');
      const saved = readStorageConfig(writes[0]!['storageConfig'] as string);
      expect(saved.sharepoint).toEqual(expect.objectContaining({ clientSecret: 'a-brand-new-secret', resolved: RESOLVED }));
      expect(auditLog.log.mock.calls[0]![0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ event: 'storage_keys_replaced', changedFields: ['sharepoint.clientSecret'] }) }),
      );
    });

    it('refuses a secret that passes the test but reaches ANOTHER library — that is another location', async () => {
      const { service } = serviceWith({ lists: [{ id: 'other-list', displayName: 'AccreditMe Files', template: 'documentLibrary', driveId: 'b!other-drive' }] });
      confirmed();
      expect(await codeOf(service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { clientSecret: 'a-brand-new-secret' } }, 'admin-1'))).toBe(
        'STORAGE_CHANGE_BY_PLATFORM',
      );
      expect(organisationWrites()).toEqual([]);
    });

    it('refuses a secret that fails the test, and keeps the old one', async () => {
      const { service } = serviceWith({ tokenErrorCodes: [7000215] });
      confirmed();
      expect(await codeOf(service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { clientSecret: 'wrong-secret-value' } }, 'admin-1'))).toBe(
        'STORAGE_TEST_FAILED',
      );
      expect(organisationWrites()).toEqual([]);
    });

    it.each([
      [{ tenant: 'fabrikam.onmicrosoft.com' }],
      [{ siteUrl: 'https://contoso.sharepoint.com/sites/Other' }],
      [{ libraryName: 'Another Library' }],
      [{ siteId: FAKE_SITE_ID, listId: '00000000-0000-0000-0000-000000000009' }],
    ])('refuses changing %p — AccreditMe changes the location', async (change) => {
      const { ms, service } = serviceWith();
      confirmed();
      expect(await codeOf(service.update('org-a', { provider: 'SHAREPOINT', sharepoint: change }, 'admin-1'))).toBe('STORAGE_CHANGE_BY_PLATFORM');
      expect(ms.calls).toEqual([]);
      expect(organisationWrites()).toEqual([]);
    });

    it('a new expiry date alone needs no test, and re-arms the 30-day warning', async () => {
      const { ms, service } = serviceWith();
      confirmed();
      await service.update('org-a', { provider: 'SHAREPOINT', sharepoint: { secretExpiresOn: '2028-06-04' } }, 'admin-1');
      expect(ms.calls).toEqual([]);
      expect(organisationWrites()[0]).toEqual(expect.objectContaining({ storageSecretWarnedAt: null }));
      expect(organisationWrites()[0]).not.toHaveProperty('storageAccessLostAt');
    });

    it('GET shows what Confirm recorded and whether Disconnect would be accepted', async () => {
      const { service } = serviceWith();
      confirmed();
      prisma.storedFile.count.mockResolvedValueOnce(3);
      const settings = await service.get('org-a');
      expect(settings.sharepoint).toEqual(
        expect.objectContaining({ tenantId: FAKE_TENANT_ID, siteName: 'Quality', filesStored: 3, disconnectAllowed: false }),
      );
      expect(prisma.storedFile.count).toHaveBeenCalledWith({ where: { organizationId: 'org-a', provider: 'SHAREPOINT', purgedAt: null } });
    });
  });

  describe('Disconnect', () => {
    it('before confirmation, clears the SharePoint draft', async () => {
      const { service } = serviceWith();
      org('S3', { sharepoint: SHAREPOINT, draftProvider: 'SHAREPOINT', minio: { endpoint: 'https://minio.example.com' } });
      await service.disconnect('org-a', 'admin-1');
      const saved = readStorageConfig(organisationWrites()[0]!['storageConfig'] as string);
      expect(saved.sharepoint).toBeUndefined();
      expect(saved.draftProvider).toBeUndefined();
      expect(saved.minio).toEqual({ endpoint: 'https://minio.example.com' });
      expect(organisationWrites()[0]).not.toHaveProperty('storageProvider');
    });

    it('after confirmation, refuses while any SharePoint file is stored there — live or in the recycle bin', async () => {
      const { service } = serviceWith();
      org('SHAREPOINT', { sharepoint: SHAREPOINT }, true);
      prisma.storedFile.count.mockResolvedValue(2);
      const error = (await service.disconnect('org-a', 'admin-1').catch((e: unknown) => e)) as StorageRefusalException;
      expect(error.code).toBe('STORAGE_LOCKED_BY_FILES');
      expect(error.getResponse()).toEqual(expect.objectContaining({ filesStored: 2 }));
      expect(prisma.storedFile.count).toHaveBeenCalledWith({ where: { organizationId: 'org-a', provider: 'SHAREPOINT', purgedAt: null } });
      expect(organisationWrites()).toEqual([]);
      prisma.storedFile.count.mockResolvedValue(0);
    });

    it('after confirmation with nothing stored there, returns to unconfirmed AccreditMe cloud — under the upload lock, audited', async () => {
      const { service } = serviceWith();
      org('SHAREPOINT', { sharepoint: SHAREPOINT }, true);
      await service.disconnect('org-a', 'admin-1');
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org-a', storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null } },
        data: expect.objectContaining({ storageProvider: 'S3', storageConfirmedAt: null, storageConfirmedById: null, storageConfig: null }),
      });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ metadata: { event: 'storage_disconnected' } }));
    });

    it('is not how a confirmed MinIO or AccreditMe cloud location is left', async () => {
      const { service } = serviceWith();
      org('MINIO', { minio: MINIO }, true);
      expect(await codeOf(service.disconnect('org-a', 'admin-1'))).toBe('STORAGE_CHANGE_BY_PLATFORM');
      expect(organisationWrites()).toEqual([]);
    });
  });

  itEnforcesTenantIsolation("Disconnect counts and switches the caller's own organisation only", async () => {
    const { service } = serviceWith();
    org('SHAREPOINT', { sharepoint: SHAREPOINT }, true);
    await service.disconnect('org-b', 'admin-1');
    expect(prisma.storedFile.count).toHaveBeenCalledWith({ where: { organizationId: 'org-b', provider: 'SHAREPOINT', purgedAt: null } });
    expect(prisma.organization.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'org-b' }) }));
  });

  itEnforcesTenantIsolation("a SharePoint draft is written to the caller's own organisation only", async () => {
    const { service } = serviceWith();
    org('S3', null);
    await service.update('org-b', { provider: 'SHAREPOINT', sharepoint: SHAREPOINT }, 'admin-1');
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
  });
});
