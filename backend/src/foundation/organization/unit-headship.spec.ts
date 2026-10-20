import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import {
  findCurrentHeadHolders,
  findCurrentHeadHoldersForUnits,
  findRunningActingCover,
  findRunningActingCoversForUnits,
  headHolderWhere,
  runningActingCoverWhere,
} from './unit-headship';

// ACC-133 — the shared headship reads. Each is asserted on the query it sends:
// scoped by organisation AND unit, with the exact holder and cover predicates.
// ACC-120 slice 11 — the predicates are exported helpers, the batched reads are
// built from them, and the single-unit reads call the batched ones.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const UNIT = 'unit-1';
const UNIT_2 = 'unit-2';
const NOW = new Date('2026-10-20T09:00:00.000Z');

const HOLDER_SELECT = {
  id: true,
  name: true,
  positionId: true,
  primaryOrgUnitId: true,
  position: { select: { nameEn: true, nameAr: true } },
};

interface HolderRow {
  id: string;
  name: string;
  organizationId: string;
  primaryOrgUnitId: string;
  positionId: string;
  position: { nameEn: string; nameAr: string | null };
}
interface CoverRow {
  id: string;
  organizationId: string;
  orgUnitId: string;
  userId: string;
  reason: 'VACANCY' | 'ABSENCE';
  validFrom: Date;
  validTo: Date | null;
  user: { name: string; primaryOrgUnitId: string | null };
}

type UnitFilter = string | { in: string[] };
const inUnits = (unitId: string, filter: UnitFilter) =>
  typeof filter === 'string' ? unitId === filter : filter.in.includes(unitId);

// Fakes that behave like the database for the scoping they are given.
function holderPrisma(rows: HolderRow[]) {
  return {
    user: {
      findMany: jest.fn(({ where }: { where: { organizationId: string; primaryOrgUnitId: UnitFilter } }) =>
        Promise.resolve(
          rows.filter((r) => r.organizationId === where.organizationId && inUnits(r.primaryOrgUnitId, where.primaryOrgUnitId)),
        ),
      ),
    },
  };
}
function coverPrisma(rows: CoverRow[]) {
  return {
    orgUnitHeadAssignment: {
      findMany: jest.fn(({ where }: { where: { organizationId: string; orgUnitId: UnitFilter } }) =>
        Promise.resolve(
          rows
            .filter((r) => r.organizationId === where.organizationId && inUnits(r.orgUnitId, where.orgUnitId))
            .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime()),
        ),
      ),
    },
  };
}

const holder = (over: Partial<HolderRow>): HolderRow => ({
  id: 'h',
  name: 'Head',
  organizationId: ORG_A,
  primaryOrgUnitId: UNIT,
  positionId: 'pos-head',
  position: { nameEn: 'Director', nameAr: 'مدير' },
  ...over,
});
const cover = (over: Partial<CoverRow>): CoverRow => ({
  id: 'c',
  organizationId: ORG_A,
  orgUnitId: UNIT,
  userId: 'tariq',
  reason: 'ABSENCE',
  validFrom: new Date('2026-10-01T00:00:00.000Z'),
  validTo: null,
  user: { name: 'Dr. Tariq', primaryOrgUnitId: 'unit-elsewhere' },
  ...over,
});

describe('unit-headship (ACC-133)', () => {
  describe('the two rules, as helpers (ACC-120 slice 11)', () => {
    it('headHolderWhere: ACTIVE, and a position that confers headship and is active (D13)', () => {
      expect(headHolderWhere()).toEqual({ status: 'ACTIVE', position: { isUnitHeadPosition: true, isActive: true } });
    });

    it('runningActingCoverWhere: ACTING, not ended, started, and not lapsed at now', () => {
      expect(runningActingCoverWhere(NOW)).toEqual({
        kind: 'ACTING',
        endedAt: null,
        validFrom: { lte: NOW },
        OR: [{ validTo: null }, { validTo: { gt: NOW } }],
      });
    });
  });

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
        select: HOLDER_SELECT,
      });
    });

    it('returns the rows it always returned: id, name, position id and names', async () => {
      const prisma = holderPrisma([holder({ id: 'fahad', name: 'Dr. Fahad' })]);
      await expect(findCurrentHeadHolders(prisma as never, ORG_A, UNIT)).resolves.toEqual([
        { id: 'fahad', name: 'Dr. Fahad', positionId: 'pos-head', position: { nameEn: 'Director', nameAr: 'مدير' } },
      ]);
    });

    itEnforcesTenantIsolation('findCurrentHeadHolders', async () => {
      const prisma = holderPrisma([holder({ id: 'a' }), holder({ id: 'b', organizationId: ORG_B })]);
      const result = await findCurrentHeadHolders(prisma as never, ORG_A, UNIT);
      expect(result.map((r) => r.id)).toEqual(['a']);
    });
  });

  describe('findCurrentHeadHoldersForUnits', () => {
    it('reads every unit in ONE query, built from headHolderWhere()', async () => {
      const prisma = holderPrisma([]);
      await findCurrentHeadHoldersForUnits(prisma as never, ORG_A, [UNIT, UNIT_2]);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, primaryOrgUnitId: { in: [UNIT, UNIT_2] }, ...headHolderWhere() },
        select: HOLDER_SELECT,
      });
    });

    it('groups by unit, keeps two holders during a handover, and omits a unit with none', async () => {
      const prisma = holderPrisma([
        holder({ id: 'out', primaryOrgUnitId: UNIT }),
        holder({ id: 'in', primaryOrgUnitId: UNIT }),
        holder({ id: 'other', primaryOrgUnitId: UNIT_2 }),
      ]);
      const byUnit = await findCurrentHeadHoldersForUnits(prisma as never, ORG_A, [UNIT, UNIT_2, 'unit-3']);
      expect(byUnit.get(UNIT)!.map((h) => h.id)).toEqual(['out', 'in']);
      expect(byUnit.get(UNIT_2)!.map((h) => h.id)).toEqual(['other']);
      expect(byUnit.has('unit-3')).toBe(false);
    });

    it('asks nothing for no units', async () => {
      const prisma = holderPrisma([]);
      expect((await findCurrentHeadHoldersForUnits(prisma as never, ORG_A, [])).size).toBe(0);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('findCurrentHeadHoldersForUnits', async () => {
      const prisma = holderPrisma([
        holder({ id: 'a', primaryOrgUnitId: UNIT }),
        holder({ id: 'b', organizationId: ORG_B, primaryOrgUnitId: UNIT }),
        holder({ id: 'b2', organizationId: ORG_B, primaryOrgUnitId: UNIT_2 }),
      ]);
      const byUnit = await findCurrentHeadHoldersForUnits(prisma as never, ORG_A, [UNIT, UNIT_2]);
      expect(byUnit.get(UNIT)!.map((h) => h.id)).toEqual(['a']);
      expect(byUnit.has(UNIT_2)).toBe(false);
    });
  });

  describe('findRunningActingCover', () => {
    it('reads an ACTING period not ended, started, and not lapsed, newest first', async () => {
      const prisma = coverPrisma([]);
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toBeNull();
      expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledWith(
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

    it('returns the period with the person named, in the shape it always had', async () => {
      const prisma = coverPrisma([cover({ id: 'c1' })]);
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toEqual({
        id: 'c1',
        userId: 'tariq',
        userName: 'Dr. Tariq',
        reason: 'ABSENCE',
        validFrom: new Date('2026-10-01T00:00:00.000Z'),
        validTo: null,
      });
    });

    itEnforcesTenantIsolation('findRunningActingCover', async () => {
      const prisma = coverPrisma([cover({ id: 'b-cover', organizationId: ORG_B, reason: 'VACANCY' })]);
      await expect(findRunningActingCover(prisma as never, ORG_A, UNIT, NOW)).resolves.toBeNull();
    });
  });

  describe('findRunningActingCoversForUnits', () => {
    it('reads every unit in ONE query, built from runningActingCoverWhere()', async () => {
      const prisma = coverPrisma([]);
      await findRunningActingCoversForUnits(prisma as never, ORG_A, [UNIT, UNIT_2], NOW);
      expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, orgUnitId: { in: [UNIT, UNIT_2] }, ...runningActingCoverWhere(NOW) },
          orderBy: { validFrom: 'desc' },
        }),
      );
    });

    it('keys by unit, the newest period wins, and the cover carries their own primary unit', async () => {
      const prisma = coverPrisma([
        cover({ id: 'older', orgUnitId: UNIT, validFrom: new Date('2026-09-01T00:00:00.000Z') }),
        cover({ id: 'newer', orgUnitId: UNIT, validFrom: new Date('2026-10-05T00:00:00.000Z') }),
        cover({ id: 'u2', orgUnitId: UNIT_2, user: { name: 'Sara', primaryOrgUnitId: UNIT_2 } }),
      ]);
      const byUnit = await findRunningActingCoversForUnits(prisma as never, ORG_A, [UNIT, UNIT_2], NOW);
      expect(byUnit.get(UNIT)!.id).toBe('newer');
      expect(byUnit.get(UNIT)!.userPrimaryOrgUnitId).toBe('unit-elsewhere');
      expect(byUnit.get(UNIT_2)).toEqual(expect.objectContaining({ id: 'u2', orgUnitId: UNIT_2, userPrimaryOrgUnitId: UNIT_2 }));
    });

    it('asks nothing for no units', async () => {
      const prisma = coverPrisma([]);
      expect((await findRunningActingCoversForUnits(prisma as never, ORG_A, [], NOW)).size).toBe(0);
      expect(prisma.orgUnitHeadAssignment.findMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('findRunningActingCoversForUnits', async () => {
      const prisma = coverPrisma([
        cover({ id: 'a', orgUnitId: UNIT }),
        cover({ id: 'b', organizationId: ORG_B, orgUnitId: UNIT_2 }),
      ]);
      const byUnit = await findRunningActingCoversForUnits(prisma as never, ORG_A, [UNIT, UNIT_2], NOW);
      expect([...byUnit.keys()]).toEqual([UNIT]);
    });
  });
});
