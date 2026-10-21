import { NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { HISTORY_MAX_TAKE, OrgUnitHistoryService, classifyAuditRow } from './org-unit-history.service';
import type { IOrgUnitAuditHistoryEntry, IOrgUnitHeadHistoryEntry } from './interfaces/org-unit-history.interface';

// ACC-120 slice 11, PR D — the History panel's endpoint (D8), against an
// in-memory database that EVALUATES the where clauses it is sent, Json filters
// included. A query that dropped organizationId, or the unit, would match the
// other rows here exactly as it would in Postgres.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const UNIT = 'pharmacy';
const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function jsonPath(value: unknown, path: string[]): unknown {
  let cur = value;
  for (const key of path) cur = cur && typeof cur === 'object' ? (cur as Row)[key] : undefined;
  return cur;
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Where[]).every((w) => matches(row, w));
    const field = row[key];
    if (value === null) return field === null || field === undefined;
    if (typeof value === 'object' && !(value instanceof Date)) {
      const op = value as Record<string, unknown>;
      if ('in' in op) return (op['in'] as unknown[]).includes(field);
      if ('not' in op && op['not'] === Prisma.DbNull) return field !== null && field !== undefined;
      if ('path' in op) return jsonPath(field, op['path'] as string[]) === op['equals'];
      throw new Error(`unsupported filter on ${key}`);
    }
    return field === value;
  });
}

function sorted(rows: Row[], orderBy: Array<Record<string, 'asc' | 'desc'>>): Row[] {
  return [...rows].sort((a, b) => {
    for (const entry of orderBy) {
      const [key, dir] = Object.entries(entry)[0]!;
      const x = a[key];
      const y = b[key];
      const cmp = x instanceof Date && y instanceof Date ? x.getTime() - y.getTime() : String(x).localeCompare(String(y));
      if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

interface Db {
  orgUnit: Row[];
  auditLog: Row[];
  orgUnitHeadEvent: Row[];
  user: Row[];
}

function fakePrisma(db: Db) {
  const table = (name: keyof Db) => ({
    findMany: jest.fn(async (args: { where?: Where; orderBy?: Array<Record<string, 'asc' | 'desc'>>; take?: number } = {}) => {
      const rows = sorted(db[name].filter((r) => matches(r, args.where ?? {})), args.orderBy ?? []);
      return args.take === undefined ? rows : rows.slice(0, args.take);
    }),
    findFirst: jest.fn(async (args: { where?: Where; orderBy?: Array<Record<string, 'asc' | 'desc'>> } = {}) =>
      sorted(db[name].filter((r) => matches(r, args.where ?? {})), args.orderBy ?? [])[0] ?? null,
    ),
    count: jest.fn(async (args: { where?: Where } = {}) => db[name].filter((r) => matches(r, args.where ?? {})).length),
  });
  return { orgUnit: table('orgUnit'), auditLog: table('auditLog'), orgUnitHeadEvent: table('orgUnitHeadEvent'), user: table('user') };
}

// ── the fixture ───────────────────────────────────────────────────────────────

/** A stored copy, typed as the Json column it is read from. */
const json = (row: Row) => row as Prisma.JsonObject;

const copy = (over: Row = {}): Row => ({
  id: UNIT,
  parentId: 'medical',
  nameEn: 'Pharmacy',
  nameAr: 'الصيدلية',
  code: 'PHARM',
  typeValueId: 't-dept',
  description: 'Dispensing and stores',
  sortOrder: 0,
  isActive: true,
  ...over,
});

const audit = (id: string, when: string, over: Row = {}): Row => ({
  id,
  organizationId: ORG_A,
  objectType: 'OrgUnit',
  objectId: UNIT,
  action: 'UPDATE',
  actorId: 'nora',
  before: null,
  after: null,
  metadata: null,
  createdAt: at(when),
  ...over,
});

const event = (id: string, when: string, action: string, over: Row = {}): Row => ({
  id,
  organizationId: ORG_A,
  orgUnitId: UNIT,
  userId: 'huda',
  approvedBy: 'nora',
  positionId: null,
  position: null,
  action,
  effectiveDate: at(when),
  createdAt: at(when),
  ...over,
});

function fixture(): Db {
  return {
    orgUnit: [
      { id: UNIT, organizationId: ORG_A, isActive: true, nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
      { id: 'medical', organizationId: ORG_A, isActive: true, nameEn: 'Medical Services', nameAr: 'الخدمات الطبية' },
      { id: 'clinical', organizationId: ORG_A, isActive: true, nameEn: 'Clinical Services', nameAr: null },
      { id: 'closed', organizationId: ORG_A, isActive: false, nameEn: 'Closed Unit', nameAr: null },
      // B's unit with a look-alike id, and B's own parent.
      { id: 'b-unit', organizationId: ORG_B, isActive: true, nameEn: 'B unit', nameAr: null },
      { id: 'b-parent', organizationId: ORG_B, isActive: true, nameEn: 'B parent', nameAr: null },
    ],
    auditLog: [
      audit('a1', '2025-01-10', { action: 'CREATE', after: copy({ parentId: 'clinical' }) }),
      audit('a2', '2025-03-02', { actorId: 'omar', before: copy({ parentId: 'clinical' }), after: copy() }),
      audit('a3', '2026-02-01', { before: copy(), after: copy({ nameEn: 'Pharmacy Dept', code: 'PHD', description: 'SECRET-DESCRIPTION' }) }),
      // A headship operation's audit twin: metadata only. Never shown.
      audit('a-head', '2026-09-25', { metadata: { actingHeadAssigned: true, userId: 'huda' } }),
      // A row with no person: the system wrote it.
      audit('a4', '2026-10-05', { actorId: null, before: copy(), after: copy({ sortOrder: 3 }) }),
      // Another object, and another organisation's rows on the same id.
      audit('a-other', '2026-10-06', { objectType: 'Committee', after: copy() }),
      audit('a-b', '2026-10-07', { organizationId: ORG_B, actorId: 'b-user', before: copy(), after: copy({ parentId: 'b-parent' }) }),
    ],
    orgUnitHeadEvent: [
      event('e1', '2025-06-01', 'ASSIGNED', {
        userId: 'fahad',
        positionId: 'pos-director',
        position: { id: 'pos-director', nameEn: 'Director', nameAr: 'مدير' },
      }),
      event('e2', '2026-09-25', 'ACTING_ASSIGNED'),
      event('e3', '2026-10-08', 'HANDOVER_COMPLETED', { approvedBy: null }),
      event('e-b', '2026-10-09', 'VACATED', { organizationId: ORG_B, userId: 'b-user' }),
      event('e-other-unit', '2026-10-09', 'VACATED', { orgUnitId: 'medical' }),
    ],
    user: [
      { id: 'nora', organizationId: ORG_A, name: 'Nora Al-Otaibi', position: { nameEn: 'Quality Director', nameAr: 'مديرة الجودة' } },
      { id: 'omar', organizationId: ORG_A, name: 'Omar Bakri', position: null },
      { id: 'huda', organizationId: ORG_A, name: 'Dr. Huda Zahrani', position: { nameEn: 'Clinical Pharmacist', nameAr: null } },
      { id: 'fahad', organizationId: ORG_A, name: 'Dr. Fahad Al-Anazi', position: { nameEn: 'Director', nameAr: 'مدير' } },
      { id: 'b-user', organizationId: ORG_B, name: 'B Person', position: null },
    ],
  };
}

const ALL = ['org:view', 'users:view'];
const NO_NAMES = ['org:view'];

describe('OrgUnitHistoryService', () => {
  let db: Db;
  let prisma: ReturnType<typeof fakePrisma>;
  let service: OrgUnitHistoryService;

  beforeEach(() => {
    db = fixture();
    prisma = fakePrisma(db);
    service = new OrgUnitHistoryService(prisma as never);
  });

  it('merges the unit’s audit rows and head events, newest first, each once', async () => {
    const page = await service.history(ORG_A, ALL, UNIT);
    expect(page.items.map((i) => i.id)).toEqual([
      'head:e3',
      'audit:a4',
      'head:e2',
      'audit:a3',
      'head:e1',
      'audit:a2',
      'audit:a1',
    ]);
    // The metadata-only twin of the acting appointment is not read: e2 says it.
    expect(page.items.map((i) => i.id)).not.toContain('audit:a-head');
    expect(page.total).toBe(7);
  });

  it('says what each audit row did, from its stored copies', async () => {
    const byId = new Map((await service.history(ORG_A, ALL, UNIT)).items.map((i) => [i.id, i as IOrgUnitAuditHistoryEntry]));
    expect(byId.get('audit:a1')).toEqual(expect.objectContaining({ kind: 'CREATED', fields: [] }));
    expect(byId.get('audit:a2')).toEqual(
      expect.objectContaining({ kind: 'CHANGED', fields: ['parent'], movedTo: { id: 'medical', nameEn: 'Medical Services', nameAr: 'الخدمات الطبية' } }),
    );
    expect(byId.get('audit:a3')).toEqual(expect.objectContaining({ kind: 'CHANGED', fields: ['nameEn', 'code', 'description'] }));
    expect(byId.get('audit:a3')).not.toHaveProperty('movedTo');
    expect(byId.get('audit:a4')).toEqual(expect.objectContaining({ fields: ['sortOrder'], actor: null }));
  });

  it('head events as stored: the action, the person, the position, who recorded it', async () => {
    const byId = new Map((await service.history(ORG_A, ALL, UNIT)).items.map((i) => [i.id, i as IOrgUnitHeadHistoryEntry]));
    expect(byId.get('head:e1')).toEqual(
      expect.objectContaining({
        source: 'HEAD_EVENT',
        kind: 'ASSIGNED',
        subject: expect.objectContaining({ userId: 'fahad', name: 'Dr. Fahad Al-Anazi' }),
        position: { id: 'pos-director', nameEn: 'Director', nameAr: 'مدير' },
        actor: expect.objectContaining({ userId: 'nora', name: 'Nora Al-Otaibi' }),
      }),
    );
    // No approver recorded (the handover completed on its date): no actor.
    expect(byId.get('head:e3')!.actor).toBeNull();
  });

  it('an actor who is not a user of this organisation is marked so, never named from elsewhere', async () => {
    db.auditLog.push(audit('a-platform', '2026-10-12', { actorId: 'b-user', before: copy(), after: copy({ code: 'PH2' }) }));
    const page = await service.history(ORG_A, ALL, UNIT);
    const row = page.items.find((i) => i.id === 'audit:a-platform')!;
    expect(row.actor).toEqual({ userId: 'b-user', name: null, inOrganization: false, positionNameEn: null, positionNameAr: null });
    expect(page.items.find((i) => i.id === 'audit:a3')!.actor!.inOrganization).toBe(true);
  });

  describe('classifyAuditRow', () => {
    it('deactivation and moving to the top', () => {
      expect(classifyAuditRow({ action: 'UPDATE', before: json(copy()), after: json(copy({ isActive: false })) }).kind).toBe('DEACTIVATED');
      expect(classifyAuditRow({ action: 'UPDATE', before: json(copy()), after: json(copy({ parentId: null })) })).toEqual({
        kind: 'CHANGED',
        fields: ['parent'],
        newParentId: null,
      });
      // A row without both copies is recorded, never guessed at.
      expect(classifyAuditRow({ action: 'UPDATE', before: null, after: json(copy()) }).kind).toBe('RECORDED');
    });
  });

  describe('paging', () => {
    it('pages never repeat or skip a row', async () => {
      const seen: string[] = [];
      for (let skip = 0; skip < 7; skip += 3) {
        const page = await service.history(ORG_A, ALL, UNIT, { skip, take: 3 });
        expect(page.total).toBe(7);
        seen.push(...page.items.map((i) => i.id));
      }
      expect(seen).toEqual((await service.history(ORG_A, ALL, UNIT)).items.map((i) => i.id));
    });

    it('a page past the end is empty; take is capped at 50', async () => {
      expect((await service.history(ORG_A, ALL, UNIT, { skip: 7, take: 3 })).items).toEqual([]);
      const capped = await service.history(ORG_A, ALL, UNIT, { take: 500 });
      expect(capped.take).toBe(HISTORY_MAX_TAKE);
      expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: HISTORY_MAX_TAKE }));
    });
  });

  describe('names (D7)', () => {
    it('with users:view, actor and subject are named', async () => {
      const page = await service.history(ORG_A, ALL, UNIT);
      const e2 = page.items.find((i) => i.id === 'head:e2') as IOrgUnitHeadHistoryEntry;
      expect(e2.subject.name).toBe('Dr. Huda Zahrani');
      expect(e2.actor!.name).toBe('Nora Al-Otaibi');
    });

    it('without it, every name is null and the position stands in', async () => {
      const page = await service.history(ORG_A, NO_NAMES, UNIT);
      const people = page.items.flatMap((i) => [i.actor, i.source === 'HEAD_EVENT' ? i.subject : null]).filter((p) => p);
      expect(people.length).toBeGreaterThan(0);
      expect(people.every((p) => p!.name === null)).toBe(true);
      const e2 = page.items.find((i) => i.id === 'head:e2') as IOrgUnitHeadHistoryEntry;
      expect(e2.subject).toEqual({ userId: 'huda', name: null, inOrganization: true, positionNameEn: 'Clinical Pharmacist', positionNameAr: null });
      expect(JSON.stringify(page)).not.toContain('Nora Al-Otaibi');
    });
  });

  it('never returns the stored copies', async () => {
    const page = await service.history(ORG_A, ALL, UNIT);
    const text = JSON.stringify(page);
    expect(text).not.toContain('"before"');
    expect(text).not.toContain('"after"');
    expect(text).not.toContain('"metadata"');
    expect(text).not.toContain('SECRET-DESCRIPTION');
    expect(text).not.toContain('Dispensing and stores');
  });

  describe('the deactivation', () => {
    it('an inactive unit gets the latest row that deactivated it', async () => {
      db.orgUnit[0]!['isActive'] = false;
      db.auditLog.push(audit('a-off', '2026-10-10', { before: copy(), after: copy({ isActive: false }) }));
      const page = await service.history(ORG_A, ALL, UNIT);
      expect(page.deactivation).toEqual({ at: at('2026-10-10'), actor: expect.objectContaining({ userId: 'nora', name: 'Nora Al-Otaibi' }) });
      expect(page.items[0]).toEqual(expect.objectContaining({ id: 'audit:a-off', kind: 'DEACTIVATED' }));
    });

    it('null when no row recorded it; absent for an active unit', async () => {
      db.orgUnit[0]!['isActive'] = false;
      expect((await service.history(ORG_A, ALL, UNIT)).deactivation).toBeNull();
      db.orgUnit[0]!['isActive'] = true;
      expect(await service.history(ORG_A, ALL, UNIT)).not.toHaveProperty('deactivation');
    });
  });

  it('an invented id is a 404', async () => {
    await expect(service.history(ORG_A, ALL, 'nope')).rejects.toThrow(new NotFoundException('Org unit not found'));
  });

  describe('tenant isolation', () => {
    itEnforcesTenantIsolation('OrgUnitHistoryService.history: rows, people, parents, and a foreign unit is the identical 404', async () => {
      const page = await service.history(ORG_A, ALL, UNIT);
      const text = JSON.stringify(page);
      expect(page.items.map((i) => i.id)).not.toContain('audit:a-b');
      expect(page.items.map((i) => i.id)).not.toContain('head:e-b');
      expect(text).not.toContain('B Person');
      expect(text).not.toContain('B parent');
      for (const call of [...prisma.auditLog.findMany.mock.calls, ...prisma.auditLog.count.mock.calls]) {
        expect(call[0]?.where).toEqual(expect.objectContaining({ organizationId: ORG_A, objectId: UNIT }));
      }
      for (const call of [...prisma.orgUnitHeadEvent.findMany.mock.calls, ...prisma.orgUnitHeadEvent.count.mock.calls]) {
        expect(call[0]?.where).toEqual({ organizationId: ORG_A, orgUnitId: UNIT });
      }
      for (const call of prisma.user.findMany.mock.calls) expect(call[0]?.where?.['organizationId']).toBe(ORG_A);
      expect(prisma.user.findMany).toHaveBeenCalled();
      // B's unit, asked for from A: the same 404 as an invented id.
      await expect(service.history(ORG_A, ALL, 'b-unit')).rejects.toThrow(new NotFoundException('Org unit not found'));
    });

    itEnforcesTenantIsolation('OrgUnitHistoryService.history: a parent in another organisation is not named', async () => {
      // A's own row whose stored copy points at B's unit (written directly).
      db.auditLog.push(audit('a-cross', '2026-10-11', { before: copy(), after: copy({ parentId: 'b-parent' }) }));
      const page = await service.history(ORG_A, ALL, UNIT);
      const row = page.items.find((i) => i.id === 'audit:a-cross') as IOrgUnitAuditHistoryEntry;
      expect(row.fields).toEqual(['parent']);
      expect(row).not.toHaveProperty('movedTo');
      for (const call of prisma.orgUnit.findMany.mock.calls) expect(call[0]?.where?.['organizationId']).toBe(ORG_A);
      expect(prisma.orgUnit.findMany).toHaveBeenCalled();
    });
  });
});
