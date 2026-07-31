import { Test, TestingModule } from '@nestjs/testing';
import { LookupController } from './lookup.controller';
import { LookupService } from './lookup.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ILookupCategory } from './interfaces/lookup-category.interface';
import { ILookupValue } from './interfaces/lookup-value.interface';
import { CreateLookupValueDto } from './dto/create-lookup-value.dto';
import { UpdateLookupCategoryDto } from './dto/update-lookup-category.dto';
import { UpdateLookupValueDto } from './dto/update-lookup-value.dto';
import { OverrideLabelDto } from './dto/override-label.dto';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test';
const USER_ID   = 'user-test';
const CAT_KEY   = 'document_type';
const VAL_ID    = 'val-test';

const MOCK_CATEGORY: ILookupCategory = {
  id:              'cat-1',
  organizationId:  null,
  key:             CAT_KEY,
  labelEn:         'Document Type',
  labelAr:         'نوع الوثيقة',
  isSystem:        true,
  isExtensible:    true,
  attributeSchema: null,
  isActive:        true,
  sortOrder:       30,
  createdAt:       new Date('2026-01-01'),
  updatedAt:       new Date('2026-01-01'),
};

const MOCK_VALUE: ILookupValue = {
  id:              VAL_ID,
  organizationId:  null,
  categoryId:      'cat-1',
  key:             'policy',
  labelEn:         'Policy',
  labelAr:         'سياسة',
  layer:           'SYSTEM',
  attributes:      null,
  isActive:        true,
  isHidden:        false,
  labelOverrideEn: null,
  labelOverrideAr: null,
  sortOrder:       10,
  createdAt:       new Date('2026-01-01'),
  updatedAt:       new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LookupController', () => {
  let controller: LookupController;
  let service: {
    getCategories:      jest.Mock;
    getCategoryByKey:   jest.Mock;
    updateCategory:     jest.Mock;
    deactivateCategory: jest.Mock;
    getValues:          jest.Mock;
    addValue:           jest.Mock;
    suggestValues:      jest.Mock;
    updateValue:        jest.Mock;
    removeValue:        jest.Mock;
    hideSystemValue:    jest.Mock;
    unhideSystemValue:  jest.Mock;
    overrideLabel:      jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getCategories:      jest.fn().mockResolvedValue([MOCK_CATEGORY]),
      getCategoryByKey:   jest.fn().mockResolvedValue(MOCK_CATEGORY),
      updateCategory:     jest.fn().mockResolvedValue(MOCK_CATEGORY),
      deactivateCategory: jest.fn().mockResolvedValue(undefined),
      getValues:          jest.fn().mockResolvedValue([MOCK_VALUE]),
      addValue:           jest.fn().mockResolvedValue(MOCK_VALUE),
      suggestValues:      jest.fn().mockResolvedValue([]),
      updateValue:        jest.fn().mockResolvedValue(MOCK_VALUE),
      removeValue:        jest.fn().mockResolvedValue(undefined),
      hideSystemValue:    jest.fn().mockResolvedValue(undefined),
      unhideSystemValue:  jest.fn().mockResolvedValue(undefined),
      overrideLabel:      jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LookupController],
      providers:   [{ provide: LookupService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(LookupController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getCategories ─────────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('delegates to lookupService.getCategories with tenantId', async () => {
      const result = await controller.getCategories(TENANT_ID);
      expect(service.getCategories).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe(CAT_KEY);
    });
  });

  // ── getCategoryByKey ──────────────────────────────────────────────────────

  describe('getCategoryByKey', () => {
    it('delegates to lookupService.getCategoryByKey with key and tenantId', async () => {
      const result = await controller.getCategoryByKey(CAT_KEY, TENANT_ID);
      expect(service.getCategoryByKey).toHaveBeenCalledWith(CAT_KEY, TENANT_ID);
      expect(result.key).toBe(CAT_KEY);
    });
  });

  // ── updateCategory ────────────────────────────────────────────────────────

  describe('updateCategory', () => {
    it('delegates to lookupService.updateCategory with key, dto, tenantId, actorId', async () => {
      const dto = { labelEn: 'Doc Type' } as UpdateLookupCategoryDto;
      const result = await controller.updateCategory(CAT_KEY, dto, TENANT_ID, USER_ID);
      expect(service.updateCategory).toHaveBeenCalledWith(CAT_KEY, TENANT_ID, dto, USER_ID);
      expect(result.key).toBe(CAT_KEY);
    });

    // Regression guard for ACC-17 — mutating a SYSTEM category (shared
    // across every tenant) must require PlatformGuard, not the tenant
    // permission lookups:manage. Controller unit tests call the method
    // directly (bypassing the guard pipeline entirely, same as every other
    // test in this file), so this can't exercise an actual rejected
    // request — it instead asserts the metadata NestJS's guard pipeline
    // reads is correctly wired, which is exactly what would silently break
    // if someone re-added @Permissions(LOOKUPS_PERMISSIONS.MANAGE) here or
    // removed @UseGuards(PlatformGuard). PlatformGuard's own behavior
    // (what a request with only lookups:manage — no platform:admin —
    // actually gets rejected for) is already covered by
    // platform.guard.spec.ts.
    it('requires PlatformGuard, and no tenant-level @Permissions, on the route', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, LookupController.prototype.updateCategory) as
        | unknown[]
        | undefined;
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, LookupController.prototype.updateCategory) as
        | string[]
        | undefined;

      expect(guards).toContain(PlatformGuard);
      expect(permissions).toBeUndefined();
    });
  });

  // ── deactivateCategory ────────────────────────────────────────────────────

  describe('deactivateCategory', () => {
    it('delegates to lookupService.deactivateCategory with key, tenantId, actorId', async () => {
      await controller.deactivateCategory(CAT_KEY, TENANT_ID, USER_ID);
      expect(service.deactivateCategory).toHaveBeenCalledWith(CAT_KEY, TENANT_ID, USER_ID);
    });

    // See updateCategory's equivalent test above for why this is a metadata
    // check rather than an actual rejected-request test (ACC-17).
    it('requires PlatformGuard, and no tenant-level @Permissions, on the route', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, LookupController.prototype.deactivateCategory) as
        | unknown[]
        | undefined;
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, LookupController.prototype.deactivateCategory) as
        | string[]
        | undefined;

      expect(guards).toContain(PlatformGuard);
      expect(permissions).toBeUndefined();
    });
  });

  // ── getValues ─────────────────────────────────────────────────────────────

  describe('getValues', () => {
    it('delegates to lookupService.getValues with key and tenantId', async () => {
      const result = await controller.getValues(CAT_KEY, TENANT_ID);
      expect(service.getValues).toHaveBeenCalledWith(CAT_KEY, TENANT_ID);
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe('policy');
    });
  });

  // ── addValue ──────────────────────────────────────────────────────────────

  describe('addValue', () => {
    it('delegates to lookupService.addValue with key, dto, tenantId, actorId', async () => {
      const dto = { key: 'custom', labelEn: 'Custom', labelAr: 'مخصص' } as CreateLookupValueDto;
      const result = await controller.addValue(CAT_KEY, dto, TENANT_ID, USER_ID);
      expect(service.addValue).toHaveBeenCalledWith(CAT_KEY, TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(VAL_ID);
    });
  });

  // ── suggestValues ─────────────────────────────────────────────────────────

  describe('suggestValues', () => {
    it('delegates to lookupService.suggestValues with key, tenantId, actorId', async () => {
      const result = await controller.suggestValues(CAT_KEY, TENANT_ID, USER_ID);
      expect(service.suggestValues).toHaveBeenCalledWith(CAT_KEY, TENANT_ID, USER_ID);
      expect(result).toEqual([]);
    });
  });

  // ── updateValue ───────────────────────────────────────────────────────────

  describe('updateValue', () => {
    it('delegates to lookupService.updateValue with id, dto, tenantId, actorId', async () => {
      const dto = { labelEn: 'Updated' } as UpdateLookupValueDto;
      const result = await controller.updateValue(VAL_ID, dto, TENANT_ID, USER_ID);
      expect(service.updateValue).toHaveBeenCalledWith(VAL_ID, TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(VAL_ID);
    });
  });

  // ── removeValue ───────────────────────────────────────────────────────────

  describe('removeValue', () => {
    it('delegates to lookupService.removeValue with id, tenantId, actorId', async () => {
      await controller.removeValue(VAL_ID, TENANT_ID, USER_ID);
      expect(service.removeValue).toHaveBeenCalledWith(VAL_ID, TENANT_ID, USER_ID);
    });
  });

  // ── hideSystemValue ───────────────────────────────────────────────────────

  describe('hideSystemValue', () => {
    it('delegates to lookupService.hideSystemValue with id, tenantId, actorId', async () => {
      await controller.hideSystemValue(VAL_ID, TENANT_ID, USER_ID);
      expect(service.hideSystemValue).toHaveBeenCalledWith(VAL_ID, TENANT_ID, USER_ID);
    });
  });

  // ── unhideSystemValue ─────────────────────────────────────────────────────

  describe('unhideSystemValue', () => {
    it('delegates to lookupService.unhideSystemValue with id, tenantId, actorId', async () => {
      await controller.unhideSystemValue(VAL_ID, TENANT_ID, USER_ID);
      expect(service.unhideSystemValue).toHaveBeenCalledWith(VAL_ID, TENANT_ID, USER_ID);
    });
  });

  // ── overrideLabel ─────────────────────────────────────────────────────────

  describe('overrideLabel', () => {
    it('delegates to lookupService.overrideLabel with id, dto, tenantId, actorId', async () => {
      const dto = { labelOverrideEn: 'Institutional Policy', labelOverrideAr: 'سياسة المؤسسة' } as OverrideLabelDto;
      await controller.overrideLabel(VAL_ID, dto, TENANT_ID, USER_ID);
      expect(service.overrideLabel).toHaveBeenCalledWith(VAL_ID, TENANT_ID, dto, USER_ID);
    });
  });
});
