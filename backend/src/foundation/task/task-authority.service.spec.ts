import { TaskAuthorityService } from './task-authority.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-173 — canActForCreator(): the creator, their out-of-office delegate while
// they are out, or the acting head appointed for ABSENCE of a unit they head
// substantively — read from the period table, never the OrgUnit cache.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const NOW = new Date('2026-10-06T09:00:00Z');
const BEFORE = new Date('2026-10-01T00:00:00Z');
const AFTER = new Date('2026-10-20T00:00:00Z');

const creatorRow = (overrides: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  actingUserId: null,
  outOfOfficeFrom: null,
  outOfOfficeTo: null,
  primaryOrgUnitId: 'unit-1',
  position: { isUnitHeadPosition: false },
  ...overrides,
});

describe('TaskAuthorityService (ACC-173)', () => {
  const prisma = {
    user: { findFirst: jest.fn(), findMany: jest.fn() },
    orgUnitHeadAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    userRole: { findMany: jest.fn() },
    orgUnit: { findFirst: jest.fn() },
  };
  const service = new TaskAuthorityService(prisma as unknown as PrismaService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.orgUnitHeadAssignment.findFirst.mockResolvedValue(null);
    prisma.orgUnitHeadAssignment.findMany.mockResolvedValue([]);
  });

  describe('canActForCreator', () => {
    it('admits the creator without reading anything', async () => {
      await expect(service.canActForCreator('creator', 'creator', ORG_A)).resolves.toBe(true);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('admits the out-of-office delegate while the creator is out, inclusive at both ends', async () => {
      for (const window of [
        { outOfOfficeFrom: BEFORE, outOfOfficeTo: AFTER },
        { outOfOfficeFrom: NOW, outOfOfficeTo: AFTER },
        { outOfOfficeFrom: BEFORE, outOfOfficeTo: NOW },
      ]) {
        prisma.user.findFirst.mockResolvedValue(creatorRow({ actingUserId: 'delegate', ...window }));
        await expect(service.canActForCreator('creator', 'delegate', ORG_A, undefined, NOW)).resolves.toBe(true);
      }
    });

    it.each([
      ['before the window', { outOfOfficeFrom: AFTER, outOfOfficeTo: new Date('2026-11-01T00:00:00Z') }],
      ['after the window', { outOfOfficeFrom: new Date('2026-09-01T00:00:00Z'), outOfOfficeTo: BEFORE }],
      ['with an open-ended window', { outOfOfficeFrom: BEFORE, outOfOfficeTo: null }],
      ['with no window at all', {}],
    ])('refuses the delegate %s', async (_label, window) => {
      prisma.user.findFirst.mockResolvedValue(creatorRow({ actingUserId: 'delegate', ...window }));
      await expect(service.canActForCreator('creator', 'delegate', ORG_A, undefined, NOW)).resolves.toBe(false);
    });

    it("refuses someone else while the creator is out — only the creator's own delegate", async () => {
      prisma.user.findFirst.mockResolvedValue(
        creatorRow({ actingUserId: 'delegate', outOfOfficeFrom: BEFORE, outOfOfficeTo: AFTER }),
      );
      await expect(service.canActForCreator('creator', 'colleague', ORG_A, undefined, NOW)).resolves.toBe(false);
    });

    it('admits the acting head covering an ABSENCE of the unit the creator heads, read from the period table', async () => {
      prisma.user.findFirst.mockResolvedValue(creatorRow({ position: { isUnitHeadPosition: true } }));
      prisma.orgUnitHeadAssignment.findFirst.mockResolvedValue({ id: 'period-1' });

      await expect(service.canActForCreator('creator', 'acting', ORG_A, undefined, NOW)).resolves.toBe(true);
      expect(prisma.orgUnitHeadAssignment.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          orgUnitId: 'unit-1',
          userId: 'acting',
          kind: 'ACTING',
          reason: 'ABSENCE',
          endedAt: null,
          validFrom: { lte: NOW },
          OR: [{ validTo: null }, { validTo: { gt: NOW } }],
        },
        select: { id: true },
      });
      // Never the cache column, which is set early and never expires.
      expect(prisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    it('does not look for an acting head when the creator heads no unit', async () => {
      prisma.user.findFirst.mockResolvedValue(creatorRow());
      await expect(service.canActForCreator('creator', 'acting', ORG_A, undefined, NOW)).resolves.toBe(false);
      expect(prisma.orgUnitHeadAssignment.findFirst).not.toHaveBeenCalled();
    });

    it('refuses an acting head when no ABSENCE appointment is in force (future, ended, vacancy)', async () => {
      prisma.user.findFirst.mockResolvedValue(creatorRow({ position: { isUnitHeadPosition: true } }));
      prisma.orgUnitHeadAssignment.findFirst.mockResolvedValue(null);
      await expect(service.canActForCreator('creator', 'acting', ORG_A, undefined, NOW)).resolves.toBe(false);
    });

    it('refuses anyone for a creator who does not exist in the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.canActForCreator('creator', 'someone', ORG_A)).resolves.toBe(false);
    });

    itEnforcesTenantIsolation('canActForCreator', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.canActForCreator('creator', 'delegate', ORG_B)).resolves.toBe(false);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'creator', organizationId: ORG_B } }),
      );
    });
  });

  describe('decisionRecipients', () => {
    it('is the active creator and whoever covers them now — never the requester', async () => {
      prisma.user.findFirst.mockResolvedValue(
        creatorRow({
          actingUserId: 'delegate',
          outOfOfficeFrom: BEFORE,
          outOfOfficeTo: AFTER,
          position: { isUnitHeadPosition: true },
        }),
      );
      prisma.orgUnitHeadAssignment.findMany.mockResolvedValue([{ userId: 'acting' }, { userId: 'requester' }]);
      prisma.user.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      );

      const ids = await service.decisionRecipients('creator', 'requester', ORG_A);

      expect(ids.sort()).toEqual(['acting', 'creator', 'delegate']);
      expect(prisma.userRole.findMany).not.toHaveBeenCalled();
    });

    it('is the tasks:reassign holders when the creator is no longer ACTIVE', async () => {
      prisma.user.findFirst.mockResolvedValue(creatorRow({ status: 'INACTIVE' }));
      prisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }, { userId: 'admin-2' }, { userId: 'requester' }]);
      prisma.user.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => ({ id }))),
      );

      const ids = await service.decisionRecipients('creator', 'requester', ORG_A);

      expect(ids.sort()).toEqual(['admin-1', 'admin-2']);
      expect(prisma.userRole.findMany).toHaveBeenCalledWith({
        where: {
          user: { organizationId: ORG_A, status: 'ACTIVE' },
          role: {
            organizationId: ORG_A,
            isActive: true,
            rolePermissions: { some: { permission: { module: 'tasks', action: 'reassign' } } },
          },
        },
        select: { userId: true },
      });
    });

    it('drops anyone who is not ACTIVE', async () => {
      prisma.user.findFirst.mockResolvedValue(creatorRow({ actingUserId: 'delegate', outOfOfficeFrom: BEFORE, outOfOfficeTo: AFTER }));
      prisma.user.findMany.mockResolvedValue([{ id: 'creator' }]);

      await expect(service.decisionRecipients('creator', 'requester', ORG_A)).resolves.toEqual(['creator']);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A, status: 'ACTIVE' }) }),
      );
    });

    itEnforcesTenantIsolation('decisionRecipients', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.userRole.findMany.mockResolvedValue([]);
      await service.decisionRecipients('creator', 'requester', ORG_B);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'creator', organizationId: ORG_B } }),
      );
      expect(prisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user: { organizationId: ORG_B, status: 'ACTIVE' } }),
        }),
      );
    });
  });

  describe('creatorsCoveredBy', () => {
    it('is the people whose out-of-office the viewer covers, and the heads whose ABSENCE they act for', async () => {
      prisma.user.findMany
        .mockResolvedValueOnce([{ id: 'away-1' }])
        .mockResolvedValueOnce([{ id: 'head-1' }]);
      prisma.orgUnitHeadAssignment.findMany.mockResolvedValue([{ orgUnitId: 'unit-1' }]);

      const ids = await service.creatorsCoveredBy('viewer', ORG_A);

      expect(ids.sort()).toEqual(['away-1', 'head-1']);
      expect(prisma.user.findMany).toHaveBeenLastCalledWith({
        where: {
          organizationId: ORG_A,
          status: 'ACTIVE',
          primaryOrgUnitId: { in: ['unit-1'] },
          position: { isUnitHeadPosition: true },
        },
        select: { id: true },
      });
    });

    itEnforcesTenantIsolation('creatorsCoveredBy', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.creatorsCoveredBy('viewer', ORG_B);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B, actingUserId: 'viewer' }) }),
      );
      expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B, userId: 'viewer' }) }),
      );
    });
  });
});
