import { SetupConditionDetectors } from './setup-condition.detectors';
import { writeStorageConfig } from '../file-storage/storage-config';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-185 — "SharePoint access withdrawn" and "SharePoint secret expires soon".
describe('SetupConditionDetectors — SharePoint storage (ACC-185)', () => {
  const prisma = { organization: { findFirst: jest.fn() } };
  const detectors = new SetupConditionDetectors(prisma as unknown as PrismaService);
  const savedKey = process.env['ENCRYPTION_KEY'];
  const NOW = new Date('2027-05-05T10:00:00Z');

  beforeAll(() => {
    process.env['ENCRYPTION_KEY'] = 'e'.repeat(64);
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env['ENCRYPTION_KEY'];
    else process.env['ENCRYPTION_KEY'] = savedKey;
  });
  beforeEach(() => jest.clearAllMocks());

  describe('STORAGE_ACCESS_WITHDRAWN', () => {
    it('is open, BLOCKS_WORK, from the moment access was lost', async () => {
      const lostAt = new Date('2027-05-01T08:00:00Z');
      prisma.organization.findFirst.mockResolvedValue({ storageProvider: 'SHAREPOINT', storageAccessLostAt: lostAt, storageAccessLostReason: 'GRANT_REMOVED' });
      expect(await detectors.byType.STORAGE_ACCESS_WITHDRAWN('org-a', NOW)).toEqual([
        { objectId: 'org-a', severity: 'BLOCKS_WORK', openedAt: lostAt, subject: { reason: 'GRANT_REMOVED' } },
      ]);
    });

    it.each([
      [{ storageProvider: 'SHAREPOINT', storageAccessLostAt: null, storageAccessLostReason: null }],
      [{ storageProvider: 'S3', storageAccessLostAt: new Date(), storageAccessLostReason: 'GRANT_REMOVED' }],
    ])('is closed for %p', async (org) => {
      prisma.organization.findFirst.mockResolvedValue(org);
      expect(await detectors.byType.STORAGE_ACCESS_WITHDRAWN('org-a', NOW)).toEqual([]);
    });
  });

  describe('STORAGE_SECRET_EXPIRING', () => {
    const withExpiry = (secretExpiresOn: string | undefined, over: Record<string, unknown> = {}) =>
      prisma.organization.findFirst.mockResolvedValue({
        storageProvider: 'SHAREPOINT',
        storageConfirmedAt: new Date('2026-10-08'),
        storageConfig: writeStorageConfig({ sharepoint: { tenant: 't', clientId: 'c', clientSecret: 's', secretExpiresOn } }),
        ...over,
      });

    it.each([
      ['2027-06-04', 30],
      ['2027-05-05', 0],
    ])('is open, AT_RISK, for a secret expiring on %p (%p days)', async (date, daysLeft) => {
      withExpiry(date);
      expect(await detectors.byType.STORAGE_SECRET_EXPIRING('org-a', NOW)).toEqual([
        { objectId: 'org-a', severity: 'AT_RISK', openedAt: null, subject: { expiresOn: date, daysLeft } },
      ]);
    });

    it.each([
      ['2027-06-05', 'more than 30 days away'],
      ['2027-05-04', 'already expired — withdrawn access takes over'],
      [undefined, 'no date entered'],
    ])('is closed for %p (%s)', async (date, _why) => {
      withExpiry(date);
      expect(await detectors.byType.STORAGE_SECRET_EXPIRING('org-a', NOW)).toEqual([]);
    });

    it('is closed for an organisation not confirmed on SharePoint', async () => {
      withExpiry('2027-05-20', { storageConfirmedAt: null });
      expect(await detectors.byType.STORAGE_SECRET_EXPIRING('org-a', NOW)).toEqual([]);
      withExpiry('2027-05-20', { storageProvider: 'MINIO' });
      expect(await detectors.byType.STORAGE_SECRET_EXPIRING('org-a', NOW)).toEqual([]);
    });
  });

  itEnforcesTenantIsolation('the SharePoint storage detectors read the named organisation only', async () => {
    prisma.organization.findFirst.mockResolvedValue(null);
    await detectors.byType.STORAGE_ACCESS_WITHDRAWN('org-b', NOW);
    await detectors.byType.STORAGE_SECRET_EXPIRING('org-b', NOW);
    for (const call of prisma.organization.findFirst.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ where: { id: 'org-b' } }));
    }
  });
});
