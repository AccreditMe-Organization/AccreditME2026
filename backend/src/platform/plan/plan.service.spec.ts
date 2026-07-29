// PlanService has no tenant/organizationId dimension by design (see this
// service's own header comment) — there is deliberately no tenant isolation
// test in this file. Don't file that as a missing-test gap.

import { NotFoundException } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { PlanModuleAccessLevel } from './interfaces/plan.interface';

// Prisma.Decimal fails to construct under ts-jest's transform of this
// generated client specifically (confirmed via a real ts-node run — same
// toolchain the actual app boots with — that Prisma.Decimal works fine
// outside Jest). Explicit factory mock, same established pattern this
// codebase already uses for other Jest-hostile generated/external modules
// (see auth.service.spec.ts's better-auth mock).
jest.mock('../../../generated/prisma/client', () => ({
  Prisma: {
    Decimal: class {
      constructor(private readonly value: string) {}
      toString() { return this.value; }
    },
  },
}));

const PLATFORM_ORG_ID = 'platform-org';

// Lightweight stand-in for Prisma's Decimal — the service only ever calls
// .toString() on these fields when mapping to the IPlan/IAiCreditPack
// response shape.
function fakeDecimal(value: string) {
  return { toString: () => value };
}

describe('PlanService', () => {
  let service: PlanService;
  let mockPrisma: any;
  let mockAuditLog: { log: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      plan: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      planModule: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      aiCreditPack: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      aiFeatureCost: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    mockAuditLog = { log: jest.fn() };

    service = new PlanService(mockPrisma as unknown as PrismaService, mockAuditLog as unknown as AuditLogService);
  });

  describe('listPlans', () => {
    it('filters to isActive: true by default', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([]);
      await service.listPlans();
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('includes inactive plans when includeInactive is true', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([]);
      await service.listPlans(true);
      expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { sortOrder: 'asc' },
      });
    });

    it('converts Decimal prices to strings', async () => {
      mockPrisma.plan.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
          monthlyPrice: fakeDecimal('99.99'), annualPrice: fakeDecimal('999.99'),
          maxFullUsers: 10, maxStaff: 100, maxStorageGb: 10, aiCreditsPerMonth: 100,
          isActive: true, isPublic: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
        },
      ]);
      const result = await service.listPlans();
      expect(result[0]?.monthlyPrice).toBe('99.99');
      expect(result[0]?.annualPrice).toBe('999.99');
    });
  });

  describe('getPlanById', () => {
    it('throws NotFoundException when the plan does not exist', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.getPlanById('nope')).rejects.toThrow(NotFoundException);
    });

    it('returns the plan with its planModules', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue({
        id: 'p1', name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
        monthlyPrice: fakeDecimal('0'), annualPrice: fakeDecimal('0'),
        maxFullUsers: null, maxStaff: null, maxStorageGb: 10, aiCreditsPerMonth: 100,
        isActive: true, isPublic: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
        planModules: [{ id: 'pm1', planId: 'p1', moduleKey: 'documents', accessLevel: 'FULL' }],
      });
      const result = await service.getPlanById('p1');
      expect(result.planModules).toEqual([
        { id: 'pm1', planId: 'p1', moduleKey: 'documents', accessLevel: 'FULL' },
      ]);
    });
  });

  describe('createPlan', () => {
    it('creates the plan and logs an audit entry', async () => {
      mockPrisma.plan.create.mockResolvedValue({
        id: 'p1', name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
        monthlyPrice: fakeDecimal('99'), annualPrice: fakeDecimal('999'),
        maxFullUsers: 10, maxStaff: 100, maxStorageGb: 10, aiCreditsPerMonth: 100,
        isActive: true, isPublic: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
      });

      await service.createPlan(
        {
          name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
          monthlyPrice: '99', annualPrice: '999',
          maxFullUsers: 10, maxStaff: 100, maxStorageGb: 10, aiCreditsPerMonth: 100,
        },
        'actor-1',
        PLATFORM_ORG_ID,
      );

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PLATFORM_ORG_ID, actorId: 'actor-1', action: 'CREATE', objectType: 'Plan' }),
      );
    });
  });

  describe('deactivatePlan', () => {
    it('sets isActive: false rather than deleting the row', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue({
        id: 'p1', name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
        monthlyPrice: fakeDecimal('0'), annualPrice: fakeDecimal('0'),
        maxFullUsers: null, maxStaff: null, maxStorageGb: 10, aiCreditsPerMonth: 100,
        isActive: true, isPublic: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
        planModules: [],
      });
      mockPrisma.plan.update.mockResolvedValue({});

      await service.deactivatePlan('p1', 'actor-1', PLATFORM_ORG_ID);

      expect(mockPrisma.plan.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { isActive: false } });
    });
  });

  describe('upsertPlanModule', () => {
    it('upserts by the (planId, moduleKey) composite key', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue({
        id: 'p1', name: 'starter', nameEn: 'Starter', nameAr: 'مبتدئ',
        monthlyPrice: fakeDecimal('0'), annualPrice: fakeDecimal('0'),
        maxFullUsers: null, maxStaff: null, maxStorageGb: 10, aiCreditsPerMonth: 100,
        isActive: true, isPublic: true, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(),
        planModules: [],
      });
      mockPrisma.planModule.upsert.mockResolvedValue({
        id: 'pm1', planId: 'p1', moduleKey: 'documents', accessLevel: 'FULL',
      });

      await service.upsertPlanModule('p1', { moduleKey: 'documents', accessLevel: PlanModuleAccessLevel.FULL }, 'actor-1', PLATFORM_ORG_ID);

      expect(mockPrisma.planModule.upsert).toHaveBeenCalledWith({
        where: { planId_moduleKey: { planId: 'p1', moduleKey: 'documents' } },
        update: { accessLevel: PlanModuleAccessLevel.FULL },
        create: { planId: 'p1', moduleKey: 'documents', accessLevel: PlanModuleAccessLevel.FULL },
      });
    });
  });

  describe('updateAiCreditPack', () => {
    it('throws NotFoundException when the pack does not exist', async () => {
      mockPrisma.aiCreditPack.findUnique.mockResolvedValue(null);
      await expect(service.updateAiCreditPack('nope', {}, 'actor-1', PLATFORM_ORG_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('upsertAiFeatureCost', () => {
    it('upserts by featureKey', async () => {
      mockPrisma.aiFeatureCost.upsert.mockResolvedValue({
        id: 'f1', featureKey: 'rca_assistance', creditCost: 5, description: null, createdAt: new Date(), updatedAt: new Date(),
      });

      await service.upsertAiFeatureCost({ featureKey: 'rca_assistance', creditCost: 5 }, 'actor-1', PLATFORM_ORG_ID);

      expect(mockPrisma.aiFeatureCost.upsert).toHaveBeenCalledWith({
        where: { featureKey: 'rca_assistance' },
        update: { creditCost: 5, description: null },
        create: { featureKey: 'rca_assistance', creditCost: 5, description: null },
      });
    });
  });
});
