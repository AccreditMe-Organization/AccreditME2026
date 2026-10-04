import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RoleService } from './role.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { ALL_PERMISSIONS } from './permission.seed';
import { SYSTEM_ROLE_SEED } from './role.seed';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

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
    // ACC-78 — getRoles() counts alongside the page.
    count: jest.fn(),
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
    // ACC-120 — getRoles() resolves every role's ACTIVE-holder count in one
    // grouped query, the same shape as the permission count.
    groupBy: jest.fn(),
  },
  rolePermission: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    // ACC-74 — getRoles() resolves every role's permission count in one
    // grouped query rather than a findMany per role.
    groupBy: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
    // ACC-120 — the invariant reads isPlatformOrg to exclude the platform org.
    findFirst: jest.fn(),
  },
  // ACC-120 — the mutations that can break the root-role invariant now commit
  // inside a transaction with the assertion. The callback is handed this same
  // mock, so a test configures tx behaviour exactly as it always configured
  // prisma behaviour, and a throw from the assertion propagates the way a real
  // rollback does.
  $transaction: jest.fn(),
};

const mockAuditLog = { log: jest.fn() };
// ─── ACC-120: a STATEFUL fake for the root-role invariant ─────────────────────
//
// A flat mock cannot express this change, and the way it fails is silent. The
// assertion runs AFTER the mutation and compares against a baseline captured
// BEFORE it, so both reads go through the same mock; a static value makes
// before and after identical, the invariant concludes "this tenant was already
// in breach", and it ALLOWS EVERYTHING. A test written that way passes while
// asserting nothing.
//
// So the fake lets the mutation move the number, which is the only way a test
// can tell a refusal from a permission.
function stageAdministrators(opts: {
  actedOnRole: ReturnType<typeof makeRole>;
  rootRoleActive?: boolean;
  activeHolders: number;
}): { holders: () => number } {
  let rootActive = opts.rootRoleActive ?? true;
  let holders = opts.activeHolders;

  mockPrisma.role.findFirst.mockImplementation((args: { where: { key?: string } }) =>
    // No key in the where clause => the service looking up the role it was
    // asked to act on. A key => the invariant's own read, which also requires
    // isActive and therefore must see the deactivation.
    Promise.resolve(
      args.where.key === undefined ? opts.actedOnRole : rootActive ? opts.actedOnRole : null,
    ),
  );
  mockPrisma.userRole.count.mockImplementation(() => Promise.resolve(holders));

  mockPrisma.role.update.mockImplementation((args: { data: { isActive?: boolean } }) => {
    if (args.data.isActive === false) rootActive = false;
    return Promise.resolve({ ...opts.actedOnRole, isActive: args.data.isActive ?? true });
  });
  mockPrisma.userRole.delete.mockImplementation(() => {
    holders -= 1;
    return Promise.resolve({ id: 'ur-1' });
  });

  return { holders: () => holders };
}


// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RoleService', () => {
  let service: RoleService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.rolePermission.findMany.mockResolvedValue([]);
    mockPrisma.rolePermission.groupBy.mockResolvedValue([]);
    mockPrisma.userRole.groupBy.mockResolvedValue([]);
    mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
    mockPrisma.organization.findFirst.mockResolvedValue({ isPlatformOrg: false });
    // ACC-120 defaults: the tenant has an administrator before and after. A
    // test about the invariant overrides role.findFirst / userRole.count itself.
    mockPrisma.userRole.count.mockResolvedValue(1);
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma),
    );

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

      // ACC-78 — the envelope, not a bare array.
      expect(result.data).toHaveLength(1);
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    // ACC-78 — these two used to assert that the application filtered
    // PLATFORM_ADMIN out of the query's results. It is now excluded in the
    // WHERE clause instead, so they assert the clause.
    //
    // The change is a correctness fix, not a refactor: a post-query filter and
    // a database-side count cannot agree. Filtering after the fact would return
    // 24 rows for a page of 25 whenever PLATFORM_ADMIN fell inside it, and
    // count() would include a role the caller can never see — so both the total
    // and the page count would be wrong.
    it('excludes PLATFORM_ADMIN in the query for a non-platform organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
      mockPrisma.role.findMany.mockResolvedValue([makeRole({ key: 'TENANT_ADMIN' })]);

      const result = await service.getRoles(ORG_A);

      const where = mockPrisma.role.findMany.mock.calls[0]![0].where;
      expect(where.AND).toContainEqual({
        OR: [{ key: null }, { key: { not: 'PLATFORM_ADMIN' } }],
      });
      expect(result.data.map((r) => r.key)).toEqual(['TENANT_ADMIN']);
    });

    // ACC-123 — the null branch, asserted on its own because its absence was a
    // real defect and this suite did not catch it.
    //
    // BE HONEST ABOUT WHAT THIS PROVES. mockPrisma returns whatever the test
    // hands it, so no assertion here can show what Postgres does with
    // `key <> 'PLATFORM_ADMIN'` when key is NULL. It answers NULL, not true,
    // and the row is dropped — which is why every tenant-created role was
    // missing from the Roles screen while these specs stayed green.
    //
    // That was MEASURED against the dev database, both spellings
    // (`key: { not: X }` and `NOT: { key: X }`), each returning the six system
    // roles and neither custom one. What this test can do is pin the shape
    // that measurement settled on, so it is not quietly simplified back.
    it('includes roles with NO key — a custom role is not PLATFORM_ADMIN', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
      mockPrisma.role.findMany.mockResolvedValue([]);

      await service.getRoles(ORG_A);

      const clause = (
        mockPrisma.role.findMany.mock.calls[0]![0].where.AND as unknown[]
      ).find((c) => JSON.stringify(c).includes('PLATFORM_ADMIN'));

      expect(clause).toEqual({
        OR: [{ key: null }, { key: { not: 'PLATFORM_ADMIN' } }],
      });
    });

    // The two clauses are each a disjunction, and one object holds one `OR`.
    // Spread side by side, the search clause REPLACES the platform exclusion —
    // so searching would put PLATFORM_ADMIN back into an ordinary tenant's
    // list. Both must survive together.
    it('keeps the PLATFORM_ADMIN exclusion when a search term is also applied', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
      mockPrisma.role.findMany.mockResolvedValue([]);

      await service.getRoles(ORG_A, { search: 'admin' });

      const and = mockPrisma.role.findMany.mock.calls[0]![0].where.AND as unknown[];
      expect(and).toContainEqual({
        OR: [{ key: null }, { key: { not: 'PLATFORM_ADMIN' } }],
      });
      expect(JSON.stringify(and)).toContain('nameAr');
    });

    it('does not exclude PLATFORM_ADMIN for the designated platform organization', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: true });
      mockPrisma.role.findMany.mockResolvedValue([
        makeRole({ key: 'PLATFORM_ADMIN' }),
        makeRole({ key: 'TENANT_ADMIN' }),
      ]);

      const result = await service.getRoles(ORG_A);

      expect(
        JSON.stringify(mockPrisma.role.findMany.mock.calls[0]![0].where),
      ).not.toContain('PLATFORM_ADMIN');
      expect(result.data.map((r) => r.key).sort()).toEqual(['PLATFORM_ADMIN', 'TENANT_ADMIN']);
    });

    // The exclusion must reach the COUNT too, or the paginator reports a total
    // that includes a row the caller can never be shown.
    it('applies the PLATFORM_ADMIN exclusion to the count as well as the page', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ isPlatformOrg: false });
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.getRoles(ORG_A);

      const findWhere = mockPrisma.role.findMany.mock.calls[0]![0].where;
      const countWhere = mockPrisma.role.count.mock.calls[0]![0].where;
      expect(countWhere).toEqual(findWhere);
      expect(countWhere.AND).toContainEqual({
        OR: [{ key: null }, { key: { not: 'PLATFORM_ADMIN' } }],
      });
    });

    // ACC-74 — the Roles list rendered 0 for every role because getRoles()
    // returned no permission data at all. These assert the count is real,
    // and that it is resolved the intended way.
    it('returns each role real permission count', async () => {
      const admin = makeRole({ id: 'role-admin', key: 'TENANT_ADMIN' });
      const viewer = makeRole({ id: 'role-viewer', key: 'VIEWER' });
      mockPrisma.role.findMany.mockResolvedValue([admin, viewer]);
      mockPrisma.rolePermission.groupBy.mockResolvedValue([
        { roleId: 'role-admin', _count: { roleId: 70 } },
        { roleId: 'role-viewer', _count: { roleId: 13 } },
      ]);

      const result = await service.getRoles(ORG_A);

      expect(result.data.find((r) => r.id === 'role-admin')?.permissionCount).toBe(70);
      expect(result.data.find((r) => r.id === 'role-viewer')?.permissionCount).toBe(13);
    });

    // A role with no permissions is a real answer, not a missing one — the
    // frontend must be able to tell 0 from "never loaded".
    it('reports 0 for a role with no permissions, not undefined', async () => {
      mockPrisma.role.findMany.mockResolvedValue([makeRole({ id: 'role-empty' })]);
      mockPrisma.rolePermission.groupBy.mockResolvedValue([]);

      const result = await service.getRoles(ORG_A);

      expect(result.data[0]!.permissionCount).toBe(0);
      expect(result.data[0]!.permissionCount).not.toBeUndefined();
    });

    // The shape decision, asserted so it cannot quietly regress into an N+1.
    // ACC-120 — the number the Manage roles dialog needs in order to lock the
    // root role's row for its last active holder rather than offering a save
    // the server refuses.
    it('reports each role ACTIVE holder count, joined to User', async () => {
      mockPrisma.role.findMany.mockResolvedValue([makeRole({ id: 'role-1' })]);
      mockPrisma.role.count.mockResolvedValue(1);
      mockPrisma.userRole.groupBy.mockResolvedValue([
        { roleId: 'role-1', _count: { roleId: 3 } },
      ]);

      const result = await service.getRoles(ORG_A, {});

      expect(result.data[0]!.activeHolderCount).toBe(3);
      // The join is the point: a raw assignment count would tell the dialog a
      // deactivated user still covers the tenant.
      expect(mockPrisma.userRole.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { organizationId: ORG_A, status: 'ACTIVE' },
          }),
        }),
      );
    });

    it('reports 0 active holders for a role nobody holds, not undefined', async () => {
      mockPrisma.role.findMany.mockResolvedValue([makeRole({ id: 'role-1' })]);
      mockPrisma.role.count.mockResolvedValue(1);
      mockPrisma.userRole.groupBy.mockResolvedValue([]);

      const result = await service.getRoles(ORG_A, {});

      expect(result.data[0]!.activeHolderCount).toBe(0);
    });

    it('resolves every count in ONE grouped query, never one per role', async () => {
      mockPrisma.role.findMany.mockResolvedValue([
        makeRole({ id: 'r1' }),
        makeRole({ id: 'r2' }),
        makeRole({ id: 'r3' }),
      ]);
      mockPrisma.rolePermission.groupBy.mockResolvedValue([]);

      await service.getRoles(ORG_A);

      expect(mockPrisma.rolePermission.groupBy).toHaveBeenCalledTimes(1);
      // attachPermissions()' per-role fetch must not be what backs this.
      expect(mockPrisma.rolePermission.findMany).not.toHaveBeenCalled();
    });

    // ACC-78 — an empty page skips the grouped query entirely. `roleId: { in: [] }`
    // is a guaranteed-empty result that still costs a round trip, and under
    // pagination an empty page is now a routine occurrence rather than an edge
    // case (any page past the last one).
    it('makes no grouped query at all for an empty page', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.getRoles(ORG_A, { page: 99 });

      expect(mockPrisma.rolePermission.groupBy).not.toHaveBeenCalled();
    });

    // The list renders a number; it must not also ship the whole set.
    it('does not populate the full permissions array on list responses', async () => {
      mockPrisma.role.findMany.mockResolvedValue([makeRole({ id: 'r1' })]);
      mockPrisma.rolePermission.groupBy.mockResolvedValue([
        { roleId: 'r1', _count: { roleId: 70 } },
      ]);

      const result = await service.getRoles(ORG_A);

      expect(result.data[0]!.permissionCount).toBe(70);
      expect(result.data[0]!.permissions).toBeUndefined();
    });

    // ── ACC-78: pagination, bilingual search, compound sort ────────────────

    it('returns the envelope with total from count()', async () => {
      mockPrisma.role.findMany.mockResolvedValue([BASE_ROLE]);
      mockPrisma.role.count.mockResolvedValue(9);

      const result = await service.getRoles(ORG_A, { page: 2, pageSize: 5 });

      expect(result).toMatchObject({ total: 9, page: 2, pageSize: 5 });
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5 }),
      );
    });

    // A role's Arabic name is not a translation of a search term — it is the
    // name an Arabic-speaking admin knows it by. Searching only nameEn would
    // make the Arabic UI's search box quietly useless.
    it('searches BOTH bilingual names', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.getRoles(ORG_A, { search: 'جودة' });

      // ACC-123 — under AND now, so that the search clause and the
      // platform-role exclusion can both apply. Before, each was an `OR` key
      // on one object and the second silently won.
      expect(mockPrisma.role.findMany.mock.calls[0]![0].where.AND).toContainEqual({
        OR: [
          { nameEn: { contains: 'جودة', mode: 'insensitive' } },
          { nameAr: { contains: 'جودة', mode: 'insensitive' } },
        ],
      });
    });

    // The compound default: system roles first, then alphabetical. It predates
    // this ticket and is a real UX property — a single-column fallback would
    // have dropped the grouping silently.
    it('defaults to the compound order — system roles first, then alphabetical', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.getRoles(ORG_A, {});

      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ isSystem: 'desc' }, { nameEn: 'asc' }] }),
      );
    });

    // Both bilingual names are sortable rather than one synthetic "name", so
    // the sort matches whichever name the reader is actually looking at.
    //
    // ACC-160 — nameAr can be NULL now, and a role with no Arabic name sorts
    // LAST in BOTH directions (Postgres's own default puts NULLs first on DESC).
    // nameEn is required and keeps a bare direction: that half is the boundary,
    // proving the option is opt-in per column rather than applied to every sort.
    it.each(['asc', 'desc'] as const)(
      'sorts by the Arabic name %s with unnamed roles last',
      async (sortDir) => {
        mockPrisma.role.findMany.mockResolvedValue([]);
        mockPrisma.role.count.mockResolvedValue(0);

        await service.getRoles(ORG_A, { sortBy: 'nameAr', sortDir });

        expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: { nameAr: { sort: sortDir, nulls: 'last' } } }),
        );
      },
    );

    it('sorts by the English name with a bare direction, since it cannot be null', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockResolvedValue(0);

      await service.getRoles(ORG_A, { sortBy: 'nameEn', sortDir: 'desc' });

      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { nameEn: 'desc' } }),
      );
    });

    it.each(['organizationId', 'id', 'description'])(
      'refuses to sort by %s and never queries',
      async (column) => {
        await expect(service.getRoles(ORG_A, { sortBy: column })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockPrisma.role.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.role.count).not.toHaveBeenCalled();
      },
    );

    itEnforcesTenantIsolation('permission counts in getRoles', async () => {
      // The groupBy is scoped by roleId drawn from the already-tenant-filtered
      // role list, so a role belonging to another tenant can never appear in
      // the `in` clause and its RolePermission rows can never be counted.
      const orgARole = makeRole({ id: 'role-org-a', organizationId: ORG_A });
      mockPrisma.role.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? [orgARole] : []),
      );
      mockPrisma.rolePermission.groupBy.mockResolvedValue([]);

      const result = await service.getRoles(ORG_B);

      expect(result.data).toEqual([]);
      // ACC-78 — the grouped query is now skipped entirely for an empty page
      // rather than being called with an empty `in`, so the isolation
      // guarantee is stronger: no query runs at all.
      expect(mockPrisma.rolePermission.groupBy).not.toHaveBeenCalled();
    });

    // Tenant scoping on the COUNT, which is a second query pagination
    // introduced. If it held only on the page, a paginator would report another
    // tenant's role total.
    itEnforcesTenantIsolation('getRoles count query', async () => {
      mockPrisma.role.findMany.mockResolvedValue([]);
      mockPrisma.role.count.mockImplementation(
        ({ where }: { where: { organizationId: string } }) =>
          Promise.resolve(where.organizationId === ORG_A ? 7 : 0),
      );

      const result = await service.getRoles(ORG_B);

      expect(result.total).toBe(0);
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

    // ACC-120 — these used to assert the ASSIGNMENT count. They now assert the
    // invariant, and the difference is the point of the change: the old pair
    // could not tell "a real administrator exists" from "a row exists for
    // someone who was deactivated last year".
    it('refuses to deactivate the root role while an active holder remains', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 1 });

      await expect(service.deactivateRole('role-1', ORG_A, ACTOR)).rejects.toThrow(
        ConflictException,
      );
    });

    // The MECHANISM, not just the outcome. countActiveAdministrators() requires
    // isActive: true on the role, and that clause is what lets ONE assertion
    // placed after the update catch a deactivation at all: the holder rows are
    // untouched by it, so a holder count alone would see nothing wrong.
    it('catches the deactivation by re-reading the role as INACTIVE, not by inspecting the request', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      // FIVE active holders, none of them touched by this mutation. A holder
      // count alone sees nothing wrong; the isActive clause is what bites.
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 5 });

      await expect(service.deactivateRole('role-1', ORG_A, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ key: 'TENANT_ADMIN', isActive: true }),
        }),
      );
    });

    it('allows deactivating the root role when nobody active holds it', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 0 });

      await service.deactivateRole('role-1', ORG_A, ACTOR);

      expect(mockPrisma.role.update).toHaveBeenCalled();
    });

    // A tenant already in breach is not punished for an unrelated mutation —
    // refusing would block the mutations needed to recover from it.
    it('allows a mutation in a tenant that already had no active administrator', async () => {
      const other = makeRole({ key: 'QUALITY_DIRECTOR', isSystem: false });
      stageAdministrators({ actedOnRole: other, rootRoleActive: false, activeHolders: 0 });

      await service.deactivateRole('role-1', ORG_A, ACTOR);

      expect(mockPrisma.role.update).toHaveBeenCalled();
    });

    // The platform organisation has the role seeded with NOBODY holding it, by
    // design — its people hold PLATFORM_ADMIN. Measured on dev before this
    // shipped: platform activeHolders=0, both real tenants 1. Without the
    // exemption the assertion would throw on every platform-org mutation.
    it('exempts the platform organization entirely', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      // Exactly the configuration refused above — one active holder, and the
      // mutation takes the role away. Only isPlatformOrg differs.
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 1 });
      mockPrisma.organization.findFirst.mockResolvedValue({ isPlatformOrg: true });

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

  // ── ACC-120: the root role's permission set is frozen ────────────────────────

  describe('assignPermissions — the root role is frozen', () => {
    // THE LIVE DEFECT THIS CLOSES. assignPermissions had no guard of any kind:
    // it deleted every permission on the role and wrote back whatever arrived.
    // One call with an empty list emptied Organization Administrator, leaving
    // the role intact, every assignment intact, both old last-admin checks
    // satisfied, and nobody able to administer anything.
    it('refuses an EMPTY permission list against the root role', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      mockPrisma.role.findFirst.mockResolvedValue(adminRole);

      await expect(
        service.assignPermissions('role-1', { permissionKeys: [] }, ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    });

    // Not only the empty list: the set is frozen, so a well-meaning narrower
    // set is refused too. A caller cannot talk their way past this by sending
    // "most" of the permissions.
    it('refuses a NON-empty permission list against the root role as well', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      mockPrisma.role.findFirst.mockResolvedValue(adminRole);

      await expect(
        service.assignPermissions(
          'role-1',
          { permissionKeys: ['users:view', 'roles:view'] },
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    });

    // FREEZE CAPABILITY, NOT THE LABEL. Renaming the role removes nothing, and
    // blocking a rename would reverse the 30 September decision that system
    // roles are tenant-editable for no safety gain.
    it('still lets the root role be RENAMED — the freeze is capability, not the label', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      // updateRole also runs a duplicate-name check through role.findFirst; a
      // flat mock answers that with the role itself and reports a clash.
      mockPrisma.role.findFirst.mockImplementation((args: { where: { nameEn?: string } }) =>
        Promise.resolve(args.where.nameEn === undefined ? adminRole : null),
      );
      mockPrisma.role.update.mockResolvedValue({ ...adminRole, nameEn: 'System Owner' });

      const updated = await service.updateRole(
        'role-1',
        { nameEn: 'System Owner' },
        ORG_A,
        ACTOR,
      );

      expect(updated.nameEn).toBe('System Owner');
    });

    it('leaves every other role editable', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.permission.findMany.mockResolvedValue([
        makePermission({ id: 'perm-1', module: 'users', action: 'view' }),
      ]);

      await service.assignPermissions('role-1', { permissionKeys: ['users:view'] }, ORG_A, ACTOR);

      expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalledWith({
        where: { roleId: 'role-1' },
      });
      expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
    });

    // The two writes had never been in a transaction. A failure between them
    // left the role with NO permissions: the delete had committed, the write
    // had not.
    it('writes the replacement set inside one transaction', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(BASE_ROLE);
      mockPrisma.permission.findMany.mockResolvedValue([
        makePermission({ id: 'perm-1', module: 'users', action: 'view' }),
      ]);

      await service.assignPermissions('role-1', { permissionKeys: ['users:view'] }, ORG_A, ACTOR);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
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

    it('refuses to remove the root role from its last ACTIVE holder', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 1 });
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', userId: 'user-1', roleId: 'role-1' });

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
    });

    // The whole reason for counting holders rather than rows. Under the old
    // `userRole.count({ roleId }) <= 1` this passed with TWO assignment rows,
    // one of them belonging to a deactivated user — so the real last
    // administrator could be removed and the tenant locked out.
    it('refuses when a second ASSIGNMENT exists but only one holder is active', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      // activeHolders is what the invariant counts; the inactive user's row is
      // invisible to it by construction, which is the fix.
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 1 });
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', userId: 'user-1', roleId: 'role-1' });

      await expect(
        service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR),
      ).rejects.toThrow(ConflictException);
      // Asserted so the test cannot pass for the old reason: the count the
      // invariant makes joins User and requires ACTIVE.
      expect(mockPrisma.userRole.count).toHaveBeenCalledWith({
        where: { roleId: adminRole.id, user: { organizationId: ORG_A, status: 'ACTIVE' } },
      });
    });

    it('allows removing the root role when another active holder remains', async () => {
      const adminRole = makeRole({ key: 'TENANT_ADMIN', isSystem: true });
      stageAdministrators({ actedOnRole: adminRole, activeHolders: 2 });
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1', userId: 'user-1', roleId: 'role-1' });

      await service.removeRoleFromUser('user-1', 'role-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.delete).toHaveBeenCalledWith({ where: { id: 'ur-1' } });
    });

    // ACC-120 — THE PINNED GAP TEST THAT STOOD HERE IS DELETED, as its own
    // comment instructed, because the gap it pinned is closed.
    //
    // It asserted that removing the last holder of a CUSTOM administrator role
    // succeeded, and said to delete it "the day the refusal is widened". The
    // refusal was not widened to read permissions — Ahmad's 3 Oct decision
    // closed the gap by making its PREMISE untrue instead: Organization
    // Administrator is the tenant's root role, it exists, and someone active
    // holds it. A tenant can therefore no longer be administered ONLY by a
    // custom role, which is the state that made removing that role's last
    // holder a lockout.
    //
    // So nothing was narrowed to keep a test green, and nothing is left
    // unprotected: the scenario is unreachable rather than unguarded.
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
    it('creates a marked UserRole row (both marker fields) and writes audit log when the user holds nothing yet', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          roleId: 'role-1',
          grantedViaHeadPositionId: 'pos-1',
          grantedViaHeadPositionOrgUnitId: 'unit-1',
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, actorId: ACTOR, action: 'CREATE', objectType: 'UserRole' }),
      );
    });

    // ACC-40 Section 2.6.4/2.6.5 (revised) — 2.9a's "applies to whoever
    // holds... it" holds without a carve-out: an org-wide head-conferring
    // position (orgUnitId: null) still grants successfully, marked via
    // grantedViaHeadPositionId instead (never null for a real grant).
    it('grants successfully for an org-wide position (orgUnitId: null), marking the row via grantedViaHeadPositionId instead', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-org-wide', null, ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          roleId: 'role-1',
          grantedViaHeadPositionId: 'pos-org-wide',
          grantedViaHeadPositionOrgUnitId: null,
        },
      });
    });

    // The hard requirement: UserRole carries @@unique([userId, roleId]) —
    // blindly creating here would throw a Prisma unique-constraint
    // violation, not silently succeed.
    it('does not create a duplicate row, and does not mark anything, when the user already independently holds the role', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue({
        id: 'ur-existing', userId: 'user-1', roleId: 'role-1', grantedViaHeadPositionOrgUnitId: null, grantedViaHeadPositionId: null,
      });

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('is idempotent — does not create a duplicate when the role was already granted via this exact mechanism', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue({
        id: 'ur-existing', userId: 'user-1', roleId: 'role-1', grantedViaHeadPositionOrgUnitId: 'unit-1', grantedViaHeadPositionId: 'pos-1',
      });

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_A, ACTOR);

      expect(mockPrisma.userRole.create).not.toHaveBeenCalled();
    });

    it('accepts a null actorId (system-triggered grant) without throwing, recording actorId as undefined in the audit log', async () => {
      mockPrisma.userRole.findFirst.mockResolvedValue(null);

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_A, null);

      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }));
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.userRole.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(where.user.organizationId === ORG_A ? { id: 'ur-a' } : null),
      );

      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_A, ACTOR);
      await service.grantRoleViaHeadAuthority('user-1', 'role-1', 'pos-1', 'unit-1', ORG_B, ACTOR);

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
    it('deletes the marked row via the orgUnitId key and writes audit log when one exists', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_A, ACTOR);

      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', grantedViaHeadPositionOrgUnitId: 'unit-1', user: { organizationId: ORG_A } },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, actorId: ACTOR, action: 'DELETE', objectType: 'UserRole' }),
      );
    });

    // ACC-40 Section 2.6.4/2.6.5 (revised) — the org-wide fallback path.
    it('deletes the marked row via the grantedViaHeadPositionId key when orgUnitId is null (the org-wide case)', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', null, 'pos-org-wide', ORG_A, ACTOR);

      expect(mockPrisma.userRole.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', grantedViaHeadPositionId: 'pos-org-wide', user: { organizationId: ORG_A } },
      });
    });

    it('prefers the orgUnitId key over positionId when both are supplied', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', 'pos-1', ORG_A, ACTOR);

      const call = mockPrisma.userRole.deleteMany.mock.calls[0][0];
      expect(call.where).toHaveProperty('grantedViaHeadPositionOrgUnitId', 'unit-1');
      expect(call.where).not.toHaveProperty('grantedViaHeadPositionId');
    });

    it('is a no-op — no query at all — when neither orgUnitId nor positionId is supplied', async () => {
      await service.revokeRoleViaHeadAuthority('user-1', null, null, ORG_A, ACTOR);

      expect(mockPrisma.userRole.deleteMany).not.toHaveBeenCalled();
    });

    it('is a silent no-op — no audit log — when nothing was ever granted via this mechanism', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 0 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_A, ACTOR);

      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('only ever targets rows matching the exact marker, not roleId — an independently-held role for the same user is never included in the delete filter', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_A, ACTOR);

      const call = mockPrisma.userRole.deleteMany.mock.calls[0][0];
      expect(call.where.grantedViaHeadPositionOrgUnitId).toBe('unit-1');
      expect(call.where).not.toHaveProperty('roleId'); // matches purely on the marker, not a specific role
    });

    it('accepts a null actorId (system-triggered revoke) without throwing', async () => {
      mockPrisma.userRole.deleteMany.mockResolvedValue({ count: 1 });

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_A, null);

      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ actorId: undefined }));
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.userRole.deleteMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.user.organizationId === ORG_A ? { count: 1 } : { count: 0 }),
      );

      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_A, ACTOR);
      await service.revokeRoleViaHeadAuthority('user-1', 'unit-1', null, ORG_B, ACTOR);

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

      await service.grantRoleViaHeadAuthority('user-1', 'role-head', 'pos-1', 'unit-1', ORG_A, ACTOR);

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

      expect(resultA.data.map((r) => r.id)).toEqual(['role-a']);
      expect(resultB.data.map((r) => r.id)).toEqual(['role-b']);
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
