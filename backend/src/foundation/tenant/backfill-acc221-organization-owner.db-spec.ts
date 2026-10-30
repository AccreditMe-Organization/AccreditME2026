/**
 * ACC-221 — the account-owner backfill (prisma/backfill-acc221-organization-owner.ts)
 * against a REAL Postgres (npm run test:db).
 *
 * What it must do: give each organisation without an owner its single ACTIVE
 * holder of the active Organization Administrator role (never an invited,
 * inactive or suspended holder, never one through an inactive role); skip and
 * report an organisation with none or with several; never touch the platform
 * organisation or an owner already set; write one audit row per organisation;
 * and a second run plans nothing.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import type { UserStatus } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { planBackfill, runBackfill, SCRIPT_NAME } from '../../../prisma/backfill-acc221-organization-owner';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);

describe('backfill:acc221-organization-owner, on a real database (ACC-221)', () => {
  const prisma = new PrismaService();

  /** An organisation with its Organization Administrator role (active unless told otherwise). */
  async function org(options: { isPlatformOrg?: boolean; roleActive?: boolean } = {}) {
    const slug = `acc221-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA', isPlatformOrg: options.isPlatformOrg ?? false } })).id;
    const roleId = (
      await prisma.role.create({
        data: { organizationId: id, key: 'TENANT_ADMIN', nameEn: 'Organization Administrator', isSystem: true, isActive: options.roleActive ?? true },
      })
    ).id;
    /** A user in this organisation holding the role. */
    const admin = async (status: UserStatus = 'ACTIVE'): Promise<string> => {
      const userId = (await prisma.user.create({ data: { organizationId: id, email: `${randomUUID()}@example.test`, name: 'Admin', status } })).id;
      await prisma.userRole.create({ data: { userId, roleId } });
      return userId;
    };
    return { id, slug, roleId, admin };
  }

  const owner = async (organizationId: string): Promise<string | null> =>
    (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { ownerUserId: true } })).ownerUserId;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('sets the single active holder, with one audit row; a second run plans 0', async () => {
    const o = await org();
    const holder = await o.admin();

    const dry = await runBackfill(prisma, { execute: false, organizationIds: [o.id] });
    expect(dry.decisions).toEqual([{ slug: o.slug, organizationId: o.id, action: 'set', ownerUserId: holder }]);
    expect(await owner(o.id)).toBeNull();

    const run = await runBackfill(prisma, { execute: true, organizationIds: [o.id] });
    expect(run.changed).toEqual([o.slug]);
    expect(await owner(o.id)).toBe(holder);

    const audit = await prisma.auditLog.findMany({ where: { organizationId: o.id, objectId: o.id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'UPDATE', objectType: 'Organization', actorId: null, before: { ownerUserId: null }, after: { ownerUserId: holder } });
    expect(audit[0]!.metadata).toMatchObject({ source: SCRIPT_NAME, ticket: 'ACC-221' });

    expect(await planBackfill(prisma, [o.id])).toEqual([]);
    const again = await runBackfill(prisma, { execute: true, organizationIds: [o.id] });
    expect(again.changed).toEqual([]);
  });

  it('skips an organisation with no active holder, and one with two, reporting the count', async () => {
    const none = await org();
    const two = await org();
    await two.admin();
    await two.admin();

    const run = await runBackfill(prisma, { execute: true, organizationIds: [none.id, two.id] });
    const bySlug = Object.fromEntries(run.decisions.map((d) => [d.slug, d]));
    expect(bySlug[none.slug]).toMatchObject({ action: 'skip', reason: 'no active Organization Administrator', holders: 0 });
    expect(bySlug[two.slug]).toMatchObject({ action: 'skip', reason: 'more than one active Organization Administrator', holders: 2 });
    expect(run.changed).toEqual([]);
    expect(await owner(none.id)).toBeNull();
    expect(await owner(two.id)).toBeNull();
  });

  it('counts only ACTIVE holders: invited, inactive and suspended holders are ignored', async () => {
    const mixed = await org();
    const active = await mixed.admin('ACTIVE');
    await mixed.admin('INVITED');
    await mixed.admin('INACTIVE');
    await mixed.admin('SUSPENDED');

    const onlyInactive = await org();
    await onlyInactive.admin('INVITED');
    await onlyInactive.admin('INACTIVE');

    await runBackfill(prisma, { execute: true, organizationIds: [mixed.id, onlyInactive.id] });
    expect(await owner(mixed.id)).toBe(active);
    expect(await owner(onlyInactive.id)).toBeNull();
    const plan = await planBackfill(prisma, [onlyInactive.id]);
    expect(plan).toEqual([expect.objectContaining({ action: 'skip', holders: 0 })]);
  });

  it('an inactive Organization Administrator role gives nobody the ownership', async () => {
    const o = await org({ roleActive: false });
    await o.admin();
    expect(await planBackfill(prisma, [o.id])).toEqual([expect.objectContaining({ action: 'skip', holders: 0 })]);
  });

  it('never touches the platform organisation', async () => {
    const platform = await org({ isPlatformOrg: true });
    await platform.admin();

    expect(await planBackfill(prisma, [platform.id])).toEqual([]);
    await runBackfill(prisma, { execute: true, organizationIds: [platform.id] });
    expect(await owner(platform.id)).toBeNull();
  });

  it('leaves an owner already set alone, even when another person is the single admin', async () => {
    const o = await org();
    await o.admin();
    const other = (await prisma.user.create({ data: { organizationId: o.id, email: `${randomUUID()}@example.test`, name: 'Owner', status: 'ACTIVE' } })).id;
    await prisma.organization.update({ where: { id: o.id }, data: { ownerUserId: other } });

    expect(await planBackfill(prisma, [o.id])).toEqual([]);
    await runBackfill(prisma, { execute: true, organizationIds: [o.id] });
    expect(await owner(o.id)).toBe(other);
  });

  it('reads the holders in one query, however many organisations there are', async () => {
    const orgs = await Promise.all([org(), org(), org(), org()]);
    for (const o of orgs) await o.admin();
    const spy = jest.spyOn(prisma.userRole, 'findMany');
    try {
      await planBackfill(prisma, orgs.map((o) => o.id));
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
