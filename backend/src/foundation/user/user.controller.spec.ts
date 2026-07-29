import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

describe('UserController', () => {
  let controller: UserController;
  let service: {
    listUsers: jest.Mock;
    getById: jest.Mock;
    invite: jest.Mock;
    updateProfile: jest.Mock;
    updateOutOfOffice: jest.Mock;
    deactivate: jest.Mock;
    getUserRoles: jest.Mock;
    assignRoleToUser: jest.Mock;
    removeRoleFromUser: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      listUsers: jest.fn().mockResolvedValue([]),
      getById: jest.fn().mockResolvedValue({ id: USER_ID }),
      invite: jest.fn().mockResolvedValue({ id: 'new-user' }),
      updateProfile: jest.fn().mockResolvedValue({ id: USER_ID }),
      updateOutOfOffice: jest.fn().mockResolvedValue({ id: USER_ID }),
      deactivate: jest.fn().mockResolvedValue({ reassignedCount: 0, unassignedCount: 0 }),
      getUserRoles: jest.fn().mockResolvedValue([]),
      assignRoleToUser: jest.fn().mockResolvedValue(undefined),
      removeRoleFromUser: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(UserController);
  });

  afterEach(() => jest.clearAllMocks());

  it('listUsers delegates to UserService.listUsers with filters', async () => {
    await controller.listUsers(TENANT_ID, 'ACTIVE', 'unit-1', 'ahmad');
    expect(service.listUsers).toHaveBeenCalledWith(TENANT_ID, {
      status: 'ACTIVE',
      orgUnitId: 'unit-1',
      search: 'ahmad',
    });
  });

  it('getById delegates to UserService.getById', async () => {
    await controller.getById(USER_ID, TENANT_ID);
    expect(service.getById).toHaveBeenCalledWith(USER_ID, TENANT_ID);
  });

  it('invite delegates to UserService.invite', async () => {
    const dto = { email: 'a@example.com', name: 'A' };
    await controller.invite(dto, TENANT_ID, USER_ID);
    expect(service.invite).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
  });

  it('updateProfile delegates to UserService.updateProfile with actor permissions', async () => {
    const dto = { name: 'New Name' };
    await controller.updateProfile(USER_ID, dto, TENANT_ID, USER_ID, ['users:manage']);
    expect(service.updateProfile).toHaveBeenCalledWith(USER_ID, dto, TENANT_ID, USER_ID, ['users:manage']);
  });

  it('updateOutOfOffice delegates to UserService.updateOutOfOffice with actor permissions', async () => {
    const dto = { actingUserId: 'acting-1' };
    await controller.updateOutOfOffice(USER_ID, dto, TENANT_ID, USER_ID, []);
    expect(service.updateOutOfOffice).toHaveBeenCalledWith(USER_ID, dto, TENANT_ID, USER_ID, []);
  });

  it('deactivate delegates to UserService.deactivate', async () => {
    await controller.deactivate(USER_ID, TENANT_ID, 'admin-1');
    expect(service.deactivate).toHaveBeenCalledWith(USER_ID, TENANT_ID, 'admin-1');
  });

  it('getUserRoles delegates to UserService.getUserRoles', async () => {
    await controller.getUserRoles(USER_ID, TENANT_ID);
    expect(service.getUserRoles).toHaveBeenCalledWith(USER_ID, TENANT_ID);
  });

  it('assignRoleToUser delegates to UserService.assignRoleToUser', async () => {
    const dto = { roleId: 'role-1' };
    await controller.assignRoleToUser(USER_ID, dto, TENANT_ID, 'admin-1');
    expect(service.assignRoleToUser).toHaveBeenCalledWith(USER_ID, dto, TENANT_ID, 'admin-1');
  });

  it('removeRoleFromUser delegates to UserService.removeRoleFromUser', async () => {
    await controller.removeRoleFromUser(USER_ID, 'role-1', TENANT_ID, 'admin-1');
    expect(service.removeRoleFromUser).toHaveBeenCalledWith(USER_ID, 'role-1', TENANT_ID, 'admin-1');
  });
});
