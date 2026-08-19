import { Test, TestingModule } from '@nestjs/testing';
import { OrgPositionController } from './org-position.controller';
import { OrgPositionService } from './org-position.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IOrgPosition } from './interfaces/org-position.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

const MOCK_POSITION: IOrgPosition = {
  id: 'position-1',
  organizationId: TENANT_ID,
  nameEn: 'Director',
  nameAr: 'مدير عام',
  grade: 10,
  isSingleAssignee: false,
  isUnitHeadPosition: false,
  roleId: null,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('OrgPositionController', () => {
  let controller: OrgPositionController;
  let service: {
    listPositions: jest.Mock;
    getPositionById: jest.Mock;
    createPosition: jest.Mock;
    updatePosition: jest.Mock;
    deactivatePosition: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listPositions: jest.fn().mockResolvedValue([MOCK_POSITION]),
      getPositionById: jest.fn().mockResolvedValue(MOCK_POSITION),
      createPosition: jest.fn().mockResolvedValue(MOCK_POSITION),
      updatePosition: jest.fn().mockResolvedValue(MOCK_POSITION),
      deactivatePosition: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrgPositionController],
      providers: [{ provide: OrgPositionService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(OrgPositionController);
  });

  afterEach(() => jest.clearAllMocks());

  it('listPositions delegates to the service', async () => {
    const result = await controller.listPositions(TENANT_ID);

    expect(service.listPositions).toHaveBeenCalledWith(TENANT_ID);
    expect(result).toEqual([MOCK_POSITION]);
  });

  it('getPositionById delegates to the service', async () => {
    const result = await controller.getPositionById('position-1', TENANT_ID);

    expect(service.getPositionById).toHaveBeenCalledWith('position-1', TENANT_ID);
    expect(result).toEqual(MOCK_POSITION);
  });

  it('createPosition delegates to the service with tenant and actor', async () => {
    const dto = { nameEn: 'Director', grade: 10 };
    const result = await controller.createPosition(dto, TENANT_ID, USER_ID);

    expect(service.createPosition).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_POSITION);
  });

  it('updatePosition delegates to the service with tenant and actor', async () => {
    const dto = { grade: 9 };
    const result = await controller.updatePosition('position-1', dto, TENANT_ID, USER_ID);

    expect(service.updatePosition).toHaveBeenCalledWith('position-1', dto, TENANT_ID, USER_ID);
    expect(result).toEqual(MOCK_POSITION);
  });

  it('deactivatePosition delegates to the service with tenant and actor', async () => {
    await controller.deactivatePosition('position-1', TENANT_ID, USER_ID);

    expect(service.deactivatePosition).toHaveBeenCalledWith('position-1', TENANT_ID, USER_ID);
  });
});
