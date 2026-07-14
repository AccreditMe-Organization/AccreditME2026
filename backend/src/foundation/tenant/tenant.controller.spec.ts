import { Test, TestingModule } from '@nestjs/testing';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

const MOCK_TENANT_ID = 'org-test';
const MOCK_USER_ID = 'user-test';

const MOCK_TENANT = {
  id: MOCK_TENANT_ID,
  name: 'Test Org',
  slug: 'test',
  country: 'SA',
  timezone: 'Asia/Riyadh',
  language: 'en',
  authProvider: 'LOCAL' as const,
  storageProvider: 'S3' as const,
  aiProvider: 'ANTHROPIC' as const,
  plan: 'STARTER' as const,
  status: 'TRIAL' as const,
  trialEndsAt: null,
  maxUsers: 25,
  maxStorageGb: 10,
  isBootstrapped: false,
  bootstrappedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('TenantController', () => {
  let controller: TenantController;
  let service: {
    findById: jest.Mock;
    update: jest.Mock;
    getTenantConfig: jest.Mock;
    bootstrap: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findById: jest.fn().mockResolvedValue(MOCK_TENANT),
      update: jest.fn().mockResolvedValue(MOCK_TENANT),
      getTenantConfig: jest.fn().mockResolvedValue({
        authProvider: 'LOCAL',
        storageProvider: 'S3',
        aiProvider: 'ANTHROPIC',
        authConfig: null,
        storageConfig: null,
        aiConfig: null,
      }),
      bootstrap: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [{ provide: TenantService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(TenantController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getCurrent', () => {
    it('calls findById with tenantId from @CurrentTenant()', async () => {
      const result = await controller.getCurrent(MOCK_TENANT_ID);
      expect(service.findById).toHaveBeenCalledWith(MOCK_TENANT_ID);
      expect(result.id).toBe(MOCK_TENANT_ID);
    });
  });

  describe('update', () => {
    it('calls update with tenantId, dto, and userId', async () => {
      const dto = { name: 'New Name' };
      await controller.update(dto, MOCK_TENANT_ID, MOCK_USER_ID);
      expect(service.update).toHaveBeenCalledWith(
        MOCK_TENANT_ID,
        dto,
        MOCK_USER_ID,
      );
    });
  });

  describe('getConfig', () => {
    it('calls getTenantConfig with tenantId', async () => {
      await controller.getConfig(MOCK_TENANT_ID);
      expect(service.getTenantConfig).toHaveBeenCalledWith(MOCK_TENANT_ID);
    });
  });

  describe('bootstrap', () => {
    it('calls bootstrap with tenantId and userId', async () => {
      await controller.bootstrap(MOCK_TENANT_ID, MOCK_USER_ID);
      expect(service.bootstrap).toHaveBeenCalledWith(
        MOCK_TENANT_ID,
        MOCK_USER_ID,
      );
    });
  });
});
