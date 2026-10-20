/**
 * ACC-244 — the grant script (prisma/backfill-acc244-grant-task-keys.ts),
 * planned and applied against a REAL Postgres (npm run test:db), limited to
 * organisations this spec creates.
 *
 * What it must do: grant each system role its seeded share of the committee
 * task keys, only where the role holds the flat key the new one replaces; one
 * audit row per grant; revoke nothing; and a second run plans and writes
 * nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { COMMITTEE_TASKS_PERMISSIONS, TASKS_PERMISSIONS, COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { applyGrants, BACKFILL_TX, planGrants, SCRIPT_NAME } from '../../../prisma/backfill-acc244-grant-task-keys';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const { VIEW_ALL, CREATE, MANAGE, VIEW_UNIT } = COMMITTEE_TASKS_PERMISSIONS;

describe('backfill:acc244-grant-task-keys, on a real database (ACC-244)', () => {
  // The script's own client shape: a plain PrismaClient on the pg adapter.
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  let A = '';
  let B = '';
  const role: Record<string, string> = {};

  /** The role's permission keys, sorted. */
  async function held(roleId: string): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { module: true, action: true } } } });
    return rows.map((r) => `${r.permission.module}:${r.permission.action}`).sort();
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, update: {}, create: { module, action, description: key } })).id;
  }

  async function seedRole(organizationId: string, key: string, keys: string[]): Promise<string> {
    const id = (await prisma.role.create({ data: { organizationId, key, nameEn: `${key} ${randomUUID().slice(0, 4)}`, isSystem: true } as never })).id;
    for (const k of keys) await prisma.rolePermission.create({ data: { roleId: id, permissionId: await permissionId(k) } });
    return id;
  }

  beforeAll(async () => {
    await prisma.$connect();
    const slug = `acc244g-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;
    const ALL_OLD = [TASKS_PERMISSIONS.VIEW, TASKS_PERMISSIONS.CREATE, TASKS_PERMISSIONS.REASSIGN, TASKS_PERMISSIONS.MANAGE];
    // Organisation A: the system roles as an organisation seeded before ACC-244 holds them.
    role['A:TENANT_ADMIN'] = await seedRole(A, 'TENANT_ADMIN', [...ALL_OLD, COMMITTEES_PERMISSIONS.VIEW]);
    role['A:QUALITY_MANAGER'] = await seedRole(A, 'QUALITY_MANAGER', [...ALL_OLD, COMMITTEES_PERMISSIONS.VIEW]);
    role['A:READ_ONLY_ADMIN'] = await seedRole(A, 'READ_ONLY_ADMIN', [TASKS_PERMISSIONS.VIEW, COMMITTEES_PERMISSIONS.VIEW]);
    role['A:VIEWER'] = await seedRole(A, 'VIEWER', [TASKS_PERMISSIONS.VIEW, COMMITTEES_PERMISSIONS.VIEW]);
    role['A:QUALITY_OFFICER'] = await seedRole(A, 'QUALITY_OFFICER', [TASKS_PERMISSIONS.VIEW, TASKS_PERMISSIONS.MANAGE]);
    // Organisation B edited its Quality Manager: no tasks:reassign, no tasks:create.
    role['B:QUALITY_MANAGER'] = await seedRole(B, 'QUALITY_MANAGER', [TASKS_PERMISSIONS.VIEW, COMMITTEES_PERMISSIONS.VIEW]);
    // And already holds one new key (granted by hand): left alone.
    role['B:TENANT_ADMIN'] = await seedRole(B, 'TENANT_ADMIN', [...ALL_OLD, VIEW_ALL]);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('plans, applies with one audit row per grant, revokes nothing, and a re-run is empty', async () => {
    const before = Object.fromEntries(await Promise.all(Object.entries(role).map(async ([k, id]) => [k, await held(id)])));

    const plan = await planGrants(prisma, [A, B]);
    const label = (g: { organizationId: string; roleKey: string }) => `${g.organizationId === A ? 'A' : 'B'}:${g.roleKey}`;
    // Each grant names the role this spec made, by id as well as by key.
    expect(plan.grants.every((g) => g.roleId === role[label(g)])).toBe(true);
    const planned = plan.grants.map((g) => `${label(g)} ${g.permission}`).sort();
    expect(planned).toEqual(
      [
        `A:TENANT_ADMIN ${VIEW_ALL}`, `A:TENANT_ADMIN ${CREATE}`, `A:TENANT_ADMIN ${MANAGE}`, `A:TENANT_ADMIN ${VIEW_UNIT}`,
        `A:QUALITY_MANAGER ${VIEW_ALL}`, `A:QUALITY_MANAGER ${CREATE}`, `A:QUALITY_MANAGER ${MANAGE}`,
        `A:READ_ONLY_ADMIN ${VIEW_ALL}`, `A:READ_ONLY_ADMIN ${VIEW_UNIT}`,
        // B's edited Quality Manager keeps exactly the reach it chose: View all only.
        `B:QUALITY_MANAGER ${VIEW_ALL}`,
        `B:TENANT_ADMIN ${CREATE}`, `B:TENANT_ADMIN ${MANAGE}`, `B:TENANT_ADMIN ${VIEW_UNIT}`,
      ].sort(),
    );
    // VIEWER and QUALITY_OFFICER have no seeded share (Q2, Q6): never planned.
    expect(plan.grants.some((g) => g.roleKey === 'VIEWER' || g.roleKey === 'QUALITY_OFFICER')).toBe(false);
    expect(plan.withheld.map((w) => `${w.roleKey} ${w.permission} lacks ${w.lacks}`).sort()).toEqual(
      [`QUALITY_MANAGER ${CREATE} lacks ${TASKS_PERMISSIONS.CREATE}`, `QUALITY_MANAGER ${MANAGE} lacks ${TASKS_PERMISSIONS.REASSIGN}`].sort(),
    );
    expect(plan.alreadyHeld).toBe(1);

    const auditBefore = await prisma.auditLog.count({ where: { organizationId: { in: [A, B] } } });
    // ONE transaction, with the explicit limit: Prisma's default 5 seconds
    // rolled the first shared-database run back (20 Oct).
    const tx = jest.spyOn(prisma, '$transaction');
    expect(await applyGrants(prisma, plan)).toBe(13);
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx).toHaveBeenCalledWith(expect.any(Function), BACKFILL_TX);
    expect(BACKFILL_TX.timeout).toBeGreaterThanOrEqual(60_000);
    tx.mockRestore();

    // One audit row per grant, naming the new row, in the role's own organisation.
    const audits = await prisma.auditLog.findMany({ where: { organizationId: { in: [A, B] } }, orderBy: { createdAt: 'asc' } });
    expect(audits).toHaveLength(auditBefore + 13);
    for (const a of audits.slice(auditBefore)) {
      expect(a).toMatchObject({ action: 'CREATE', objectType: 'RolePermission', actorId: null, metadata: expect.objectContaining({ source: SCRIPT_NAME }) });
      const row = await prisma.rolePermission.findUnique({ where: { id: a.objectId! }, include: { role: { select: { organizationId: true } } } });
      expect(row?.role.organizationId).toBe(a.organizationId);
    }

    // Revokes nothing: every role keeps everything it held, plus exactly its grants.
    for (const [k, id] of Object.entries(role)) {
      const now = await held(id);
      expect(before[k].filter((p: string) => !now.includes(p))).toEqual([]);
    }
    expect(await held(role['A:VIEWER']!)).toEqual(before['A:VIEWER']);

    // Idempotent: the second run plans nothing and writes nothing.
    const again = await planGrants(prisma, [A, B]);
    expect(again.grants).toEqual([]);
    expect(again.missingCatalogue).toEqual([]);
    expect(await applyGrants(prisma, again)).toBe(0);
    expect(await prisma.auditLog.count({ where: { organizationId: { in: [A, B] } } })).toBe(auditBefore + 13);
  });
});
