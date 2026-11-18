/**
 * ACC-77 — backfill:acc77-manage-umbrellas, on a REAL Postgres (npm run test:db).
 *
 * A system role holding an umbrella is granted the umbrella's missing specifics;
 * a system role that lost the umbrella, and a tenant's own custom role, are
 * left alone; a second run plans nothing; a customer organisation is refused.
 * Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEE_TASKS_PERMISSIONS, MEETING_TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { planBackfill, runBackfill, SCRIPT_NAME } from '../../../prisma/backfill-acc77-manage-umbrellas';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const C = COMMITTEE_TASKS_PERMISSIONS;
const M = MEETING_TASKS_PERMISSIONS;

describe('backfill:acc77-manage-umbrellas, on a real database (ACC-77)', () => {
  const prisma = new PrismaService();
  const fixtures = new Set<string>();
  const isFixture = (slug: string) => fixtures.has(slug);
  let A = '';
  let B = '';
  const role: Record<string, string> = {};

  const held = async (roleId: string): Promise<string[]> =>
    (await prisma.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { module: true, action: true } } } }))
      .map((r) => `${r.permission.module}:${r.permission.action}`)
      .sort();
  const permissionId = async (key: string): Promise<string> => {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, update: {}, create: { module, action, description: key } })).id;
  };
  const seedRole = async (organizationId: string, key: string | null, keys: string[]): Promise<string> => {
    const id = (await prisma.role.create({ data: { organizationId, key, nameEn: `${key ?? 'Custom'} ${randomUUID().slice(0, 4)}`, isSystem: key !== null } })).id;
    for (const k of keys) await prisma.rolePermission.create({ data: { roleId: id, permissionId: await permissionId(k) } });
    return id;
  };

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc77-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;
    fixtures.add(slug).add(`${slug}-b`);
    // A: the Quality Manager as an organisation seeded before ACC-77 holds it.
    role['A:QM'] = await seedRole(A, 'QUALITY_MANAGER', [C.VIEW_ALL, C.CREATE, C.MANAGE, M.VIEW_ALL, M.CREATE, M.MANAGE]);
    // A: a custom role the tenant built, holding the umbrella alone: its choice.
    role['A:custom'] = await seedRole(A, null, [C.MANAGE]);
    // B: an organisation that took Manage tasks on meetings away from its Quality Manager.
    role['B:QM'] = await seedRole(B, 'QUALITY_MANAGER', [C.VIEW_ALL, C.CREATE, C.MANAGE, M.VIEW_ALL, M.CREATE]);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('plans the missing specifics of each umbrella a system role still holds, and nothing else', async () => {
    const plans = await planBackfill(prisma, [A, B], isFixture);
    const grants = plans.flatMap((p) => p.grants.map((g) => `${p.slug === plans[0]!.slug ? 'A' : 'B'} ${g.roleKey} ${g.permission}`)).sort();
    expect(grants).toEqual([`A QUALITY_MANAGER ${C.VIEW_UNIT}`, `A QUALITY_MANAGER ${M.VIEW_UNIT}`, `B QUALITY_MANAGER ${C.VIEW_UNIT}`].sort());
  });

  it('a dry run writes nothing', async () => {
    await runBackfill(prisma, { execute: false, organizationIds: [A, B], isFixture });
    expect(await held(role['A:QM']!)).not.toContain(C.VIEW_UNIT);
  });

  it('--execute grants them, writes one audit row per organisation, and a second run plans nothing', async () => {
    const result = await runBackfill(prisma, { execute: true, organizationIds: [A, B], isFixture });
    expect(result.changed.map((c) => c.grants).sort()).toEqual([1, 2]);
    expect(await held(role['A:QM']!)).toEqual([C.VIEW_ALL, C.CREATE, C.MANAGE, C.VIEW_UNIT, M.VIEW_ALL, M.CREATE, M.MANAGE, M.VIEW_UNIT].sort());
    expect(await held(role['B:QM']!)).toEqual([C.VIEW_ALL, C.CREATE, C.MANAGE, C.VIEW_UNIT, M.VIEW_ALL, M.CREATE].sort());
    expect(await held(role['A:custom']!)).toEqual([C.MANAGE]);
    for (const org of [A, B]) {
      expect(await prisma.auditLog.count({ where: { organizationId: org, metadata: { path: ['source'], equals: SCRIPT_NAME } } })).toBe(1);
    }
    const again = await planBackfill(prisma, [A, B], isFixture);
    expect(again.flatMap((p) => p.grants)).toEqual([]);
  });

  it('refuses a customer organisation with anything to grant, writing nothing', async () => {
    const slug = `acc77c-${randomUUID().slice(0, 8)}`;
    const customer = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const qm = await seedRole(customer, 'QUALITY_MANAGER', [C.VIEW_ALL, C.CREATE, C.MANAGE]);
    const result = await runBackfill(prisma, { execute: true, organizationIds: [customer], isFixture });
    expect(result.refusedCustomers).toEqual([slug]);
    expect(await held(qm)).not.toContain(C.VIEW_UNIT);
  });
});
