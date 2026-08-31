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
    getByIdForViewer: jest.Mock;
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
      getByIdForViewer: jest.fn().mockResolvedValue({ id: USER_ID }),
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

  it('getById delegates to UserService.getByIdForViewer with actor context', async () => {
    await controller.getById(USER_ID, TENANT_ID, USER_ID, ['users:view']);
    expect(service.getByIdForViewer).toHaveBeenCalledWith(USER_ID, TENANT_ID, USER_ID, ['users:view']);
  });

  it('invite delegates to UserService.invite', async () => {
    const dto = { email: 'a@example.com', name: 'A', positionId: 'pos-1' };
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

  // ACC-45 — regression coverage for the toSafeUser() mapping wired into
  // listUsers()/getById()/invite(). The service mock is deliberately given
  // the FULL, unfiltered row shape (including invitationToken and other
  // internal-only fields UserService's real Prisma calls actually return)
  // so these tests exercise the real toSafeUser() mapping, not a mock —
  // if the controller stopped calling it, these would fail.
  describe('sensitive-field stripping (ACC-45)', () => {
    const RAW_USER_WITH_SECRETS = {
      id: USER_ID,
      organizationId: TENANT_ID,
      email: 'a@example.com',
      name: 'A',
      avatarUrl: null,
      status: 'ACTIVE',
      language: 'en',
      positionId: null,
      primaryOrgUnitId: null,
      managerId: null,
      outOfOfficeFrom: null,
      outOfOfficeTo: null,
      actingUserId: null,
      actingOrgUnitId: null,
      actingOrgUnitUntil: null,
      lastLoginAt: null,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      // Internal-only — must never reach the HTTP response.
      invitationToken: 'raw-invitation-secret',
      invitationExpiresAt: new Date('2026-01-08'),
      authUserId: 'auth-user-1',
      tokenVersion: 3,
      lastLoginIp: '203.0.113.5',
      hijriDisplay: false,
      tosAcceptedAt: null,
      tosVersion: null,
    };

    const SENSITIVE_FIELDS = [
      'invitationToken',
      'invitationExpiresAt',
      'authUserId',
      'tokenVersion',
      'lastLoginIp',
      'hijriDisplay',
      'tosAcceptedAt',
      'tosVersion',
    ] as const;

    it('listUsers strips invitationToken and every other internal-only field from each returned user', async () => {
      service.listUsers.mockResolvedValue([RAW_USER_WITH_SECRETS]);
      const result = await controller.listUsers(TENANT_ID);
      const [mapped] = result;
      for (const field of SENSITIVE_FIELDS) expect(mapped).not.toHaveProperty(field);
      expect(mapped?.id).toBe(USER_ID);
      expect(mapped?.email).toBe('a@example.com');
    });

    it('getById strips invitationToken and every other internal-only field', async () => {
      service.getByIdForViewer.mockResolvedValue(RAW_USER_WITH_SECRETS);
      const result = await controller.getById(USER_ID, TENANT_ID, USER_ID, ['users:view']);
      for (const field of SENSITIVE_FIELDS) expect(result).not.toHaveProperty(field);
      expect(result.id).toBe(USER_ID);
    });

    it('invite strips invitationToken and every other internal-only field', async () => {
      service.invite.mockResolvedValue(RAW_USER_WITH_SECRETS);
      const dto = { email: 'a@example.com', name: 'A', positionId: 'pos-1' };
      const result = await controller.invite(dto, TENANT_ID, USER_ID);
      for (const field of SENSITIVE_FIELDS) expect(result).not.toHaveProperty(field);
      // Belt-and-suspenders: confirm the raw secret value isn't reachable
      // anywhere in the serialized response, not just absent under its own key.
      expect(JSON.stringify(result)).not.toContain('raw-invitation-secret');
    });

    it('updateProfile strips invitationToken and every other internal-only field', async () => {
      service.updateProfile.mockResolvedValue(RAW_USER_WITH_SECRETS);
      const dto = { name: 'New Name' };
      const result = await controller.updateProfile(USER_ID, dto, TENANT_ID, USER_ID, ['users:manage']);
      for (const field of SENSITIVE_FIELDS) expect(result).not.toHaveProperty(field);
      expect(result.id).toBe(USER_ID);
    });

    it('updateOutOfOffice strips invitationToken and every other internal-only field', async () => {
      service.updateOutOfOffice.mockResolvedValue(RAW_USER_WITH_SECRETS);
      const dto = { actingUserId: 'acting-1' };
      const result = await controller.updateOutOfOffice(USER_ID, dto, TENANT_ID, USER_ID, []);
      for (const field of SENSITIVE_FIELDS) expect(result).not.toHaveProperty(field);
      expect(result.id).toBe(USER_ID);
    });
  });
});
