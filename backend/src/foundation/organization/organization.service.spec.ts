import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';

const BASE_UNIT = {
  id: 'unit-1',
  organizationId: ORG_A,
  parentId: null as string | null,
  nameEn: 'Intensive Care Unit',
  nameAr: null,
  code: 'ICU',
  type: null,
  description: null,
  isActive: true,
  isCodeLocked: false,
  sortOrder: 0,
  // ACC-40 Section 2.5.1
  isHeadVacant: false,
  headVacantSince: null as Date | null,
  actingHeadUserId: null as string | null,
  isHeadFullyUnresolved: false,
  headFullyUnresolvedLastRemindedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeUnit = (overrides: Partial<typeof BASE_UNIT> = {}) => ({
  ...BASE_UNIT,
  ...overrides,
});

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  orgUnit: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockNotificationService = { create: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrganizationService', () => {
  let service: OrganizationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  // ── findById ──────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the unit when found for the correct tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      const result = await service.findById('unit-1', ORG_A);
      expect(result.id).toBe('unit-1');
      expect(result.organizationId).toBe(ORG_A);
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'unit-1', organizationId: ORG_A },
      });
    });

    it('throws NotFoundException when unit does not exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      await expect(service.findById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a unit with valid data', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValueOnce(null); // no code conflict
      mockPrisma.orgUnit.create.mockResolvedValue(BASE_UNIT);

      const result = await service.create(
        ORG_A,
        { nameEn: 'Intensive Care Unit', code: 'ICU' },
        'actor-1',
      );

      expect(result.code).toBe('ICU');
      expect(mockPrisma.orgUnit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: ORG_A, code: 'ICU' }),
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'OrgUnit' }),
      );
    });

    it('throws ConflictException when code is already in use', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT); // code conflict
      await expect(
        service.create(ORG_A, { nameEn: 'ICU Copy', code: 'ICU' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.orgUnit.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when parentId does not belong to the tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null); // parent not found
      await expect(
        service.create(
          ORG_A,
          { nameEn: 'Sub Unit', code: 'SUB', parentId: 'foreign-parent' },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates allowed fields without touching the code when not provided', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.update.mockResolvedValue({ ...BASE_UNIT, nameEn: 'Updated ICU' });

      const result = await service.update('unit-1', ORG_A, { nameEn: 'Updated ICU' }, 'actor-1');
      expect(result.nameEn).toBe('Updated ICU');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('throws ForbiddenException when attempting to change a locked code', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ isCodeLocked: true }));
      await expect(
        service.update('unit-1', ORG_A, { code: 'NEW' }, 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when new code conflicts with another unit', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(BASE_UNIT)                          // the unit being updated
        .mockResolvedValueOnce(makeUnit({ id: 'unit-2', code: 'ER' })); // conflict check
      await expect(
        service.update('unit-1', ORG_A, { code: 'ER' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when parentId is set to self', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      await expect(
        service.update('unit-1', ORG_A, { parentId: 'unit-1' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivates a unit that has no active blockers', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(0); // no active children
      mockPrisma.user.count.mockResolvedValue(0); // no active users
      mockPrisma.orgUnit.update.mockResolvedValue({ ...BASE_UNIT, isActive: false });

      const result = await service.deactivate('unit-1', ORG_A, 'actor-1');
      expect(result.isActive).toBe(false);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'OrgUnit' }),
      );
    });

    it('throws ConflictException with a structured blocker list when active users are assigned to the unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(0); // no active children
      mockPrisma.user.count.mockResolvedValue(2); // 2 active users

      try {
        await service.deactivate('unit-1', ORG_A, 'actor-1');
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          message: string;
          blockers: string[];
        };
        expect(body.blockers).toHaveLength(1);
        expect(body.blockers[0]).toMatch(/2 active user\(s\)/);
      }
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { primaryOrgUnitId: 'unit-1', organizationId: ORG_A, status: 'ACTIVE' } }),
      );
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('returns idempotently when unit is already inactive', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ isActive: false }));
      const result = await service.deactivate('unit-1', ORG_A, 'actor-1');
      expect(result.isActive).toBe(false);
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException with a structured blocker list when active children exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(3); // 3 active children
      mockPrisma.user.count.mockResolvedValue(0); // no active users

      try {
        await service.deactivate('unit-1', ORG_A, 'actor-1');
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          message: string;
          blockers: string[];
        };
        expect(body.message).toMatch(/Cannot deactivate/);
        expect(Array.isArray(body.blockers)).toBe(true);
        expect(body.blockers).toHaveLength(1);
        expect(body.blockers[0]).toMatch(/3 active child unit/);
      }
    });

    it('throws NotFoundException when unit does not exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      await expect(service.deactivate('missing', ORG_A, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getTree ───────────────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('returns a nested tree structure built from flat Prisma results', async () => {
      const parent = makeUnit({ id: 'parent', parentId: null, code: 'HOSP' });
      const child = makeUnit({ id: 'child', parentId: 'parent', code: 'ICU' });
      mockPrisma.orgUnit.findMany.mockResolvedValue([parent, child]);

      const tree = await service.getTree(ORG_A);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('parent');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children![0]!.id).toBe('child');
    });

    it('returns empty array when organization has no org units', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      const tree = await service.getTree(ORG_A);
      expect(tree).toEqual([]);
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return records belonging to a different tenant', async () => {
      const unitA = makeUnit({ organizationId: ORG_A, code: 'A' });
      const unitB = makeUnit({ id: 'unit-b', organizationId: ORG_B, code: 'B' });

      mockPrisma.orgUnit.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string } }) => {
          if (where.organizationId === ORG_A) return Promise.resolve([unitA]);
          if (where.organizationId === ORG_B) return Promise.resolve([unitB]);
          return Promise.resolve([]);
        },
      );

      const resultA = await service.listFlat(ORG_A);
      const resultB = await service.listFlat(ORG_B);

      expect(resultA.every((u) => u.organizationId === ORG_A)).toBe(true);
      expect(resultB.every((u) => u.organizationId === ORG_B)).toBe(true);
      expect(resultA.map((u) => u.id)).not.toContain('unit-b');
      expect(resultB.map((u) => u.id)).not.toContain('unit-1');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null); // cross-tenant miss
      await expect(service.findById('unit-1', ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'unit-1', organizationId: ORG_B },
      });
    });
  });

  // ── resolveActingHeadForOrgUnit (ACC-40 Section 2.5) ────────────────────────
  //
  // The resolver everything downstream depends on — Phase 6's own
  // checkpoint requires isolated confidence in this method before it's
  // wired into anything else. Covers all 4 cases the plan's own test
  // checklist names, verbatim.

  describe('resolveActingHeadForOrgUnit', () => {
    it("returns the unit's own holder directly, without ever checking actingHeadUserId or walking to the parent", async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'holder-1' }]);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['holder-1']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: 'unit-1',
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true },
      });
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.3 — now reachable per Phase 5's own handover
    // mechanism: during a declared handover, both the outgoing and
    // incoming users genuinely hold the position at once. The resolver
    // needs no special-case logic for this — it's the same query,
    // returning 2 rows instead of 1 by construction.
    it("returns BOTH holders during a declared handover — the 2-holder case, no special-casing needed", async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'outgoing-holder' }, { id: 'incoming-successor' }]);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['outgoing-holder', 'incoming-successor']);
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    it("falls through to the unit's own Acting Head when vacant, without walking to the parent", async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // unit-1 has no direct holder
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ actingHeadUserId: 'acting-1', parentId: 'parent-1' });

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['acting-1']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1); // never reaches parent-1
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledTimes(1);
    });

    it("escalates to the parent's holder when the unit is vacant with no Acting Head of its own", async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.primaryOrgUnitId === 'unit-1' ? [] : [{ id: 'parent-holder' }]),
      );
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1' ? { actingHeadUserId: null, parentId: 'parent-1' } : null,
        ),
      );

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['parent-holder']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2);
      // Confirms the walk actually reached the parent, not a coincidence.
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: 'parent-1',
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true },
      });
    });

    it('returns an empty pool when the full chain is exhausted — vacant at every level, no Acting Head anywhere, walk reaches the root', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant at every level
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1'
            ? { actingHeadUserId: null, parentId: 'parent-1' }
            : { actingHeadUserId: null, parentId: null }, // parent-1: root, chain ends here
        ),
      );

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2); // unit-1, then parent-1 — walk stops there
    });

    it('returns an empty pool immediately when the starting unit does not exist in this tenant', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual([]);
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? [{ id: 'holder-a' }] : [{ id: 'leaked-holder' }]),
      );

      const resultA = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);
      const resultB = await service.resolveActingHeadForOrgUnit('unit-1', ORG_B);

      expect(resultA).toEqual(['holder-a']);
      expect(resultB).toEqual(['leaked-holder']); // scoped correctly to ORG_B, not a leak from ORG_A
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }));
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }));
    });
  });

  // ── refreshOrgUnitHeadVacancy (ACC-40 Section 2.5.1) ────────────────────────
  //
  // Entry-time check: only a genuine isHeadVacant transition writes/notifies.
  // No-op when nothing changed — the sweep (Phase 6 commit 3) owns ongoing
  // drift and reminder cadence, not this method.

  describe('refreshOrgUnitHeadVacancy', () => {
    const VACANCY_UNIT = makeUnit({
      isHeadVacant: false,
      headVacantSince: null,
      isHeadFullyUnresolved: false,
      headFullyUnresolvedLastRemindedAt: null,
      actingHeadUserId: null as string | null,
    });

    it('is a no-op when the unit does not exist in this tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.user.count).not.toHaveBeenCalled();
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no transition — still held, was not vacant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(VACANCY_UNIT); // isHeadVacant: false
      mockPrisma.user.count.mockResolvedValue(1); // still has a direct holder

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no transition — still vacant, was already vacant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...VACANCY_UNIT, isHeadVacant: true });
      mockPrisma.user.count.mockResolvedValue(0);

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled(); // resolver never runs
    });

    it('clears all 4 vacancy fields on a true→false recovery transition, silently', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({
        ...VACANCY_UNIT,
        isHeadVacant: true,
        headVacantSince: new Date('2026-08-01'),
        isHeadFullyUnresolved: true,
        headFullyUnresolvedLastRemindedAt: new Date('2026-08-01'),
      });
      mockPrisma.user.count.mockResolvedValue(1); // newly filled

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: false,
          headVacantSince: null,
          isHeadFullyUnresolved: false,
          headFullyUnresolvedLastRemindedAt: null,
        },
      });
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('on a false→true transition with ancestor coverage (partial), sets isHeadFullyUnresolved false and stays silent', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(VACANCY_UNIT) // the unit itself
        .mockResolvedValueOnce({ actingHeadUserId: null, parentId: 'parent-1' }); // resolver: unit-1 walk step — never reaches a 3rd call, since parent-1 has a direct holder
      mockPrisma.user.count.mockResolvedValue(0); // no direct holder on unit-1
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.primaryOrgUnitId === 'unit-1' ? [] : [{ id: 'parent-holder' }]),
      );

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: true,
          headVacantSince: expect.any(Date),
          isHeadFullyUnresolved: false,
          headFullyUnresolvedLastRemindedAt: null,
        },
      });
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('on a false→true transition fully exhausted, sets isHeadFullyUnresolved true, stamps the reminder timestamp, and notifies Tenant Admins immediately', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(VACANCY_UNIT) // the unit itself
        .mockResolvedValueOnce({ actingHeadUserId: null, parentId: null }); // resolver: root, chain ends
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant everywhere
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-1' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: true,
          headVacantSince: expect.any(Date),
          isHeadFullyUnresolved: true,
          headFullyUnresolvedLastRemindedAt: expect.any(Date),
        },
      });
      expect(mockNotificationService.create).toHaveBeenCalledTimes(1);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          titleEn: 'Org unit has no resolvable Head',
          objectType: 'OrgUnit',
          objectId: 'unit-1',
        }),
        ORG_A,
      );
    });
  });

  // ── notifyTenantAdminsOfOrgUnitVacancy (ACC-40 Section 2.5.1) ────────────────

  describe('notifyTenantAdminsOfOrgUnitVacancy', () => {
    it('is a no-op when the tenant has no TENANT_ADMIN role', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await service.notifyTenantAdminsOfOrgUnitVacancy(
        ORG_A,
        { id: 'unit-1', nameEn: 'ICU', headVacantSince: new Date() },
        false,
      );

      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });

    it('notifies every active Tenant Admin, using the first-notification wording when isReminder is false', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-1' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }, { userId: 'admin-2' }]);

      await service.notifyTenantAdminsOfOrgUnitVacancy(
        ORG_A,
        { id: 'unit-1', nameEn: 'ICU', headVacantSince: new Date() },
        false,
      );

      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-1', titleEn: 'Org unit has no resolvable Head' }),
        ORG_A,
      );
      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin-2', titleEn: 'Org unit has no resolvable Head' }),
        ORG_A,
      );
    });

    it('states the actual elapsed duration computed from headVacantSince when isReminder is true', async () => {
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'admin-role-1' });
      mockPrisma.userRole.findMany.mockResolvedValue([{ userId: 'admin-1' }]);
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

      await service.notifyTenantAdminsOfOrgUnitVacancy(
        ORG_A,
        { id: 'unit-1', nameEn: 'ICU', headVacantSince: sixDaysAgo },
        true,
      );

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          titleEn: 'Reminder: org unit still has no resolvable Head',
          bodyEn: expect.stringContaining('has been unresolved for 6 day(s)'),
        }),
        ORG_A,
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.role.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? { id: 'admin-role-a' } : { id: 'admin-role-b' }),
      );
      mockPrisma.userRole.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.roleId === 'admin-role-a' ? [{ userId: 'admin-a' }] : [{ userId: 'leaked-admin' }],
        ),
      );

      await service.notifyTenantAdminsOfOrgUnitVacancy(ORG_A, { id: 'unit-1', nameEn: 'ICU', headVacantSince: null }, false);
      await service.notifyTenantAdminsOfOrgUnitVacancy(ORG_B, { id: 'unit-1', nameEn: 'ICU', headVacantSince: null }, false);

      expect(mockPrisma.role.findFirst).toHaveBeenNthCalledWith(1, { where: { organizationId: ORG_A, key: 'TENANT_ADMIN' } });
      expect(mockPrisma.role.findFirst).toHaveBeenNthCalledWith(2, { where: { organizationId: ORG_B, key: 'TENANT_ADMIN' } });
      expect(mockPrisma.userRole.findMany).toHaveBeenNthCalledWith(1, {
        where: { roleId: 'admin-role-a', user: { organizationId: ORG_A, status: 'ACTIVE' } },
      });
      expect(mockPrisma.userRole.findMany).toHaveBeenNthCalledWith(2, {
        where: { roleId: 'admin-role-b', user: { organizationId: ORG_B, status: 'ACTIVE' } },
      });
    });
  });

  // ── generateCode (static) ─────────────────────────────────────────────────────

  describe('generateCode', () => {
    it('uppercases and truncates to 10 characters', () => {
      // 'INTENSIVE-CARE-UNIT' → slice(0, 10) → 'INTENSIVE-'
      expect(OrganizationService.generateCode('Intensive Care Unit')).toBe('INTENSIVE-');
    });

    it('replaces spaces with hyphens', () => {
      expect(OrganizationService.generateCode('Lab Path')).toBe('LAB-PATH');
    });

    it('strips non-alphanumeric characters and collapses adjacent spaces', () => {
      // '&' removed → two surrounding spaces collapse to one hyphen
      expect(OrganizationService.generateCode('ICU & ER')).toBe('ICU-ER');
    });
  });
});
