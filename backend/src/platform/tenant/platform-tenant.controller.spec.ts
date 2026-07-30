// PlatformTenantController imports the real PlatformTenantService class for
// its DI token even though useValue below swaps the implementation — that
// real file's own import chain (auth.service.ts -> better-auth.config.ts)
// would otherwise pull in better-auth's ESM-only package and fail Jest's
// CJS transform. Same explicit-factory pattern as platform-tenant.service.spec.ts.
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { PlatformTenantController } from './platform-tenant.controller';
import { PlatformTenantService } from './platform-tenant.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PlatformGuard } from '../../common/guards/platform.guard';

const TENANT_ID = 'tenant-a';
const ACTOR_ID = 'platform-admin-1';
const PLATFORM_ORG_ID = 'platform-org';

describe('PlatformTenantController', () => {
  let controller: PlatformTenantController;
  let service: {
    listTenants: jest.Mock;
    getTenantDetail: jest.Mock;
    createTenant: jest.Mock;
    suspendTenant: jest.Mock;
    reactivateTenant: jest.Mock;
    extendTrial: jest.Mock;
    updateTenantModules: jest.Mock;
    allocateAiCredits: jest.Mock;
    startImpersonation: jest.Mock;
    endImpersonation: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listTenants: jest.fn().mockResolvedValue([]),
      getTenantDetail: jest.fn().mockResolvedValue({}),
      createTenant: jest.fn().mockResolvedValue({}),
      suspendTenant: jest.fn().mockResolvedValue(undefined),
      reactivateTenant: jest.fn().mockResolvedValue(undefined),
      extendTrial: jest.fn().mockResolvedValue(undefined),
      updateTenantModules: jest.fn().mockResolvedValue(undefined),
      allocateAiCredits: jest.fn().mockResolvedValue(undefined),
      startImpersonation: jest.fn().mockResolvedValue(undefined),
      endImpersonation: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlatformTenantController],
      providers: [{ provide: PlatformTenantService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PlatformGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PlatformTenantController);
  });

  afterEach(() => jest.clearAllMocks());

  it('listTenants delegates with status/planId filters', async () => {
    await controller.listTenants('ACTIVE', 'plan-1');
    expect(service.listTenants).toHaveBeenCalledWith({ status: 'ACTIVE', planId: 'plan-1' });
  });

  it('getTenantDetail delegates with id', async () => {
    await controller.getTenantDetail(TENANT_ID);
    expect(service.getTenantDetail).toHaveBeenCalledWith(TENANT_ID);
  });

  it('createTenant delegates with dto and actorId', async () => {
    const dto = { name: 'Acme' } as any;
    await controller.createTenant(dto, ACTOR_ID);
    expect(service.createTenant).toHaveBeenCalledWith(dto, ACTOR_ID);
  });

  it('suspendTenant delegates with id and actorId', async () => {
    await controller.suspendTenant(TENANT_ID, ACTOR_ID);
    expect(service.suspendTenant).toHaveBeenCalledWith(TENANT_ID, ACTOR_ID);
  });

  it('reactivateTenant delegates with id and actorId', async () => {
    await controller.reactivateTenant(TENANT_ID, ACTOR_ID);
    expect(service.reactivateTenant).toHaveBeenCalledWith(TENANT_ID, ACTOR_ID);
  });

  it('extendTrial delegates with id, a parsed Date, and actorId', async () => {
    await controller.extendTrial(TENANT_ID, { trialEndsAt: '2027-01-01T00:00:00.000Z' }, ACTOR_ID);
    expect(service.extendTrial).toHaveBeenCalledWith(TENANT_ID, new Date('2027-01-01T00:00:00.000Z'), ACTOR_ID);
  });

  it('updateTenantModules delegates with id, dto, and actorId', async () => {
    const dto = { modules: { documents: true } };
    await controller.updateTenantModules(TENANT_ID, dto, ACTOR_ID);
    expect(service.updateTenantModules).toHaveBeenCalledWith(TENANT_ID, dto, ACTOR_ID);
  });

  it('allocateAiCredits delegates with id, dto, and actorId', async () => {
    const dto = { monthlyCredits: 500 };
    await controller.allocateAiCredits(TENANT_ID, dto, ACTOR_ID);
    expect(service.allocateAiCredits).toHaveBeenCalledWith(TENANT_ID, dto, ACTOR_ID);
  });

  it('startImpersonation delegates with tenantId, targetUserId, actorId, platformOrgId, res', async () => {
    const res = {} as any;
    await controller.startImpersonation(TENANT_ID, 'user-1', ACTOR_ID, PLATFORM_ORG_ID, res);
    expect(service.startImpersonation).toHaveBeenCalledWith(TENANT_ID, 'user-1', ACTOR_ID, PLATFORM_ORG_ID, res);
  });

  it('endImpersonation delegates with req and res', async () => {
    const req = {} as any;
    const res = {} as any;
    await controller.endImpersonation(req, res);
    expect(service.endImpersonation).toHaveBeenCalledWith(req, res);
  });
});
