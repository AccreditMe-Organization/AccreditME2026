/**
 * ACC-244 — the shared headship reads on a REAL Postgres (npm run test:db):
 * the holder rule, the cover window at its exact edges, the reverse lookups and
 * the sub-unit walk, in two organisations.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_ISOLATION_GATE_STRING } from '../../common/testing/tenant-isolation';
import {
  findCurrentHeadHolders,
  findRunningActingCover,
  findUnitHeadedBy,
  findActiveCoversForUnits,
  findUnitLeadersAmong,
  findUnitsCoveredBy,
  findUnitsLedBy,
  findUnitSubtreeIds,
} from './unit-headship';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);
const HOUR = 3_600_000;
// A fixed instant, so the window's edges are exact (ACC-248).
const NOW = new Date('2026-10-21T09:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe('unit-headship on a real database (ACC-244)', () => {
  const prisma = new PrismaService();
  let A = '';
  let B = '';
  const unit: Record<string, string> = {};
  const user: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc244h-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;

    const mk = async (key: string, organizationId: string, parentId: string | null, isActive = true) =>
      (unit[key] = (
        await prisma.orgUnit.create({ data: { organizationId, parentId, nameEn: key, code: `${key}${slug.slice(-4)}`.toUpperCase().slice(0, 10), isActive } })
      ).id);
    // A: ROOT → DEPT → WARD → LEAF; ROOT → SIBLING; DEPT → OLD (inactive).
    await mk('ROOT', A, null);
    await mk('DEPT', A, unit['ROOT']!);
    await mk('WARD', A, unit['DEPT']!);
    await mk('LEAF', A, unit['WARD']!);
    await mk('SIB', A, unit['ROOT']!);
    await mk('OLD', A, unit['DEPT']!, false);
    await mk('GONE', A, null, false); // an inactive root
    await mk('BUNIT', B, null);
    // A corrupt cross-organisation link: B's unit pointing at A's root. The walk
    // must never follow it, which is what its per-step organisation filter is for.
    await mk('BCHILD', B, unit['ROOT']!);

    const position = async (organizationId: string, isUnitHeadPosition: boolean, isActive = true) =>
      (await prisma.orgPosition.create({ data: { organizationId, nameEn: `P ${randomUUID().slice(0, 6)}`, grade: 1, isUnitHeadPosition, isActive } })).id;
    const head = await position(A, true);
    const retiredHead = await position(A, true, false);
    const plain = await position(A, false);
    const headB = await position(B, true);

    const person = async (key: string, organizationId: string, data: Record<string, unknown> = {}) =>
      (user[key] = (
        await prisma.user.create({ data: { organizationId, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...data } })
      ).id);
    await person('deptHead', A, { positionId: head, primaryOrgUnitId: unit['DEPT'] });
    await person('retiredHeadHolder', A, { positionId: retiredHead, primaryOrgUnitId: unit['WARD'] });
    await person('plainInWard', A, { positionId: plain, primaryOrgUnitId: unit['WARD'] });
    await person('inactiveHead', A, { positionId: head, primaryOrgUnitId: unit['LEAF'], status: 'INACTIVE' });
    // A handover in progress on SIB: the outgoing and the incoming hold the position.
    await person('outgoing', A, { positionId: head, primaryOrgUnitId: unit['SIB'] });
    await person('incoming', A, { positionId: head, primaryOrgUnitId: unit['SIB'] });
    for (const k of ['coverNow', 'coverFuture', 'coverLapsed', 'coverEnded', 'coverEdgeStart', 'coverEdgeEnd', 'coverVacancy']) await person(k, A);
    await person('coverInactive', A, { status: 'INACTIVE' }); // ACC-245: a cover in force, its person deactivated
    await person('headInB', B, { positionId: headB, primaryOrgUnitId: unit['BUNIT'] });
    await person('coverInB', B);

    const period = (orgUnitId: string, userId: string, data: Record<string, unknown>) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: A, orgUnitId, userId, kind: 'ACTING', reason: 'ABSENCE', createdById: user['deptHead']!, validFrom: at(-24 * HOUR), ...data } as never,
      });
    await period(unit['WARD']!, user['coverNow']!, {});
    await period(unit['LEAF']!, user['coverFuture']!, { validFrom: at(HOUR) });
    await period(unit['SIB']!, user['coverLapsed']!, { validTo: at(-HOUR) });
    await period(unit['ROOT']!, user['coverEnded']!, { endedAt: at(-HOUR), endedById: user['deptHead'] });
    await period(unit['OLD']!, user['coverEdgeStart']!, { validFrom: NOW }); // starts exactly now: in force
    await period(unit['GONE']!, user['coverEdgeEnd']!, { validTo: NOW }); // ends exactly now: lapsed
    await period(unit['DEPT']!, user['coverVacancy']!, { reason: 'VACANCY' });
    await period(unit['SIB']!, user['coverInactive']!, {});
    await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: B, orgUnitId: unit['BUNIT']!, userId: user['coverInB']!, kind: 'ACTING', reason: 'ABSENCE', createdById: user['headInB']!, validFrom: at(-HOUR) } as never,
    });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('heads (the holder rule)', () => {
    it('a holder of an active head position heads their primary unit', async () => {
      expect(await findUnitHeadedBy(prisma, A, user['deptHead']!)).toBe(unit['DEPT']);
      expect((await findCurrentHeadHolders(prisma, A, unit['DEPT']!)).map((h) => h.id)).toEqual([user['deptHead']]);
    });

    it('an INACTIVE head position confers nothing (Q8)', async () => {
      expect(await findUnitHeadedBy(prisma, A, user['retiredHeadHolder']!)).toBeNull();
      expect(await findCurrentHeadHolders(prisma, A, unit['WARD']!)).toEqual([]);
    });

    it('a plain position, and an INACTIVE user on a head position, head nothing', async () => {
      expect(await findUnitHeadedBy(prisma, A, user['plainInWard']!)).toBeNull();
      expect(await findUnitHeadedBy(prisma, A, user['inactiveHead']!)).toBeNull();
    });

    it('during a handover both holders head the unit (Q5)', async () => {
      expect(await findUnitHeadedBy(prisma, A, user['outgoing']!)).toBe(unit['SIB']);
      expect(await findUnitHeadedBy(prisma, A, user['incoming']!)).toBe(unit['SIB']);
      expect((await findCurrentHeadHolders(prisma, A, unit['SIB']!)).map((h) => h.id).sort()).toEqual([user['outgoing'], user['incoming']].sort());
    });
  });

  describe('covers (the window, at NOW)', () => {
    it('a cover in force: inside its period', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverNow']!, NOW)).toEqual([unit['WARD']]);
      expect((await findRunningActingCover(prisma, A, unit['WARD']!, NOW))?.userId).toBe(user['coverNow']);
    });

    it('before its period: none; it becomes in force once it starts', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverFuture']!, NOW)).toEqual([]);
      expect(await findRunningActingCover(prisma, A, unit['LEAF']!, NOW)).toBeNull();
      expect(await findUnitsCoveredBy(prisma, A, user['coverFuture']!, at(2 * HOUR))).toEqual([unit['LEAF']]);
    });

    it('after its period (validTo passed), and ended early by hand: none', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverLapsed']!, NOW)).toEqual([]);
      expect(await findUnitsCoveredBy(prisma, A, user['coverEnded']!, NOW)).toEqual([]);
    });

    it('the edges: starting exactly now is in force, ending exactly now is not', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverEdgeStart']!, NOW)).toEqual([unit['OLD']]);
      expect(await findUnitsCoveredBy(prisma, A, user['coverEdgeStart']!, at(-1))).toEqual([]);
      expect(await findUnitsCoveredBy(prisma, A, user['coverEdgeEnd']!, NOW)).toEqual([]);
      expect(await findUnitsCoveredBy(prisma, A, user['coverEdgeEnd']!, at(-1))).toEqual([unit['GONE']]);
    });

    // ACC-245 — reach needs an ACTIVE person, for a cover as for a head holder.
    it('a cover in force whose person is deactivated gives no reach, in either reader', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverInactive']!, NOW)).toEqual([]);
      expect(await findUnitLeadersAmong(prisma, A, [unit['SIB']!], [user['coverInactive']!, user['outgoing']!], NOW)).toEqual(new Set([user['outgoing']]));
      // Non-vacuity: the same period, its person active again, does give reach.
      await prisma.user.update({ where: { id: user['coverInactive']! }, data: { status: 'ACTIVE' } });
      try {
        expect(await findUnitsCoveredBy(prisma, A, user['coverInactive']!, NOW)).toEqual([unit['SIB']]);
        expect(await findUnitLeadersAmong(prisma, A, [unit['SIB']!], [user['coverInactive']!], NOW)).toEqual(new Set([user['coverInactive']]));
      } finally {
        await prisma.user.update({ where: { id: user['coverInactive']! }, data: { status: 'INACTIVE' } });
      }
    });

    // ACC-245 PR 2 (P203) — the units these people lead, for many at once.
    it('findUnitsLedBy: a head’s unit and a cover in force count; a deactivated cover and another organisation’s head do not', async () => {
      const people = [user['deptHead']!, user['coverNow']!, user['coverInactive']!, user['headInB']!, user['plainInWard']!];
      expect(await findUnitsLedBy(prisma, A, people, NOW)).toEqual([unit['DEPT'], unit['WARD']].sort());
      // Each alone, so a wrong union cannot pass by luck.
      expect(await findUnitsLedBy(prisma, A, [user['deptHead']!], NOW)).toEqual([unit['DEPT']]);
      expect(await findUnitsLedBy(prisma, A, [user['coverNow']!], NOW)).toEqual([unit['WARD']]);
      expect(await findUnitsLedBy(prisma, A, [user['coverInactive']!, user['headInB']!], NOW)).toEqual([]);
      // Asked in B, B's head leads B's unit.
      expect(await findUnitsLedBy(prisma, B, [user['headInB']!], NOW)).toEqual([unit['BUNIT']]);
    });

    it('both reasons count, unless one is asked for', async () => {
      expect(await findUnitsCoveredBy(prisma, A, user['coverVacancy']!, NOW)).toEqual([unit['DEPT']]);
      expect(await findUnitsCoveredBy(prisma, A, user['coverVacancy']!, NOW, 'ABSENCE')).toEqual([]);
    });
  });

  describe('sub-units', () => {
    it('a unit and everything below it, inactive descendants included', async () => {
      expect(await findUnitSubtreeIds(prisma, A, [unit['DEPT']!])).toEqual([unit['DEPT'], unit['WARD'], unit['LEAF'], unit['OLD']].sort());
    });

    it('the root reaches the whole active tree; a sibling is not under a department', async () => {
      const all = await findUnitSubtreeIds(prisma, A, [unit['ROOT']!]);
      expect(all).toEqual([unit['ROOT'], unit['DEPT'], unit['WARD'], unit['LEAF'], unit['SIB'], unit['OLD']].sort());
      expect(await findUnitSubtreeIds(prisma, A, [unit['DEPT']!])).not.toContain(unit['SIB']);
    });

    it('an INACTIVE root reaches nothing; no roots, nothing', async () => {
      expect(await findUnitSubtreeIds(prisma, A, [unit['GONE']!])).toEqual([]);
      expect(await findUnitSubtreeIds(prisma, A, [])).toEqual([]);
    });
  });

  // ACC-324 (P213) — the period-table cover read, asked of another organisation's units and covers.
  it(`${TENANT_ISOLATION_GATE_STRING} — findActiveCoversForUnits: another organisation's cover on the same unit ids is never returned`, async () => {
    // B's own unit, with B's own cover in force: asked in A, nothing.
    expect(await findActiveCoversForUnits(prisma, A, [unit['BUNIT']!], NOW)).toEqual(new Map());
    expect(await findActiveCoversForUnits(prisma, B, [unit['BUNIT']!], NOW)).toEqual(new Map([[unit['BUNIT'], user['coverInB']]])); // non-vacuity
    // A row filed under B that names A's unit (a corrupt link): asked in A, A's own cover only.
    await prisma.orgUnitHeadAssignment.create({
      data: { organizationId: B, orgUnitId: unit['SIB']!, userId: user['coverInB']!, kind: 'ACTING', reason: 'ABSENCE', createdById: user['headInB']!, validFrom: at(-HOUR) } as never,
    });
    try {
      const inA = await findActiveCoversForUnits(prisma, A, [unit['SIB']!, unit['WARD']!], NOW);
      expect([...inA.values()]).not.toContain(user['coverInB']);
      expect(inA.get(unit['WARD']!)).toBe(user['coverNow']); // A's own cover still found
    } finally {
      await prisma.orgUnitHeadAssignment.deleteMany({ where: { organizationId: B, orgUnitId: unit['SIB']! } });
    }
  });

  it(`${TENANT_ISOLATION_GATE_STRING} — unit-headship: another organisation's heads, covers and units`, async () => {
    // B's head and cover, asked about in A, are nobody.
    expect(await findUnitHeadedBy(prisma, A, user['headInB']!)).toBeNull();
    expect(await findUnitsCoveredBy(prisma, A, user['coverInB']!, NOW)).toEqual([]);
    expect(await findCurrentHeadHolders(prisma, A, unit['BUNIT']!)).toEqual([]);
    expect(await findRunningActingCover(prisma, A, unit['BUNIT']!, NOW)).toBeNull();
    // B's unit is no root in A, and A's root never reaches into B.
    expect(await findUnitSubtreeIds(prisma, A, [unit['BUNIT']!])).toEqual([]);
    expect(await findUnitSubtreeIds(prisma, A, [unit['ROOT']!])).not.toContain(unit['BUNIT']);
    expect(await findUnitSubtreeIds(prisma, A, [unit['ROOT']!])).not.toContain(unit['BCHILD']);
    // And each is real in its own organisation.
    expect(await findUnitHeadedBy(prisma, B, user['headInB']!)).toBe(unit['BUNIT']);
    expect(await findUnitsCoveredBy(prisma, B, user['coverInB']!, NOW)).toEqual([unit['BUNIT']]);
  });
});
