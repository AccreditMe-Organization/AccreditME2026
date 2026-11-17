/**
 * ACC-283 PR 4 — the retire backfill (prisma/backfill-acc283-retire-committees-approve.ts)
 * against a REAL Postgres (npm run test:db).
 *
 * What it must do: in each organisation, remove committees:approve from every
 * role that holds it, with one audit row per role changed in that organisation's
 * own trail; leave every other key and every other organisation alone; refuse
 * (writing nothing) when a customer organisation holds it; keep the shared
 * catalogue row while any grant still references it; and a second run plans
 * nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KEY, SCRIPT_NAME, planBackfill, retireCatalogueRow, runBackfill } from '../../../prisma/backfill-acc283-retire-committees-approve';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('backfill:acc283-retire-committees-approve, on a real database (ACC-283 PR 4)', () => {
  const prisma = new PrismaService();

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, update: {}, create: { module, action, description: key } })).id;
  }

  async function seedRole(organizationId: string, key: string | null, keys: string[]): Promise<string> {
    const id = (
      await prisma.role.create({
        data: { organizationId, key, nameEn: `${key ?? 'Custom'} ${randomUUID().slice(0, 6)}`, isSystem: key !== null },
      })
    ).id;
    for (const k of keys) await prisma.rolePermission.create({ data: { roleId: id, permissionId: await permissionId(k) } });
    return id;
  }

  async function held(roleId: string): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { module: true, action: true } } } });
    return rows.map((r) => `${r.permission.module}:${r.permission.action}`).sort();
  }

  /** An organisation as it stands before PR 4: committees:approve on the root role, a seeded role and a custom one. */
  async function org() {
    const slug = `acc283r-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const roles = {
      root: await seedRole(id, 'TENANT_ADMIN', [KEY, 'committees:view', 'roles:manage']),
      qm: await seedRole(id, 'QUALITY_MANAGER', [KEY, 'committees:view', 'committees:create']),
      custom: await seedRole(id, null, [KEY]),
      untouched: await seedRole(id, null, ['committees:view']),
    };
    return { id, slug, roles };
  }

  const fixture = () => true;
  const customer = () => false;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('dry run plans every role holding it and writes nothing; execute removes it with one audit row per role; a second dry run plans 0', async () => {
    const o = await org();
    const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture: fixture });
    expect(dry.plans[0]!.revocations.map((r) => r.roleId).sort()).toEqual([o.roles.root, o.roles.qm, o.roles.custom].sort());
    expect(await held(o.roles.qm)).toContain(KEY);
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, metadata: { path: ['source'], equals: SCRIPT_NAME } } })).toBe(0);

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: fixture });
    expect(run.refusedCustomers).toEqual([]);
    expect(run.revoked).toEqual([{ slug: o.slug, roles: 3 }]);

    // Only the key goes; every other key of every role stays.
    expect(await held(o.roles.root)).toEqual(['committees:view', 'roles:manage']);
    expect(await held(o.roles.qm)).toEqual(['committees:create', 'committees:view']);
    expect(await held(o.roles.custom)).toEqual([]);
    expect(await held(o.roles.untouched)).toEqual(['committees:view']);

    // One audit row per role changed, in the organisation's own trail, with no actor.
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: o.id, metadata: { path: ['source'], equals: SCRIPT_NAME } },
      select: { objectId: true, actorId: true, action: true, objectType: true, before: true, after: true, metadata: true },
    });
    expect(audits.map((a) => a.objectId).sort()).toEqual([o.roles.root, o.roles.qm, o.roles.custom].sort());
    for (const a of audits) {
      expect([a.actorId, a.action, a.objectType]).toEqual([null, 'UPDATE', 'RolePermission']);
      expect((a.before as { permissions: string[] }).permissions).toContain(KEY);
      expect((a.after as { permissions: string[] }).permissions).not.toContain(KEY);
      expect((a.metadata as { removed: string[] }).removed).toEqual([KEY]);
    }

    const again = await planBackfill(prisma, [o.id], fixture);
    expect(again[0]!.revocations).toEqual([]);
  });

  it('leaves another organisation alone', async () => {
    const o = await org();
    const other = await org();
    await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: fixture });
    expect(await held(other.roles.qm)).toContain(KEY);
    expect(await prisma.auditLog.count({ where: { organizationId: other.id, metadata: { path: ['source'], equals: SCRIPT_NAME } } })).toBe(0);
  });

  it('refuses a customer organisation and writes nothing, anywhere in the run', async () => {
    const fixtureOrg = await org();
    const customerOrg = await org();
    const isFixture = (slug: string) => slug === fixtureOrg.slug;
    const run = await runBackfill(prisma, { execute: true, organizationIds: [fixtureOrg.id, customerOrg.id], isFixture });
    expect(run.refusedCustomers).toEqual([customerOrg.slug]);
    expect(run.revoked).toEqual([]);
    // Neither organisation changed: the refusal comes before any write.
    expect(await held(customerOrg.roles.qm)).toContain(KEY);
    expect(await held(fixtureOrg.roles.qm)).toContain(KEY);
    // A dry run still reports the customer organisation.
    const dry = await runBackfill(prisma, { execute: false, organizationIds: [customerOrg.id], isFixture: customer });
    expect(dry.plans[0]).toEqual(expect.objectContaining({ customer: true }));
    expect(dry.plans[0]!.revocations).toHaveLength(3);
  });

  it('keeps the shared catalogue row while any grant references it, and a narrowed run never touches it', async () => {
    const o = await org();
    const narrowed = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture: fixture });
    expect(narrowed.catalogue).toEqual({ present: false, deleted: false, stillReferenced: 0 });
    const kept = await retireCatalogueRow(prisma, true);
    expect(kept.present).toBe(true);
    expect(kept.deleted).toBe(false);
    expect(kept.stillReferenced).toBeGreaterThanOrEqual(3);
    expect(await prisma.permission.count({ where: { module: 'committees', action: 'approve' } })).toBe(1);
  });
});
