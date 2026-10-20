/**
 * ACC-120 slice 11 — the organisation read model against a REAL Postgres
 * (npm run test:db).
 *
 * The unit spec evaluates the where clauses in memory. Only a database proves
 * the queries themselves: the `in` lists, the relation filter on the holder's
 * position, the cover window's date comparisons, the grouped counts, and that
 * another organisation's rows — including rows that point at this
 * organisation's unit ids — are never read.
 *
 * The same 7-level tree as the unit spec, created here and torn down after.
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgStructureService } from './org-structure.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const ALL = ['org:view', 'org:manage', 'users:view', 'committees:view', 'setup:view'];

describe('The organisation read model against a real database (ACC-120 slice 11)', () => {
  const prisma = new PrismaService();
  const service = new OrgStructureService(prisma);
  const orgIds: string[] = [];
  let A: Record<string, string>;
  let orgA: string;
  let orgB: string;

  async function organization(prefix: string) {
    const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    orgIds.push(o.id);
    return o.id;
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    orgA = await organization('acc120b-a');
    orgB = await organization('acc120b-b');
    const s = randomUUID().slice(0, 6);

    const unit = async (organizationId: string, key: string, parentId: string | null, over: Record<string, unknown> = {}) =>
      (
        await prisma.orgUnit.create({
          data: { organizationId, nameEn: key.toUpperCase(), code: `${key}-${s}`.slice(0, 20), parentId, ...over },
        })
      ).id;

    const u0 = await unit(orgA, 'u0', null);
    const u1 = await unit(orgA, 'u1', u0, { sortOrder: 1 });
    const u1b = await unit(orgA, 'u1b', u0, { sortOrder: 2 });
    const u1x = await unit(orgA, 'u1x', u0, { isActive: false });
    const u2 = await unit(orgA, 'u2', u1);
    const u3 = await unit(orgA, 'u3', u2, { nameAr: 'الصيدلية' });
    const u4 = await unit(orgA, 'u4', u3, { nameEn: 'A-U4' });
    const u4b = await unit(orgA, 'u4b', u3, { nameEn: 'B-U4B' });
    const u5 = await unit(orgA, 'u5', u4);
    const u5x = await unit(orgA, 'u5x', u4, { isActive: false });
    const u6 = await unit(orgA, 'u6', u5);
    const c1 = await unit(orgA, 'c1', null);
    const c2 = await unit(orgA, 'c2', c1);
    await prisma.orgUnit.update({ where: { id: c1 }, data: { parentId: c2 } }); // a loop, written directly
    A = { u0, u1, u1b, u1x, u2, u3, u4, u4b, u5, u5x, u6, c1, c2 };

    // B: a unit that claims A's u0 as its parent, and B people in A's units.
    const bUnit = await unit(orgB, 'bunit', u0);
    A['bUnit'] = bUnit;

    const position = (organizationId: string, nameEn: string, grade: number, over: Record<string, unknown> = {}) =>
      prisma.orgPosition.create({ data: { organizationId, nameEn: `${nameEn}-${s}`, grade, ...over } });
    const head = await position(orgA, 'Director', 10, { isUnitHeadPosition: true, isSingleAssignee: true });
    const oldHead = await position(orgA, 'Old Director', 10, { isUnitHeadPosition: true, isActive: false });
    const staff = await position(orgA, 'Pharmacist', 5);
    const bHead = await position(orgB, 'Director', 10, { isUnitHeadPosition: true });

    const user = async (organizationId: string, key: string, primaryOrgUnitId: string, positionId: string | null, over: Record<string, unknown> = {}) =>
      (
        await prisma.user.create({
          data: { organizationId, email: `${key}-${s}@example.test`, name: `Person ${key}`, status: 'ACTIVE', primaryOrgUnitId, positionId, ...over },
        })
      ).id;

    const fahad = await user(orgA, 'fahad', u3, head.id);
    const huda = await user(orgA, 'huda', u3, head.id);
    await user(orgA, 'p1', u3, staff.id);
    await user(orgA, 'p2', u3, staff.id);
    await user(orgA, 'gone', u3, staff.id, { status: 'INACTIVE' });
    await user(orgA, 'old', u2, oldHead.id);
    const tariq = await user(orgA, 'tariq', u1, staff.id);
    await user(orgB, 'bhead', u2, bHead.id);
    await user(orgB, 'bstaff', u3, null);
    A['fahad'] = fahad;
    A['huda'] = huda;
    A['tariq'] = tariq;
    await prisma.orgUnit.update({ where: { id: u3 }, data: { pendingHeadUserId: huda } });

    const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const now = new Date();
    const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);
    await prisma.orgUnitHeadAssignment.createMany({
      data: [
        { organizationId: orgA, orgUnitId: u2, userId: tariq, kind: 'ACTING', reason: 'VACANCY', validFrom: inDays(-10), createdById: fahad },
        { organizationId: orgA, orgUnitId: u1, userId: fahad, kind: 'ACTING', reason: 'ABSENCE', validFrom: inDays(-60), validTo: inDays(-30), createdById: fahad },
        { organizationId: orgA, orgUnitId: u5, userId: fahad, kind: 'ACTING', reason: 'ABSENCE', validFrom: inDays(30), createdById: fahad },
        { organizationId: orgB, orgUnitId: u3, userId: tariq, kind: 'ACTING', reason: 'VACANCY', validFrom: inDays(-10), createdById: fahad },
      ],
    });

    await prisma.committee.createMany({
      data: [
        { organizationId: orgA, nameEn: 'P&T', typeValueId: 'type', orgUnitId: u3 },
        { organizationId: orgA, nameEn: 'Old', typeValueId: 'type', orgUnitId: u3, isActive: false },
        { organizationId: orgB, nameEn: 'B committee', typeValueId: 'type', orgUnitId: u3 },
      ],
    });

    await prisma.setupCondition.createMany({
      data: [
        { organizationId: orgA, type: 'ORG_UNIT_WITHOUT_HEAD', severity: 'AT_RISK', objectId: u1, subject: {}, openedAt: day('2026-09-01'), lastSeenAt: now },
        { organizationId: orgB, type: 'ORG_UNIT_WITHOUT_HEAD', severity: 'BLOCKS_WORK', objectId: u3, subject: {}, openedAt: day('2026-09-01'), lastSeenAt: now },
      ],
    });
  });

  afterAll(async () => {
    const where = { organizationId: { in: orgIds } };
    await prisma.setupCondition.deleteMany({ where });
    await prisma.committee.deleteMany({ where });
    await prisma.orgUnitHeadAssignment.deleteMany({ where });
    await prisma.orgUnit.updateMany({ where, data: { parentId: null, pendingHeadUserId: null } });
    await prisma.user.deleteMany({ where });
    await prisma.orgUnit.deleteMany({ where });
    await prisma.orgPosition.deleteMany({ where });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    const left = await prisma.orgUnit.count({ where });
    expect(left).toBe(0);
    await prisma.onModuleDestroy();
  });

  const byId = <T extends { id: string }>(nodes: T[]) => new Map(nodes.map((n) => [n.id, n]));

  it('the chart from the top unit: four levels, tree order, no inactive unit, nothing of B', async () => {
    const chart = await service.chart(orgA, ALL, { rootId: A['u0'] });
    expect(chart.nodes.map((n) => [n.id, n.depth])).toEqual([
      [A['u0'], 0],
      [A['u1'], 1],
      [A['u2'], 2],
      [A['u3'], 3],
      [A['u1b'], 1],
    ]);
    const nodes = byId(chart.nodes);
    expect(nodes.get(A['u0']!)!.childCount).toBe(2); // not u1x (inactive), not B's unit
    expect(nodes.get(A['u3']!)!.childCount).toBe(2); // u4 and u4b, below the cut
  });

  it('re-rooted at a level-3 unit: the path from the top and the window below', async () => {
    const chart = await service.chart(orgA, ALL, { rootId: A['u3'] });
    expect(chart.root.path.map((p) => p.id)).toEqual([A['u0'], A['u1'], A['u2'], A['u3']]);
    expect(chart.root.path[3]).toEqual({ id: A['u3'], nameEn: 'U3', nameAr: 'الصيدلية' });
    expect(chart.nodes.map((n) => [n.id, n.depth])).toEqual([
      [A['u3'], 0],
      [A['u4'], 1],
      [A['u5'], 2],
      [A['u6'], 3],
      [A['u4b'], 1],
    ]);
    expect(byId(chart.nodes).get(A['u4']!)!.childCount).toBe(1); // u5x is inactive
  });

  it('a loop in the data ends every walk', async () => {
    const chart = await service.chart(orgA, ALL, { rootId: A['c1'] });
    expect(chart.nodes.map((n) => n.id)).toEqual([A['c1'], A['c2']]);
    expect(chart.root.path.map((p) => p.id)).toEqual([A['c2'], A['c1']]);
    const { nodes } = await service.structure(orgA, ALL);
    expect(nodes.filter((n) => n.id === A['c1'] || n.id === A['c2'])).toHaveLength(2);
  });

  it('heads by the holder rule, the incoming successor, the cover in force and countedHere', async () => {
    const { nodes } = await service.structure(orgA, ALL);
    const map = byId(nodes);
    const u3 = map.get(A['u3']!)!;
    expect(u3.heads.map((h) => [h.userId, h.role, h.countedHere]).sort()).toEqual(
      [
        [A['fahad'], 'substantive', true],
        [A['huda'], 'incoming', true],
      ].sort(),
    );
    expect(u3.headcount).toBe(4); // fahad, huda, p1, p2; not 'gone', not B's person
    expect(u3.committees.count).toBe(1);
    expect(u3.acting).toBeNull(); // B's cover on this unit id is not A's
    expect(map.get(A['u2']!)!.heads).toEqual([]); // a deactivated head position; B's head
    expect(map.get(A['u2']!)!.acting).toEqual(
      expect.objectContaining({ userId: A['tariq'], reason: 'VACANCY', name: 'Person tariq', countedHere: false }),
    );
    expect(map.get(A['u1']!)!.acting).toBeNull(); // lapsed
    expect(map.get(A['u5']!)!.acting).toBeNull(); // not started
  });

  it('attention for setup:view only, from this organisation\'s conditions', async () => {
    const withSetup = byId((await service.structure(orgA, ALL)).nodes);
    expect(withSetup.get(A['u1']!)!.attention).toEqual(expect.objectContaining({ code: 'ORG_UNIT_WITHOUT_HEAD', openCount: 1 }));
    expect(withSetup.get(A['u3']!)!.attention).toBeNull();
    const without = (await service.structure(orgA, ['org:view'])).nodes;
    expect(without.some((n) => 'attention' in n)).toBe(false);
  });

  it('the summary: people, positions, committees, and names only for users:view', async () => {
    const summary = await service.summary(orgA, ALL, A['u3']!);
    expect(summary.people).toHaveLength(4);
    expect(summary.positions.map((p) => [p.nameEn.split('-')[0], p.count])).toEqual([
      ['Director', 2],
      ['Pharmacist', 2],
    ]);
    expect(summary.committees.items!.map((c) => c.nameEn)).toEqual(['P&T']);

    const narrow = await service.summary(orgA, ['org:view'], A['u3']!);
    expect(narrow.people.every((p) => p.name === null)).toBe(true);
    expect(narrow.committees).toEqual({ count: 1, items: null });
  });

  it('another organisation\'s unit is the identical not-found, as root and as summary', async () => {
    await expect(service.chart(orgA, ALL, { rootId: A['bUnit'] })).rejects.toThrow(new NotFoundException('Org unit not found'));
    await expect(service.summary(orgA, ALL, A['bUnit']!)).rejects.toThrow(new NotFoundException('Org unit not found'));
    await expect(service.chart(orgA, ALL, { rootId: 'nowhere' })).rejects.toThrow(new NotFoundException('Org unit not found'));
  });
});
