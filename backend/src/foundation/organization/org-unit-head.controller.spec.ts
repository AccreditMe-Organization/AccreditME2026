import { Test, TestingModule } from '@nestjs/testing';
import { OrgUnitHeadController } from './org-unit-head.controller';
import { OrgUnitHeadService } from './org-unit-head.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { ORG_PERMISSIONS } from '../../common/constants/permissions';

const TENANT_ID = 'org-test';
const USER_ID = 'user-test';
const UNIT_ID = 'unit-test';

describe('OrgUnitHeadController', () => {
  let controller: OrgUnitHeadController;
  let service: {
    getHeadStatus: jest.Mock;
    assignHead: jest.Mock;
    vacateHead: jest.Mock;
    declareHandover: jest.Mock;
    completeHandoverNow: jest.Mock;
    cancelHandover: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getHeadStatus: jest.fn().mockResolvedValue({ holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null }),
      assignHead: jest.fn().mockResolvedValue(undefined),
      vacateHead: jest.fn().mockResolvedValue(undefined),
      declareHandover: jest.fn().mockResolvedValue(undefined),
      completeHandoverNow: jest.fn().mockResolvedValue(undefined),
      cancelHandover: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgUnitHeadController],
      providers: [{ provide: OrgUnitHeadService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrgUnitHeadController);
  });

  afterEach(() => jest.clearAllMocks());

  it('getHeadStatus delegates to the service with tenant', async () => {
    await controller.getHeadStatus(UNIT_ID, TENANT_ID);
    expect(service.getHeadStatus).toHaveBeenCalledWith(UNIT_ID, TENANT_ID);
  });

  it('assignHead delegates to the service with tenant and actor', async () => {
    const dto = { userId: 'target-user', positionId: 'pos-head' };
    await controller.assignHead(UNIT_ID, dto, TENANT_ID, USER_ID);
    expect(service.assignHead).toHaveBeenCalledWith(UNIT_ID, dto, TENANT_ID, USER_ID);
  });

  it('vacateHead delegates to the service with tenant and actor', async () => {
    await controller.vacateHead(UNIT_ID, TENANT_ID, USER_ID);
    expect(service.vacateHead).toHaveBeenCalledWith(UNIT_ID, TENANT_ID, USER_ID);
  });

  it('declareHandover delegates to the service with tenant and actor', async () => {
    const dto = { incomingUserId: 'incoming-user', effectiveDate: '2026-09-01' };
    await controller.declareHandover(UNIT_ID, dto, TENANT_ID, USER_ID);
    expect(service.declareHandover).toHaveBeenCalledWith(UNIT_ID, dto, TENANT_ID, USER_ID);
  });

  it('completeHandoverNow delegates to the service with tenant and actor', async () => {
    await controller.completeHandoverNow(UNIT_ID, TENANT_ID, USER_ID);
    expect(service.completeHandoverNow).toHaveBeenCalledWith(UNIT_ID, TENANT_ID, USER_ID);
  });

  it('cancelHandover delegates to the service with tenant and actor', async () => {
    await controller.cancelHandover(UNIT_ID, TENANT_ID, USER_ID);
    expect(service.cancelHandover).toHaveBeenCalledWith(UNIT_ID, TENANT_ID, USER_ID);
  });

  // ACC-40 Section 2.3 — Head-management actions must be gated by
  // org:manage specifically, not positions:manage (a deliberate,
  // explicitly-reasoned design choice — see the controller's own header
  // comment). Direct metadata assertion, same pattern as
  // lookup.controller.spec.ts's PlatformGuard checks (ACC-17) — proves the
  // actual decorator is attached to each route, which is exactly what
  // would silently break if someone removed @Permissions(...) or changed
  // it to the wrong string.
  describe('org:manage permission gating', () => {
    const routes: [string, () => object][] = [
      ['assignHead', () => OrgUnitHeadController.prototype.assignHead],
      ['vacateHead', () => OrgUnitHeadController.prototype.vacateHead],
      ['declareHandover', () => OrgUnitHeadController.prototype.declareHandover],
      ['completeHandoverNow', () => OrgUnitHeadController.prototype.completeHandoverNow],
      ['cancelHandover', () => OrgUnitHeadController.prototype.cancelHandover],
    ];

    it.each(routes)('%s requires org:manage', (_name, getMethod) => {
      const permissions = Reflect.getMetadata(PERMISSIONS_KEY, getMethod()) as string[] | undefined;
      expect(permissions).toContain(ORG_PERMISSIONS.MANAGE);
      expect(permissions).not.toContain('positions:manage');
    });
  });
});
