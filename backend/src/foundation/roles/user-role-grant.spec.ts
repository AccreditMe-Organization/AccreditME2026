import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { RoleService } from './role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  UserRoleGrantSource,
  resolveGrantSource,
} from './interfaces/user-role-grant.interface';

// ACC-120 — GET /users/:userId/roles returns the GRANT, and a derived grant
// cannot be removed by hand.
//
// Both halves exist because the old shape hid something rather than lacking it:
// mapRole(ur.role) returned a `createdAt` that was the ROLE's, and dropped the
// two grantedVia* ids entirely, so a derived grant and a direct one were
// identical on the wire.
const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('RoleService — user role grants (ACC-120)', () => {
  let service: RoleService;
  let prisma: {
    userRole: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
    role: { findFirst: jest.Mock };
  };

  const role = (over: Record<string, unknown> = {}) => ({
    id: 'role-1',
    organizationId: ORG_A,
    key: 'QUALITY_MANAGER',
    nameEn: 'Quality Manager',
    nameAr: 'مدير الجودة',
    description: null,
    isSystem: true,
    isActive: true,
    // DELIBERATELY different from every grantedAt below. If the service ever
    // reverts to mapping the role's date, these dates diverge and the
    // assertions say so — on dev the real data could not have shown it, because
    // the seed made roles and grants on the same day.
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...over,
  });

  const grantRow = (over: Record<string, unknown> = {}) => ({
    id: 'ur-1',
    userId: 'user-1',
    roleId: 'role-1',
    createdAt: new Date('2025-03-03T09:30:00Z'),
    grantedViaHeadPositionId: null,
    grantedViaHeadPositionOrgUnitId: null,
    role: role(),
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      userRole: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
        count: jest.fn().mockResolvedValue(5),
      },
      role: { findFirst: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = moduleRef.get(RoleService);
  });

  // ── the discriminator, on its own ──────────────────────────────────────────
  // Asserted directly rather than only through a query, because this rule is
  // the whole reason a client no longer has to infer anything.
  describe('resolveGrantSource', () => {
    it('is DIRECT when no position id is set', () => {
      expect(resolveGrantSource(null, null)).toBe(UserRoleGrantSource.DIRECT);
    });

    it('is DIRECT even if an org unit id somehow survives without a position id', () => {
      // Should not occur — grantRoleViaHeadAuthority() always writes both. But a
      // function that reads two nullable columns must say what it does with
      // every combination, rather than leaving one to chance.
      expect(resolveGrantSource(null, 'unit-1')).toBe(UserRoleGrantSource.DIRECT);
    });

    it('is HEAD_POSITION_UNIT when the authority is scoped to a unit', () => {
      expect(resolveGrantSource('pos-1', 'unit-1')).toBe(
        UserRoleGrantSource.HEAD_POSITION_UNIT,
      );
    });

    it('is HEAD_POSITION_ORG_WIDE when the head position has no unit', () => {
      expect(resolveGrantSource('pos-1', null)).toBe(
        UserRoleGrantSource.HEAD_POSITION_ORG_WIDE,
      );
    });
  });

  // ── getUserRoles ───────────────────────────────────────────────────────────
  describe('getUserRoles', () => {
    it("returns the GRANT's date, not the role's", async () => {
      prisma.userRole.findMany.mockResolvedValue([grantRow()]);

      const [grant] = await service.getUserRoles('user-1', ORG_A);

      expect(grant!.grantedAt).toEqual(new Date('2025-03-03T09:30:00Z'));
      // The trap this replaced: the role's own date, identical for every holder.
      expect(grant!.grantedAt).not.toEqual(grant!.role.createdAt);
    });

    it('labels a direct grant DIRECT and carries no position ids', async () => {
      prisma.userRole.findMany.mockResolvedValue([grantRow()]);

      const [grant] = await service.getUserRoles('user-1', ORG_A);

      expect(grant!.source).toBe(UserRoleGrantSource.DIRECT);
      expect(grant!.grantedViaHeadPositionId).toBeNull();
      expect(grant!.grantedViaHeadPositionOrgUnitId).toBeNull();
    });

    it('labels a unit-scoped head grant and passes both ids through', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        grantRow({
          grantedViaHeadPositionId: 'pos-1',
          grantedViaHeadPositionOrgUnitId: 'unit-1',
        }),
      ]);

      const [grant] = await service.getUserRoles('user-1', ORG_A);

      expect(grant!.source).toBe(UserRoleGrantSource.HEAD_POSITION_UNIT);
      expect(grant!.grantedViaHeadPositionId).toBe('pos-1');
      expect(grant!.grantedViaHeadPositionOrgUnitId).toBe('unit-1');
    });

    it('labels an org-wide head grant, where only the position id is set', async () => {
      prisma.userRole.findMany.mockResolvedValue([
        grantRow({ grantedViaHeadPositionId: 'pos-1', grantedViaHeadPositionOrgUnitId: null }),
      ]);

      const [grant] = await service.getUserRoles('user-1', ORG_A);

      expect(grant!.source).toBe(UserRoleGrantSource.HEAD_POSITION_ORG_WIDE);
    });

    it('carries the UserRole row id, so a per-grant action has something to address', async () => {
      prisma.userRole.findMany.mockResolvedValue([grantRow({ id: 'ur-42' })]);

      const [grant] = await service.getUserRoles('user-1', ORG_A);

      expect(grant!.id).toBe('ur-42');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      await service.getUserRoles('user-1', ORG_A);

      // BOTH sides scoped, in the same where. The role side alone already made a
      // cross-tenant read impossible in practice; relying on that is reasoning
      // about data rather than scoping a query.
      expect(prisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            user: { organizationId: ORG_A },
            role: { organizationId: ORG_A },
          }),
        }),
      );
      expect(prisma.userRole.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ user: { organizationId: ORG_B } }),
        }),
      );
    });
  });

  // ── removeRoleFromUser ─────────────────────────────────────────────────────
  describe('removeRoleFromUser refuses a head-position-derived grant', () => {
    beforeEach(() => {
      prisma.role.findFirst.mockResolvedValue(role({ key: 'QUALITY_MANAGER' }));
    });

    it('refuses a unit-scoped derived grant, and deletes nothing', async () => {
      prisma.userRole.findFirst.mockResolvedValue(
        grantRow({ grantedViaHeadPositionId: 'pos-1', grantedViaHeadPositionOrgUnitId: 'unit-1' }),
      );

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.userRole.delete).not.toHaveBeenCalled();
    });

    it('refuses an org-wide derived grant too, where only the position id is set', async () => {
      prisma.userRole.findFirst.mockResolvedValue(
        grantRow({ grantedViaHeadPositionId: 'pos-1', grantedViaHeadPositionOrgUnitId: null }),
      );

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.userRole.delete).not.toHaveBeenCalled();
    });

    // The message is asserted, not just the status. "Cannot be removed" without
    // saying where it IS ended reads as a broken product.
    it('names the reason and where the grant is actually ended', async () => {
      prisma.userRole.findFirst.mockResolvedValue(
        grantRow({ grantedViaHeadPositionId: 'pos-1', grantedViaHeadPositionOrgUnitId: 'unit-1' }),
      );

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1'),
      ).rejects.toThrow(/head position/i);
      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1'),
      ).rejects.toThrow(/End it by changing the head position/i);
    });

    it('still removes an ordinary direct grant', async () => {
      prisma.userRole.findFirst.mockResolvedValue(grantRow());

      await service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1');

      expect(prisma.userRole.delete).toHaveBeenCalledWith({ where: { id: 'ur-1' } });
    });

    it('should NOT return records belonging to a different tenant', async () => {
      prisma.userRole.findFirst.mockResolvedValue(grantRow());

      await service.removeRoleFromUser('user-1', 'role-1', ORG_A, 'actor-1');

      expect(prisma.userRole.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', roleId: 'role-1', user: { organizationId: ORG_A } },
      });
    });
  });
});
