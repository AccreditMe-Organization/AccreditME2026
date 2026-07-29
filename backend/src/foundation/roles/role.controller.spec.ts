import { Test, TestingModule } from '@nestjs/testing';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IRole } from './interfaces/role.interface';
import { IPermission } from './interfaces/permission.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';
const ROLE_ID = 'role-test';

const MOCK_ROLE: IRole = {
  id: ROLE_ID,
  organizationId: TENANT_ID,
  key: null,
  nameEn: 'Custom Role',
  nameAr: 'دور مخصص',
  description: null,
  isSystem: false,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  permissions: ['documents:view'],
};

const MOCK_PERMISSION: IPermission = {
  id: 'perm-1',
  module: 'documents',
  action: 'view',
  description: 'documents:view',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RoleController', () => {
  let controller: RoleController;
  let service: {
    getRoles: jest.Mock;
    getRoleById: jest.Mock;
    createRole: jest.Mock;
    updateRole: jest.Mock;
    assignPermissions: jest.Mock;
    deactivateRole: jest.Mock;
    reactivateRole: jest.Mock;
    listAllPermissions: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getRoles: jest.fn().mockResolvedValue([MOCK_ROLE]),
      getRoleById: jest.fn().mockResolvedValue(MOCK_ROLE),
      createRole: jest.fn().mockResolvedValue(MOCK_ROLE),
      updateRole: jest.fn().mockResolvedValue(MOCK_ROLE),
      assignPermissions: jest.fn().mockResolvedValue(MOCK_ROLE),
      deactivateRole: jest.fn().mockResolvedValue(undefined),
      reactivateRole: jest.fn().mockResolvedValue(undefined),
      listAllPermissions: jest.fn().mockResolvedValue([MOCK_PERMISSION]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoleController],
      providers: [{ provide: RoleService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(RoleController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getRoles ──────────────────────────────────────────────────────────────

  describe('getRoles', () => {
    it('delegates to roleService.getRoles with tenantId', async () => {
      const result = await controller.getRoles(TENANT_ID);
      expect(service.getRoles).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
    });
  });

  // ── listAllPermissions ────────────────────────────────────────────────────

  describe('listAllPermissions', () => {
    it('delegates to roleService.listAllPermissions', async () => {
      const result = await controller.listAllPermissions();
      expect(service.listAllPermissions).toHaveBeenCalled();
      expect(result).toEqual([MOCK_PERMISSION]);
    });
  });

  // ── getRoleById ───────────────────────────────────────────────────────────

  describe('getRoleById', () => {
    it('delegates to roleService.getRoleById with id and tenantId', async () => {
      const result = await controller.getRoleById(ROLE_ID, TENANT_ID);
      expect(service.getRoleById).toHaveBeenCalledWith(ROLE_ID, TENANT_ID);
      expect(result.id).toBe(ROLE_ID);
    });
  });

  // ── createRole ────────────────────────────────────────────────────────────

  describe('createRole', () => {
    it('delegates to roleService.createRole with dto, tenantId, actorId', async () => {
      const dto: CreateRoleDto = { nameEn: 'Custom Role', nameAr: 'دور مخصص' };
      const result = await controller.createRole(dto, TENANT_ID, USER_ID);
      expect(service.createRole).toHaveBeenCalledWith(dto, TENANT_ID, USER_ID);
      expect(result.id).toBe(ROLE_ID);
    });
  });

  // ── updateRole ────────────────────────────────────────────────────────────

  describe('updateRole', () => {
    it('delegates to roleService.updateRole with id, dto, tenantId, actorId', async () => {
      const dto: UpdateRoleDto = { nameEn: 'Updated Name' };
      const result = await controller.updateRole(ROLE_ID, dto, TENANT_ID, USER_ID);
      expect(service.updateRole).toHaveBeenCalledWith(ROLE_ID, dto, TENANT_ID, USER_ID);
      expect(result.id).toBe(ROLE_ID);
    });
  });

  // ── assignPermissions ─────────────────────────────────────────────────────

  describe('assignPermissions', () => {
    it('delegates to roleService.assignPermissions with id, dto, tenantId, actorId', async () => {
      const dto: AssignPermissionsDto = { permissionKeys: ['documents:view'] };
      const result = await controller.assignPermissions(ROLE_ID, dto, TENANT_ID, USER_ID);
      expect(service.assignPermissions).toHaveBeenCalledWith(ROLE_ID, dto, TENANT_ID, USER_ID);
      expect(result.id).toBe(ROLE_ID);
    });
  });

  // ── deactivateRole ────────────────────────────────────────────────────────

  describe('deactivateRole', () => {
    it('delegates to roleService.deactivateRole with id, tenantId, actorId', async () => {
      await controller.deactivateRole(ROLE_ID, TENANT_ID, USER_ID);
      expect(service.deactivateRole).toHaveBeenCalledWith(ROLE_ID, TENANT_ID, USER_ID);
    });
  });

  // ── reactivateRole ────────────────────────────────────────────────────────

  describe('reactivateRole', () => {
    it('delegates to roleService.reactivateRole with id, tenantId, actorId', async () => {
      await controller.reactivateRole(ROLE_ID, TENANT_ID, USER_ID);
      expect(service.reactivateRole).toHaveBeenCalledWith(ROLE_ID, TENANT_ID, USER_ID);
    });
  });
});
