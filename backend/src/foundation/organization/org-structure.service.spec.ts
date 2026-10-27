import { NotFoundException } from '@nestjs/common';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { OrgStructureService } from './org-structure.service';

// ACC-120 slice 11 — the read model, against an in-memory database that
// EVALUATES the where clauses it is sent. A query that dropped organizationId
// would match the other organisation's rows here exactly as it would in
// Postgres, which is what makes the isolation tests below mean something.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const NOW = new Date('2026-10-20T09:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return (value as Where[]).some((w) => matches(row, w));
    const field = row[key];
    if (value === null) return field === null || field === undefined;
    if (value instanceof Date) return field instanceof Date && field.getTime() === value.getTime();
    if (typeof value === 'object') {
      const op = value as Record<string, unknown>;
      if ('in' in op) return (op['in'] as unknown[]).includes(field);
      if ('not' in op) return field !== op['not'];
      if ('lte' in op || 'gt' in op || 'lt' in op || 'gte' in op) {
        if (!(field instanceof Date)) return false;
        const t = field.getTime();
        if (op['lte'] && !(t <= (op['lte'] as Date).getTime())) return false;
        if (op['lt'] && !(t < (op['lt'] as Date).getTime())) return false;
        if (op['gt'] && !(t > (op['gt'] as Date).getTime())) return false;
        if (op['gte'] && !(t >= (op['gte'] as Date).getTime())) return false;
        return true;
      }
      // A relation filter (user.position).
      if (field === null || field === undefined) return false;
      return matches(field as Row, op);
    }
    return field === value;
  });
}

function sortBy(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Array<Record<string, 'asc' | 'desc'>>;
  return [...rows].sort((a, b) => {
    for (const entry of keys) {
      const [key, dir] = Object.entries(entry)[0]!;
      const x = a[key];
      const y = b[key];
      const cmp =
        x instanceof Date && y instanceof Date
          ? x.getTime() - y.getTime()
          : typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y));
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

interface Db {
  orgUnit: Row[];
  user: Row[];
  orgUnitHeadAssignment: Row[];
  committee: Row[];
  setupCondition: Row[];
  lookupCategory: Row[];
  lookupValue: Row[];
  committeeMember: Row[];
  workflowInstance: Row[];
  workflowStage: Row[];
}

function fakePrisma(db: Db) {
  const table = (name: keyof Db) => ({
    findMany: jest.fn(async (args: { where?: Where; orderBy?: unknown } = {}) =>
      sortBy(db[name].filter((r) => matches(r, args.where ?? {})), args.orderBy),
    ),
    findFirst: jest.fn(async (args: { where?: Where; orderBy?: unknown } = {}) =>
      sortBy(db[name].filter((r) => matches(r, args.where ?? {})), args.orderBy)[0] ?? null,
    ),
    groupBy: jest.fn(async (args: { by: string[]; where?: Where; _count: Record<string, true> }) => {
      const groups = new Map<string, Row[]>();
      for (const r of db[name].filter((row) => matches(row, args.where ?? {}))) {
        const key = JSON.stringify(args.by.map((b) => r[b]));
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      return [...groups.values()].map((rows) => ({
        ...Object.fromEntries(args.by.map((b) => [b, rows[0]![b]])),
        _count: Object.fromEntries(Object.keys(args._count).map((k) => [k, rows.length])),
      }));
    }),
  });
  return {
    orgUnit: table('orgUnit'),
    user: table('user'),
    orgUnitHeadAssignment: table('orgUnitHeadAssignment'),
    committee: table('committee'),
    setupCondition: table('setupCondition'),
    lookupCategory: table('lookupCategory'),
    lookupValue: table('lookupValue'),
    committeeMember: table('committeeMember'),
    workflowInstance: table('workflowInstance'),
    workflowStage: table('workflowStage'),
  };
}

// ── the fixture: a 7-level tree in A, a look-alike in B ───────────────────────

const unit = (id: string, parentId: string | null, over: Row = {}): Row => ({
  id,
  organizationId: ORG_A,
  parentId,
  nameEn: id.toUpperCase(),
  nameAr: null,
  code: id.toUpperCase(),
  typeValueId: 't-dept',
  description: null,
  sortOrder: 0,
  isActive: true,
  pendingHeadUserId: null,
  createdAt: day('2026-01-01'),
  updatedAt: day('2026-01-01'),
  ...over,
});

const HEAD_POS = { nameEn: 'Director', nameAr: 'مدير', grade: 10, isUnitHeadPosition: true, isActive: true };
const STAFF_POS = { nameEn: 'Pharmacist', nameAr: 'صيدلي', grade: 5, isUnitHeadPosition: false, isActive: true };
const TECH_POS = { nameEn: 'Technician', nameAr: null, grade: 3, isUnitHeadPosition: false, isActive: true };

const person = (id: string, unitId: string, position: Row | null, over: Row = {}): Row => ({
  id,
  organizationId: ORG_A,
  name: `Person ${id}`,
  primaryOrgUnitId: unitId,
  status: 'ACTIVE',
  positionId: position ? `pos-${String(position['nameEn']).toLowerCase()}` : null,
  position,
  ...over,
});

function fixture(): Db {
  return {
    orgUnit: [
      // L0 → L6 down one chain, with siblings and inactive children on the way.
      unit('u0', null),
      unit('u1', 'u0', { sortOrder: 1 }),
      unit('u1b', 'u0', { sortOrder: 2 }),
      unit('u1x', 'u0', { isActive: false }),
      unit('u2', 'u1'),
      unit('u3', 'u2', { pendingHeadUserId: 'huda' }),
      unit('u4', 'u3', { nameEn: 'A-U4' }),
      unit('u4b', 'u3', { nameEn: 'B-U4B' }),
      unit('u5', 'u4'),
      unit('u5x', 'u4', { isActive: false }),
      unit('u6', 'u5'),
      // A loop written before PR A refused one: c1 ↔ c2, under nothing.
      unit('c1', 'c2'),
      unit('c2', 'c1'),
      // B's look-alikes: same parent ids, never part of A's tree.
      unit('b-unit', 'u0', { organizationId: ORG_B, nameEn: 'B UNIT' }),
      unit('b-root', null, { organizationId: ORG_B }),
    ],
    user: [
      person('fahad', 'u3', HEAD_POS),
      person('huda', 'u3', HEAD_POS),
      person('p1', 'u3', STAFF_POS),
      person('p2', 'u3', STAFF_POS),
      person('p3', 'u3', TECH_POS),
      person('gone', 'u3', STAFF_POS, { status: 'INACTIVE' }),
      person('u0-head', 'u0', HEAD_POS),
      person('old-head', 'u2', { ...HEAD_POS, isActive: false }),
      // B's people in A's unit ids.
      person('b-head', 'u2', HEAD_POS, { organizationId: ORG_B }),
      person('b-staff', 'u3', STAFF_POS, { organizationId: ORG_B }),
    ],
    orgUnitHeadAssignment: [
      // u2 covered by someone from elsewhere; u4 by one of its own.
      { id: 'cv-u2', organizationId: ORG_A, orgUnitId: 'u2', userId: 'tariq', kind: 'ACTING', reason: 'VACANCY', validFrom: day('2026-10-01'), validTo: null, endedAt: null, user: { name: 'Dr. Tariq', primaryOrgUnitId: 'u1' } },
      { id: 'cv-u4', organizationId: ORG_A, orgUnitId: 'u4', userId: 'sara', kind: 'ACTING', reason: 'ABSENCE', validFrom: day('2026-10-10'), validTo: day('2026-11-10'), endedAt: null, user: { name: 'Sara', primaryOrgUnitId: 'u4' } },
      // Lapsed, ended and not yet started: none of them in force.
      { id: 'cv-lapsed', organizationId: ORG_A, orgUnitId: 'u1', userId: 'x', kind: 'ACTING', reason: 'ABSENCE', validFrom: day('2026-08-01'), validTo: day('2026-09-01'), endedAt: null, user: { name: 'X', primaryOrgUnitId: 'u1' } },
      { id: 'cv-ended', organizationId: ORG_A, orgUnitId: 'u1b', userId: 'y', kind: 'ACTING', reason: 'ABSENCE', validFrom: day('2026-08-01'), validTo: null, endedAt: day('2026-09-01'), user: { name: 'Y', primaryOrgUnitId: 'u1b' } },
      { id: 'cv-future', organizationId: ORG_A, orgUnitId: 'u5', userId: 'z', kind: 'ACTING', reason: 'ABSENCE', validFrom: day('2026-12-01'), validTo: null, endedAt: null, user: { name: 'Z', primaryOrgUnitId: 'u5' } },
      { id: 'cv-b', organizationId: ORG_B, orgUnitId: 'u3', userId: 'b-cover', kind: 'ACTING', reason: 'VACANCY', validFrom: day('2026-10-01'), validTo: null, endedAt: null, user: { name: 'B Cover', primaryOrgUnitId: 'u3' } },
    ],
    committee: [
      { id: 'cm-1', organizationId: ORG_A, orgUnitId: 'u3', isActive: true, nameEn: 'Pharmacy & Therapeutics', nameAr: 'لجنة الصيدلة' },
      { id: 'cm-2', organizationId: ORG_A, orgUnitId: 'u3', isActive: false, nameEn: 'Dissolved one', nameAr: null },
      { id: 'cm-b', organizationId: ORG_B, orgUnitId: 'u3', isActive: true, nameEn: 'B committee', nameAr: null },
    ],
    setupCondition: [
      { objectId: 'u1', organizationId: ORG_A, type: 'ORG_UNIT_WITHOUT_HEAD', severity: 'AT_RISK', openedAt: day('2026-09-01'), clearedAt: null },
      { objectId: 'u1', organizationId: ORG_A, type: 'ORG_UNIT_WITHOUT_TYPE', severity: 'BLOCKS_WORK', openedAt: day('2026-09-15'), clearedAt: null },
      { objectId: 'u1b', organizationId: ORG_A, type: 'ORG_UNIT_WITHOUT_HEAD', severity: 'AT_RISK', openedAt: day('2026-09-01'), clearedAt: day('2026-10-01') },
      { objectId: 'u1b', organizationId: ORG_A, type: 'STAGE_WITHOUT_ASSIGNEE', severity: 'BLOCKS_WORK', openedAt: day('2026-09-01'), clearedAt: null },
      { objectId: 'u3', organizationId: ORG_B, type: 'ORG_UNIT_WITHOUT_HEAD', severity: 'BLOCKS_WORK', openedAt: day('2026-09-01'), clearedAt: null },
    ],
    lookupCategory: [{ id: 'cat', key: 'org_unit_type', organizationId: null }],
    lookupValue: [
      { id: 't-dept', categoryId: 'cat', organizationId: null, key: 'department', labelEn: 'Department', labelAr: 'قسم', labelOverrideEn: null, labelOverrideAr: null, isActive: true, isHidden: false },
      { id: 't-b-dept', categoryId: 'cat', organizationId: ORG_B, key: 'department', labelEn: 'Department', labelAr: 'قسم', labelOverrideEn: 'B Department', labelOverrideAr: null, isActive: true, isHidden: false },
      { id: 't-b-own', categoryId: 'cat', organizationId: ORG_B, key: 'b-only', labelEn: 'B only', labelAr: null, labelOverrideEn: null, labelOverrideAr: null, isActive: true, isHidden: false },
    ],
    committeeMember: [],
    workflowInstance: [
      { organizationId: ORG_A, objectType: 'COMMITTEE', objectId: 'cm-1', currentStageId: 'st-active', createdAt: day('2026-01-01') },
    ],
    workflowStage: [{ id: 'st-active', nameEn: 'Active', nameAr: 'نشطة', key: 'active', flags: ['IN_FORCE'], workflowTemplate: { organizationId: ORG_A } }],
  };
}

const ALL = ['org:view', 'org:manage', 'users:view', 'committees:view', 'setup:view'];
const VIEW_ONLY = ['org:view'];

describe('OrgStructureService (ACC-120 slice 11)', () => {
  let db: Db;
  let prisma: ReturnType<typeof fakePrisma>;
  let service: OrgStructureService;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    db = fixture();
    prisma = fakePrisma(db);
    service = new OrgStructureService(prisma as never);
  });
  afterEach(() => jest.useRealTimers());

  const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id);

  // ── the chart window ──────────────────────────────────────────────────────
  describe('chart', () => {
    it('from the top unit, stops at four levels, in tree order, with no inactive unit', async () => {
      const chart = await service.chart(ORG_A, ALL);
      expect(chart.depth).toBe(4);
      expect(chart.root).toEqual({ id: 'u0', path: [{ id: 'u0', nameEn: 'U0', nameAr: null }] });
      expect(chart.nodes.map((n) => [n.id, n.depth])).toEqual([
        ['u0', 0],
        ['u1', 1],
        ['u2', 2],
        ['u3', 3],
        ['u1b', 1],
      ]);
    });

    it('childCount counts ACTIVE direct children, those below the cut-off included', async () => {
      const chart = await service.chart(ORG_A, ALL);
      const byId = new Map(chart.nodes.map((n) => [n.id, n]));
      expect(byId.get('u3')!.childCount).toBe(2); // u4 and u4b, both below the cut
      expect(byId.get('u0')!.childCount).toBe(2); // u1 and u1b; u1x is inactive
    });

    it('re-rooted at a level-3 unit: the path from the top, and the window below it', async () => {
      const chart = await service.chart(ORG_A, ALL, { rootId: 'u3' });
      expect(chart.root.path.map((p) => p.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
      expect(chart.nodes.map((n) => [n.id, n.depth])).toEqual([
        ['u3', 0],
        ['u4', 1],
        ['u5', 2],
        ['u6', 3],
        ['u4b', 1],
      ]);
      const u4 = chart.nodes.find((n) => n.id === 'u4')!;
      expect(u4.childCount).toBe(1); // u5; u5x is inactive and not counted
    });

    it('depth is capped at 4, never refused, and a smaller depth is honoured', async () => {
      expect((await service.chart(ORG_A, ALL, { depth: 10 })).depth).toBe(4);
      const two = await service.chart(ORG_A, ALL, { depth: 2 });
      expect(two.nodes.map((n) => n.id)).toEqual(['u0', 'u1', 'u1b']);
    });

    it('an inactive root, an invented one and another organisation\'s are the identical not-found', async () => {
      const outcomes = await Promise.all(
        ['u1x', 'nowhere', 'b-unit'].map((rootId) =>
          service.chart(ORG_A, ALL, { rootId }).then(
            () => 'OK',
            (e: Error) => `${e.constructor.name}: ${e.message}`,
          ),
        ),
      );
      expect(new Set(outcomes)).toEqual(new Set([`${NotFoundException.name}: Org unit not found`]));
    });

    it('a loop in the data ends the walk: each unit once, and a path that stops', async () => {
      const chart = await service.chart(ORG_A, ALL, { rootId: 'c1' });
      expect(chart.nodes.map((n) => n.id)).toEqual(['c1', 'c2']);
      expect(chart.root.path.map((p) => p.id)).toEqual(['c2', 'c1']);
    });
  });

  // ── heads and covers ──────────────────────────────────────────────────────
  describe('heads and covers', () => {
    it('heads come from the holder rule; the pending successor is incoming; both counted here', async () => {
      const chart = await service.chart(ORG_A, ALL, { rootId: 'u3' });
      const u3 = chart.nodes.find((n) => n.id === 'u3')!;
      expect(u3.heads).toEqual([
        { userId: 'fahad', name: 'Person fahad', positionId: 'pos-director', positionNameEn: 'Director', positionNameAr: 'مدير', role: 'substantive', countedHere: true },
        { userId: 'huda', name: 'Person huda', positionId: 'pos-director', positionNameEn: 'Director', positionNameAr: 'مدير', role: 'incoming', countedHere: true },
      ]);
    });

    it('a holder of a deactivated head position is not a head (D13)', async () => {
      const chart = await service.chart(ORG_A, ALL);
      expect(chart.nodes.find((n) => n.id === 'u2')!.heads).toEqual([]);
    });

    it('the cover in force, from the period table; countedHere only when they belong to the unit', async () => {
      // The cache column is not even read: the units carry no actingHeadUserId.
      const chart = await service.chart(ORG_A, ALL, { rootId: 'u0', depth: 4 });
      const u2 = chart.nodes.find((n) => n.id === 'u2')!;
      expect(u2.acting).toEqual({ userId: 'tariq', name: 'Dr. Tariq', reason: 'VACANCY', validFrom: day('2026-10-01'), validTo: null, countedHere: false });
      const deep = await service.chart(ORG_A, ALL, { rootId: 'u3' });
      expect(deep.nodes.find((n) => n.id === 'u4')!.acting).toEqual(expect.objectContaining({ userId: 'sara', countedHere: true }));
    });

    it('a lapsed, an ended and a future cover are not in force', async () => {
      const chart = await service.chart(ORG_A, ALL);
      expect(chart.nodes.find((n) => n.id === 'u1')!.acting).toBeNull();
      expect(chart.nodes.find((n) => n.id === 'u1b')!.acting).toBeNull();
      const deep = await service.chart(ORG_A, ALL, { rootId: 'u3' });
      expect(deep.nodes.find((n) => n.id === 'u5')!.acting).toBeNull();
    });
  });

  // ── structure ─────────────────────────────────────────────────────────────
  describe('structure', () => {
    it('every active unit once, parents first, loop members last', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(ids(nodes)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u4b', 'u1b', 'c1', 'c2']);
    });

    it('inactive units only for org:manage, and only when asked', async () => {
      expect(ids((await service.structure(ORG_A, ALL)).nodes)).not.toContain('u1x');
      const withInactive = await service.structure(ORG_A, ALL, { includeInactive: true });
      expect(ids(withInactive.nodes)).toEqual(expect.arrayContaining(['u1x', 'u5x']));
      expect(withInactive.nodes.find((n) => n.id === 'u1x')!.isActive).toBe(false);
      const notManager = await service.structure(ORG_A, ['org:view', 'users:view'], { includeInactive: true });
      expect(ids(notManager.nodes)).not.toContain('u1x');
    });

    it('headcount is ACTIVE people of the unit; committees counts ACTIVE ones', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      const u3 = nodes.find((n) => n.id === 'u3')!;
      expect(u3.headcount).toBe(5); // 'gone' is deactivated
      expect(u3.committees).toEqual({ count: 1 });
    });

    it('both type labels, override-resolved (D5)', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes[0]!.type).toEqual({ id: 't-dept', key: 'department', labelEn: 'Department', labelAr: 'قسم', isRetired: false });
    });

    it('one query per kind of fact, whatever the size of the tree', async () => {
      await service.structure(ORG_A, ALL);
      expect(prisma.orgUnit.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1); // heads
      expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.committee.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.setupCondition.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.lookupValue.findMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── attention ─────────────────────────────────────────────────────────────
  describe('attention', () => {
    it('the highest open unit condition, with how many are open', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u1')!.attention).toEqual({
        code: 'ORG_UNIT_WITHOUT_TYPE',
        severity: 'BLOCKS_WORK',
        since: day('2026-09-15'),
        openCount: 2,
      });
      // Cleared, and a type that is not about units: no attention.
      expect(nodes.find((n) => n.id === 'u1b')!.attention).toBeNull();
    });
  });

  // ── what each caller sees (D7) ────────────────────────────────────────────
  describe('what each caller sees (D7)', () => {
    it('without users:view, every person name is null; ids, titles and counts stay', async () => {
      const chart = await service.chart(ORG_A, ['org:view', 'committees:view', 'setup:view'], { rootId: 'u2' });
      const u2 = chart.nodes.find((n) => n.id === 'u2')!;
      const u3 = chart.nodes.find((n) => n.id === 'u3')!;
      expect(u3.heads.map((h) => [h.userId, h.name, h.positionNameEn])).toEqual([
        ['fahad', null, 'Director'],
        ['huda', null, 'Director'],
      ]);
      expect(u2.acting).toEqual(expect.objectContaining({ userId: 'tariq', name: null }));
      expect(u3.headcount).toBe(5);

      const summary = await service.summary(ORG_A, ['org:view'], 'u3');
      expect(summary.people.every((p) => p.name === null)).toBe(true);
      expect(summary.people.map((p) => p.positionNameEn)).toContain('Pharmacist');
      expect(summary.positions.map((p) => p.nameEn)).toEqual(['Director', 'Pharmacist', 'Technician']);
    });

    it('with users:view, names are shown', async () => {
      const summary = await service.summary(ORG_A, ['org:view', 'users:view'], 'u3');
      expect(summary.unit.heads.map((h) => h.name)).toEqual(['Person fahad', 'Person huda']);
      expect(summary.people.map((p) => p.name)).toContain('Person p1');
    });

    it('without committees:view, committees are a count only, and none is read', async () => {
      const summary = await service.summary(ORG_A, VIEW_ONLY, 'u3');
      expect(summary.committees).toEqual({ count: 1, items: null });
      expect(prisma.committee.findMany).not.toHaveBeenCalled();
    });

    it('with committees:view, the items carry their stage', async () => {
      const summary = await service.summary(ORG_A, ['org:view', 'committees:view'], 'u3');
      expect(summary.committees).toEqual({
        count: 1,
        items: [{ id: 'cm-1', nameEn: 'Pharmacy & Therapeutics', nameAr: 'لجنة الصيدلة', stageNameEn: 'Active', stageNameAr: 'نشطة' }],
      });
    });

    it('without setup:view, attention is ABSENT (not null), and conditions are not read', async () => {
      const { nodes } = await service.structure(ORG_A, VIEW_ONLY);
      expect(nodes.every((n) => !('attention' in n))).toBe(true);
      expect(prisma.setupCondition.findMany).not.toHaveBeenCalled();
      const summary = await service.summary(ORG_A, VIEW_ONLY, 'u1');
      expect('attention' in summary.unit).toBe(false);
    });

    it('with setup:view, attention is present on every node, null where nothing is open', async () => {
      const { nodes } = await service.structure(ORG_A, ['org:view', 'setup:view']);
      expect(nodes.every((n) => 'attention' in n)).toBe(true);
    });
  });

  // ── summary ───────────────────────────────────────────────────────────────
  describe('summary', () => {
    it('the node, its path, its positions by grade then count, and its people', async () => {
      const summary = await service.summary(ORG_A, ALL, 'u3');
      expect(summary.unit).toEqual(expect.objectContaining({ id: 'u3', childCount: 2, headcount: 5, description: null }));
      expect(summary.path.map((p) => p.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
      expect(summary.positions).toEqual([
        { positionId: 'pos-director', nameEn: 'Director', nameAr: 'مدير', grade: 10, isUnitHeadPosition: true, count: 2 },
        { positionId: 'pos-pharmacist', nameEn: 'Pharmacist', nameAr: 'صيدلي', grade: 5, isUnitHeadPosition: false, count: 2 },
        { positionId: 'pos-technician', nameEn: 'Technician', nameAr: null, grade: 3, isUnitHeadPosition: false, count: 1 },
      ]);
      expect(summary.people.filter((p) => p.isHead).map((p) => p.userId)).toEqual(['fahad', 'huda']);
      expect(summary.people.map((p) => p.userId)).not.toContain('gone');
    });

    // PR D — the record's Sub-units panel.
    it('children: the direct ACTIVE children, in sibling order, each decorated', async () => {
      const { children } = await service.summary(ORG_A, ALL, 'u0');
      // u1x is inactive; B's b-unit claims u0 as its parent and is not A's.
      expect(children.map((c) => c.id)).toEqual(['u1', 'u1b']);
      expect(children[0]).toEqual(expect.objectContaining({ childCount: 1, headcount: 0 }));
      const u3 = await service.summary(ORG_A, ALL, 'u3');
      expect(u3.children.map((c) => c.id)).toEqual(['u4', 'u4b']);
      expect(u3.children[0]!.acting).toEqual(expect.objectContaining({ userId: 'sara', countedHere: true }));
      expect((await service.summary(ORG_A, ALL, 'u6')).children).toEqual([]);
    });

    it('an inactive unit is returned, marked inactive', async () => {
      const summary = await service.summary(ORG_A, ALL, 'u1x');
      expect(summary.unit.isActive).toBe(false);
    });

    it('a loop ends the path', async () => {
      expect((await service.summary(ORG_A, ALL, 'c2')).path.map((p) => p.id)).toEqual(['c1', 'c2']);
    });
  });

  // ── tenant isolation, one per query ───────────────────────────────────────
  describe('tenant isolation', () => {
    itEnforcesTenantIsolation('OrgStructureService: units, and a foreign rootId is the identical 404', async () => {
      const { nodes } = await service.structure(ORG_A, ALL, { includeInactive: true });
      expect(ids(nodes)).not.toContain('b-unit');
      expect(ids(nodes)).not.toContain('b-root');
      // b-unit claims u0 as its parent; it is not u0's child in A.
      expect(nodes.find((n) => n.id === 'u0')!.childCount).toBe(2);
      await expect(service.chart(ORG_A, ALL, { rootId: 'b-unit' })).rejects.toThrow(new NotFoundException('Org unit not found'));
    });

    itEnforcesTenantIsolation('OrgStructureService: type values', async () => {
      db.orgUnit.find((u) => u['id'] === 'u1')!['typeValueId'] = 't-b-own';
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u1')!.type).toBeNull(); // B's own value
      expect(nodes.find((n) => n.id === 'u0')!.type!.labelEn).toBe('Department'); // not B's override
    });

    itEnforcesTenantIsolation('OrgStructureService: head holders', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u2')!.heads).toEqual([]); // b-head sits in u2 in B
    });

    itEnforcesTenantIsolation('OrgStructureService: acting covers', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u3')!.acting).toBeNull(); // cv-b covers u3 in B
    });

    itEnforcesTenantIsolation('OrgStructureService: headcount', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u3')!.headcount).toBe(5); // b-staff not counted
    });

    itEnforcesTenantIsolation('OrgStructureService: positions and people in the summary', async () => {
      const summary = await service.summary(ORG_A, ALL, 'u3');
      expect(summary.people.map((p) => p.userId)).not.toContain('b-staff');
      expect(summary.positions.find((p) => p.nameEn === 'Pharmacist')!.count).toBe(2);
    });

    itEnforcesTenantIsolation('OrgStructureService: committees, counted and listed', async () => {
      const summary = await service.summary(ORG_A, ALL, 'u3');
      expect(summary.committees.count).toBe(1);
      expect(summary.committees.items!.map((c) => c.id)).toEqual(['cm-1']);
    });

    itEnforcesTenantIsolation('OrgStructureService: setup conditions', async () => {
      const { nodes } = await service.structure(ORG_A, ALL);
      expect(nodes.find((n) => n.id === 'u3')!.attention).toBeNull(); // B's condition on u3
    });

    itEnforcesTenantIsolation('OrgStructureService: summary of another organisation\'s unit is the identical 404', async () => {
      const outcomes = await Promise.all(
        ['b-unit', 'nowhere'].map((id) =>
          service.summary(ORG_A, ALL, id).then(
            () => 'OK',
            (e: Error) => `${e.constructor.name}: ${e.message}`,
          ),
        ),
      );
      expect(outcomes).toEqual([`${NotFoundException.name}: Org unit not found`, `${NotFoundException.name}: Org unit not found`]);
    });
  });
});
