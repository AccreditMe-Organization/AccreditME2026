import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StagePoolRequest, StagePoolService } from './stage-pool.service';

// ACC-271 — StagePoolService against an in-memory fake that honours each
// query's organisation and `in` filters, so the spec proves the scoping and the
// batching (one call per kind, however many stages) rather than a mock's order.

const ORG = 'org-a';
const OTHER = 'org-b';
const NOW = new Date('2026-10-28T09:00:00Z');
const DAY = 24 * 3600 * 1000;

type Kind = 'SPECIFIC_USER' | 'POSITION_IN_UNIT' | 'ORG_UNIT_HEAD' | 'CREATOR' | 'COMMITTEE';
interface Entry {
  id: string;
  organizationId: string;
  stageId: string;
  order: number;
  kind: Kind;
  userId?: string | null;
  positionId?: string | null;
  orgUnitId?: string | null;
  committeeId?: string | null;
  committeeRoleValueId?: string | null;
}
interface UserRow {
  id: string;
  organizationId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'INVITED';
  name?: string;
  positionId?: string | null;
  primaryOrgUnitId?: string | null;
  headPosition?: boolean;
  outOfOfficeFrom?: Date | null;
  outOfOfficeTo?: Date | null;
  actingUserId?: string | null;
}
interface Data {
  entries: Entry[];
  users: UserRow[];
  instanceStages: {
    id: string;
    workflowInstanceId: string;
    organizationId: string;
    stageId: string;
    enteredAt: Date;
    actorId: string | null;
    exitedAt: Date | null;
    whoMode: string | null;
    objectType: string;
    objectId: string;
  }[];
  covers: { id: string; organizationId: string; orgUnitId: string; userId: string; validFrom: Date; validTo: Date | null; endedAt: Date | null }[];
  members: { organizationId: string; committeeId: string; userId: string; roleValueId: string; isActive: boolean }[];
  committees: { id: string; organizationId: string; orgUnitId: string }[];
}

const inOrEq = (filter: string | { in: string[] } | undefined, value: string | null | undefined): boolean =>
  filter === undefined ? true : typeof filter === 'string' ? filter === value : filter.in.includes(value as string);

function fakePrisma(data: Data) {
  const userById = (id: string | null | undefined) => data.users.find((u) => u.id === id);
  return {
    workflowStageAssignee: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string; stageId: { in: string[] } } }) =>
        data.entries
          .filter((e) => e.organizationId === where.organizationId && where.stageId.in.includes(e.stageId))
          .sort((a, b) => a.stageId.localeCompare(b.stageId) || a.order - b.order)
          .map((e) => ({ userId: null, positionId: null, orgUnitId: null, committeeId: null, committeeRoleValueId: null, ...e })),
      ),
      findFirst: jest.fn(async ({ where }: { where: { organizationId: string; stageId: string; kind: Kind } }) => {
        const e = data.entries
          .filter((x) => x.organizationId === where.organizationId && x.stageId === where.stageId && x.kind === where.kind)
          .sort((a, b) => a.order - b.order)[0];
        return e ? { committeeId: e.committeeId ?? null } : null;
      }),
    },
    workflowInstanceStage: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            workflowInstanceId?: { in: string[] };
            workflowInstance: { organizationId: string };
            exitedAt?: null;
            stage?: { whoMode: { not: null } };
          };
        }) => {
          let rows = data.instanceStages.filter((s) => s.organizationId === where.workflowInstance.organizationId);
          if (where.workflowInstanceId) rows = rows.filter((s) => where.workflowInstanceId!.in.includes(s.workflowInstanceId));
          if ('exitedAt' in where) rows = rows.filter((s) => s.exitedAt === null);
          if (where.stage) rows = rows.filter((s) => s.whoMode !== null);
          return [...rows]
            .sort((a, b) => a.enteredAt.getTime() - b.enteredAt.getTime())
            .map((s) => ({
              id: s.id,
              stageId: s.stageId,
              workflowInstanceId: s.workflowInstanceId,
              actorId: s.actorId,
              workflowInstance: { id: s.workflowInstanceId, objectType: s.objectType, objectId: s.objectId },
            }));
        },
      ),
    },
    user: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        let rows = data.users.filter((u) => u.organizationId === where['organizationId']);
        if (where['status']) rows = rows.filter((u) => u.status === where['status']);
        if (where['id']) rows = rows.filter((u) => inOrEq(where['id'] as { in: string[] }, u.id));
        if (where['primaryOrgUnitId']) rows = rows.filter((u) => inOrEq(where['primaryOrgUnitId'] as string, u.primaryOrgUnitId));
        if (where['position']) rows = rows.filter((u) => u.headPosition === true);
        if (where['OR']) {
          const pairs = where['OR'] as { positionId: string; primaryOrgUnitId: string }[];
          rows = rows.filter((u) => pairs.some((p) => p.positionId === u.positionId && p.primaryOrgUnitId === u.primaryOrgUnitId));
        }
        return rows.map((u) => {
          const acting = userById(u.actingUserId);
          return {
            id: u.id,
            name: u.name ?? u.id,
            status: u.status,
            positionId: u.positionId ?? null,
            primaryOrgUnitId: u.primaryOrgUnitId ?? null,
            position: { nameEn: 'Head', nameAr: null },
            outOfOfficeFrom: u.outOfOfficeFrom ?? null,
            outOfOfficeTo: u.outOfOfficeTo ?? null,
            actingUserId: u.actingUserId ?? null,
            actingUser: acting ? { status: acting.status, organizationId: acting.organizationId } : null,
          };
        });
      }),
    },
    orgUnitHeadAssignment: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string; orgUnitId: string | { in: string[] } } }) =>
        data.covers
          .filter((c) => c.organizationId === where.organizationId && inOrEq(where.orgUnitId, c.orgUnitId))
          .filter((c) => c.endedAt === null && c.validFrom <= NOW && (c.validTo === null || c.validTo > NOW))
          .map((c) => ({ ...c, reason: 'ABSENCE', user: { name: c.userId, primaryOrgUnitId: null } })),
      ),
    },
    committeeMember: {
      findMany: jest.fn(async ({ where }: { where: { organizationId: string; committeeId: { in: string[] } } }) =>
        data.members.filter((m) => m.organizationId === where.organizationId && where.committeeId.in.includes(m.committeeId) && m.isActive),
      ),
    },
    committee: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; organizationId: string } }) =>
        data.committees.filter((c) => c.organizationId === where.organizationId && where.id.in.includes(c.id)),
      ),
    },
    meeting: { findMany: jest.fn(async () => []) },
  };
}

const empty = (): Data => ({ entries: [], users: [], instanceStages: [], covers: [], members: [], committees: [] });
const active = (id: string, extra: Partial<UserRow> = {}): UserRow => ({ id, organizationId: ORG, status: 'ACTIVE', ...extra });
const committeeInstance = (id: string, objectId: string): StagePoolRequest['instance'] => ({ id, objectType: 'COMMITTEE', objectId });
const entry = (stageId: string, order: number, kind: Kind, extra: Partial<Entry> = {}): Entry => ({
  id: `${stageId}-${order}`,
  organizationId: ORG,
  stageId,
  order,
  kind,
  ...extra,
});

function service(data: Data) {
  const prisma = fakePrisma(data);
  return { prisma, pools: new StagePoolService(prisma as unknown as PrismaService) };
}
const one = async (data: Data, stageId = 's1', instance = committeeInstance('i1', 'c1'), org = ORG) => {
  const { pools } = service(data);
  return (await pools.resolveMany(org, [{ key: 'k', stageId, instance }], undefined, NOW)).get('k')!;
};

describe('StagePoolService (ACC-271)', () => {
  describe('each kind', () => {
    it('Specific user: that user', async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'SPECIFIC_USER', { userId: 'u1' }));
      data.users.push(active('u1'));
      expect((await one(data)).members).toEqual(['u1']);
    });

    it("Fixed position: the position's holders in that unit, and nobody holding it elsewhere", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'POSITION_IN_UNIT', { positionId: 'p1', orgUnitId: 'ou1' }));
      data.users.push(
        active('in', { positionId: 'p1', primaryOrgUnitId: 'ou1' }),
        active('elsewhere', { positionId: 'p1', primaryOrgUnitId: 'ou2' }),
        active('other-post', { positionId: 'p2', primaryOrgUnitId: 'ou1' }),
      );
      expect((await one(data)).members).toEqual(['in']);
    });

    it("Org unit head: a named unit's head holders and its acting cover in force, the cover marked as acting", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'ORG_UNIT_HEAD', { orgUnitId: 'ou1' }));
      data.users.push(active('head', { primaryOrgUnitId: 'ou1', headPosition: true }), active('cover'));
      data.covers.push({ id: 'a1', organizationId: ORG, orgUnitId: 'ou1', userId: 'cover', validFrom: new Date(NOW.getTime() - DAY), validTo: null, endedAt: null });
      const pool = await one(data);
      expect(pool.members.sort()).toEqual(['cover', 'head']);
      expect(pool.actingHeadOf.get('cover')).toBe('ou1');
      expect(pool.actingHeadOf.has('head')).toBe(false);
    });

    it("Org unit head with no unit: the record's own unit (plan gap 1), with no walk up to a parent", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'ORG_UNIT_HEAD'));
      data.committees.push({ id: 'c1', organizationId: ORG, orgUnitId: 'ou-record' });
      data.users.push(active('record-head', { primaryOrgUnitId: 'ou-record', headPosition: true }), active('parent-head', { primaryOrgUnitId: 'ou-parent', headPosition: true }));
      expect((await one(data)).members).toEqual(['record-head']);
    });

    it("Org unit head with no unit, on a kind of record with no route: nobody (fail closed)", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'ORG_UNIT_HEAD'));
      data.users.push(active('head', { primaryOrgUnitId: 'ou1', headPosition: true }));
      const pool = await one(data, 's1', { id: 'i1', objectType: 'DOCUMENT', objectId: 'd1' });
      expect(pool.members).toEqual([]);
    });

    it("A cover whose period has ended or not begun is not the unit's acting head", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'ORG_UNIT_HEAD', { orgUnitId: 'ou1' }));
      data.users.push(active('ended'), active('future'));
      data.covers.push(
        { id: 'a1', organizationId: ORG, orgUnitId: 'ou1', userId: 'ended', validFrom: new Date(NOW.getTime() - 3 * DAY), validTo: null, endedAt: new Date(NOW.getTime() - DAY) },
        { id: 'a2', organizationId: ORG, orgUnitId: 'ou1', userId: 'future', validFrom: new Date(NOW.getTime() + DAY), validTo: null, endedAt: null },
      );
      expect((await one(data)).members).toEqual([]);
    });

    it("Creator: whoever moved the record into its first stage", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'CREATOR'));
      data.users.push(active('starter'), active('later'));
      data.instanceStages.push(
        { id: 'e2', workflowInstanceId: 'i1', organizationId: ORG, stageId: 's1', enteredAt: new Date(NOW.getTime() - DAY), actorId: 'later', exitedAt: null, whoMode: 'ANY_ONE', objectType: 'COMMITTEE', objectId: 'c1' },
        { id: 'e1', workflowInstanceId: 'i1', organizationId: ORG, stageId: 's0', enteredAt: new Date(NOW.getTime() - 2 * DAY), actorId: 'starter', exitedAt: NOW, whoMode: null, objectType: 'COMMITTEE', objectId: 'c1' },
      );
      expect((await one(data)).members).toEqual(['starter']);
    });

    it('Committee: its active members, narrowed to the role when one is set', async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'COMMITTEE', { committeeId: 'cX', committeeRoleValueId: 'chair' }));
      data.users.push(active('chair-1'), active('member-1'), active('gone'));
      data.members.push(
        { organizationId: ORG, committeeId: 'cX', userId: 'chair-1', roleValueId: 'chair', isActive: true },
        { organizationId: ORG, committeeId: 'cX', userId: 'member-1', roleValueId: 'member', isActive: true },
        { organizationId: ORG, committeeId: 'cX', userId: 'gone', roleValueId: 'chair', isActive: false },
      );
      const pool = await one(data);
      expect(pool.members).toEqual(['chair-1']);
      expect(pool.voteCommitteeId).toBe('cX');
    });

    it("Committee with no committee: the record's own committee", async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'COMMITTEE'));
      data.committees.push({ id: 'c1', organizationId: ORG, orgUnitId: 'ou1' });
      data.users.push(active('m1'));
      data.members.push({ organizationId: ORG, committeeId: 'c1', userId: 'm1', roleValueId: 'member', isActive: true });
      const pool = await one(data);
      expect(pool.members).toEqual(['m1']);
      expect(pool.voteCommitteeId).toBe('c1');
    });
  });

  it('joins the entries with "or" and lists each person once', async () => {
    const data = empty();
    data.entries.push(
      entry('s1', 1, 'SPECIFIC_USER', { userId: 'u1' }),
      entry('s1', 2, 'POSITION_IN_UNIT', { positionId: 'p1', orgUnitId: 'ou1' }),
      entry('s1', 3, 'SPECIFIC_USER', { userId: 'u2' }),
    );
    data.users.push(active('u1', { positionId: 'p1', primaryOrgUnitId: 'ou1' }), active('u2'));
    expect((await one(data)).members).toEqual(['u1', 'u2']);
  });

  it('a stage with no entries has nobody', async () => {
    const pool = await one(empty());
    expect(pool).toMatchObject({ members: [], direct: [], voteCommitteeId: null });
  });

  describe('ACTIVE only', () => {
    it.each(['INACTIVE', 'INVITED'] as const)('drops a %s person, whichever kind named them', async (status) => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'SPECIFIC_USER', { userId: 'u1' }), entry('s1', 2, 'COMMITTEE', { committeeId: 'cX' }));
      data.users.push({ id: 'u1', organizationId: ORG, status }, { id: 'm1', organizationId: ORG, status }, active('m2'));
      data.members.push(
        { organizationId: ORG, committeeId: 'cX', userId: 'm1', roleValueId: 'member', isActive: true },
        { organizationId: ORG, committeeId: 'cX', userId: 'm2', roleValueId: 'member', isActive: true },
      );
      // A deactivated committee member is out of the pool (plan gap 4).
      expect((await one(data)).members).toEqual(['m2']);
    });
  });

  describe('out of office', () => {
    const away = { outOfOfficeFrom: new Date(NOW.getTime() - DAY), outOfOfficeTo: new Date(NOW.getTime() + DAY) };

    it('puts an away member\'s acting user in their place, and says whom they cover', async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'SPECIFIC_USER', { userId: 'away' }));
      data.users.push(active('away', { ...away, actingUserId: 'stand-in' }), active('stand-in'));
      const pool = await one(data);
      expect(pool.members).toEqual(['stand-in']);
      expect(pool.direct).toEqual(['away']);
      expect(pool.coveringFor.get('stand-in')).toBe('away');
    });

    it('keeps the member when their acting user is not ACTIVE', async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'SPECIFIC_USER', { userId: 'away' }));
      data.users.push(active('away', { ...away, actingUserId: 'left' }), { id: 'left', organizationId: ORG, status: 'INACTIVE' });
      expect((await one(data)).members).toEqual(['away']);
    });

    it('keeps the member outside their absence window', async () => {
      const data = empty();
      data.entries.push(entry('s1', 1, 'SPECIFIC_USER', { userId: 'back' }));
      data.users.push(
        active('back', { outOfOfficeFrom: new Date(NOW.getTime() - 3 * DAY), outOfOfficeTo: new Date(NOW.getTime() - DAY), actingUserId: 'stand-in' }),
        active('stand-in'),
      );
      expect((await one(data)).members).toEqual(['back']);
    });
  });

  it('resolves many stages and records with one query per kind (the performance rule)', async () => {
    const data = empty();
    const requests: StagePoolRequest[] = [];
    for (let i = 0; i < 12; i++) {
      const stageId = `s${i}`;
      data.entries.push(
        entry(stageId, 1, 'SPECIFIC_USER', { userId: `u${i}` }),
        entry(stageId, 2, 'POSITION_IN_UNIT', { positionId: 'p1', orgUnitId: `ou${i}` }),
        entry(stageId, 3, 'ORG_UNIT_HEAD'),
        entry(stageId, 4, 'COMMITTEE'),
        entry(stageId, 5, 'CREATOR'),
      );
      data.users.push(active(`u${i}`), active(`h${i}`, { primaryOrgUnitId: `ou-c${i}`, headPosition: true }));
      data.committees.push({ id: `c${i}`, organizationId: ORG, orgUnitId: `ou-c${i}` });
      requests.push({ key: `k${i}`, stageId, instance: committeeInstance(`i${i}`, `c${i}`) });
    }
    const { prisma, pools } = service(data);
    const result = await pools.resolveMany(ORG, requests, undefined, NOW);
    expect(result.size).toBe(12);
    expect(result.get('k3')!.members.sort()).toEqual(['h3', 'u3']);
    expect(prisma.workflowStageAssignee.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.workflowInstanceStage.findMany).toHaveBeenCalledTimes(1); // creators
    expect(prisma.committee.findMany).toHaveBeenCalledTimes(2); // the records' units, the records' committees
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledTimes(1);
    // Fixed positions, unit heads, and the final status/absence read.
    expect(prisma.user.findMany).toHaveBeenCalledTimes(3);
  });

  itEnforcesTenantIsolation('StagePoolService.resolveMany — entries, records and people are read in the caller\'s organisation only', async () => {
    const data = empty();
    // Org B's own entries on the same stage id, and Org B people everywhere.
    data.entries.push(
      entry('s1', 1, 'SPECIFIC_USER', { userId: 'b-user', organizationId: OTHER }),
      entry('s1', 1, 'ORG_UNIT_HEAD'),
      entry('s1', 2, 'COMMITTEE'),
      entry('s1', 3, 'SPECIFIC_USER', { userId: 'b-named' }),
    );
    data.committees.push({ id: 'c1', organizationId: OTHER, orgUnitId: 'ou-b' });
    data.users.push(
      { id: 'b-user', organizationId: OTHER, status: 'ACTIVE' },
      { id: 'b-named', organizationId: OTHER, status: 'ACTIVE' },
      { id: 'b-head', organizationId: OTHER, status: 'ACTIVE', primaryOrgUnitId: 'ou-b', headPosition: true },
    );
    data.members.push({ organizationId: OTHER, committeeId: 'c1', userId: 'b-user', roleValueId: 'member', isActive: true });
    const { prisma, pools } = service(data);
    const pool = (await pools.resolveMany(ORG, [{ key: 'k', stageId: 's1', instance: committeeInstance('i1', 'c1') }], undefined, NOW)).get('k')!;
    expect(pool.members).toEqual([]);
    for (const call of [...prisma.workflowStageAssignee.findMany.mock.calls, ...prisma.user.findMany.mock.calls, ...prisma.committee.findMany.mock.calls]) {
      expect((call[0] as { where: { organizationId: string } }).where.organizationId).toBe(ORG);
    }
  });

  describe('voteCommitteeId', () => {
    it("is the stage's Committee entry's own committee, else the record's", async () => {
      const data = empty();
      data.entries.push(entry('named', 1, 'COMMITTEE', { committeeId: 'cX' }), entry('relative', 1, 'COMMITTEE'));
      data.committees.push({ id: 'c1', organizationId: ORG, orgUnitId: 'ou1' });
      const { pools } = service(data);
      expect(await pools.voteCommitteeId(ORG, 'named', { objectType: 'COMMITTEE', objectId: 'c1' })).toBe('cX');
      expect(await pools.voteCommitteeId(ORG, 'relative', { objectType: 'COMMITTEE', objectId: 'c1' })).toBe('c1');
      expect(await pools.voteCommitteeId(ORG, 'none', { objectType: 'COMMITTEE', objectId: 'c1' })).toBeNull();
    });
  });

  describe('openEntriesWithMember', () => {
    it("lists the open entries of converted stages whose pool holds the person, directly or standing in", async () => {
      const data = empty();
      const base = { organizationId: ORG, enteredAt: NOW, actorId: 'x', objectType: 'COMMITTEE', objectId: 'c1' };
      data.instanceStages.push(
        { ...base, id: 'open-in', workflowInstanceId: 'i1', stageId: 's-in', exitedAt: null, whoMode: 'ALL' },
        { ...base, id: 'open-standing-in', workflowInstanceId: 'i2', stageId: 's-cover', exitedAt: null, whoMode: 'ALL' },
        { ...base, id: 'open-not', workflowInstanceId: 'i3', stageId: 's-not', exitedAt: null, whoMode: 'ALL' },
        { ...base, id: 'closed', workflowInstanceId: 'i4', stageId: 's-in', exitedAt: NOW, whoMode: 'ALL' },
        { ...base, id: 'unconverted', workflowInstanceId: 'i5', stageId: 's-in', exitedAt: null, whoMode: null },
      );
      data.entries.push(
        entry('s-in', 1, 'SPECIFIC_USER', { userId: 'leaver' }),
        entry('s-cover', 1, 'SPECIFIC_USER', { userId: 'away' }),
        entry('s-not', 1, 'SPECIFIC_USER', { userId: 'someone' }),
      );
      data.users.push(
        active('leaver'),
        active('someone'),
        active('away', { outOfOfficeFrom: new Date(Date.now() - DAY), outOfOfficeTo: new Date(Date.now() + DAY), actingUserId: 'leaver' }),
      );
      const { pools } = service(data);
      expect((await pools.openEntriesWithMember(ORG, 'leaver')).sort()).toEqual(['open-in', 'open-standing-in']);
    });
  });
});
