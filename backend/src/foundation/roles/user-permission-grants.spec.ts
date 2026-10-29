import { Test } from '@nestjs/testing';
import { RoleService } from './role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UserRoleGrantSource } from './interfaces/user-role-grant.interface';

// ACC-272 — GET /users/:userId/permissions: each grant with its role's keys,
// for the read-only "A user's permissions" page.
//
// ONE query: the grants, their roles and every role's keys arrive together
// through include. Nothing is read per grant, and the union is the page's.
const ORG_A = 'org-a';
const ORG_B = 'org-b';

describe('RoleService.getUserPermissionGrants (ACC-272)', () => {
  let service: RoleService;
  let prisma: { userRole: { findMany: jest.Mock } } & Record<string, unknown>;

  const perm = (key: string) => {
    const [module, action] = key.split(':');
    return { permission: { id: `p-${key}`, module, action, description: null } };
  };
  const role = (over: Record<string, unknown> = {}) => ({
    id: 'role-qe',
    organizationId: ORG_A,
    key: null,
    nameEn: 'Quality Editor',
    nameAr: 'محرر الجودة',
    description: null,
    isSystem: false,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    rolePermissions: [perm('users:view'), perm('committees:view')],
    ...over,
  });
  const grantRow = (over: Record<string, unknown> = {}) => ({
    id: 'ur-1',
    userId: 'user-1',
    roleId: 'role-qe',
    createdAt: new Date('2026-10-03T09:00:00Z'),
    grantedViaHeadPositionId: null,
    grantedViaHeadPositionOrgUnitId: null,
    role: role(),
    ...over,
  });

  beforeEach(async () => {
    // Only userRole.findMany exists: any other read would throw, which is how
    // "one query, nothing per grant" is held, not only asserted.
    prisma = { userRole: { findMany: jest.fn().mockResolvedValue([]) } };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(RoleService);
  });

  it('makes ONE query, including each role and its keys', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      grantRow(),
      grantRow({ id: 'ur-2', roleId: 'role-uh', role: role({ id: 'role-uh', nameEn: 'Unit Head', rolePermissions: [perm('org:view')] }) }),
    ]);

    await service.getUserPermissionGrants('user-1', ORG_A);

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      }),
    );
  });

  it('returns the grant shape with its keys, module:action, sorted', async () => {
    prisma.userRole.findMany.mockResolvedValue([grantRow()]);

    const [grant] = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grant).toEqual({
      id: 'ur-1',
      role: expect.objectContaining({ id: 'role-qe', nameEn: 'Quality Editor', isActive: true }),
      grantedAt: new Date('2026-10-03T09:00:00Z'),
      source: UserRoleGrantSource.DIRECT,
      grantedViaHeadPositionId: null,
      grantedViaHeadPositionOrgUnitId: null,
      permissions: ['committees:view', 'users:view'],
    });
    // The role is mapped, never passed through with its rolePermissions.
    expect(Object.keys(grant!.role)).not.toContain('rolePermissions');
  });

  it('names where a head-position grant comes from', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      grantRow({ grantedViaHeadPositionId: 'pos-1', grantedViaHeadPositionOrgUnitId: 'unit-1' }),
      grantRow({ id: 'ur-2', grantedViaHeadPositionId: 'pos-2', grantedViaHeadPositionOrgUnitId: null }),
    ]);

    const grants = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grants.map((g) => g.source)).toEqual([
      UserRoleGrantSource.HEAD_POSITION_UNIT,
      UserRoleGrantSource.HEAD_POSITION_ORG_WIDE,
    ]);
  });

  it('includes an inactive role, marked inactive, with its stored keys', async () => {
    prisma.userRole.findMany.mockResolvedValue([grantRow({ role: role({ isActive: false }) })]);

    const [grant] = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grant!.role.isActive).toBe(false);
    expect(grant!.permissions).toEqual(['committees:view', 'users:view']);
    // No isActive filter in the query: the page decides what an inactive role gives.
    const where = prisma.userRole.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('isActive');
  });

  it('a role holding nothing gives an empty list', async () => {
    prisma.userRole.findMany.mockResolvedValue([grantRow({ role: role({ rolePermissions: [] }) })]);

    const [grant] = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grant!.permissions).toEqual([]);
  });

  it('should NOT return records belonging to a different tenant', async () => {
    await service.getUserPermissionGrants('user-1', ORG_A);

    // BOTH sides scoped, in the same where, like getUserRoles().
    expect(prisma.userRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', user: { organizationId: ORG_A }, role: { organizationId: ORG_A } },
      }),
    );
    expect(prisma.userRole.findMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user: { organizationId: ORG_B } }) }),
    );
  });
});
