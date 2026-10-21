/**
 * ACC-120 slice 5 (CC-91, D4) — the permission save against a REAL Postgres
 * (npm run test:db).
 *
 * The unit spec serialises transactions by hand to stand in for the row lock.
 * Only a database can prove the lock itself: that concurrent saves from one
 * loaded set cannot both commit — without SELECT … FOR UPDATE they can each
 * read the old set, both pass the comparison, and the later write silently
 * replaces the earlier.
 *
 * Same guards as ai-credit.db-spec.ts: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine — CI's
 * ephemeral Postgres is on localhost — so it can never write to the shared
 * dev database.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RoleService } from './role.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('Saving a role\'s permissions against a real database (ACC-120 slice 5)', () => {
  const prisma = new PrismaService();
  const roles = new RoleService(prisma, new AuditLogService(prisma));

  async function role(): Promise<{ organizationId: string; roleId: string; actorId: string }> {
    const slug = `acc120-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const actor = await prisma.user.create({
      data: { organizationId: org.id, email: `${slug}@example.test`, name: 'Role editor' },
    });
    const created = await prisma.role.create({
      data: { organizationId: org.id, nameEn: `Editor ${slug}`, isSystem: false, isActive: true },
    });
    return { organizationId: org.id, roleId: created.id, actorId: actor.id };
  }

  async function held(roleId: string): Promise<string[]> {
    const rows = await prisma.rolePermission.findMany({ where: { roleId }, include: { permission: true } });
    return rows.map((r) => `${r.permission.module}:${r.permission.action}`).sort();
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    // The catalogue: CI's database is migrated but not seeded.
    await roles.seedPermissions();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('ten concurrent saves from ONE loaded set: exactly one commits, nine get 409, one audit row', async () => {
    const { organizationId, roleId, actorId } = await role();
    const choices = ['committees:view', 'admin:access', 'lookups:view', 'users:view', 'roles:view',
      'org:view', 'workflows:view', 'positions:view', 'setup:view', 'meetings:view'];

    const outcomes = await Promise.all(
      choices.map((key) =>
        roles
          .assignPermissions(roleId, { permissionKeys: [key], expectedPermissionKeys: [] }, organizationId, actorId)
          .then(() => key)
          .catch((e: { getResponse?: () => { code?: string } }) => e.getResponse?.()?.code ?? 'ERROR'),
      ),
    );

    const committed = outcomes.filter((o) => choices.includes(o));
    expect(committed).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ROLE_PERMISSIONS_CHANGED')).toHaveLength(choices.length - 1);
    expect(await held(roleId)).toEqual(committed);
    const audits = await prisma.auditLog.count({ where: { organizationId, objectType: 'RolePermission', objectId: roleId } });
    expect(audits).toBe(1);
  });

  it('a save from a FRESH load after the winner goes through', async () => {
    const { organizationId, roleId, actorId } = await role();
    await roles.assignPermissions(roleId, { permissionKeys: ['roles:view'], expectedPermissionKeys: [] }, organizationId, actorId);

    await roles.assignPermissions(
      roleId,
      { permissionKeys: ['roles:view', 'lookups:view'], expectedPermissionKeys: ['roles:view'] },
      organizationId,
      actorId,
    );

    expect(await held(roleId)).toEqual(['lookups:view', 'roles:view']);
  });

  it("another organisation's role cannot be saved from this one, and is left untouched", async () => {
    const mine = await role();
    const theirs = await role();
    await roles.assignPermissions(
      theirs.roleId,
      { permissionKeys: ['roles:view'], expectedPermissionKeys: [] },
      theirs.organizationId,
      theirs.actorId,
    );

    await expect(
      roles.assignPermissions(
        theirs.roleId,
        { permissionKeys: [], expectedPermissionKeys: ['roles:view'] },
        mine.organizationId,
        mine.actorId,
      ),
    ).rejects.toThrow('Role not found');

    expect(await held(theirs.roleId)).toEqual(['roles:view']);
  });
});
