import { holdsSeatWhere, seatPosition } from './seat-holders';
import { OrgPositionService } from '../../foundation/org-position/org-position.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from './audit-log.service';
import type { OrganizationService } from '../../foundation/organization/organization.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import { useFixedClock } from '../testing/fixed-clock';

// ACC-159 — the one rule for "holds a seat or a position". The fake below
// evaluates the `where` the way Postgres would (OR, gte, the position join), so
// a rule that stopped reading the expiry goes red here, not only in a spec that
// copies its shape.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const NOW = new Date('2026-11-20T10:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

interface Row {
  id: string;
  organizationId: string;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  invitationExpiresAt: Date | null;
  primaryOrgUnitId?: string | null;
  positionId?: string | null;
  position?: { isUnitHeadPosition: boolean; isSingleAssignee: boolean };
}

interface Where {
  organizationId?: string;
  status?: string;
  invitationExpiresAt?: { gte?: Date };
  primaryOrgUnitId?: string | null;
  id?: { not: string };
  position?: { isUnitHeadPosition?: boolean; isSingleAssignee?: boolean };
  OR?: Where[];
}

const matches = (r: Row, w: Where): boolean =>
  (w.organizationId === undefined || r.organizationId === w.organizationId) &&
  (w.status === undefined || r.status === w.status) &&
  (w.invitationExpiresAt?.gte === undefined ||
    (r.invitationExpiresAt !== null && r.invitationExpiresAt >= w.invitationExpiresAt.gte)) &&
  (w.primaryOrgUnitId === undefined || r.primaryOrgUnitId === w.primaryOrgUnitId) &&
  (w.id === undefined || r.id !== w.id.not) &&
  (w.position?.isUnitHeadPosition === undefined || r.position?.isUnitHeadPosition === w.position.isUnitHeadPosition) &&
  (w.position?.isSingleAssignee === undefined || r.position?.isSingleAssignee === w.position.isSingleAssignee) &&
  (w.OR === undefined || w.OR.some((branch) => matches(r, branch)));

function fakePrisma(rows: Row[], maxUsers: Record<string, number> = {}) {
  return {
    user: {
      count: jest.fn(({ where }: { where: Where }) => Promise.resolve(rows.filter((r) => matches(r, where)).length)),
      findMany: jest.fn(({ where }: { where: Where }) =>
        Promise.resolve(rows.filter((r) => matches(r, where)).map((r) => ({ positionId: r.positionId ?? null }))),
      ),
    },
    organization: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id in maxUsers ? { maxUsers: maxUsers[where.id] } : null),
      ),
    },
    orgPosition: {
      findMany: jest.fn(() =>
        Promise.resolve([{ id: 'pos-head', organizationId: ORG_A, isActive: true, isSingleAssignee: true, isUnitHeadPosition: true }]),
      ),
    },
  };
}

describe('seat-holders (ACC-159)', () => {
  describe('holdsSeatWhere()', () => {
    const row = (status: Row['status'], invitationExpiresAt: Date | null): Row => ({
      id: 'u',
      organizationId: ORG_A,
      status,
      invitationExpiresAt,
    });

    it.each<[string, boolean, Row]>([
      ['an ACTIVE person', true, row('ACTIVE', null)],
      ['an invitation still open', true, row('INVITED', later(DAY))],
      ['an invitation expiring this very moment', true, row('INVITED', NOW)],
      ['an invitation past its expiry', false, row('INVITED', later(-1))],
      ['an invitation with no expiry (read as expired, as isOpenInvitation does)', false, row('INVITED', null)],
      ['a deactivated person', false, row('INACTIVE', null)],
    ])('%s: holds a seat = %s', (_label, expected, r) => {
      expect(matches(r, holdsSeatWhere(NOW) as Where)).toBe(expected);
    });

    it('owns only the OR key, so it can sit beside a count\'s own fields', () => {
      expect(Object.keys(holdsSeatWhere(NOW))).toEqual(['OR']);
    });
  });

  describe('seatPosition()', () => {
    const rows: Row[] = [
      { id: 'a1', organizationId: ORG_A, status: 'ACTIVE', invitationExpiresAt: null },
      { id: 'a2', organizationId: ORG_A, status: 'ACTIVE', invitationExpiresAt: null },
      { id: 'i1', organizationId: ORG_A, status: 'INVITED', invitationExpiresAt: later(DAY) },
      { id: 'i2', organizationId: ORG_A, status: 'INVITED', invitationExpiresAt: later(-DAY) }, // expired
      { id: 'x1', organizationId: ORG_A, status: 'INACTIVE', invitationExpiresAt: null },
    ];

    it('an expired invitation holds no seat: the seat frees itself, with no sweep', async () => {
      const prisma = fakePrisma(rows, { [ORG_A]: 5 });

      expect(await seatPosition(prisma as unknown as PrismaService, ORG_A, NOW)).toEqual({ occupied: 3, maxUsers: 5 });
    });

    it('a missing organisation is null', async () => {
      const prisma = fakePrisma(rows, {});

      expect(await seatPosition(prisma as unknown as PrismaService, ORG_A, NOW)).toBeNull();
    });

    itEnforcesTenantIsolation('seatPosition counts only its own organisation', async () => {
      const prisma = fakePrisma(
        [...rows, { id: 'b1', organizationId: ORG_B, status: 'ACTIVE', invitationExpiresAt: null }],
        { [ORG_A]: 5, [ORG_B]: 5 },
      );

      expect(await seatPosition(prisma as unknown as PrismaService, ORG_B, NOW)).toEqual({ occupied: 1, maxUsers: 5 });
      expect(prisma.user.count).toHaveBeenCalledWith({ where: expect.objectContaining({ organizationId: ORG_B }) });
    });
  });

  describe('a position', () => {
    const headHolder = (status: Row['status'], invitationExpiresAt: Date | null): Row => ({
      id: 'holder',
      organizationId: ORG_A,
      status,
      invitationExpiresAt,
      primaryOrgUnitId: 'unit-1',
      positionId: 'pos-head',
      position: { isUnitHeadPosition: true, isSingleAssignee: true },
    });
    const service = (rows: Row[]) =>
      new OrgPositionService(
        fakePrisma(rows) as unknown as PrismaService,
        {} as AuditLogService,
        {} as OrganizationService,
      );

    beforeEach(() => useFixedClock(NOW));
    afterEach(() => jest.useRealTimers());

    it('an open invitation still holds the head position', async () => {
      expect(await service([headHolder('INVITED', later(DAY))]).hasAnyHeadConferringHolder('unit-1', ORG_A, null)).toBe(true);
    });

    it('an expired invitation no longer holds the head position', async () => {
      expect(await service([headHolder('INVITED', later(-1))]).hasAnyHeadConferringHolder('unit-1', ORG_A, null)).toBe(false);
    });

    it('a position held only by an expired invitation is offered again', async () => {
      const offered = await service([headHolder('INVITED', later(-1))]).listAvailablePositionsForUser('candidate', 'unit-1', ORG_A);

      expect(offered.map((p) => p.id)).toEqual(['pos-head']);
    });

    it('a position held by an open invitation is not offered', async () => {
      const offered = await service([headHolder('INVITED', later(DAY))]).listAvailablePositionsForUser('candidate', 'unit-1', ORG_A);

      expect(offered).toEqual([]);
    });
  });
});
