/**
 * ACC-164 — the users:reset_mfa grant backfill against a REAL Postgres
 * (npm run test:db): the dry run's counts, --execute's grant and its one audit
 * row per organisation, the platform organisation skipped, and a re-run that
 * plans 0 and writes nothing.
 *
 * Like every db-spec it FAILS without a database and refuses one that is not
 * on this machine, so it can never reach the shared dev database (ACC-120).
 * Scoped to the organisations it creates, so other rows in the database are
 * never planned or touched.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { applyGrants, KEY, planGrants } from '../../../prisma/backfill-acc164-reset-mfa-permission';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('backfill-acc164 — users:reset_mfa granted to Organization Administrator, against a real database', () => {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  async function organisation(opts: { platform?: boolean; holds?: boolean } = {}): Promise<{ id: string; slug: string; roleId: string }> {
    const slug = `acc164-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({
      data: { name: slug, slug, country: 'SA', isPlatformOrg: opts.platform ?? false },
      select: { id: true, slug: true },
    });
    const role = await prisma.role.create({
      data: { organizationId: org.id, key: 'TENANT_ADMIN', nameEn: 'Organization Administrator', isSystem: true },
      select: { id: true },
    });
    if (opts.holds) {
      const [module, action] = KEY.split(':') as [string, string];
      const permission = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action, description: KEY },
      });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    }
    return { ...org, roleId: role.id };
  }

  const holds = async (roleId: string) =>
    (await prisma.rolePermission.count({
      where: { roleId, permission: { module: 'users', action: 'reset_mfa' } },
    })) === 1;
  const auditRows = (organizationId: string) =>
    prisma.auditLog.findMany({ where: { organizationId, objectType: 'RolePermission' } });

  it('plans, grants with one audit row per organisation, skips the platform organisation, then plans 0', async () => {
    const a = await organisation();
    const b = await organisation();
    const already = await organisation({ holds: true });
    const platform = await organisation({ platform: true });
    const ids = [a.id, b.id, already.id, platform.id];

    const dry = await planGrants(prisma, ids);
    expect(dry.grants.map((g) => g.slug).sort()).toEqual([a.slug, b.slug].sort());
    expect(dry.alreadyHeld).toEqual([already.slug]);
    expect(dry.skipped).toEqual([platform.slug]);
    // The dry run wrote nothing.
    expect(await holds(a.roleId)).toBe(false);

    expect(await applyGrants(prisma, dry)).toBe(2);
    expect(await holds(a.roleId)).toBe(true);
    expect(await holds(b.roleId)).toBe(true);
    expect(await holds(platform.roleId)).toBe(false);
    for (const org of [a, b]) {
      const rows = await auditRows(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorId: null, action: 'CREATE', after: { permission: KEY, roleKey: 'TENANT_ADMIN' } });
    }
    expect(await auditRows(already.id)).toHaveLength(0);

    const again = await planGrants(prisma, ids);
    expect(again.grants).toEqual([]);
    expect(await applyGrants(prisma, again)).toBe(0);
    expect(await auditRows(a.id)).toHaveLength(1);
  });
});
