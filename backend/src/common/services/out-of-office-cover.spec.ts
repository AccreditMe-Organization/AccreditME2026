import {
  activeCoverOf,
  coverEntries,
  coversOf,
  isOutOfOffice,
  routeWithCovers,
  type CoverClient,
  type TaskCover,
} from './out-of-office-cover';

/**
 * ACC-302 — the one copy of "away" and "who covers". The window test's three
 * callers keep their own specs (stage-pool.service.spec.ts,
 * task-authority.service.spec.ts, task-workload.spec.ts), unchanged: they pin
 * that moving it here changed nothing.
 */

const NOW = new Date('2026-11-14T10:00:00.000Z');
const BEFORE = new Date('2026-11-13T00:00:00.000Z');
const AFTER = new Date('2026-11-16T00:00:00.000Z');
const ORG = 'org-a';
const away = { outOfOfficeFrom: BEFORE, outOfOfficeTo: AFTER };
const here = { outOfOfficeFrom: null, outOfOfficeTo: null };

describe('isOutOfOffice', () => {
  it('needs both dates, and now inside them, inclusive', () => {
    expect(isOutOfOffice(away, NOW)).toBe(true);
    expect(isOutOfOffice({ outOfOfficeFrom: NOW, outOfOfficeTo: NOW }, NOW)).toBe(true);
    expect(isOutOfOffice({ outOfOfficeFrom: BEFORE, outOfOfficeTo: null }, NOW)).toBe(false);
    expect(isOutOfOffice({ outOfOfficeFrom: null, outOfOfficeTo: AFTER }, NOW)).toBe(false);
    expect(isOutOfOffice({ outOfOfficeFrom: AFTER, outOfOfficeTo: AFTER }, NOW)).toBe(false);
    expect(isOutOfOffice(here, NOW)).toBe(false);
  });
});

describe('activeCoverOf (StagePoolService\'s test)', () => {
  const cover = { status: 'ACTIVE', organizationId: ORG };
  it('is the acting user while away, when they are ACTIVE in the same organisation', () => {
    expect(activeCoverOf({ ...away, actingUserId: 'c', actingUser: cover }, ORG, NOW)).toBe('c');
  });
  it('is nobody when not away, with no acting user, an inactive one, or one in another organisation', () => {
    expect(activeCoverOf({ ...here, actingUserId: 'c', actingUser: cover }, ORG, NOW)).toBeNull();
    expect(activeCoverOf({ ...away, actingUserId: null, actingUser: null }, ORG, NOW)).toBeNull();
    expect(activeCoverOf({ ...away, actingUserId: 'c', actingUser: { ...cover, status: 'INACTIVE' } }, ORG, NOW)).toBeNull();
    expect(activeCoverOf({ ...away, actingUserId: 'c', actingUser: { ...cover, organizationId: 'org-b' } }, ORG, NOW)).toBeNull();
  });
});

describe('coversOf (the task rule)', () => {
  type Row = { id: string; outOfOfficeFrom: Date | null; outOfOfficeTo: Date | null; actingUserId: string | null; actingUser: { name: string; status: string; organizationId: string; outOfOfficeFrom: Date | null; outOfOfficeTo: Date | null } | null };
  const client = (rows: Row[]) => {
    const findMany = jest.fn().mockResolvedValue(rows);
    return { client: { user: { findMany } } as unknown as CoverClient, findMany };
  };
  const coverRow = (over: Partial<Row['actingUser']> = {}) => ({ name: 'Cover', status: 'ACTIVE', organizationId: ORG, ...here, ...over });

  it('maps an away person to an ACTIVE cover who is not away, in ONE read scoped by organisation', async () => {
    const { client: c, findMany } = client([{ id: 'a', ...away, actingUserId: 'c', actingUser: coverRow() }]);
    const covers = await coversOf(c, ORG, ['a', 'b', 'a'], NOW);
    expect(covers).toEqual(new Map([['a', { userId: 'c', name: 'Cover' }]]));
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ organizationId: ORG, id: { in: ['a', 'b'] }, status: 'ACTIVE', actingUserId: { not: null } });
  });

  it('one hop only: a cover who is away too means the task stays with the person', async () => {
    const { client: c } = client([{ id: 'a', ...away, actingUserId: 'c', actingUser: coverRow(away) }]);
    expect(await coversOf(c, ORG, ['a'], NOW)).toEqual(new Map());
  });

  it('nobody for an inactive cover or one in another organisation', async () => {
    const { client: c } = client([
      { id: 'a', ...away, actingUserId: 'c', actingUser: coverRow({ status: 'INACTIVE' }) },
      { id: 'b', ...away, actingUserId: 'x', actingUser: coverRow({ organizationId: 'org-b' }) },
    ]);
    expect(await coversOf(c, ORG, ['a', 'b'], NOW)).toEqual(new Map());
  });

  it('reads nothing for nobody', async () => {
    const { client: c, findMany } = client([]);
    expect(await coversOf(c, ORG, [], NOW)).toEqual(new Map());
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('routeWithCovers', () => {
  const covers = new Map<string, TaskCover>([['a', { userId: 'c', name: 'Cover' }]]);

  it('replaces the away person with the cover, stamped with whom it covers', () => {
    expect(routeWithCovers(['a'], covers)).toEqual({
      userIds: ['c'],
      delegations: new Map([['c', { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'a' }]]),
    });
  });

  it('leaves everyone else as they are', () => {
    expect(routeWithCovers(['b'], covers)).toEqual({ userIds: ['b'], delegations: new Map() });
  });

  it('a cover who is already one of the people is there in their own right: once, unstamped', () => {
    expect(routeWithCovers(['a', 'c'], covers)).toEqual({ userIds: ['c'], delegations: new Map() });
  });

  it('two people with one cover give the cover one row', () => {
    const both = new Map<string, TaskCover>([...covers, ['b', { userId: 'c', name: 'Cover' }]]);
    expect(routeWithCovers(['a', 'b'], both).userIds).toEqual(['c']);
  });
});

describe('coverEntries', () => {
  it('lists the OUT_OF_OFFICE_COVERAGE stamps by id, and nothing else', () => {
    expect(
      coverEntries(
        new Map([
          ['c', { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: 'a' }],
          ['h', { delegationReason: 'ACTING_HEAD', delegationContextId: 'unit' }],
        ]),
      ),
    ).toEqual([{ forUserId: 'a', coverUserId: 'c' }]);
    expect(coverEntries(undefined)).toEqual([]);
  });
});
