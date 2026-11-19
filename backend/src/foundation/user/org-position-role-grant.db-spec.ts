/**
 * ACC-271 (carried from ACC-136, Ahmad 27 Sep) — WHY `OrgPosition.roleId` STAYS:
 * it is the PERMISSION BRIDGE. A person holds a position, a head-conferring
 * position confers its role, and the role carries permissions — read by the
 * head-authority grant chain (UserService.syncHeadAuthorityRoleGrant() →
 * RoleService.grantRoleViaHeadAuthority()). It is NOT a workflow assignee:
 * stages are worked by their `who` pools (ACC-271), never by a role.
 *
 * One test, against a REAL Postgres (npm run test:db): a head position's
 * roleId reaches its holder's computed permissions. The unit specs in
 * user.service.spec.ts check the grant CALL with the role service mocked;
 * only a database proves the permission arrives.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { RoleService } from '../roles/role.service';
import { UserService } from './user.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('OrgPosition.roleId is the permission bridge (ACC-136, ACC-271)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const roles = new RoleService(prisma, audit);
  // syncHeadAuthorityRoleGrant() reads only Prisma and the role service; nothing else is called.
  const unused = {} as never;
  const users = new UserService(prisma, audit, unused, roles, unused, unused, unused, unused, unused, unused, unused, unused, unused);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("a head position's roleId reaches its holder's permissions", async () => {
    const slug = `acc271-roleid-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const permission = await prisma.permission.upsert({
      where: { module_action: { module: 'committees', action: 'view' } },
      create: { module: 'committees', action: 'view' },
      update: {},
    });
    const role = await prisma.role.create({
      data: { organizationId: org.id, nameEn: 'Head of unit', rolePermissions: { create: [{ permissionId: permission.id }] } },
    });
    const unit = await prisma.orgUnit.create({ data: { organizationId: org.id, nameEn: 'Clinical', code: `C-${slug}` } });
    const position = await prisma.orgPosition.create({
      data: { organizationId: org.id, nameEn: 'Head of Clinical', grade: 1, isUnitHeadPosition: true, roleId: role.id },
    });
    const holder = await prisma.user.create({
      data: { organizationId: org.id, email: `${slug}@example.test`, name: 'Holder', status: 'ACTIVE', positionId: position.id, primaryOrgUnitId: unit.id },
    });
    expect(await roles.getUserPermissions(holder.id, org.id)).not.toContain('committees:view');

    await users.syncHeadAuthorityRoleGrant(holder.id, null, null, position.id, unit.id, org.id, null);

    expect(await roles.getUserPermissions(holder.id, org.id)).toContain('committees:view');
  });
});
