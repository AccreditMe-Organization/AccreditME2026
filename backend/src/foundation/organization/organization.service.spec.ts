import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';

const BASE_UNIT = {
  id: 'unit-1',
  organizationId: ORG_A,
  parentId: null as string | null,
  nameEn: 'Intensive Care Unit',
  nameAr: null,
  code: 'ICU',
  type: null,
  typeValueId: null as string | null,
  description: null,
  isActive: true,
  isCodeLocked: false,
  sortOrder: 0,
  // ACC-40 Section 2.5.1
  isHeadVacant: false,
  headVacantSince: null as Date | null,
  actingHeadUserId: null as string | null,
  isHeadFullyUnresolved: false,
  headFullyUnresolvedLastRemindedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const makeUnit = (overrides: Partial<typeof BASE_UNIT> = {}) => ({
  ...BASE_UNIT,
  ...overrides,
});

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  orgUnit: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
  userRole: {
    findMany: jest.fn(),
  },
  // ACC-137 — buildTypeResolver() reads the org_unit_type category and its
  // values on every read path, so every org-unit test goes through these two.
  lookupCategory: {
    findFirst: jest.fn(),
  },
  lookupValue: {
    findMany: jest.fn(),
  },
};

// ACC-137 — the SYSTEM 'department' value, as buildTypeResolver() sees it.
const SYSTEM_DEPARTMENT = {
  id: 'lv-dept',
  organizationId: null as string | null,
  key: 'department',
  labelEn: 'Department',
  labelAr: 'قسم',
  labelOverrideEn: null as string | null,
  labelOverrideAr: null as string | null,
  isActive: true,
  isHidden: false,
};

const mockAuditLog = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OrganizationService', () => {
  let service: OrganizationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    // ACC-137 — a working lookup by default, so tests that are not about the
    // type do not each have to stub it. Tests that ARE about it override these.
    mockPrisma.lookupCategory.findFirst.mockResolvedValue({ id: 'cat-org-unit-type' });
    mockPrisma.lookupValue.findMany.mockResolvedValue([SYSTEM_DEPARTMENT]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<OrganizationService>(OrganizationService);
  });

  // ── findById ──────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the unit when found for the correct tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      const result = await service.findById('unit-1', ORG_A);
      expect(result.id).toBe('unit-1');
      expect(result.organizationId).toBe(ORG_A);
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'unit-1', organizationId: ORG_A },
      });
    });

    it('throws NotFoundException when unit does not exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      await expect(service.findById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a unit with valid data', async () => {
      // ACC-134 — this dto has no parentId, so the root check runs FIRST and
      // the code check second. Both are mocked by position rather than with one
      // blanket mockResolvedValue, so a future change to the order fails here
      // instead of passing for a reason the test never meant.
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(null) // no existing root
        .mockResolvedValueOnce(null); // no code conflict
      mockPrisma.orgUnit.create.mockResolvedValue(BASE_UNIT);

      const result = await service.create(
        ORG_A,
        { nameEn: 'Intensive Care Unit', code: 'ICU', typeValueId: 'lv-dept' },
        'actor-1',
      );

      expect(result.code).toBe('ICU');
      expect(mockPrisma.orgUnit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ organizationId: ORG_A, code: 'ICU' }),
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'OrgUnit' }),
      );
    });

    it('throws ConflictException when code is already in use', async () => {
      // Asserts on the MESSAGE, not just the type. Both this and ACC-134's
      // second-root refusal are ConflictException, so a type-only assertion
      // would pass if the root check swallowed this case — which is exactly
      // what a blanket mockResolvedValue(BASE_UNIT) used to do here.
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(null) // no existing root — reach the code check
        .mockResolvedValueOnce(BASE_UNIT); // code conflict
      await expect(
        service.create(
          ORG_A,
          { nameEn: 'ICU Copy', code: 'ICU', typeValueId: 'lv-dept' },
          'actor-1',
        ),
      ).rejects.toThrow('Code "ICU" is already in use in this organization');
      expect(mockPrisma.orgUnit.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when parentId does not belong to the tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null); // parent not found
      await expect(
        service.create(
          ORG_A,
          { nameEn: 'Sub Unit', code: 'SUB', parentId: 'foreign-parent', typeValueId: 'lv-dept' },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── one root per tenant (ACC-134) ─────────────────────────────────────────────

  describe('one root per tenant (ACC-134)', () => {
    const ROOT = makeUnit({ id: 'root-1', nameEn: 'Al Nakheel Specialist Hospital', code: 'NAKHEEL' });

    it('refuses a second root on create, and NAMES the existing one', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValueOnce(ROOT); // a root exists

      // Caught once rather than awaited twice: a second `service.create` call
      // would consume a mockResolvedValueOnce that is no longer queued, so the
      // root lookup would return undefined and the creation would SUCCEED —
      // which is how this assertion failed on its first run.
      const error = await service
        .create(ORG_A, { nameEn: 'Another Top Level', code: 'TOP2', typeValueId: 'lv-dept' }, 'actor-1')
        .then(
          () => null,
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(ConflictException);
      // The acceptance criterion is that the refusal NAMES the root, not that
      // it merely refuses — a bare constraint error satisfies the first half
      // and defeats the point of it.
      expect((error as Error).message).toMatch(/Al Nakheel Specialist Hospital/);
      expect((error as Error).message).toMatch(/NAKHEEL/);
      expect(mockPrisma.orgUnit.create).not.toHaveBeenCalled();
    });

    it('allows the FIRST root, when the organization has none', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(null) // no existing root
        .mockResolvedValueOnce(null); // no code conflict
      mockPrisma.orgUnit.create.mockResolvedValue(ROOT);

      await expect(
        service.create(ORG_A, { nameEn: 'Al Nakheel Specialist Hospital', code: 'NAKHEEL', typeValueId: 'lv-dept' }, 'a'),
      ).resolves.toEqual(expect.objectContaining({ code: 'NAKHEEL' }));
      expect(mockPrisma.orgUnit.create).toHaveBeenCalled();
    });

    it('does NOT run the root check when a parent is supplied', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(makeUnit({ id: 'parent-1' })) // parent found
        .mockResolvedValueOnce(null); // no code conflict
      mockPrisma.orgUnit.create.mockResolvedValue(BASE_UNIT);

      await service.create(ORG_A, { nameEn: 'Child', code: 'CHILD', parentId: 'parent-1', typeValueId: 'lv-dept' }, 'a');

      // A child unit is never a root, so asking about roots would be a wasted
      // query on the common path.
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ parentId: null }) }),
      );
    });

    it('refuses promoting a child to root by PATCHing parentId to null', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(makeUnit({ id: 'unit-9', parentId: 'parent-1' })) // the unit
        .mockResolvedValueOnce(ROOT); // a root already exists

      await expect(
        service.update('unit-9', ORG_A, { parentId: null }, 'actor-1'),
      ).rejects.toThrow(/already has a root unit.*Al Nakheel Specialist Hospital/);

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('lets the EXISTING root re-save its own null parent — it is not a second root', async () => {
      const self = makeUnit({ id: 'root-1', parentId: null });
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(self) // the unit being updated
        .mockResolvedValueOnce(null); // no OTHER root, because self is excluded
      mockPrisma.orgUnit.update.mockResolvedValue(self);

      await expect(
        service.update('root-1', ORG_A, { parentId: null, nameEn: 'Renamed' }, 'actor-1'),
      ).resolves.toEqual(expect.objectContaining({ id: 'root-1' }));

      // The exclusion is what makes this idempotent rather than self-blocking.
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 'root-1' } }),
        }),
      );
    });

    it('ignores an INACTIVE root, so an archived unit cannot block the tenant forever', async () => {
      // findActiveRoot filters isActive, so the query must carry it. There is
      // no reactivate path on this service, so counting an inactive root would
      // be an unrecoverable dead end.
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(null) // no ACTIVE root found
        .mockResolvedValueOnce(null); // no code conflict
      mockPrisma.orgUnit.create.mockResolvedValue(ROOT);

      await service.create(ORG_A, { nameEn: 'New Root', code: 'NEW', typeValueId: 'lv-dept' }, 'actor-1');

      expect(mockPrisma.orgUnit.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ parentId: null, isActive: true }),
        }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // The root lookup must be scoped by organizationId. Unscoped, ORG_B's
      // root would be found while creating in ORG_A — and the refusal would
      // name another tenant's unit, which both blocks a legitimate write and
      // leaks that tenant's structure in the message.
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.create.mockResolvedValue(BASE_UNIT);

      await service.create(ORG_A, { nameEn: 'Root', code: 'ROOT', typeValueId: 'lv-dept' }, 'actor-1');

      expect(mockPrisma.orgUnit.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_A, parentId: null }),
        }),
      );
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_B }),
        }),
      );
    });
  });

  // ── the root's type is `organization` (ACC-141) ───────────────────────────────

  describe('the organization type is reserved for the root (ACC-141)', () => {
    const ORG_VALUE = {
      id: 'lv-org',
      organizationId: null as string | null,
      key: 'organization',
      labelEn: 'Organization',
      labelAr: 'منشأة',
      labelOverrideEn: null as string | null,
      labelOverrideAr: null as string | null,
      isActive: true,
      isHidden: false,
    };

    const withValues = (values: unknown[]): void => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue({ id: 'cat-org-unit-type' });
      mockPrisma.lookupValue.findMany.mockResolvedValue(values);
    };

    it('refuses organization on CREATE, without asking whether it is the root', async () => {
      // The asymmetry with update() is the point. ACC-134 already forbids a
      // second root and bootstrap() writes the only one through Prisma directly,
      // so every unit created through this API is non-root by construction —
      // there is no root to detect. Verified in a browser: a create with no
      // parentId is refused by ACC-134's guard before reaching here.
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(makeUnit({ id: 'parent-1' })) // parent found
        .mockResolvedValueOnce(null); // no code conflict

      await expect(
        service.create(ORG_A, { nameEn: 'X', code: 'X', parentId: 'parent-1', typeValueId: 'lv-org' }, 'a'),
      ).rejects.toThrow(/reserved for the organization's root unit/);
      expect(mockPrisma.orgUnit.create).not.toHaveBeenCalled();
    });

    it('refuses organization on UPDATE of a non-root unit', async () => {
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(
        makeUnit({ id: 'child-1', parentId: 'parent-1', typeValueId: 'lv-dept' }),
      );

      await expect(
        service.update('child-1', ORG_A, { typeValueId: 'lv-org' }, 'actor-1'),
      ).rejects.toThrow(/reserved for the organization's root unit/);
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it("refuses changing the ROOT's type at all — there is no edit path", async () => {
      // Rule 2. Not a default that can be changed: a root unit IS the
      // organisation, so the value is structurally determined.
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(
        makeUnit({ id: 'root-1', parentId: null, typeValueId: 'lv-org' }),
      );

      await expect(
        service.update('root-1', ORG_A, { typeValueId: 'lv-dept' }, 'actor-1'),
      ).rejects.toThrow(/root unit's type is set by the system/);
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('lets the root re-save the SAME type, so a round-tripping form is not refused', async () => {
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(
        makeUnit({ id: 'root-1', parentId: null, typeValueId: 'lv-org' }),
      );
      mockPrisma.orgUnit.update.mockResolvedValue(
        makeUnit({ id: 'root-1', parentId: null, typeValueId: 'lv-org', nameEn: 'Renamed' }),
      );

      await expect(
        service.update('root-1', ORG_A, { typeValueId: 'lv-org', nameEn: 'Renamed' }, 'actor-1'),
      ).resolves.toEqual(expect.objectContaining({ id: 'root-1' }));
    });

    it('RESOLVES organization for display — the root must not render blank', async () => {
      // The third of the three answers. Selection excludes this value; filtering
      // and resolution include it. A test pins that, so nobody later "fixes" a
      // blank root by putting it back in the picker.
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(
        makeUnit({ id: 'root-1', parentId: null, typeValueId: 'lv-org' }),
      );

      const result = await service.findById('root-1', ORG_A);

      expect(result.typeValue).toEqual({
        id: 'lv-org',
        key: 'organization',
        labelEn: 'Organization',
        labelAr: 'منشأة',
        isRetired: false,
      });
    });

    it('keeps organization ACTIVE and not hidden, so it stays filterable', async () => {
      // Filtering the tree by type is a legitimate query and the root holds this
      // value, so it must not be hidden or deactivated to keep it out of the
      // picker. The picker filters by KEY instead; the value itself stays normal.
      withValues([SYSTEM_DEPARTMENT, ORG_VALUE]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ typeValueId: 'lv-org' }));

      const result = await service.findById('unit-1', ORG_A);

      expect(result.typeValue?.isRetired).toBe(false);
    });
  });

  // ── the type is a lookup value (ACC-137) ──────────────────────────────────────

  describe('unit type as a lookup value (ACC-137)', () => {
    const TENANT_WARD = {
      id: 'lv-ward',
      organizationId: ORG_A,
      key: 'ward',
      labelEn: 'Ward',
      labelAr: 'جناح',
      labelOverrideEn: null as string | null,
      labelOverrideAr: null as string | null,
      isActive: true,
      isHidden: false,
    };

    const withValues = (values: unknown[]): void => {
      mockPrisma.lookupCategory.findFirst.mockResolvedValue({ id: 'cat-org-unit-type' });
      mockPrisma.lookupValue.findMany.mockResolvedValue(values);
    };

    it('refuses a typeValueId that resolves to nothing this tenant can see', async () => {
      // Another tenant's value and another category's value reach the service
      // the same way: absent from this tenant's resolved set. One refusal covers
      // both, because the resolver never loads either.
      withValues([SYSTEM_DEPARTMENT]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.create(ORG_A, { nameEn: 'X', code: 'X', typeValueId: 'lv-from-org-b' }, 'a'),
      ).rejects.toThrow(/not an available org_unit_type value in this organization/);
      expect(mockPrisma.orgUnit.create).not.toHaveBeenCalled();
    });

    it('refuses an INACTIVE value, which renders but cannot be newly chosen', async () => {
      withValues([{ ...TENANT_WARD, isActive: false }]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.create(ORG_A, { nameEn: 'X', code: 'X', typeValueId: 'lv-ward' }, 'a'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a SYSTEM value the tenant has HIDDEN', async () => {
      // Hiding a system value writes a TENANT row with the same key and
      // isHidden true. The system row itself is untouched, so a resolver that
      // only looked at the system layer would accept it happily.
      withValues([
        SYSTEM_DEPARTMENT,
        { ...TENANT_WARD, id: 'lv-dept-override', key: 'department', isHidden: true },
      ]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(
        service.create(ORG_A, { nameEn: 'X', code: 'X', typeValueId: 'lv-dept' }, 'a'),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts a TENANT value belonging to this tenant, and writes BOTH shapes', async () => {
      withValues([SYSTEM_DEPARTMENT, TENANT_WARD]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      mockPrisma.orgUnit.create.mockResolvedValue(makeUnit({ typeValueId: 'lv-ward' }));

      await service.create(ORG_A, { nameEn: 'Ward 3', code: 'W3', typeValueId: 'lv-ward' }, 'a');

      // The legacy key comes from the RESOLVED value, so `type` and
      // `typeValueId` cannot drift apart during the expand step.
      expect(mockPrisma.orgUnit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ type: 'ward', typeValueId: 'lv-ward' }),
      });
    });

    it('returns the per-tenant labelOverrideEn rather than the seeded labelEn', async () => {
      // The whole reason the read path resolves at all. A client mapping keys to
      // labels from its own table would show "Department" to a tenant that
      // renamed it — the tenant seeing the wrong word for its own data.
      withValues([
        SYSTEM_DEPARTMENT,
        {
          ...TENANT_WARD,
          id: 'lv-dept-override',
          key: 'department',
          labelOverrideEn: 'Clinical Department',
          labelOverrideAr: 'قسم إكلينيكي',
        },
      ]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ typeValueId: 'lv-dept' }));

      const result = await service.findById('unit-1', ORG_A);

      expect(result.typeValue).toEqual({
        id: 'lv-dept',
        key: 'department',
        labelEn: 'Clinical Department',
        labelAr: 'قسم إكلينيكي',
        isRetired: false,
      });
    });

    it('still resolves a HIDDEN value for a unit that holds it, marked retired', async () => {
      // An acceptance criterion in its own right: a type must not vanish from a
      // column because an admin tidied the Lookups page. That reads as data loss.
      withValues([
        SYSTEM_DEPARTMENT,
        { ...TENANT_WARD, id: 'lv-dept-override', key: 'department', isHidden: true },
      ]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ typeValueId: 'lv-dept' }));

      const result = await service.findById('unit-1', ORG_A);

      expect(result.typeValue).toEqual(
        expect.objectContaining({ id: 'lv-dept', isRetired: true }),
      );
    });

    it('leaves typeValue null for a unit with no type, without inventing one', async () => {
      withValues([SYSTEM_DEPARTMENT]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ typeValueId: null }));

      const result = await service.findById('unit-1', ORG_A);

      expect(result.typeValueId).toBeNull();
      expect(result.typeValue).toBeNull();
    });

    it('does not touch the type on an update that does not mention it', async () => {
      withValues([SYSTEM_DEPARTMENT]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.update.mockResolvedValue(BASE_UNIT);

      await service.update('unit-1', ORG_A, { nameEn: 'Renamed' }, 'actor-1');

      // A PATCH that renames a unit must not have to resend its type, and must
      // not silently clear it.
      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ typeValueId: expect.anything() }),
        }),
      );
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // The value set is SYSTEM (organizationId null, shared by every tenant) OR
      // this tenant's own. `ward` belongs to Al Nakheel and `faculty` to Al
      // Manara, so dropping the organizationId arm would let one tenant set the
      // other's private type on its units — a cross-tenant WRITE, not a read.
      withValues([SYSTEM_DEPARTMENT]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ typeValueId: 'lv-dept' }));

      await service.findById('unit-1', ORG_A);

      expect(mockPrisma.lookupValue.findMany).toHaveBeenCalledWith({
        where: {
          categoryId: 'cat-org-unit-type',
          OR: [{ organizationId: null }, { organizationId: ORG_A }],
        },
      });
      expect(mockPrisma.lookupValue.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_B }),
        }),
      );
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates allowed fields without touching the code when not provided', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.update.mockResolvedValue({ ...BASE_UNIT, nameEn: 'Updated ICU' });

      const result = await service.update('unit-1', ORG_A, { nameEn: 'Updated ICU' }, 'actor-1');
      expect(result.nameEn).toBe('Updated ICU');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE' }),
      );
    });

    it('throws ForbiddenException when attempting to change a locked code', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ isCodeLocked: true }));
      await expect(
        service.update('unit-1', ORG_A, { code: 'NEW', typeValueId: 'lv-dept' }, 'actor-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ConflictException when new code conflicts with another unit', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(BASE_UNIT)                          // the unit being updated
        .mockResolvedValueOnce(makeUnit({ id: 'unit-2', code: 'ER' })); // conflict check
      await expect(
        service.update('unit-1', ORG_A, { code: 'ER' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when parentId is set to self', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      await expect(
        service.update('unit-1', ORG_A, { parentId: 'unit-1' }, 'actor-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── deactivate ────────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('deactivates a unit that has no active blockers', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(0); // no active children
      mockPrisma.user.count.mockResolvedValue(0); // no active users
      mockPrisma.orgUnit.update.mockResolvedValue({ ...BASE_UNIT, isActive: false });

      const result = await service.deactivate('unit-1', ORG_A, 'actor-1');
      expect(result.isActive).toBe(false);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'OrgUnit' }),
      );
    });

    it('throws ConflictException with a structured blocker list when active users are assigned to the unit', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(0); // no active children
      mockPrisma.user.count.mockResolvedValue(2); // 2 active users

      try {
        await service.deactivate('unit-1', ORG_A, 'actor-1');
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          message: string;
          blockers: string[];
        };
        expect(body.blockers).toHaveLength(1);
        expect(body.blockers[0]).toMatch(/2 active user\(s\)/);
      }
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { primaryOrgUnitId: 'unit-1', organizationId: ORG_A, status: 'ACTIVE' } }),
      );
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('returns idempotently when unit is already inactive', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(makeUnit({ isActive: false }));
      const result = await service.deactivate('unit-1', ORG_A, 'actor-1');
      expect(result.isActive).toBe(false);
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException with a structured blocker list when active children exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(BASE_UNIT);
      mockPrisma.orgUnit.count.mockResolvedValue(3); // 3 active children
      mockPrisma.user.count.mockResolvedValue(0); // no active users

      try {
        await service.deactivate('unit-1', ORG_A, 'actor-1');
        fail('expected ConflictException to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConflictException);
        const body = (err as ConflictException).getResponse() as {
          message: string;
          blockers: string[];
        };
        expect(body.message).toMatch(/Cannot deactivate/);
        expect(Array.isArray(body.blockers)).toBe(true);
        expect(body.blockers).toHaveLength(1);
        expect(body.blockers[0]).toMatch(/3 active child unit/);
      }
    });

    it('throws NotFoundException when unit does not exist', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);
      await expect(service.deactivate('missing', ORG_A, 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getTree ───────────────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('returns a nested tree structure built from flat Prisma results', async () => {
      const parent = makeUnit({ id: 'parent', parentId: null, code: 'HOSP' });
      const child = makeUnit({ id: 'child', parentId: 'parent', code: 'ICU' });
      mockPrisma.orgUnit.findMany.mockResolvedValue([parent, child]);

      const tree = await service.getTree(ORG_A);
      expect(tree).toHaveLength(1);
      expect(tree[0]!.id).toBe('parent');
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children![0]!.id).toBe('child');
    });

    it('returns empty array when organization has no org units', async () => {
      mockPrisma.orgUnit.findMany.mockResolvedValue([]);
      const tree = await service.getTree(ORG_A);
      expect(tree).toEqual([]);
    });
  });

  // ── Tenant isolation ──────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return records belonging to a different tenant', async () => {
      const unitA = makeUnit({ organizationId: ORG_A, code: 'A' });
      const unitB = makeUnit({ id: 'unit-b', organizationId: ORG_B, code: 'B' });

      mockPrisma.orgUnit.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string } }) => {
          if (where.organizationId === ORG_A) return Promise.resolve([unitA]);
          if (where.organizationId === ORG_B) return Promise.resolve([unitB]);
          return Promise.resolve([]);
        },
      );

      const resultA = await service.listFlat(ORG_A);
      const resultB = await service.listFlat(ORG_B);

      expect(resultA.every((u) => u.organizationId === ORG_A)).toBe(true);
      expect(resultB.every((u) => u.organizationId === ORG_B)).toBe(true);
      expect(resultA.map((u) => u.id)).not.toContain('unit-b');
      expect(resultB.map((u) => u.id)).not.toContain('unit-1');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null); // cross-tenant miss
      await expect(service.findById('unit-1', ORG_B)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { id: 'unit-1', organizationId: ORG_B },
      });
    });
  });

  // ── resolveActingHeadForOrgUnit (ACC-40 Section 2.5) ────────────────────────
  //
  // The resolver everything downstream depends on — Phase 6's own
  // checkpoint requires isolated confidence in this method before it's
  // wired into anything else. Covers all 4 cases the plan's own test
  // checklist names, verbatim.

  describe('resolveActingHeadForOrgUnit', () => {
    it("returns the unit's own holder directly, without ever checking actingHeadUserId or walking to the parent", async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'holder-1' }]);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['holder-1']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: 'unit-1',
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true },
      });
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    // ACC-40 Section 2.3 — now reachable per Phase 5's own handover
    // mechanism: during a declared handover, both the outgoing and
    // incoming users genuinely hold the position at once. The resolver
    // needs no special-case logic for this — it's the same query,
    // returning 2 rows instead of 1 by construction.
    it("returns BOTH holders during a declared handover — the 2-holder case, no special-casing needed", async () => {
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'outgoing-holder' }, { id: 'incoming-successor' }]);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['outgoing-holder', 'incoming-successor']);
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled();
    });

    it("falls through to the unit's own Acting Head when vacant, without walking to the parent", async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // unit-1 has no direct holder
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ actingHeadUserId: 'acting-1', parentId: 'parent-1' });

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['acting-1']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1); // never reaches parent-1
      expect(mockPrisma.orgUnit.findFirst).toHaveBeenCalledTimes(1);
    });

    it("escalates to the parent's holder when the unit is vacant with no Acting Head of its own", async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.primaryOrgUnitId === 'unit-1' ? [] : [{ id: 'parent-holder' }]),
      );
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1' ? { actingHeadUserId: null, parentId: 'parent-1' } : null,
        ),
      );

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual(['parent-holder']);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2);
      // Confirms the walk actually reached the parent, not a coincidence.
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          organizationId: ORG_A,
          primaryOrgUnitId: 'parent-1',
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true, isActive: true },
        },
        select: { id: true },
      });
    });

    it('returns an empty pool when the full chain is exhausted — vacant at every level, no Acting Head anywhere, walk reaches the root', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant at every level
      mockPrisma.orgUnit.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'unit-1'
            ? { actingHeadUserId: null, parentId: 'parent-1' }
            : { actingHeadUserId: null, parentId: null }, // parent-1: root, chain ends here
        ),
      );

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual([]);
      expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(2); // unit-1, then parent-1 — walk stops there
    });

    it('returns an empty pool immediately when the starting unit does not exist in this tenant', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      const result = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);

      expect(result).toEqual([]);
    });

    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.organizationId === ORG_A ? [{ id: 'holder-a' }] : [{ id: 'leaked-holder' }]),
      );

      const resultA = await service.resolveActingHeadForOrgUnit('unit-1', ORG_A);
      const resultB = await service.resolveActingHeadForOrgUnit('unit-1', ORG_B);

      expect(resultA).toEqual(['holder-a']);
      expect(resultB).toEqual(['leaked-holder']); // scoped correctly to ORG_B, not a leak from ORG_A
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }));
      expect(mockPrisma.user.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }));
    });
  });

  // ── refreshOrgUnitHeadVacancy (ACC-40 Section 2.5.1) ────────────────────────
  //
  // Entry-time check: only a genuine isHeadVacant transition writes. No-op
  // when nothing changed — the sweep owns ongoing drift, not this method.
  //
  // ACC-82 — it no longer notifies anyone in any branch, and OrganizationService
  // no longer depends on NotificationService at all: a vacant unit is a Setup
  // health condition, not a bell event (SYSTEM-REFERENCE §13.7). Nor does it
  // write headFullyUnresolvedLastRemindedAt, which only paced the removed
  // reminders — the exact `data` assertions below pin that.

  describe('refreshOrgUnitHeadVacancy', () => {
    const VACANCY_UNIT = makeUnit({
      isHeadVacant: false,
      headVacantSince: null,
      isHeadFullyUnresolved: false,
      headFullyUnresolvedLastRemindedAt: null,
      actingHeadUserId: null as string | null,
    });

    // ACC-44 — renamed to the exact CI isolation-gate string ("should NOT
    // return records belonging to a different tenant"). Same logic as
    // before (a cross-tenant unit id resolves to nothing, so the method
    // is a correct no-op) — this test was always correct, just invisible
    // to CI's --testNamePattern gate under its old name.
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(null);

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.user.count).not.toHaveBeenCalled();
      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no transition — still held, was not vacant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue(VACANCY_UNIT); // isHeadVacant: false
      mockPrisma.user.count.mockResolvedValue(1); // still has a direct holder

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no transition — still vacant, was already vacant', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({ ...VACANCY_UNIT, isHeadVacant: true });
      mockPrisma.user.count.mockResolvedValue(0);

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).not.toHaveBeenCalled();
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled(); // resolver never runs
    });

    it('clears the vacancy flags on a true→false recovery transition', async () => {
      mockPrisma.orgUnit.findFirst.mockResolvedValue({
        ...VACANCY_UNIT,
        isHeadVacant: true,
        headVacantSince: new Date('2026-08-01'),
        isHeadFullyUnresolved: true,
        headFullyUnresolvedLastRemindedAt: new Date('2026-08-01'),
      });
      mockPrisma.user.count.mockResolvedValue(1); // newly filled

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: false,
          headVacantSince: null,
          isHeadFullyUnresolved: false,
        },
      });
    });

    it('on a false→true transition with ancestor coverage (partial), sets isHeadFullyUnresolved false', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(VACANCY_UNIT) // the unit itself
        .mockResolvedValueOnce({ actingHeadUserId: null, parentId: 'parent-1' }); // resolver: unit-1 walk step — never reaches a 3rd call, since parent-1 has a direct holder
      mockPrisma.user.count.mockResolvedValue(0); // no direct holder on unit-1
      mockPrisma.user.findMany.mockImplementation(({ where }: any) =>
        Promise.resolve(where.primaryOrgUnitId === 'unit-1' ? [] : [{ id: 'parent-holder' }]),
      );

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: true,
          headVacantSince: expect.any(Date),
          isHeadFullyUnresolved: false,
        },
      });
    });

    // Previously this branch also paged every Tenant Admin. It is exactly the
    // BLOCKS_WORK case Setup health now lists.
    it('on a false→true transition fully exhausted, sets isHeadFullyUnresolved true and looks up no admins to notify', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(VACANCY_UNIT) // the unit itself
        .mockResolvedValueOnce({ actingHeadUserId: null, parentId: null }); // resolver: root, chain ends
      mockPrisma.user.count.mockResolvedValue(0);
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant everywhere

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith({
        where: { id: 'unit-1' },
        data: {
          isHeadVacant: true,
          headVacantSince: expect.any(Date),
          isHeadFullyUnresolved: true,
        },
      });
      expect(mockPrisma.role.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.userRole.findMany).not.toHaveBeenCalled();
    });

    // ACC-43 — an INVITED head-conferring holder does NOT count as covering
    // a unit, matching the same principle already established for
    // out-of-office coverage: holding a position isn't the same as being
    // able to act. Asserts the direct-holder query itself filters by
    // status: 'ACTIVE' — a user who has never accepted their invitation
    // must not silently mask a genuinely vacant unit.
    it('filters the direct-holder count by status: ACTIVE — an INVITED holder still counts the unit as vacant', async () => {
      mockPrisma.orgUnit.findFirst
        .mockResolvedValueOnce(VACANCY_UNIT) // the unit itself
        .mockResolvedValueOnce({ actingHeadUserId: null, parentId: null }); // resolver: root, chain ends
      mockPrisma.user.count.mockResolvedValue(0); // the ACTIVE-only filter excludes the INVITED holder
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant everywhere

      await service.refreshOrgUnitHeadVacancy('unit-1', ORG_A);

      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_A,
            primaryOrgUnitId: 'unit-1',
            status: 'ACTIVE',
          }),
        }),
      );
      expect(mockPrisma.orgUnit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isHeadVacant: true }) }),
      );
    });
  });

  // ── generateCode (static) ─────────────────────────────────────────────────────

  describe('generateCode', () => {
    it('uppercases and truncates to 10 characters', () => {
      // 'INTENSIVE-CARE-UNIT' → slice(0, 10) → 'INTENSIVE-'
      expect(OrganizationService.generateCode('Intensive Care Unit')).toBe('INTENSIVE-');
    });

    it('replaces spaces with hyphens', () => {
      expect(OrganizationService.generateCode('Lab Path')).toBe('LAB-PATH');
    });

    it('strips non-alphanumeric characters and collapses adjacent spaces', () => {
      // '&' removed → two surrounding spaces collapse to one hyphen
      expect(OrganizationService.generateCode('ICU & ER')).toBe('ICU-ER');
    });
  });
});
