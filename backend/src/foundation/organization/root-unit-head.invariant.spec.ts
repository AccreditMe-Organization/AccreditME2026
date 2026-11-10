import { Logger } from '@nestjs/common';
import { ROOT_UNIT_NEEDS_HEAD, RootUnitNeedsHeadRefusal } from './org-unit-refusals';
import {
  RootHeadInvariantClient,
  assertRootUnitRetainsAHead,
  captureRootHeadBaseline,
  reportRootUnitHeadBreach,
} from './root-unit-head.invariant';
import { useFixedClock } from '../../common/testing/fixed-clock';

// ACC-288 — the root unit always keeps a head or an acting head in force.
//
// An in-memory client that applies the WHERE shapes unit-headship.ts sends
// (headHolderWhere: ACTIVE, on an active head position; runningActingCoverWhere:
// an ACTING period not ended, started, not lapsed), scoped by organisation and
// unit. So "an inactive head position" and "a cover that starts next month" are
// decided by the same filters the code uses, not by a stub's say-so.

const NOW = new Date('2026-11-10T09:00:00.000Z');
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const PLATFORM = 'org-platform';

interface FakeUser {
  id: string;
  organizationId: string;
  primaryOrgUnitId: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED';
  position: { isUnitHeadPosition: boolean; isActive: boolean } | null;
}
interface FakeCover {
  id: string;
  organizationId: string;
  orgUnitId: string;
  userId: string;
  validFrom: Date;
  validTo: Date | null;
  endedAt: Date | null;
}

interface World {
  orgs: { id: string; isPlatformOrg: boolean }[];
  units: { id: string; organizationId: string; parentId: string | null; nameEn: string; nameAr: string | null; createdAt: Date }[];
  users: FakeUser[];
  covers: FakeCover[];
}

const ROOT_A = { id: 'root-a', organizationId: ORG_A, parentId: null, nameEn: 'Al-Nakheel Hospital', nameAr: 'مستشفى النخيل', createdAt: new Date('2026-01-01') };
const ROOT_B = { id: 'root-b', organizationId: ORG_B, parentId: null, nameEn: 'Al-Manara Group', nameAr: null, createdAt: new Date('2026-01-01') };
const ROOT_P = { id: 'root-p', organizationId: PLATFORM, parentId: null, nameEn: 'Platform', nameAr: null, createdAt: new Date('2026-01-01') };
const HEAD_POSITION = { isUnitHeadPosition: true, isActive: true };

const head = (id: string, over: Partial<FakeUser> = {}): FakeUser => ({
  id,
  organizationId: ORG_A,
  primaryOrgUnitId: ROOT_A.id,
  status: 'ACTIVE',
  position: HEAD_POSITION,
  ...over,
});
const cover = (id: string, over: Partial<FakeCover> = {}): FakeCover => ({
  id,
  organizationId: ORG_A,
  orgUnitId: ROOT_A.id,
  userId: 'acting',
  validFrom: new Date('2026-11-01T00:00:00.000Z'),
  validTo: null,
  endedAt: null,
  ...over,
});

interface UserWhere {
  organizationId?: string;
  primaryOrgUnitId?: string;
  status?: string;
  position?: { isUnitHeadPosition?: boolean; isActive?: boolean };
}
interface CoverWhere {
  organizationId?: string;
  orgUnitId?: string;
  kind?: string;
  endedAt?: null;
  validFrom?: { lte?: Date };
  OR?: ({ validTo: null } | { validTo: { gt: Date } })[];
}

/** Each field present in `where` must hold; a field the code omits filters nothing. */
function matchesUser(u: FakeUser, where: UserWhere): boolean {
  if (where.organizationId !== undefined && u.organizationId !== where.organizationId) return false;
  if (where.primaryOrgUnitId !== undefined && u.primaryOrgUnitId !== where.primaryOrgUnitId) return false;
  if (where.status !== undefined && u.status !== where.status) return false;
  if (where.position) {
    if (!u.position) return false;
    if (where.position.isUnitHeadPosition !== undefined && u.position.isUnitHeadPosition !== where.position.isUnitHeadPosition) return false;
    if (where.position.isActive !== undefined && u.position.isActive !== where.position.isActive) return false;
  }
  return true;
}

function matchesCover(c: FakeCover, where: CoverWhere): boolean {
  if (where.organizationId !== undefined && c.organizationId !== where.organizationId) return false;
  if (where.orgUnitId !== undefined && c.orgUnitId !== where.orgUnitId) return false;
  if (where.kind !== undefined && where.kind !== 'ACTING') return false;
  if (where.endedAt === null && c.endedAt !== null) return false;
  if (where.validFrom?.lte !== undefined && !(c.validFrom <= where.validFrom.lte)) return false;
  if (where.OR) {
    const ok = where.OR.some((clause) =>
      clause.validTo === null ? c.validTo === null : c.validTo !== null && c.validTo > clause.validTo.gt,
    );
    if (!ok) return false;
  }
  return true;
}

function makeClient(world: World): RootHeadInvariantClient & { lockKeys: string[] } {
  const lockKeys: string[] = [];
  const client = {
    lockKeys,
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      lockKeys.push(String(values[0]));
      return Promise.resolve([]);
    }),
    organization: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(world.orgs.find((o) => o.id === where.id) ?? null),
      ),
    },
    orgUnit: {
      findFirst: jest.fn(({ where }: { where: { organizationId: string; parentId: null } }) =>
        Promise.resolve(
          world.units
            .filter((u) => u.organizationId === where.organizationId && u.parentId === null)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr }))[0] ?? null,
        ),
      ),
    },
    user: {
      // Evaluates the WHERE the code sends (headHolderWhere(), from
      // unit-headship.ts): a field the code stops asking for stops filtering.
      findMany: jest.fn(({ where }: { where: UserWhere }) =>
        Promise.resolve(
          world.users
            .filter((u) => matchesUser(u, where))
            .map((u) => ({ id: u.id, name: u.id, positionId: 'p', primaryOrgUnitId: u.primaryOrgUnitId, position: null })),
        ),
      ),
    },
    orgUnitHeadAssignment: {
      // Evaluates the WHERE the code sends (runningActingCoverWhere(now)).
      findMany: jest.fn(({ where }: { where: CoverWhere }) =>
        Promise.resolve(
          world.covers
            .filter((c) => matchesCover(c, where))
            .map((c) => ({
              id: c.id,
              orgUnitId: c.orgUnitId,
              userId: c.userId,
              reason: 'ABSENCE',
              validFrom: c.validFrom,
              validTo: c.validTo,
              user: { name: c.userId, primaryOrgUnitId: null },
            })),
        ),
      ),
    },
  };
  return client as unknown as RootHeadInvariantClient & { lockKeys: string[] };
}

function world(over: Partial<World> = {}): World {
  return {
    orgs: [
      { id: ORG_A, isPlatformOrg: false },
      { id: ORG_B, isPlatformOrg: false },
      { id: PLATFORM, isPlatformOrg: true },
    ],
    units: [ROOT_A, ROOT_B, ROOT_P],
    users: [],
    covers: [],
    ...over,
  };
}

/** Baseline, then `change` (a mutation of the world), then the assertion. */
async function run(w: World, change: (w: World) => void, organizationId = ORG_A): Promise<void> {
  const client = makeClient(w);
  const baseline = await captureRootHeadBaseline(organizationId, client);
  change(w);
  await assertRootUnitRetainsAHead(organizationId, client, baseline);
}

describe('root-unit-head.invariant (ACC-288)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    useFixedClock(NOW);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('refuses headed → headless, naming the root, with ROOT_UNIT_NEEDS_HEAD', async () => {
    const w = world({ users: [head('h1')] });
    const refusal = await run(w, (x) => (x.users[0]!.status = 'INACTIVE')).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(RootUnitNeedsHeadRefusal);
    const body = (refusal as RootUnitNeedsHeadRefusal).getResponse() as Record<string, unknown>;
    expect(body).toEqual(
      expect.objectContaining({ statusCode: 409, code: ROOT_UNIT_NEEDS_HEAD, unitId: ROOT_A.id, unitNameEn: ROOT_A.nameEn, unitNameAr: ROOT_A.nameAr }),
    );
  });

  it('passes head → cover only (the head leaves while a cover is in force)', async () => {
    const w = world({ users: [head('h1')], covers: [cover('c1')] });
    await expect(run(w, (x) => (x.users[0]!.status = 'INACTIVE'))).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('passes cover → head only (the cover ends while a head holds the root)', async () => {
    const w = world({ users: [head('h1')], covers: [cover('c1')] });
    await expect(run(w, (x) => (x.covers[0]!.endedAt = NOW))).resolves.toBeUndefined();
  });

  it('refuses ending the only cover when the root has no head holder', async () => {
    const w = world({ covers: [cover('c1')] });
    await expect(run(w, (x) => (x.covers[0]!.endedAt = NOW))).rejects.toBeInstanceOf(RootUnitNeedsHeadRefusal);
  });

  it('headless before AND after: allowed, with one logged line naming ids only', async () => {
    const w = world({ users: [head('h1', { status: 'INACTIVE' })] });
    await expect(run(w, () => undefined)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0]![0]);
    expect(line).toContain(ORG_A);
    expect(line).toContain(ROOT_A.id);
    expect(line).not.toContain(ROOT_A.nameEn);
  });

  it('skips the platform organisation, which has no root head to keep', async () => {
    const w = world({ users: [head('ph', { organizationId: PLATFORM, primaryOrgUnitId: ROOT_P.id })] });
    await expect(run(w, (x) => (x.users[0]!.status = 'INACTIVE'), PLATFORM)).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('a head holder on an INACTIVE head position does not count', async () => {
    const client = makeClient(world({ users: [head('h1', { position: { isUnitHeadPosition: true, isActive: false } })] }));
    expect(await captureRootHeadBaseline(ORG_A, client)).toBe(false);
  });

  it('a cover that starts next month does not count', async () => {
    const client = makeClient(world({ covers: [cover('c1', { validFrom: new Date('2026-12-01T00:00:00.000Z') })] }));
    expect(await captureRootHeadBaseline(ORG_A, client)).toBe(false);
  });

  it('a cover that lapsed on its own date does not count', async () => {
    const client = makeClient(world({ covers: [cover('c1', { validTo: new Date('2026-11-05T00:00:00.000Z') })] }));
    expect(await captureRootHeadBaseline(ORG_A, client)).toBe(false);
  });

  it('should NOT return records belonging to a different tenant — another organisation\'s root head never counts', async () => {
    // Org B's root is headed; org A's is not. Org A must read as headless, and
    // every read is scoped to org A.
    const w = world({ users: [head('b-head', { organizationId: ORG_B, primaryOrgUnitId: ROOT_B.id })], covers: [cover('b-cover', { organizationId: ORG_B, orgUnitId: ROOT_B.id })] });
    const client = makeClient(w);
    expect(await captureRootHeadBaseline(ORG_A, client)).toBe(false);
    for (const call of (client.user.findMany as unknown as jest.Mock).mock.calls) expect(call[0].where.organizationId).toBe(ORG_A);
    for (const call of (client.orgUnitHeadAssignment.findMany as unknown as jest.Mock).mock.calls) expect(call[0].where.organizationId).toBe(ORG_A);
    for (const call of (client.orgUnit.findFirst as unknown as jest.Mock).mock.calls) expect(call[0].where.organizationId).toBe(ORG_A);
  });

  it('takes the per-organisation lock before it reads anything', async () => {
    const client = makeClient(world({ users: [head('h1')] }));
    await captureRootHeadBaseline(ORG_A, client);
    expect(client.lockKeys).toEqual(['root-head:org-a']);
    const lockOrder = (client.$queryRaw as unknown as jest.Mock).mock.invocationCallOrder[0]!;
    const firstRead = (client.organization.findFirst as unknown as jest.Mock).mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(firstRead);
  });

  describe('reportRootUnitHeadBreach — for the handover sweep, which no person can be refused', () => {
    it('logs a breach and never throws', async () => {
      const w = world({ users: [head('h1')] });
      const client = makeClient(w);
      const baseline = await captureRootHeadBaseline(ORG_A, client);
      w.users[0]!.status = 'INACTIVE';
      await expect(reportRootUnitHeadBreach(ORG_A, client, baseline)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toContain(ROOT_A.id);
    });

    it('says nothing when the root is still headed', async () => {
      const w = world({ users: [head('h1'), head('h2')] });
      const client = makeClient(w);
      const baseline = await captureRootHeadBaseline(ORG_A, client);
      w.users[0]!.status = 'INACTIVE';
      await reportRootUnitHeadBreach(ORG_A, client, baseline);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
