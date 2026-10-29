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
  let prisma: { userRole: { findMany: jest.Mock }; orgPosition: { findMany: jest.Mock }; orgUnit: { findMany: jest.Mock } };

  // Names, in two organisations. The mocks honour the where's id list AND its
  // organizationId, as the database would, so an id from another organisation
  // is not found.
  const POSITIONS = [
    { id: 'pos-psl', organizationId: ORG_A, nameEn: 'Patient Safety Lead', nameAr: 'رئيس سلامة المرضى' },
    { id: 'pos-qd', organizationId: ORG_A, nameEn: 'Quality Director', nameAr: 'مدير الجودة' },
    { id: 'pos-foreign', organizationId: ORG_B, nameEn: 'Foreign Head', nameAr: null },
  ];
  const UNITS = [
    { id: 'unit-ps', organizationId: ORG_A, nameEn: 'Patient Safety Unit', nameAr: 'وحدة سلامة المرضى' },
    { id: 'unit-foreign', organizationId: ORG_B, nameEn: 'Foreign Ward', nameAr: null },
  ];
  const byIdsInOrg =
    (table: { id: string; organizationId: string; nameEn: string; nameAr: string | null }[]) =>
    ({ where }: { where: { id: { in: string[] }; organizationId?: string } }) =>
      Promise.resolve(
        table
          .filter((r) => where.id.in.includes(r.id) && (where.organizationId === undefined || r.organizationId === where.organizationId))
          .map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr })),
      );

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
    // Only these three reads exist: any other would throw, which is how "no
    // query per grant" is held, not only asserted.
    prisma = {
      userRole: { findMany: jest.fn().mockResolvedValue([]) },
      orgPosition: { findMany: jest.fn(byIdsInOrg(POSITIONS)) },
      orgUnit: { findMany: jest.fn(byIdsInOrg(UNITS)) },
    };
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
      headPosition: null,
      headUnit: null,
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

  // ── The head grants' names (CC-165) ─────────────────────────────────────────

  it("(a) names an acting head grant: a position and unit that are not the person's own, in one Promise.all", async () => {
    // The acting headship of Patient Safety Unit: its head position is the
    // unit's, neither the person's positionId nor their primary or acting unit.
    prisma.userRole.findMany.mockResolvedValue([
      grantRow({ id: 'ur-psr', grantedViaHeadPositionId: 'pos-psl', grantedViaHeadPositionOrgUnitId: 'unit-ps' }),
      grantRow({ id: 'ur-qe' }),
    ]);

    const [acting, direct] = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(acting!.headPosition).toEqual({ nameEn: 'Patient Safety Lead', nameAr: 'رئيس سلامة المرضى' });
    expect(acting!.headUnit).toEqual({ nameEn: 'Patient Safety Unit', nameAr: 'وحدة سلامة المرضى' });
    expect(direct!.headPosition).toBeNull();
    expect(direct!.headUnit).toBeNull();
    // Three queries in all: the grants, then one read each for the names.
    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orgPosition.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orgUnit.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orgPosition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['pos-psl'] }, organizationId: ORG_A },
      select: { id: true, nameEn: true, nameAr: true },
    });
  });

  it('reads each distinct id once, and an org-wide grant reads no unit', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      grantRow({ id: 'ur-1', grantedViaHeadPositionId: 'pos-qd', grantedViaHeadPositionOrgUnitId: null }),
      grantRow({ id: 'ur-2', grantedViaHeadPositionId: 'pos-qd', grantedViaHeadPositionOrgUnitId: null }),
    ]);

    const grants = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grants.map((g) => g.headPosition?.nameEn)).toEqual(['Quality Director', 'Quality Director']);
    expect(grants.map((g) => g.headUnit)).toEqual([null, null]);
    expect(prisma.orgPosition.findMany.mock.calls[0][0].where.id.in).toEqual(['pos-qd']);
    expect(prisma.orgUnit.findMany).not.toHaveBeenCalled();
  });

  it('(b) a person with direct grants only costs exactly one query, with no name reads', async () => {
    prisma.userRole.findMany.mockResolvedValue([grantRow(), grantRow({ id: 'ur-2' })]);

    await service.getUserPermissionGrants('user-1', ORG_A);

    expect(prisma.userRole.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orgPosition.findMany).not.toHaveBeenCalled();
    expect(prisma.orgUnit.findMany).not.toHaveBeenCalled();
  });

  it('(c) should NOT return records belonging to a different tenant: a foreign position or unit id is named null', async () => {
    prisma.userRole.findMany.mockResolvedValue([
      grantRow({ id: 'ur-x', grantedViaHeadPositionId: 'pos-foreign', grantedViaHeadPositionOrgUnitId: 'unit-foreign' }),
    ]);

    const [grant] = await service.getUserPermissionGrants('user-1', ORG_A);

    expect(grant!.headPosition).toBeNull();
    expect(grant!.headUnit).toBeNull();
    // Both name reads are scoped to this organisation.
    expect(prisma.orgPosition.findMany.mock.calls[0][0].where.organizationId).toBe(ORG_A);
    expect(prisma.orgUnit.findMany.mock.calls[0][0].where.organizationId).toBe(ORG_A);
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
