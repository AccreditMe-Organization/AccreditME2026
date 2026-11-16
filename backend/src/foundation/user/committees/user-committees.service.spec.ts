// ACC-216 — GET /users/:userId/committees. The gate (committees:view always,
// users:view unless yourself) is checked BEFORE any read; another organisation's
// user is the same 404 as an invented id; every query is scoped by organisation;
// `current` is ACC-281's rule; seats are named through getValues().
//
// Both refusals are 403, so every refusal is asserted on its MESSAGE.
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserCommitteesService, USER_COMMITTEES_CAP } from './user-committees.service';
import type { ILookupValue } from '../../lookup/interfaces/lookup-value.interface';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ME = 'user-me';
const COLLEAGUE = 'user-colleague';
const FOREIGN = 'user-foreign';

interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  roleValueId: string;
  joinedAt: Date;
  leftAt: Date | null;
  isActive: boolean;
  committee: { id: string; organizationId: string; nameEn: string; nameAr: string | null; isActive: boolean };
}

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const committee = (id: string, isActive = true, organizationId = ORG) => ({
  id,
  organizationId,
  nameEn: `Committee ${id}`,
  nameAr: `لجنة ${id}`,
  isActive,
});

const seatValue = (id: string, labelEn: string, sortOrder: number, extra: Partial<ILookupValue> = {}): ILookupValue => ({
  id,
  organizationId: null,
  categoryId: 'cat',
  key: id,
  labelEn,
  labelAr: `${labelEn} (ar)`,
  layer: 'SYSTEM',
  attributes: null,
  isActive: true,
  isHidden: false,
  labelOverrideEn: null,
  labelOverrideAr: null,
  sortOrder,
  createdAt: d('2026-01-01'),
  updatedAt: d('2026-01-01'),
  ...extra,
});

// The tenant's seats as getValues() returns them: Chairman RELABELLED by the
// organisation, so the SYSTEM id and layer stay and the label is the override.
const SEATS = [
  seatValue('seat-chair', 'Chair of the Committee', 1, { labelOverrideEn: 'Chair of the Committee' }),
  seatValue('seat-secretary', 'Secretary', 2),
  seatValue('seat-member', 'Member', 3),
];

function makeService(data: MemberRow[], users: Record<string, string> = { [ME]: ORG, [COLLEAGUE]: ORG, [FOREIGN]: OTHER_ORG }) {
  // A Prisma-shaped mock that APPLIES the where clause, so a query that dropped
  // its organisation scope would return the other organisation's row.
  const matches = (row: MemberRow, where: Record<string, unknown>): boolean => {
    if (where['organizationId'] !== undefined && row.organizationId !== where['organizationId']) return false;
    if (where['userId'] !== undefined && row.userId !== where['userId']) return false;
    if (where['isActive'] !== undefined && row.isActive !== where['isActive']) return false;
    const c = where['committee'] as { organizationId?: string; isActive?: boolean } | undefined;
    if (c?.organizationId !== undefined && row.committee.organizationId !== c.organizationId) return false;
    if (c?.isActive !== undefined && row.committee.isActive !== c.isActive) return false;
    return true;
  };
  const findMany = jest.fn(({ where, select, take }: { where: Record<string, unknown>; select: Record<string, unknown>; take?: number }) => {
    const found = data.filter((r) => matches(r, where));
    const out = select['committeeId']
      ? found.map((r) => ({ committeeId: r.committee.id }))
      : found.map((r) => ({
          roleValueId: r.roleValueId,
          joinedAt: r.joinedAt,
          leftAt: r.leftAt,
          committee: { id: r.committee.id, nameEn: r.committee.nameEn, nameAr: r.committee.nameAr },
        }));
    return Promise.resolve(take ? out.slice(0, take) : out);
  });
  const count = jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(data.filter((r) => matches(r, where)).length));
  const lookupFindMany = jest.fn().mockResolvedValue([]);
  const prisma = { committeeMember: { findMany, count }, lookupValue: { findMany: lookupFindMany } };
  const getValues = jest.fn().mockResolvedValue(SEATS);
  const getById = jest.fn((id: string, organizationId: string) =>
    users[id] === organizationId ? Promise.resolve({ id, organizationId }) : Promise.reject(new NotFoundException('User not found')),
  );
  const service = new UserCommitteesService(prisma as never, { getValues } as never, { getById } as never);
  return { service, findMany, count, getValues, getById, lookupFindMany };
}

const row = (over: Partial<MemberRow> & Pick<MemberRow, 'id' | 'committee'>): MemberRow => ({
  organizationId: ORG,
  userId: COLLEAGUE,
  roleValueId: 'seat-member',
  joinedAt: d('2026-03-01'),
  leftAt: null,
  isActive: true,
  ...over,
});

const ADMIN = ['committees:view', 'users:view'];

describe('UserCommitteesService (ACC-216)', () => {
  describe('the gate, before any read', () => {
    it('without committees:view, even reading yourself: 403 naming committees:view, and no query', async () => {
      const { service, findMany, getById, getValues } = makeService([]);
      for (const [viewer, userId] of [
        [{ id: ME, permissions: ['users:view'] }, COLLEAGUE],
        [{ id: ME, permissions: [] }, ME],
      ] as const) {
        const err = await service.forUser(ORG, viewer, userId).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toBe('Required permission: committees:view');
      }
      expect(getById).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
      expect(getValues).not.toHaveBeenCalled();
    });

    it("someone else's, without users:view: 403 naming users:view, and no query", async () => {
      const { service, findMany, getById } = makeService([]);
      const err = await service.forUser(ORG, { id: ME, permissions: ['committees:view'] }, COLLEAGUE).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toBe('Required permission: users:view');
      expect(getById).not.toHaveBeenCalled();
      expect(findMany).not.toHaveBeenCalled();
    });

    it('the users:view refusal is the same for an invented id (existence-neutral)', async () => {
      const { service } = makeService([]);
      const messages = await Promise.all(
        [COLLEAGUE, 'user-invented'].map((id) =>
          service.forUser(ORG, { id: ME, permissions: ['committees:view'] }, id).catch((e: Error) => e.message),
        ),
      );
      expect(messages).toEqual(['Required permission: users:view', 'Required permission: users:view']);
    });

    it('yourself, with committees:view and without users:view: admitted', async () => {
      const { service } = makeService([row({ id: 'm1', userId: ME, committee: committee('c1') })]);
      const result = await service.forUser(ORG, { id: ME, permissions: ['committees:view'] }, ME);
      expect(result.rows.map((r) => r.committee.id)).toEqual(['c1']);
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // A membership row of this user on ANOTHER organisation's committee, and a
    // whole membership in another organisation: neither may be listed.
    const data = [
      row({ id: 'm1', committee: committee('c-own') }),
      row({ id: 'm2', committee: committee('c-foreign', true, OTHER_ORG) }),
      row({ id: 'm3', organizationId: OTHER_ORG, committee: committee('c-foreign-2', true, OTHER_ORG) }),
    ];
    const { service, findMany, count } = makeService(data);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(result.rows.map((r) => r.committee.id)).toEqual(['c-own']);
    expect(result.total).toBe(1);
    for (const call of [...findMany.mock.calls, ...count.mock.calls]) {
      const where = (call[0] as { where: { organizationId: string; committee: { organizationId: string } } }).where;
      expect(where.organizationId).toBe(ORG);
      expect(where.committee.organizationId).toBe(ORG);
    }

    // Another organisation's user is the identical refusal an invented id gets.
    const foreign = await service.forUser(ORG, { id: ME, permissions: ADMIN }, FOREIGN).catch((e: Error) => e);
    const invented = await service.forUser(ORG, { id: ME, permissions: ADMIN }, 'user-invented').catch((e: Error) => e);
    expect(foreign).toBeInstanceOf(NotFoundException);
    expect(invented).toBeInstanceOf(NotFoundException);
    expect((foreign as Error).message).toBe((invented as Error).message);
  });

  it('`current` is the ACC-281 rule: former memberships and inactive committees are listed, not current', async () => {
    const data = [
      row({ id: 'm1', committee: committee('c-active') }),
      row({ id: 'm2', committee: committee('c-inactive', false) }),
      row({ id: 'm3', committee: committee('c-left'), isActive: false, leftAt: d('2026-05-01') }),
    ];
    const { service } = makeService(data);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    const byId = Object.fromEntries(result.rows.map((r) => [r.committee.id, r.current]));
    expect(byId).toEqual({ 'c-active': true, 'c-inactive': false, 'c-left': false });
  });

  it('orders current first (by seat, then longest-served), then past by left date, newest first', async () => {
    const data = [
      row({ id: 'p-old', committee: committee('p-old'), isActive: false, leftAt: d('2025-01-01') }),
      row({ id: 'c-member', committee: committee('c-member'), roleValueId: 'seat-member', joinedAt: d('2024-01-01') }),
      row({ id: 'p-new', committee: committee('p-new'), isActive: false, leftAt: d('2026-06-01') }),
      row({ id: 'c-chair', committee: committee('c-chair'), roleValueId: 'seat-chair', joinedAt: d('2026-02-01') }),
      row({ id: 'p-inactive', committee: committee('p-inactive', false) }),
      row({ id: 'c-member-2', committee: committee('c-member-2'), roleValueId: 'seat-member', joinedAt: d('2025-01-01') }),
    ];
    const { service } = makeService(data);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(result.rows.map((r) => r.committee.id)).toEqual([
      'c-chair',
      'c-member',
      'c-member-2',
      'p-inactive',
      'p-new',
      'p-old',
    ]);
  });

  it("a relabelled seat keeps the SYSTEM value's id and layer and shows the organisation's label", async () => {
    const { service } = makeService([row({ id: 'm1', committee: committee('c1'), roleValueId: 'seat-chair' })]);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(result.rows[0]!.seat).toEqual({
      id: 'seat-chair',
      labelEn: 'Chair of the Committee',
      labelAr: 'Chair of the Committee (ar)',
      layer: 'SYSTEM',
    });
  });

  it('a seat getValues() leaves out is named from its own value, in ONE extra query', async () => {
    const { service, lookupFindMany } = makeService([
      row({ id: 'm1', committee: committee('c1'), roleValueId: 'seat-retired' }),
      row({ id: 'm2', committee: committee('c2'), roleValueId: 'seat-retired' }),
    ]);
    lookupFindMany.mockResolvedValue([{ id: 'seat-retired', labelEn: 'Rapporteur', labelAr: 'مقرر', organizationId: ORG }]);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(lookupFindMany).toHaveBeenCalledTimes(1);
    const where = (lookupFindMany.mock.calls[0]![0] as { where: unknown }).where;
    expect(where).toEqual({ id: { in: ['seat-retired'] }, OR: [{ organizationId: null }, { organizationId: ORG }] });
    expect(result.rows[0]!.seat).toEqual({ id: 'seat-retired', labelEn: 'Rapporteur', labelAr: 'مقرر', layer: 'TENANT' });
  });

  // The fallback seat read is the third new query; it gets its own isolation test
  // under the CI gate phrase. The mock APPLIES the where clause, so a fallback
  // that dropped its organisation scope would name the seat from another
  // organisation's value row.
  it('should NOT return records belonging to a different tenant — the fallback seat read', async () => {
    const { service, lookupFindMany } = makeService([
      row({ id: 'm1', committee: committee('c1'), roleValueId: 'seat-foreign' }),
      row({ id: 'm2', committee: committee('c2'), roleValueId: 'seat-own' }),
    ]);
    const VALUES = [
      { id: 'seat-foreign', labelEn: 'Other organisation seat', labelAr: 'مقعد منظمة أخرى', organizationId: OTHER_ORG },
      { id: 'seat-own', labelEn: 'Rapporteur', labelAr: 'مقرر', organizationId: ORG },
    ];
    lookupFindMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] }; OR?: { organizationId: string | null }[] } }) =>
        Promise.resolve(
          VALUES.filter(
            (v) => where.id.in.includes(v.id) && (!where.OR || where.OR.some((o) => o.organizationId === v.organizationId)),
          ),
        ),
    );
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    const seatOf = (committeeId: string) => result.rows.find((r) => r.committee.id === committeeId)!.seat;
    expect(seatOf('c1')).toEqual({ id: 'seat-foreign', labelEn: null, labelAr: null, layer: null });
    expect(seatOf('c2')).toEqual({ id: 'seat-own', labelEn: 'Rapporteur', labelAr: 'مقرر', layer: 'TENANT' });
  });

  it('no extra seat query when every seat is known', async () => {
    const { service, lookupFindMany } = makeService([row({ id: 'm1', committee: committee('c1') })]);
    await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(lookupFindMany).not.toHaveBeenCalled();
  });

  it(`reads at most ${USER_COMMITTEES_CAP} rows in one query; total counts past the cap`, async () => {
    const data = Array.from({ length: 230 }, (_, i) =>
      row({ id: `m${i}`, committee: committee(`c${String(i).padStart(3, '0')}`), isActive: false, leftAt: d('2026-01-01') }),
    );
    const { service, findMany, count } = makeService(data);
    const result = await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE);
    expect(result.rows.length).toBe(USER_COMMITTEES_CAP);
    expect(result.total).toBe(230);
    // The rows query (1) and the current set (1): two findMany calls, one count,
    // whatever the number of rows. No query per row.
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(count).toHaveBeenCalledTimes(1);
    expect((findMany.mock.calls[0]![0] as { take: number }).take).toBe(USER_COMMITTEES_CAP);
  });

  it('nobody on any committee: an empty list, total 0', async () => {
    const { service } = makeService([]);
    expect(await service.forUser(ORG, { id: ME, permissions: ADMIN }, COLLEAGUE)).toEqual({ total: 0, rows: [] });
  });
});
