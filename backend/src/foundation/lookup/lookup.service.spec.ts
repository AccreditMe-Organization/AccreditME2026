import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LookupService } from './lookup.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A  = 'org-a-id';
const ORG_B  = 'org-b-id';
const ACTOR  = 'actor-id';

const BASE_CATEGORY = {
  id:              'cat-1',
  organizationId:  null as string | null,
  key:             'document_type',
  labelEn:         'Document Type',
  labelAr:         'نوع الوثيقة',
  isSystem:        true,
  isExtensible:    true,
  attributeSchema: null as unknown,
  isActive:        true,
  sortOrder:       30,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const BASE_VALUE = {
  id:              'val-1',
  organizationId:  null as string | null,
  categoryId:      'cat-1',
  key:             'policy',
  labelEn:         'Policy',
  labelAr:         'سياسة',
  layer:           'SYSTEM',
  attributes:      null as unknown,
  isActive:        true,
  isHidden:        false,
  labelOverrideEn: null as string | null,
  labelOverrideAr: null as string | null,
  sortOrder:       10,
  createdAt:       new Date(),
  updatedAt:       new Date(),
};

const makeCategory = (overrides: Partial<typeof BASE_CATEGORY> = {}) => ({
  ...BASE_CATEGORY,
  ...overrides,
});

const makeValue = (overrides: Partial<typeof BASE_VALUE> = {}) => ({
  ...BASE_VALUE,
  ...overrides,
});

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  lookupCategory: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
  },
  lookupValue: {
    findFirst:  jest.fn(),
    findMany:   jest.fn(),
    findUnique: jest.fn(),
    create:     jest.fn(),
    update:     jest.fn(),
    updateMany: jest.fn(),
    upsert:     jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LookupService', () => {
  let service: LookupService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LookupService,
        { provide: PrismaService,  useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<LookupService>(LookupService);
  });

  // ── seedSystemData ────────────────────────────────────────────────────────────

  describe('seedSystemData', () => {
    it('creates categories and values on first run', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      mockPrisma.lookupCategory.create.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      mockPrisma.lookupValue.create.mockResolvedValue(BASE_VALUE);

      await service.seedSystemData();

      expect(mockPrisma.lookupCategory.create).toHaveBeenCalled();
      expect(mockPrisma.lookupValue.create).toHaveBeenCalled();
      expect(mockPrisma.lookupCategory.update).not.toHaveBeenCalled();
    });

    it('updates existing categories and values on subsequent runs', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupCategory.update.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findFirst.mockResolvedValue(BASE_VALUE);
      mockPrisma.lookupValue.update.mockResolvedValue(BASE_VALUE);

      await service.seedSystemData();

      expect(mockPrisma.lookupCategory.update).toHaveBeenCalled();
      expect(mockPrisma.lookupValue.update).toHaveBeenCalled();
      expect(mockPrisma.lookupCategory.create).not.toHaveBeenCalled();
    });
  });

  // ── getCategories ─────────────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('returns only system categories (organizationId: null)', async () => {
      mockPrisma.lookupCategory.findMany.mockResolvedValue([BASE_CATEGORY]);

      const result = await service.getCategories(ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe('document_type');
      expect(mockPrisma.lookupCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: null }) }),
      );
    });

    it('returns empty array when no categories exist', async () => {
      mockPrisma.lookupCategory.findMany.mockResolvedValue([]);
      const result = await service.getCategories(ORG_A);
      expect(result).toEqual([]);
    });
  });

  // ── getCategoryByKey ──────────────────────────────────────────────────────────

  describe('getCategoryByKey', () => {
    it('returns the category when found', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      const result = await service.getCategoryByKey('document_type', ORG_A);
      expect(result.key).toBe('document_type');
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(service.getCategoryByKey('nonexistent', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateCategory ────────────────────────────────────────────────────────────

  describe('updateCategory', () => {
    it('updates label fields and writes audit log', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupCategory.update.mockResolvedValue({
        ...BASE_CATEGORY,
        labelEn: 'Doc Type Updated',
      });

      const result = await service.updateCategory(
        'document_type',
        ORG_A,
        { labelEn: 'Doc Type Updated' },
        ACTOR,
      );

      expect(result.labelEn).toBe('Doc Type Updated');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'LookupCategory', tenantId: ORG_A }),
      );
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.updateCategory('nonexistent', ORG_A, { labelEn: 'X' }, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deactivateCategory ────────────────────────────────────────────────────────

  describe('deactivateCategory', () => {
    it('deactivates an active category and writes audit log', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupCategory.update.mockResolvedValue({ ...BASE_CATEGORY, isActive: false });

      await service.deactivateCategory('document_type', ORG_A, ACTOR);

      expect(mockPrisma.lookupCategory.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', tenantId: ORG_A }),
      );
    });

    it('returns without updating when category is already inactive', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(makeCategory({ isActive: false }));

      await service.deactivateCategory('document_type', ORG_A, ACTOR);

      expect(mockPrisma.lookupCategory.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(service.deactivateCategory('nonexistent', ORG_A, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getValues (two-layer merge) ───────────────────────────────────────────────

  describe('getValues', () => {
    it('returns system values when no tenant overrides exist', async () => {
      const sysVal = makeValue({ key: 'policy', sortOrder: 10 });
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findMany
        .mockResolvedValueOnce([sysVal])   // system values
        .mockResolvedValueOnce([]);         // tenant records

      const result = await service.getValues('document_type', ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe('policy');
      expect(result[0]!.labelEn).toBe('Policy');
    });

    it('applies label overrides from tenant record', async () => {
      const sysVal = makeValue({ key: 'policy' });
      const tenantOverride = makeValue({
        id:              'val-override',
        organizationId:  ORG_A,
        key:             'policy',
        layer:           'TENANT',
        labelOverrideEn: 'Institutional Policy',
        labelOverrideAr: 'سياسة المؤسسة',
      });

      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findMany
        .mockResolvedValueOnce([sysVal])
        .mockResolvedValueOnce([tenantOverride]);

      const result = await service.getValues('document_type', ORG_A);

      expect(result).toHaveLength(1);
      expect(result[0]!.labelEn).toBe('Institutional Policy');
      expect(result[0]!.labelAr).toBe('سياسة المؤسسة');
    });

    it('excludes system values hidden by tenant', async () => {
      const sysVal = makeValue({ key: 'policy' });
      const hiddenOverride = makeValue({
        id:             'val-hidden',
        organizationId: ORG_A,
        key:            'policy',
        layer:          'TENANT',
        isHidden:       true,
      });

      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findMany
        .mockResolvedValueOnce([sysVal])
        .mockResolvedValueOnce([hiddenOverride]);

      const result = await service.getValues('document_type', ORG_A);

      expect(result).toHaveLength(0);
    });

    it('appends tenant-only additions after system values', async () => {
      const sysVal    = makeValue({ key: 'policy', sortOrder: 10 });
      const tenantVal = makeValue({
        id:             'val-tenant',
        organizationId: ORG_A,
        key:            'local_form',
        labelEn:        'Local Form',
        labelAr:        'نموذج محلي',
        layer:          'TENANT',
        sortOrder:      99,
      });

      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findMany
        .mockResolvedValueOnce([sysVal])
        .mockResolvedValueOnce([tenantVal]);

      const result = await service.getValues('document_type', ORG_A);

      expect(result).toHaveLength(2);
      expect(result[0]!.key).toBe('policy');
      expect(result[1]!.key).toBe('local_form');
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(service.getValues('nonexistent', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── addValue ──────────────────────────────────────────────────────────────────

  describe('addValue', () => {
    it('creates a tenant-layer value and writes audit log', async () => {
      const newValue = makeValue({
        id:             'val-new',
        organizationId: ORG_A,
        key:            'local_form',
        layer:          'TENANT',
      });
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findUnique.mockResolvedValue(null);
      mockPrisma.lookupValue.create.mockResolvedValue(newValue);

      const result = await service.addValue(
        'document_type',
        ORG_A,
        { key: 'local_form', labelEn: 'Local Form', labelAr: 'نموذج محلي' },
        ACTOR,
      );

      expect(result.layer).toBe('TENANT');
      expect(mockPrisma.lookupValue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: ORG_A, layer: 'TENANT' }),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'LookupValue', tenantId: ORG_A }),
      );
    });

    it('throws ForbiddenException when category is not extensible', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(
        makeCategory({ isExtensible: false }),
      );

      await expect(
        service.addValue('document_type', ORG_A, { key: 'x', labelEn: 'X', labelAr: 'X' }, ACTOR),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.lookupValue.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when key already exists for this tenant', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findUnique.mockResolvedValue(BASE_VALUE);

      await expect(
        service.addValue('document_type', ORG_A, { key: 'policy', labelEn: 'P', labelAr: 'P' }, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(
        service.addValue('nonexistent', ORG_A, { key: 'x', labelEn: 'X', labelAr: 'X' }, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateValue ───────────────────────────────────────────────────────────────

  describe('updateValue', () => {
    it('updates a tenant-layer value and writes audit log', async () => {
      const tenantVal = makeValue({ organizationId: ORG_A, layer: 'TENANT' });
      mockPrisma.lookupValue.findFirst.mockResolvedValue(tenantVal);
      mockPrisma.lookupValue.update.mockResolvedValue({ ...tenantVal, labelEn: 'Updated' });

      const result = await service.updateValue('val-1', ORG_A, { labelEn: 'Updated' }, ACTOR);

      expect(result.labelEn).toBe('Updated');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', tenantId: ORG_A }),
      );
    });

    it('throws ForbiddenException when trying to edit a SYSTEM value', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(makeValue({ layer: 'SYSTEM' }));

      await expect(
        service.updateValue('val-1', ORG_A, { labelEn: 'X' }, ACTOR),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when value does not exist for this tenant', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      await expect(service.updateValue('missing', ORG_A, {}, ACTOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeValue ───────────────────────────────────────────────────────────────

  describe('removeValue', () => {
    it('soft-deletes a tenant-layer value and writes audit log', async () => {
      const tenantVal = makeValue({ organizationId: ORG_A, layer: 'TENANT' });
      mockPrisma.lookupValue.findFirst.mockResolvedValue(tenantVal);
      mockPrisma.lookupValue.update.mockResolvedValue({ ...tenantVal, isActive: false });

      await service.removeValue('val-1', ORG_A, ACTOR);

      expect(mockPrisma.lookupValue.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', tenantId: ORG_A }),
      );
    });

    it('throws ForbiddenException when trying to delete a SYSTEM value', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(makeValue({ layer: 'SYSTEM' }));
      await expect(service.removeValue('val-1', ORG_A, ACTOR)).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when value does not exist for this tenant', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      await expect(service.removeValue('missing', ORG_A, ACTOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ── hideSystemValue ───────────────────────────────────────────────────────────

  describe('hideSystemValue', () => {
    it('upserts a tenant TENANT record with isHidden: true', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(BASE_VALUE);
      mockPrisma.lookupValue.upsert.mockResolvedValue({});

      await service.hideSystemValue('val-1', ORG_A, ACTOR);

      expect(mockPrisma.lookupValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { isHidden: true },
          create: expect.objectContaining({ isHidden: true, layer: 'TENANT', organizationId: ORG_A }),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ after: expect.objectContaining({ isHidden: true }), tenantId: ORG_A }),
      );
    });

    it('throws NotFoundException when system value does not exist', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      await expect(service.hideSystemValue('missing', ORG_A, ACTOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ── unhideSystemValue ─────────────────────────────────────────────────────────

  describe('unhideSystemValue', () => {
    it('clears isHidden on matching TENANT override records', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(BASE_VALUE);
      mockPrisma.lookupValue.updateMany.mockResolvedValue({ count: 1 });

      await service.unhideSystemValue('val-1', ORG_A, ACTOR);

      expect(mockPrisma.lookupValue.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isHidden: false } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ after: expect.objectContaining({ isHidden: false }), tenantId: ORG_A }),
      );
    });

    it('throws NotFoundException when system value does not exist', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      await expect(service.unhideSystemValue('missing', ORG_A, ACTOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ── overrideLabel ─────────────────────────────────────────────────────────────

  describe('overrideLabel', () => {
    it('upserts label override on the TENANT record', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(BASE_VALUE);
      mockPrisma.lookupValue.upsert.mockResolvedValue({});

      await service.overrideLabel(
        'val-1',
        ORG_A,
        { labelOverrideEn: 'Institutional Policy', labelOverrideAr: 'سياسة المؤسسة' },
        ACTOR,
      );

      expect(mockPrisma.lookupValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { labelOverrideEn: 'Institutional Policy', labelOverrideAr: 'سياسة المؤسسة' },
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', tenantId: ORG_A }),
      );
    });

    it('throws NotFoundException when system value does not exist', async () => {
      mockPrisma.lookupValue.findFirst.mockResolvedValue(null);
      await expect(
        service.overrideLabel('missing', ORG_A, { labelOverrideEn: 'X', labelOverrideAr: 'X' }, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── suggestValues ─────────────────────────────────────────────────────────────

  describe('suggestValues', () => {
    it('returns empty array (AI stub)', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      const result = await service.suggestValues('document_type', ORG_A, ACTOR);
      expect(result).toEqual([]);
    });

    it('throws NotFoundException when category does not exist', async () => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue(null);
      await expect(service.suggestValues('nonexistent', ORG_A, ACTOR)).rejects.toThrow(NotFoundException);
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    // A test previously lived here asserting getCategories() "should NOT
    // return records belonging to a different tenant" — but getCategories()
    // deliberately ignores its organizationId argument (categories are
    // shared SYSTEM data, ORG_A and ORG_B always see the same rows), so the
    // test's own assertions (resultA[0].id === resultB[0].id) proved the
    // opposite of what its name claimed. Removed as redundant with
    // getCategories' own describe block above ('returns only system
    // categories (organizationId: null)'), which asserts the real behavior
    // correctly (see ACC-17).
    it('should NOT return records belonging to a different tenant', async () => {
      const sysVal = makeValue({ key: 'policy', organizationId: null });
      const tenantAVal = makeValue({ id: 'val-a', organizationId: ORG_A, key: 'local_form', layer: 'TENANT' });
      const tenantBVal = makeValue({ id: 'val-b', organizationId: ORG_B, key: 'custom_form', layer: 'TENANT' });

      mockPrisma.lookupCategory.findFirst.mockResolvedValue(BASE_CATEGORY);
      mockPrisma.lookupValue.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string | null } }) => {
          if (where.organizationId === null) return Promise.resolve([sysVal]);
          if (where.organizationId === ORG_A) return Promise.resolve([tenantAVal]);
          if (where.organizationId === ORG_B) return Promise.resolve([tenantBVal]);
          return Promise.resolve([]);
        },
      );

      const resultA = await service.getValues('document_type', ORG_A);
      const resultB = await service.getValues('document_type', ORG_B);

      expect(resultA.map((v) => v.id)).not.toContain('val-b');
      expect(resultB.map((v) => v.id)).not.toContain('val-a');
    });
  });
});
