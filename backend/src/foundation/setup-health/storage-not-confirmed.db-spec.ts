/**
 * ACC-261 — "File storage not confirmed" against a REAL Postgres: the detector
 * and the reconciler as they run hourly, on real organisations.
 *
 *   - an organisation whose storageConfirmedAt is null gets one BLOCKS_WORK row,
 *     about itself;
 *   - the first pass after Confirm (storageConfirmedAt stamped, as
 *     POST /tenant/storage/confirm stamps it) clears that row;
 *   - another organisation's state never reaches these rows.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SetupConditionDetectors } from './setup-condition.detectors';
import { SetupConditionReconciler } from './setup-condition.reconciler';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const TYPE = 'STORAGE_NOT_CONFIRMED' as const;

describe('File storage not confirmed, against a real database (ACC-261)', () => {
  const prisma = new PrismaService();
  const detectors = new SetupConditionDetectors(prisma);
  const reconciler = new SetupConditionReconciler(prisma, detectors);

  /** A new organisation: storage unconfirmed, as every organisation starts (ACC-177). */
  const org = async () => {
    const slug = `acc261-${randomUUID().slice(0, 8)}`;
    return (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
  };
  const confirm = (organizationId: string, at: Date) =>
    prisma.organization.update({ where: { id: organizationId }, data: { storageConfirmedAt: at } });
  const rowsOf = (organizationId: string) =>
    prisma.setupCondition.findMany({ where: { organizationId, type: TYPE }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('opens one BLOCKS_WORK row about the organisation while its storage is unconfirmed, and clears it after Confirm', async () => {
    const id = await org();
    const t1 = new Date('2026-11-17T09:00:00Z');
    const t2 = new Date('2026-11-17T10:00:00Z');

    await reconciler.reconcileType(id, TYPE, t1);
    const [open] = await rowsOf(id);
    expect(open).toMatchObject({ objectId: id, severity: 'BLOCKS_WORK', openedAt: t1, clearedAt: null });

    // Another pass while still unconfirmed: the same row, still open.
    await reconciler.reconcileType(id, TYPE, new Date('2026-11-17T09:30:00Z'));
    expect((await rowsOf(id)).map((r) => [r.id, r.clearedAt])).toEqual([[open!.id, null]]);

    await confirm(id, new Date('2026-11-17T09:45:00Z'));
    await reconciler.reconcileType(id, TYPE, t2);
    const [closed, ...more] = await rowsOf(id);
    expect(more).toEqual([]);
    expect(closed).toMatchObject({ id: open!.id, clearedAt: t2, openedAt: t1 });
  });

  it('a confirmed organisation never gets the row', async () => {
    const id = await org();
    await confirm(id, new Date('2026-11-17T08:00:00Z'));
    await reconciler.reconcileType(id, TYPE, new Date('2026-11-17T09:00:00Z'));
    expect(await rowsOf(id)).toEqual([]);
  });

  itEnforcesTenantIsolation("file storage not confirmed — another organisation's state never reaches these rows", async () => {
    const mine = await org();
    const theirs = await org();
    await confirm(mine, new Date('2026-11-17T08:00:00Z'));

    // Mine is confirmed, theirs is not: reconciling mine opens nothing, about anyone.
    await reconciler.reconcileType(mine, TYPE, new Date('2026-11-17T09:00:00Z'));
    expect(await rowsOf(mine)).toEqual([]);
    const any = await prisma.setupCondition.findMany({ where: { type: TYPE, objectId: { in: [mine, theirs] } } });
    expect(any).toEqual([]);

    // Theirs opens only its own row, filed under its own organisation.
    await reconciler.reconcileType(theirs, TYPE, new Date('2026-11-17T09:00:00Z'));
    const rows = await prisma.setupCondition.findMany({ where: { type: TYPE, objectId: { in: [mine, theirs] } } });
    expect(rows.map((r) => [r.organizationId, r.objectId])).toEqual([[theirs, theirs]]);
  });
});
