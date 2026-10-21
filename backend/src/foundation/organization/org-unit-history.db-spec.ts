/**
 * ACC-120 slice 11, PR D — the History endpoint against a REAL Postgres
 * (npm run test:db).
 *
 * The unit spec evaluates the where clauses in memory, including its own
 * reading of the two Json filters. Only a database proves those: that
 * `after: { not: DbNull }` leaves out the metadata-only audit twin of a
 * headship operation, and that the deactivation lookup's two `path` filters
 * find the row that moved `isActive` from true to false and no other.
 *
 * AuditLog is append-only (PrismaService refuses every delete), so the rows
 * this spec writes stay, as the other audit-writing db-specs' do. They are in
 * organisations made here, on a local test database only. Same guards as the
 * other db-specs: it FAILS, never skips, without a database, and refuses any
 * database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgUnitHistoryService } from './org-unit-history.service';
import type { IOrgUnitAuditHistoryEntry } from './interfaces/org-unit-history.interface';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const ALL = ['org:view', 'users:view'];

describe('The org unit History endpoint against a real database (ACC-120 slice 11, PR D)', () => {
  const prisma = new PrismaService();
  const service = new OrgUnitHistoryService(prisma);
  let orgA: string;
  let orgB: string;
  let unit: string;
  let parent: string;
  let bUnit: string;
  let nora: string;

  const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

  beforeAll(async () => {
    await prisma.onModuleInit();
    const s = randomUUID().slice(0, 8);
    const org = async (prefix: string) =>
      (await prisma.organization.create({ data: { name: `${prefix}-${s}`, slug: `${prefix}-${s}`, country: 'SA' } })).id;
    orgA = await org('acc120d-a');
    orgB = await org('acc120d-b');

    parent = (await prisma.orgUnit.create({ data: { organizationId: orgA, nameEn: 'Medical Services', code: `MED-${s}` } })).id;
    unit = (await prisma.orgUnit.create({ data: { organizationId: orgA, nameEn: 'Pharmacy', code: `PH-${s}`, parentId: parent } })).id;
    bUnit = (await prisma.orgUnit.create({ data: { organizationId: orgB, nameEn: 'B unit', code: `B-${s}` } })).id;
    nora = (
      await prisma.user.create({ data: { organizationId: orgA, email: `nora-${s}@example.test`, name: 'Nora Al-Otaibi', status: 'ACTIVE' } })
    ).id;
    const bUser = (
      await prisma.user.create({ data: { organizationId: orgB, email: `b-${s}@example.test`, name: 'B Person', status: 'ACTIVE' } })
    ).id;

    const copy = (over: Record<string, unknown> = {}) => ({
      id: unit,
      parentId: null,
      nameEn: 'Pharmacy',
      code: `PH-${s}`,
      isActive: true,
      sortOrder: 0,
      ...over,
    });
    const audit = (organizationId: string, objectId: string, createdAt: Date, data: Record<string, unknown>) =>
      prisma.auditLog.create({ data: { organizationId, objectType: 'OrgUnit', objectId, action: 'UPDATE', actorId: nora, createdAt, ...data } });

    await audit(orgA, unit, at('2025-01-10'), { action: 'CREATE', after: copy() });
    await audit(orgA, unit, at('2025-03-02'), { before: copy(), after: copy({ parentId: parent }) });
    // The metadata-only twin of a headship operation: must not be read.
    await audit(orgA, unit, at('2026-09-25'), { metadata: { actingHeadAssigned: true, userId: nora } });
    // A row that switched isActive the other way, then the real deactivation.
    await audit(orgA, unit, at('2026-10-01'), { before: copy({ isActive: false }), after: copy({ isActive: true }) });
    await audit(orgA, unit, at('2026-10-10'), { before: copy(), after: copy({ isActive: false }) });
    // B's rows on A's unit id.
    await audit(orgB, unit, at('2026-10-11'), { actorId: bUser, before: copy(), after: copy({ isActive: false }) });

    await prisma.orgUnitHeadEvent.create({
      data: { organizationId: orgA, orgUnitId: unit, userId: nora, action: 'ACTING_ASSIGNED', effectiveDate: at('2026-09-25'), createdAt: at('2026-09-25'), approvedBy: nora },
    });
    await prisma.orgUnitHeadEvent.create({
      data: { organizationId: orgB, orgUnitId: bUnit, userId: bUser, action: 'VACATED', effectiveDate: at('2026-10-11'), createdAt: at('2026-10-11') },
    });
    await prisma.orgUnit.update({ where: { id: unit }, data: { isActive: false } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the unit’s own audit rows and its head event, newest first; never the metadata-only twin', async () => {
    const page = await service.history(orgA, ALL, unit);
    expect(page.items.map((i) => [i.source, i.kind])).toEqual([
      ['AUDIT', 'DEACTIVATED'],
      ['AUDIT', 'REACTIVATED'],
      ['HEAD_EVENT', 'ACTING_ASSIGNED'],
      ['AUDIT', 'CHANGED'],
      ['AUDIT', 'CREATED'],
    ]);
    expect(page.total).toBe(5);
    const moved = page.items[3] as IOrgUnitAuditHistoryEntry;
    expect(moved.movedTo).toEqual({ id: parent, nameEn: 'Medical Services', nameAr: null });
    expect(JSON.stringify(page)).not.toContain('B Person');
  });

  it('the deactivation is the row that moved isActive from true to false', async () => {
    const page = await service.history(orgA, ALL, unit);
    expect(page.deactivation).toEqual({ at: at('2026-10-10'), actor: expect.objectContaining({ userId: nora, name: 'Nora Al-Otaibi' }) });
  });

  it('pages over both sources without repeating a row', async () => {
    const first = await service.history(orgA, ALL, unit, { skip: 0, take: 2 });
    const second = await service.history(orgA, ALL, unit, { skip: 2, take: 2 });
    const third = await service.history(orgA, ALL, unit, { skip: 4, take: 2 });
    const all = await service.history(orgA, ALL, unit);
    expect([...first.items, ...second.items, ...third.items].map((i) => i.id)).toEqual(all.items.map((i) => i.id));
  });

  it('should NOT return records belonging to a different tenant — B’s unit from A is the identical 404', async () => {
    await expect(service.history(orgA, ALL, bUnit)).rejects.toThrow(new NotFoundException('Org unit not found'));
    // And A's unit from B: B has rows on that id, but no such unit.
    await expect(service.history(orgB, ALL, unit)).rejects.toThrow(new NotFoundException('Org unit not found'));
  });
});
