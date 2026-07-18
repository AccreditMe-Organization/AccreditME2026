import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

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
};

const mockAuditLog = { log: jest.fn() };

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
      mockPrisma.orgUnit.update.mockResolvedValue({ ...BASE_UNIT, isActive: false });

      const result = await service.deactivate('unit-1', ORG_A, 'actor-1');
      expect(result.isActive).toBe(false);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'OrgUnit' }),
      );
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
