import { SharePointAccessService, classifyAccessLoss } from './sharepoint-access.service';
import { StorageResolverService } from './storage-resolver.service';
import { StorageNoticesService } from './storage-notices.service';
import { StorageRefusalException } from './storage-refusal';
import { writeStorageConfig } from './storage-config';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { SharePointConnector } from '../../providers/storage/sharepoint/sharepoint-connector';
import { MicrosoftIdentity, MicrosoftSignInError } from '../../providers/storage/sharepoint/microsoft-identity';
import { GraphClient, GraphError } from '../../providers/storage/sharepoint/graph-client';
import { FAKE_DRIVE_ID, FAKE_LIST_ID, FAKE_SITE_ID, FAKE_TENANT_ID, fakeMicrosoft, FakeMicrosoftOptions } from '../../providers/storage/sharepoint/testing/fake-microsoft';

const CONFIRMED = {
  sharepoint: {
    tenant: FAKE_TENANT_ID,
    clientId: '99999999-8888-7777-6666-555555555555',
    clientSecret: 'secret-value-123',
    siteUrl: 'https://contoso.sharepoint.com/sites/Quality',
    libraryName: 'AccreditMe Files',
    secretExpiresOn: '2027-06-04',
    resolved: {
      tenantId: FAKE_TENANT_ID,
      siteId: FAKE_SITE_ID,
      siteName: 'Quality',
      siteWebUrl: null,
      listId: FAKE_LIST_ID,
      driveId: FAKE_DRIVE_ID,
      libraryName: 'AccreditMe Files',
      libraryWebUrl: null,
      resolvedAt: '2026-10-08T00:00:00.000Z',
    },
  },
};

describe('classifyAccessLoss (ACC-185)', () => {
  it.each([
    [new MicrosoftSignInError('SECRET_INVALID'), 'library', 'SECRET_INVALID'],
    [new MicrosoftSignInError('CLIENT_NOT_FOUND'), 'library', 'CONSENT_REVOKED'],
    [new MicrosoftSignInError('APP_DISABLED'), 'file', 'CONSENT_REVOKED'],
    [new MicrosoftSignInError('TENANT_NOT_FOUND'), 'library', 'CONSENT_REVOKED'],
    [new MicrosoftSignInError('UNAVAILABLE'), 'library', null],
    [new GraphError(401, null, 'x'), 'file', 'CONSENT_REVOKED'],
    [new GraphError(403, 'accessDenied', 'x'), 'file', 'GRANT_REMOVED'],
    [new GraphError(404, 'itemNotFound', 'x'), 'library', 'LIBRARY_GONE'],
    [new GraphError(404, 'itemNotFound', 'x'), 'file', null],
    [new GraphError(503, null, 'x', 5), 'library', null],
    [new GraphError(0, null, 'x'), 'library', null],
    [new Error('anything else'), 'library', null],
  ])('%p on a %s → %p', (error, scope, reason) => {
    expect(classifyAccessLoss(error, scope as 'library' | 'file')).toBe(reason);
  });
});

describe('SharePointAccessService (ACC-185)', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  };
  const notices = { sharePointAccessLost: jest.fn().mockResolvedValue(undefined), sharePointSecretExpiring: jest.fn().mockResolvedValue(undefined) };
  const savedKey = process.env['ENCRYPTION_KEY'];

  const serviceWith = (microsoft: FakeMicrosoftOptions & { driveStatus?: number } = {}) => {
    const ms = fakeMicrosoft(microsoft);
    const connector = new SharePointConnector(new MicrosoftIdentity(ms.fetchFn), new GraphClient(ms.fetchFn, async () => undefined));
    const resolver = new StorageResolverService(prisma as unknown as PrismaService, connector);
    return { ms, service: new SharePointAccessService(prisma as unknown as PrismaService, resolver, notices as unknown as StorageNoticesService) };
  };
  const org = (over: Record<string, unknown> = {}) =>
    prisma.organization.findFirst.mockResolvedValue({
      storageProvider: 'SHAREPOINT',
      storageConfirmedAt: new Date('2026-10-08'),
      storageConfig: writeStorageConfig(CONFIRMED),
      ...over,
    });
  const stamps = () => prisma.organization.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> });

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

  describe('one record, one notice', () => {
    it('stamps the loss with its reason, guarded on it not being stamped yet, and tells the tenant admins', async () => {
      const { service } = serviceWith();
      org();
      expect(await service.markLost('org-a', 'GRANT_REMOVED')).toBe(true);
      expect(stamps()[0]).toEqual({
        where: { id: 'org-a', storageProvider: 'SHAREPOINT', storageAccessLostAt: null },
        data: { storageAccessLostAt: expect.any(Date), storageAccessLostReason: 'GRANT_REMOVED' },
      });
      expect(notices.sharePointAccessLost).toHaveBeenCalledWith('org-a', 'GRANT_REMOVED', 'AccreditMe Files');
    });

    it('sends nothing when the loss was already stamped', async () => {
      const { service } = serviceWith();
      org();
      prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.markLost('org-a', 'GRANT_REMOVED')).toBe(false);
      expect(notices.sharePointAccessLost).not.toHaveBeenCalled();
    });

    it('turns a withdrawal into STORAGE_ACCESS_WITHDRAWN, stamping it', async () => {
      const { service } = serviceWith();
      org();
      const refusal = await service.refusalFor('org-a', new GraphError(403, 'accessDenied', 'write'), 'library');
      expect(refusal?.code).toBe('STORAGE_ACCESS_WITHDRAWN');
      expect(notices.sharePointAccessLost).toHaveBeenCalledTimes(1);
    });

    it('a file gone inside SharePoint is FILE_UNAVAILABLE — the connection is fine, nothing is stamped', async () => {
      const { service } = serviceWith();
      const refusal = await service.refusalFor('org-a', new GraphError(404, 'itemNotFound', 'read'), 'file');
      expect(refusal?.code).toBe('FILE_UNAVAILABLE');
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('leaves anything else to the caller', async () => {
      const { service } = serviceWith();
      expect(await service.refusalFor('org-a', new GraphError(503, null, 'write', 9), 'library')).toBeNull();
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('the hourly probe — the one scheduled recomputer', () => {
    it('clears the flag when the library can be reached', async () => {
      const { ms, service } = serviceWith();
      org();
      expect(await service.probe('org-a')).toBe('OK');
      expect(ms.calls.some((c) => c.url.includes(`/drives/${encodeURIComponent(FAKE_DRIVE_ID)}?`))).toBe(true);
      expect(stamps()).toEqual([
        { where: { id: 'org-a', storageAccessLostAt: { not: null } }, data: { storageAccessLostAt: null, storageAccessLostReason: null } },
      ]);
    });

    it.each([
      [{ tokenErrorCodes: [7000222] }, 'SECRET_INVALID'],
      [{ tokenErrorCodes: [700016] }, 'CONSENT_REVOKED'],
      [{ probeStatus: 403 }, 'GRANT_REMOVED'],
      [{ probeStatus: 404 }, 'LIBRARY_GONE'],
    ])('sets the flag when Microsoft answers %p: %s', async (microsoft, reason) => {
      const { service } = serviceWith(microsoft);
      org();
      expect(await service.probe('org-a')).toBe(reason);
      expect(stamps()[0]!.data).toEqual(expect.objectContaining({ storageAccessLostReason: reason }));
    });

    it('a check that could not run never clears the flag', async () => {
      const { service } = serviceWith({ tokenErrorCodes: [70011] });
      org();
      expect(await service.probe('org-a')).toBe('UNAVAILABLE');
      expect(prisma.organization.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing for an organisation not confirmed on SharePoint', async () => {
      const { ms, service } = serviceWith();
      org({ storageProvider: 'S3' });
      expect(await service.probe('org-a')).toBe('NOT_SHAREPOINT');
      org({ storageConfirmedAt: null });
      expect(await service.probe('org-a')).toBe('NOT_SHAREPOINT');
      expect(ms.calls).toEqual([]);
    });

    it('assertReachable refuses before anything changes — withdrawn, or Microsoft down', async () => {
      const withdrawn = serviceWith({ tokenErrorCodes: [7000215] });
      org();
      await expect(withdrawn.service.assertReachable('org-a')).rejects.toMatchObject({ code: 'STORAGE_ACCESS_WITHDRAWN' });
      const down = serviceWith({ tokenErrorCodes: [70011] });
      await expect(down.service.assertReachable('org-a')).rejects.toBeInstanceOf(StorageRefusalException);
    });

    it('probeAll checks every confirmed SharePoint organisation, one failing not stopping the rest', async () => {
      const { service } = serviceWith();
      prisma.organization.findMany.mockResolvedValue([{ id: 'org-a' }, { id: 'org-b' }]);
      prisma.organization.findFirst
        .mockRejectedValueOnce(new Error('db hiccup'))
        .mockResolvedValue({ storageProvider: 'SHAREPOINT', storageConfirmedAt: new Date(), storageConfig: writeStorageConfig(CONFIRMED) });
      expect(await service.probeAll()).toEqual({ checked: 2, withdrawn: 0, unavailable: 1 });
      expect(prisma.organization.findMany).toHaveBeenCalledWith({
        where: { storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null } },
        select: { id: true },
      });
    });
  });

  describe('the 30-day secret warning', () => {
    const due = (expiresOn: string | undefined) =>
      prisma.organization.findMany.mockResolvedValue([
        { id: 'org-a', storageConfig: writeStorageConfig({ sharepoint: { ...CONFIRMED.sharepoint, secretExpiresOn: expiresOn } }) },
      ]);
    const NOW = new Date('2027-05-05T10:00:00Z');

    it.each([
      ['2027-06-04', 1], // 30 days
      ['2027-05-05', 1], // today
      ['2027-06-05', 0], // 31 days
      ['2027-05-04', 0], // already expired — the probe's job
      [undefined, 0], // no date, no warning
    ])('a secret expiring on %p warns %p time(s)', async (expiresOn, times) => {
      const { service } = serviceWith();
      due(expiresOn);
      expect(await service.warnExpiringSecrets(NOW)).toEqual({ warned: times });
      expect(notices.sharePointSecretExpiring).toHaveBeenCalledTimes(times);
    });

    it('warns once — the stamp is guarded, and only the call that set it sends', async () => {
      const { service } = serviceWith();
      due('2027-06-01');
      prisma.organization.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.warnExpiringSecrets(NOW)).toEqual({ warned: 0 });
      expect(notices.sharePointSecretExpiring).not.toHaveBeenCalled();
      expect(prisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { storageProvider: 'SHAREPOINT', storageConfirmedAt: { not: null }, storageSecretWarnedAt: null } }),
      );
    });
  });

  itEnforcesTenantIsolation("the probe reads and stamps the named organisation only", async () => {
    const { service } = serviceWith({ tokenErrorCodes: [7000215] });
    org();
    await service.probe('org-b');
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'org-b' } }));
    expect(stamps().every((s) => s.where['id'] === 'org-b')).toBe(true);
  });
});
