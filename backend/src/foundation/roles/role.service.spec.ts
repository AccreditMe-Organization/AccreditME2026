import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RoleService } from './role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ALL_PERMISSIONS } from './permission.seed';
import { SYSTEM_ROLE_SEED } from './role.seed';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';

const BASE_ROLE = {
  id: 'role-1',
  organizationId: ORG_A,
  key: null as string | null,
  nameEn: 'Quality Manager',
  nameAr: 'مدير الجودة',
  description: 'Manages quality processes',
  isSystem: false,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_PERMISSION = {
  id: 'perm-1',
  module: 'documents',
  action: 'view',
  description: 'documents:view',
};

const makeRole = (overrides: Partial<typeof BASE_ROLE> = {}) => ({
  ...BASE_ROLE,
  ...overrides,
});

const makePermission = (overrides: Partial<typeof BASE_PERMISSION> = {}) => ({
  ...BASE_PERMISSION,
  ...overrides,
});

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  role: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
  },
  permission: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  userRole: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  rolePermission: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RoleService', () => {
  let service: RoleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.rolePermission.findMany.mockResolvedValue([]);
    mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<RoleService>(RoleService);
  });

  // ── seedPermissions ───────────────────────────────────────────────────────────

  describe('seedPermissions', () => {
    it('upserts every constant from permissions.ts exactly once', async () => {
      mockPrisma.permission.upsert.mockResolvedValue(BASE_PERMISSION);

      await service.seedPermissions();

      expect(mockPrisma.permission.upsert).toHaveBeenCalledTimes(ALL_PERMISSIONS.length);
      expect(mockPrisma.permission.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { module_action: { module: expect.any(String), action: expect.any(String) } },
        }),
      );
    });
  });

  // ── seedSystemRoles ───────────────────────────────────────────────────────────

  describe('seedSystemRoles', () => {
    it('creates all 7 system roles with their RolePermission rows for a fresh org', async () => {
      mockPrisma.permission.upsert.mockResolvedValue(BASE_PERMISSION);
      mockPrisma.permission.findMany.mockResolvedValue(
        ALL_PERMISSIONS.map((p, i) => ({ id: `perm-${i}`, ...p })),
      );
      mockPrisma.role.upsert.mockImplementation(({ create }) =>
        Promise.resolve(makeRole({ id: `role-${create.key}`, key: create.key, isSystem: true })),
      );

      await service.seedSystemRoles(ORG_A);

      expect(mockPrisma.role.upsert).toHaveBeenCalledTimes(SYSTEM_ROLE_SEED.length);
      expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
      // Only upsert is ever used to persist roles during seeding — never a direct create,
      // which is what makes repeated seeding idempotent against a real database.
      expect(mockPrisma.role.create).not.toHaveBeenCalled();
    });

    it('is idempotent — calling twice produces no duplicate roles or assignments', async () => {
      mockPrisma.permission.upsert.mockResolvedValue(BASE_PERMISSION);
      mockPrisma.permission.findMany.mockResolvedValue(
        ALL_PERMISSIONS.map((p, i) => ({ id: `perm-${i}`, ...p })),
      );
      mockPrisma.role.upsert.mockImplementation(({ create }) =>
        Promise.resolve(makeRole({ id: `role-${create.key}`, key: create.key, isSystem: true })),
      );

      await service.seedSystemRoles(ORG_A);
      await service.seedSystemRoles(ORG_A);

      expect(mockPrisma.role.upsert).toHaveBeenCalledTimes(SYSTEM_ROLE_SEED.length * 2);
      expect(mockPrisma.role.create).not.toHaveBeenCalled();
      // Each seeding pass clears and re-creates RolePermission rows for a role,
      // rather than appending — so a second pass cannot leave duplicates behind.
      expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalledTimes(
        SYSTEM_ROLE_SEED.length * 2,
      );
    });
  });

  // ── getRoles ──────────────────────────────────────────────────────────────────

  describe('getRoles', () => {
    it('returns roles scoped to the tenant', async () => {
      mockPrisma.role.findMany.mockResolvedValue([BASE_ROLE]);

      const result = await service.getRoles(ORG_A);

      expect(result).toHaveLength(1);
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A } }),
      );
    });

    it('filters out PLATFORM_ADMIN for a non-platform organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
      mockPrisma.role.findMany.mockResolvedValue([
        makeRole({ key: 'PLATFORM_ADMIN', nameEn: 'Platform Administrator' }),
        makeRole({ key: 'TENANT_ADMIN', nameEn: 'Organization Administrator' }),
      ]);

      const result = await service.getRoles(ORG_A);

      expect(result.map((r) => r.key)).toEqual(['TENANT_ADMIN']);
    });

    it('includes PLATFORM_ADMIN for the designated platform organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: true });
      mockPrisma.role.findMany.mockResolvedValue([
        makeRole({ key: 'PLATFORM_ADMIN', nameEn: 'Platform Administrator' }),
        makeRole({ key: 'TENANT_ADMIN', nameEn: 'Organization Administrator' }),
      ]);

      const result = await service.getRoles(ORG_A);

      expect(result.map((r) => r.key).sort()).toEqual(['PLATFORM_ADMIN', 'TENANT_ADMIN']);
    });
  });

  // ── getRoleById ───────────────────────────────────────────────────────────────

  describe('getRoleById', () => {
    it('returns the role with its permissions when found', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.rolePermission.findMany.mockResolvedValue([
        { permission: makePermission({ module: 'documents', action: 'view' }) },
      ]);

      const result = await service.getRoleById('role-1', ORG_A);

      expect(result.permissions).toEqual(['documents:view']);
    });

    it('throws NotFoundException when role does not exist for this tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(service.getRoleById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createRole ────────────────────────────────────────────────────────────────

  describe('createRole', () => {
    it('always creates with key=null and isSystem=false', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      mockPrisma.role.create.mockResolvedValue(BASE_ROLE);

      await service.createRole(
        { nameEn: 'Custom Role', nameAr: 'دور مخصص' },
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.role.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ key: null, isSystem: false, organizationId: ORG_A }),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'Role', tenantId: ORG_A }),
      );
    });

    it('throws ConflictException on duplicate nameEn within the same org', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);

      await expect(
        service.createRole({ nameEn: 'Quality Manager', nameAr: 'مدير الجودة' }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.role.create).not.toHaveBeenCalled();
    });
  });

  // ── updateRole ────────────────────────────────────────────────────────────────

  describe('updateRole', () => {
    it('updates nameEn/nameAr/description on a system role — proves system roles are editable', async () => {
      const systemRole = makeRole({ key: 'AUDITOR', isSystem: true });
      mockPrisma.role.findFirst
        .mockResolvedValueOnce(systemRole) // load
        .mockResolvedValueOnce(null); // duplicate-name check
      mockPrisma.role.update.mockResolvedValue({ ...systemRole, nameEn: 'Lead Auditor' });

      const result = await service.updateRole(
        'role-1',
        { nameEn: 'Lead Auditor' },
        ORG_A,
        ACTOR,
      );

      expect(result.nameEn).toBe('Lead Auditor');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'Role', tenantId: ORG_A }),
      );
    });

    it('throws NotFoundException when role does not exist for this tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(
        service.updateRole('missing', { nameEn: 'X' }, ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── assignPermissions ─────────────────────────────────────────────────────────

  describe('assignPermissions', () => {
    it('replaces the full permission set for the role', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.permission.findMany.mockResolvedValue([
        makePermission({ id: 'perm-1', module: 'documents', action: 'view' }),
        makePermission({ id: 'perm-2', module: 'documents', action: 'create' }),
      ]);

      await service.assignPermissions(
        'role-1',
        { permissionKeys: ['documents:view', 'documents:create'] },
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1' },
      });
      expect(mockPrisma.rolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { roleId: 'role-1', permissionId: 'perm-1' },
          { roleId: 'role-1', permissionId: 'perm-2' },
        ],
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'RolePermission',
          after: { permissions: ['documents:view', 'documents:create'] },
        }),
      );
    });

    it('throws NotFoundException for an unknown permission key', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.permission.findMany.mockResolvedValue([]);

      await expect(
        service.assignPermissions(
          'role-1',
          { permissionKeys: ['nonexistent:action'] },
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ── deactivateRole / reactivateRole — admin lockout protection ───────────────

  describe('deactivateRole', () => {
    it('deactivates a non-admin role and writes audit log', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.role.update.mockResolvedValue({ ...BASE_ROLE, isActive: false });

      await service.deactivateRole('role-1', ORG_A, ACTOR);

      expect(mockPrisma.role.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });

    it('throws ConflictException deactivating the tenant\'s only assigned TENANT_ADMIN role', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      mockPrisma.role.findFirst.mockResolvedValue(adminRole);
      mockPrisma.userRole.count.mockResolvedValue(1);

      await expect(service.deactivateRole('role-1', ORG_A, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.role.update).not.toHaveBeenCalled();
    });

    it('allows deactivating TENANT_ADMIN when no users are assigned to it', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      mockPrisma.role.findFirst.mockResolvedValue(adminRole);
      mockPrisma.userRole.count.mockResolvedValue(0);
      mockPrisma.role.update.mockResolvedValue({ ...adminRole, isActive: false });

      await service.deactivateRole('role-1', ORG_A, ACTOR);

      expect(mockPrisma.role.update).toHaveBeenCalled();
    });

    it('throws NotFoundException when role does not exist for this tenant', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(service.deactivateRole('missing', ORG_A, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getUserPermissions ────────────────────────────────────────────────────────

  describe('getUserPermissions', () => {
    it('returns the deduplicated union of permissions across multiple assigned roles', async () => {
      mockPrisma.userRole.findMany.mockResolvedValue([
        {
          role: {
            rolePermissions: [
              { permission: makePermission({ module: 'documents', action: 'view' }) },
              { permission: makePermission({ module: 'tasks', action: 'view' }) },
            ],
          },
        },
        {
          role: {
            rolePermissions: [
              { permission: makePermission({ module: 'documents', action: 'view' }) }, // duplicate
              { permission: makePermission({ module: 'audits', action: 'view' }) },
            ],
          },
        },
      ]);

      const result = await service.getUserPermissions('user-1', ORG_A);

      expect(result.sort()).toEqual(['audits:view', 'documents:view', 'tasks:view'].sort());
    });

    it('only queries active roles scoped to the tenant — deactivated or cross-tenant roles contribute nothing', async () => {
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.getUserPermissions('user-1', ORG_A);

      expect(mockPrisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: { isActive: true, organizationId: ORG_A },
          }),
        }),
      );
    });
  });

  // ── removeRoleFromUser — admin lockout protection ────────────────────────────

  describe('removeRoleFromUser', () => {
    it('removes a non-last assignment and writes audit log', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', userId: 'user-1', roleId: 'role-1' });

      await service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.delete).toHaveBeenCalledWith({ where: { id: 'ur-1' } });
    });

    it('throws ConflictException when removing the last TENANT_ADMIN assignment', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      mockPrisma.role.findFirst.mockResolvedValue(adminRole);
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', userId: 'user-1', roleId: 'role-1' });
      mockPrisma.userRole.count.mockResolvedValue(1);

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.userRole.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the assignment does not exist', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── grantRoleViaHeadAuthority / revokeRoleViaHeadAuthority (ACC-40 Section 2.6.5) ──

  describe('grantRoleViaHeadAuthority', () => {
    it('creates a marked UserRole row and writes audit log when the user holds nothing yet', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roleId: 'role-1', grantedViaHeadPositionOrgUnitId: 'unit-1' },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, actorId: ACTOR, action: 'CREATE', objectType: 'UserRole' }),
      );
    });

    // The hard requirement: UserRole carries @@unique([userId, roleId]) —
    // blindly creating here would throw a Prisma unique-constraint
    // violation, not silently succeed.
    it('does not create a duplicate row, and does not mark anything, when the user already independently holds the role', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue({
        id: 'ur-existing', userId: 'user-1', roleId: 'role-1', grantedViaHeadPositionOrgUnitId: null,
      });

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('is idempotent — does not create a duplicate when the role was already granted via this exact mechanism', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue({
        id: 'ur-existing', userId: 'user-1', roleId: 'role-1', grantedViaHeadPositionOrgUnitId: 'unit-1',
      });

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
    });

    it('accepts a null actorId (system-triggered grant) without throwing, recording actorId as undefined in the audit log', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_A, null);

      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }));
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.userRole.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.user.organizationId === ORG_A ? { id: 'ur-a' } : null),
      );

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_A, ACTOR);
      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'unit-1', ORG_B, ACTOR);

      expect(mockPrisma.userRole.findFirst).toHaveBeenNthCalledWith(1, {
        where: { userId: 'user-1', roleId: 'role-1', user: { organizationId: ORG_A } },
      });
      expect(mockPrisma.userRole.findFirst).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1', roleId: 'role-1', user: { organizationId: ORG_B } },
      });
      // ORG_A's lookup found a row (no create); ORG_B's found nothing (create fires) —
      // proves the two calls are genuinely scoped independently, not sharing state.
      expect(mockPrisma.userRole.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('revokeRoleViaHeadAuthority', () => {
    it('deletes the marked row and writes audit log when one exists', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', grantedViaHeadPositionOrgUnitId: 'unit-1', user: { organizationId: ORG_A } },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, actorId: ACTOR, action: 'DELETE', objectType: 'UserRole' }),
      );
    });

    it('is a silent no-op — no audit log — when nothing was ever granted via this mechanism', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_A, ACTOR);

      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('only ever targets rows matching the exact grantedViaHeadPositionOrgUnitId marker — an independently-held role for the same user is never included in the delete filter', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_A, ACTOR);

      const call = mockPrisma.userRole.deleteMany.mock.calls[0][0];
      expect(call.where.grantedViaHeadPositionOrgUnitId).toBe('unit-1');
      expect(call.where).not.toHaveProperty('roleId'); // matches purely on the marker, not a specific role
    });

    it('accepts a null actorId (system-triggered revoke) without throwing', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_A, null);

      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }));
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.userRole.deleteMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.user.organizationId === ORG_A ? { count: 1 } : { count: 0 }),
      );

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_A, ACTOR);
      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', ORG_B, ACTOR);

      expect(mockPrisma.userRole.deleteMany).toHaveBeenNthCalledWith(1, {
        where: { userId: 'user-1', grantedViaHeadPositionOrgUnitId: 'unit-1', user: { organizationId: ORG_A } },
      });
      expect(mockPrisma.userRole.deleteMany).toHaveBeenNthCalledWith(2, {
        where: { userId: 'user-1', grantedViaHeadPositionOrgUnitId: 'unit-1', user: { organizationId: ORG_B } },
      });
    });
  });

  // ── Live-run proof: getUserPermissions() requires ZERO code changes ────────
  //
  // ACC-40 Section 2.6.5's own explicit requirement — not just asserted, a
  // real run. A single in-memory array simulates the UserRole table,
  // shared by BOTH grantRoleViaHeadAuthority()'s create() and
  // getUserPermissions()'s own findMany() — proving the union logic
  // naturally picks up a newly-granted row with no changes to
  // getUserPermissions() itself.

  describe('grantRoleViaHeadAuthority -> getUserPermissions (live-run proof, ACC-40 Section 2.6.5)', () => {
    it('a freshly granted head-authority role is immediately visible in getUserPermissions()\'s permission union', async () => {
      const persistedUserRoles: { userId: string; roleId: string; grantedViaHeadPositionOrgUnitId: string | null }[] = [];

      mockPrisma.userRole.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(persistedUserRoles.find((ur) => ur.userId === where.userId && ur.roleId === where.roleId) ?? null),
      );
      mockPrisma.userRole.create.mockImplementation(({ data }: any) => {
        persistedUserRoles.push(data);
        return Promise.resolve(data);
      });
      // getUserPermissions() queries with an `include`, not a plain row —
      // this mock reconstructs the shape it expects from whatever's
      // currently in the same persistedUserRoles array, keeping both
      // methods reading from ONE shared source of truth.
      mockPrisma.userRole.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(
          persistedUserRoles
            .filter((ur) => ur.userId === where.userId)
            .map(() => ({
              role: {
                rolePermissions: [{ permission: makePermission({ module: 'committees', action: 'manage' }) }],
              },
            })),
        ),
      );

      // Before the grant: no permissions.
      expect(await service.getUserPermissions('user-1', ORG_A)).toEqual([]);

      await service.grantRoleViaHeadAuthority('user-1', 'role-head', 'unit-1', ORG_A, ACTOR);

      // After the grant, with no change to getUserPermissions() itself:
      // the new row is already part of the union.
      expect(await service.getUserPermissions('user-1', ORG_A)).toEqual(['committees:manage']);
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return records belonging to a different tenant', async () => {
      const roleA = makeRole({ id: 'role-a', organizationId: ORG_A });
      const roleB = makeRole({ id: 'role-b', organizationId: ORG_B });

      mockPrisma.role.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string } }) => {
          if (where.organizationId === ORG_A) return Promise.resolve([roleA]);
          return Promise.resolve([roleB]);
        },
      );

      const resultA = await service.getRoles(ORG_A);
      const resultB = await service.getRoles(ORG_B);

      expect(resultA.map((r) => r.id)).toEqual(['role-a']);
      expect(resultB.map((r) => r.id)).toEqual(['role-b']);
    });

    it('should NOT allow assigning a role belonging to a different tenant to a user', async () => {
      // findFirst is always scoped by { id, organizationId } — a role created under
      // ORG_A is invisible to a lookup scoped to ORG_B, so it resolves to null.
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(
        service.assignRoleToUser(
          'user-in-org-b',
          { roleId: 'role-belonging-to-org-a' },
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
    });

    it('getUserPermissions should NOT resolve permissions from a role belonging to a different tenant', async () => {
      mockPrisma.userRole.findMany.mockResolvedValue([]);

      await service.getUserPermissions('user-1', ORG_A);

      // Regression guard for the missing-organizationId bug: the query must
      // scope the role relation by the caller's tenant, not just by userId.
      expect(mockPrisma.userRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: expect.objectContaining({ organizationId: ORG_A }),
          }),
        }),
      );
    });
  });
});
