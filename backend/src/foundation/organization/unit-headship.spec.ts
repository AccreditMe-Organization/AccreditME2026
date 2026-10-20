import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { findCurrentHeadHolders, findRunningActingCover } from './unit-headship';

// ACC-133 — the shared headship reads. Each is asserted on the query it sends:
// scoped by organisation AND unit, with the exact holder and cover predicates.

const ORG_A = 'org-a';
const UNIT = 'unit-1';
const NOW = new Date('2026-10-20T09:00:00.000Z');

describe('unit-headship (ACC-133)', () => {
  describe('findCurrentHeadHolders', () => {
    it('reads ACTIVE people of the unit whose position confers headship and is active (D13)', async () => {
      const prisma = { user: { findMany: jest.fn().mockResolvedValue([]) } };
      await findCurrentHeadHolders(prisma as never, ORG_A, UNIT);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: UNIT,
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true, name: true, positionId: true, position: { select: { nameEn: true, nameAr: true } } },
      });
    });

    itEnforcesTenantIsolation('findCurrentHeadHolders', async () => {
      const rows = [
        { id: 'a', organizationId: ORG_A, primaryOrgUnitId: UNIT },
        { id: 'b', organizationId: 'org-b', primaryOrgUnitId: UNIT },
      ];
      const prisma = {
        user: {
          findMany: jest.fn(({ where }: { where: { organizationId: string; primaryOrgUnitId: string } }) =>
            Promise.resolve(rows.filter((r) => r.organizationId === where.organizationId && r.primaryOrgUnitId === where.primaryOrgUnitId)),
          ),
        },
      };
      const result = await findCurrentHeadHolders(prisma as never, ORG_A, UNIT);
      expect(result.map((r: { id: string }) => r.id)).toEqual(['a']);
    });
  });

  describe('findRunningActingCover', () => {
    it('reads an ACTING period not ended, started, and not lapsed, newest first', async () => {
      const prisma = { orgUnitHeadAssignment: { findFirst: jest.fn().mockResolvedValue(null) } };
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toBeNull();
      expect(prisma.orgUnitHeadAssignment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_A,
            orgUnitId: UNIT,
            kind: 'ACTING',
            endedAt: null,
            validFrom: { lte: NOW },
            OR: [{ validTo: null }, { validTo: { gt: NOW } }],
          },
          orderBy: { validFrom: 'desc' },
        }),
      );
    });

    it('returns the period with the person named', async () => {
      const row = {
        id: 'c1',
        userId: 'tariq',
        reason: 'ABSENCE',
        validFrom: new Date('2026-10-01T00:00:00.000Z'),
        validTo: null,
        user: { name: 'Dr. Tariq' },
      };
      const prisma = { orgUnitHeadAssignment: { findFirst: jest.fn().mockResolvedValue(row) } };
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toEqual({
        id: 'c1',
        userId: 'tariq',
        userName: 'Dr. Tariq',
        reason: 'ABSENCE',
        validFrom: row.validFrom,
        validTo: null,
      });
    });

    itEnforcesTenantIsolation('findRunningActingCover', async () => {
      const rows = [{ id: 'b-cover', organizationId: 'org-b', orgUnitId: UNIT, userId: 'x', reason: 'VACANCY', validFrom: NOW, validTo: null, user: { name: 'X' } }];
      const prisma = {
        orgUnitHeadAssignment: {
          findFirst: jest.fn(({ where }: { where: { organizationId: string; orgUnitId: string } }) =>
            Promise.resolve(rows.find((r) => r.organizationId === where.organizationId && r.orgUnitId === where.orgUnitId) ?? null),
          ),
        },
      };
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toBeNull();
    });
  });
});
