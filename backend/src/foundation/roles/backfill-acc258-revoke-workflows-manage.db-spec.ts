/**
 * ACC-258 — the revocation backfill (prisma/backfill-acc258-revoke-workflows-manage.ts)
 * against a REAL Postgres (npm run test:db).
 *
 * What it must do: in each non-platform organisation, remove workflows:manage
 * from every role but Organization Administrator and Platform Administrator,
 * with one audit row per revoked grant in that organisation's own trail; leave
 * every other key, and every other organisation, alone; refuse a customer
 * organisation; and a second run plans nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { planBackfill, runBackfill, SCRIPT_NAME } from '../../../prisma/backfill-acc258-revoke-workflows-manage';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

const MANAGE = 'workflows:manage';

describe('backfill:acc258-revoke-workflows-manage, on a real database (ACC-258)', () => {
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

  /** An organisation as it could stand before ACC-258: workflows:manage given to roles beyond the root role. */
  async function org(isPlatformOrg = false) {
    const slug = `acc258-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA', isPlatformOrg } })).id;
    const roles = {
      root: await seedRole(id, 'TENANT_ADMIN', [MANAGE, 'workflows:view', 'roles:manage']),
      platform: await seedRole(id, 'PLATFORM_ADMIN', [MANAGE, 'platform:admin']),
      qm: await seedRole(id, 'QUALITY_MANAGER', [MANAGE, 'workflows:view', 'committees:view']),
      custom: await seedRole(id, null, [MANAGE]),
      untouched: await seedRole(id, null, ['workflows:view']),
    };
    return { id, slug, roles };
  }

  const isFixture = () => true;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('dry run plans the two grants outside the kept roles; execute revokes them with one audit row each; a second dry run plans 0', async () => {
    const o = await org();

    const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture });
    expect(dry.plans).toHaveLength(1);
    expect(dry.plans[0]!.revocations.map((r) => r.roleId).sort()).toEqual([o.roles.qm, o.roles.custom].sort());
    expect(await held(o.roles.qm)).toContain(MANAGE);

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture });
    expect(run.revoked).toEqual([{ slug: o.slug, grants: 2 }]);

    // Only the key went, and only from those two roles.
    expect(await held(o.roles.qm)).toEqual(['committees:view', 'workflows:view']);
    expect(await held(o.roles.custom)).toEqual([]);
    expect(await held(o.roles.root)).toEqual(['roles:manage', MANAGE, 'workflows:view'].sort());
    expect(await held(o.roles.platform)).toEqual(['platform:admin', MANAGE].sort());
    expect(await held(o.roles.untouched)).toEqual(['workflows:view']);

    const audit = await prisma.auditLog.findMany({
      where: { organizationId: o.id, metadata: { path: ['ticket'], equals: 'ACC-258' } },
      orderBy: { objectId: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.objectId).sort()).toEqual([o.roles.qm, o.roles.custom].sort());
    const qmRow = audit.find((a) => a.objectId === o.roles.qm)!;
    expect(qmRow).toMatchObject({
      actorId: null,
      action: 'UPDATE',
      objectType: 'RolePermission',
      before: { permissions: ['committees:view', MANAGE, 'workflows:view'].sort() },
      after: { permissions: ['committees:view', 'workflows:view'] },
    });
    expect(qmRow.metadata).toMatchObject({ source: SCRIPT_NAME, ticket: 'ACC-258', added: [], removed: [MANAGE] });

    const again = await runBackfill(prisma, { execute: false, organizationIds: [o.id], isFixture });
    expect(again.plans[0]!.revocations).toEqual([]);
  });

  it("should NOT return records belonging to a different tenant — one organisation's run leaves another's grants alone", async () => {
    const a = await org();
    const b = await org();
    await runBackfill(prisma, { execute: true, organizationIds: [a.id], isFixture });
    expect(await held(a.roles.qm)).not.toContain(MANAGE);
    expect(await held(b.roles.qm)).toContain(MANAGE);
    expect(await held(b.roles.custom)).toEqual([MANAGE]);
    expect(await prisma.auditLog.count({ where: { organizationId: b.id, metadata: { path: ['ticket'], equals: 'ACC-258' } } })).toBe(0);
  });

  it('never plans the platform organisation', async () => {
    const p = await org(true);
    const plans = await planBackfill(prisma, [p.id], isFixture);
    expect(plans).toEqual([]);
    expect(await held(p.roles.custom)).toEqual([MANAGE]);
  });

  it('refuses a customer organisation and writes nothing', async () => {
    const o = await org();
    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id], isFixture: () => false });
    expect(run.refusedCustomers).toEqual([o.slug]);
    expect(run.revoked).toEqual([]);
    expect(await held(o.roles.qm)).toContain(MANAGE);
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, metadata: { path: ['ticket'], equals: 'ACC-258' } } })).toBe(0);
  });
});
