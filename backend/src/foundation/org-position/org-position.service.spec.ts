import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgPositionService } from './org-position.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';

const BASE_POSITION = {
  id: 'position-1',
  organizationId: ORG_A,
  orgUnitId: null as string | null,
  nameEn: 'Director',
  nameAr: 'مدير عام',
  grade: 10,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  orgPosition: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  orgUnit: {
    findFirst: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };

describe('OrgPositionService', () => {
  let service: OrgPositionService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgPositionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<OrgPositionService>(OrgPositionService);
  });

  describe('seedDefaultPositions', () => {
    it('creates 10 positions for a fresh org', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledTimes(10);
    });

    it('is idempotent — second call produces no duplicates', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION); // now "exists"
      await service.seedDefaultPositions(ORG_A);

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledTimes(10); // not 20
    });

    it('should NOT seed positions for a different tenant than requested', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.seedDefaultPositions(ORG_A);

      for (const call of mockPrisma.orgPosition.create.mock.calls) {
        expect(call[0].data.organizationId).toBe(ORG_A);
        expect(call[0].data.organizationId).not.toBe(ORG_B);
      }
    });
  });

  describe('listPositions', () => {
    it('returns org-wide + unit-specific when orgUnitId given', async () => {
      mockPrisma.orgPosition.findMany.mockResolvedValue([BASE_POSITION]);

      await service.listPositions(ORG_A, 'unit-1');

      expect(mockPrisma.orgPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, OR: [{ orgUnitId: null }, { orgUnitId: 'unit-1' }] },
        }),
      );
    });

    it('returns only org-wide when no orgUnitId given', async () => {
      mockPrisma.orgPosition.findMany.mockResolvedValue([BASE_POSITION]);

      await service.listPositions(ORG_A);

      expect(mockPrisma.orgPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A, OR: [{ orgUnitId: null }] } }),
      );
    });

    // Renamed from "should NOT return positions from another tenant"
    // (ACC-33 item 1) — the CI tenant-isolation gate filters on the literal
    // string "should NOT return records belonging to a different tenant";
    // the near-miss wording meant this otherwise-correct test was silently
    // excluded from that gate.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findMany.mockImplementation(({ where }) =>
        Promise.resolve(
          [BASE_POSITION, { ...BASE_POSITION, id: 'position-2', organizationId: ORG_B }].filter(
            (p) => p.organizationId === where.organizationId,
          ),
        ),
      );

      const result = await service.listPositions(ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]?.organizationId).toBe(ORG_A);
    });
  });

  describe('getPositionById', () => {
    it('returns the position when found', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);

      const result = await service.getPositionById('position-1', ORG_A);

      expect(result).toEqual(BASE_POSITION);
    });

    it('throws NotFoundException for a missing position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.getPositionById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });

    // Same near-miss title fix as listPositions() above (ACC-33 item 1).
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgPosition.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? BASE_POSITION : null),
      );

      await expect(service.getPositionById('position-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPosition', () => {
    it('creates a position scoped to organizationId', async () => {
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.createPosition({ nameEn: 'Director', grade: 10 }, ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('validates orgUnitId belongs to the same org', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.createPosition({ nameEn: 'ICU Manager', grade: 7, orgUnitId: 'unit-x' }, ORG_A, 'actor-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('calls AuditLogService.log() on creation', async () => {
      mockPrisma.orgPosition.create.mockResolvedValue(BASE_POSITION);

      await service.createPosition({ nameEn: 'Director', grade: 10 }, ORG_A, 'actor-1');

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'OrgPosition' }),
      );
    });
  });

  describe('updatePosition', () => {
    it('updates fields present in the dto', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, grade: 9 });

      const result = await service.updatePosition('position-1', { grade: 9 }, ORG_A, 'actor-1');

      expect(result.grade).toBe(9);
    });

    it('throws NotFoundException for a cross-tenant position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.updatePosition('position-1', { grade: 9 }, ORG_B, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('calls AuditLogService.log() with before/after', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, grade: 9 });

      await service.updatePosition('position-1', { grade: 9 }, ORG_A, 'actor-1');

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: BASE_POSITION,
          after: expect.objectContaining({ grade: 9 }),
        }),
      );
    });
  });

  describe('deactivatePosition', () => {
    it('sets isActive to false', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(BASE_POSITION);
      mockPrisma.orgPosition.update.mockResolvedValue({ ...BASE_POSITION, isActive: false });

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('is idempotent — no error if already inactive', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ ...BASE_POSITION, isActive: false });

      await service.deactivatePosition('position-1', ORG_A, 'actor-1');

      expect(mockPrisma.orgPosition.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a cross-tenant position', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.deactivatePosition('position-1', ORG_B, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('validateEscalationTarget', () => {
    const unitChild = { id: 'unit-child', parentId: 'unit-parent' };
    const unitParent = { id: 'unit-parent', parentId: null };
    const unitOther = { id: 'unit-other', parentId: null };

    function mockOrgUnitChain() {
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }) => {
        const units = [unitChild, unitParent, unitOther];
        return Promise.resolve(units.find((u) => u.id === where.id) ?? null);
      });
    }

    it('VALID — target has higher grade in same org unit', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 5 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-child',
        position: { grade: 8 },
      });

      await expect(
        service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A),
      ).resolves.toBeUndefined();
    });

    it('VALID — target has equal grade in parent org unit', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 5 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-parent',
        position: { grade: 5 },
      });

      await expect(
        service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A),
      ).resolves.toBeUndefined();
    });

    it('INVALID — target has lower grade (throws BadRequestException)', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 8 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-child',
        position: { grade: 5 },
      });

      await expect(service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('INVALID — target in a different org unit branch (throws)', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 5 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-other',
        position: { grade: 8 },
      });

      await expect(service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('EDGE — assignee has no position: grade treated as 0, any target valid', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: null },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-child',
        position: { grade: 1 },
      });

      await expect(
        service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A),
      ).resolves.toBeUndefined();
    });

    it('EDGE — target has no position: grade 0, fails if assignee has a position', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 5 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: 'unit-child',
        position: null,
      });

      await expect(service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('EDGE — target has no primaryOrgUnitId: fails the org unit check', async () => {
      mockOrgUnitChain();
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'assignee-1', primaryOrgUnitId: 'unit-child', position: { grade: 5 } },
      ]);
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'target-1',
        primaryOrgUnitId: null,
        position: { grade: 10 },
      });

      await expect(service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should NOT resolve users from another tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? [] : [{ id: 'leaked', position: null }]),
      );
      mockPrisma.user.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.organizationId === ORG_A ? null : { id: 'leaked', position: null }),
      );

      // No assignees resolved for ORG_A and no target resolved for ORG_A —
      // target lookup fails, confirming cross-tenant users are never used.
      await expect(service.validateEscalationTarget(['assignee-1'], 'target-1', ORG_A)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
