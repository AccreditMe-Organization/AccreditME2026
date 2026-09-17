// One-off backfill for ACC-101 — removes tasks:view from every existing
// organization's BASE_USER role.
//
// THIS IS THE FIRST REVOCATION BACKFILL IN THE PROJECT, and that is the reason
// for most of what follows. Every earlier backfill-*.ts (ACC-16, ACC-22,
// ACC-46, ACC-82) only ever GRANTED a permission. Granting one a tenant never
// chose to withhold is safe; taking one away may overwrite a decision a
// customer made deliberately, because roles are fully tenant-editable —
// assignPermissions() replaces any role's set, system roles included.
//
// THE RULE THIS ESTABLISHES, recorded in CLAUDE.md alongside it:
//   A revocation backfill is permitted only while no CUSTOMER tenant exists.
//   After the first customer, a removal changes the seed for new tenants only;
//   existing tenants get a REPORT of which roles still grant it, and their
//   admin decides. A security-critical revocation that cannot wait becomes a
//   customer-notified migration, never a silent script.
// Today that condition holds: the three organizations on dev are the platform
// org and two seeded fixtures, and zero users hold BASE_USER at all.
//
// WHY NOT seedSystemRoles(): it does deleteMany({ roleId }) and recreates from
// the seed, so running it to propagate one removal would silently reset every
// permission on every system role, discarding any tenant customisation. This
// deletes exactly the RolePermission rows it names and nothing else — the same
// narrow-blast-radius reasoning backfill-setup-view-permission.ts used in the
// granting direction.
//
// DRY RUN BY DEFAULT. Pass --execute to delete. The dry run prints the same
// per-row detail the execute path acts on, so the count can be approved before
// anything is removed.
//
// Idempotent: re-running after a successful execute finds nothing and deletes
// nothing.
//
// Run: npm run backfill:remove-base-user-tasks-view            (dry run)
//      npm run backfill:remove-base-user-tasks-view -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { TASKS_PERMISSIONS } from '../src/common/constants/permissions';

const BASE_USER_KEY = 'BASE_USER';

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [module, action] = TASKS_PERMISSIONS.VIEW.split(':') as [string, string];

    const permission = await prisma.permission.findFirst({ where: { module, action } });
    if (!permission) {
      console.log(`Permission ${TASKS_PERMISSIONS.VIEW} is not in the catalog; nothing to do.`);
      return;
    }

    const roles = await prisma.role.findMany({
      where: { key: BASE_USER_KEY },
      select: { id: true, nameEn: true, organizationId: true },
    });

    const targets: Array<{ orgSlug: string; roleId: string; roleName: string; holders: number }> = [];

    for (const role of roles) {
      const grant = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: permission.id },
      });
      if (!grant) continue;

      const org = await prisma.organization.findFirst({
        where: { id: role.organizationId },
        select: { slug: true },
      });
      // Reported per role, because "who is affected" is the question an
      // approver actually needs answered — a role nobody holds is a different
      // decision from one fifty people hold.
      const holders = await prisma.userRole.count({ where: { roleId: role.id } });

      targets.push({
        orgSlug: org?.slug ?? role.organizationId,
        roleId: role.id,
        roleName: role.nameEn,
        holders,
      });
    }

    const orgCount = new Set(targets.map((t) => t.orgSlug)).size;
    console.log(
      `\n${execute ? 'DELETING' : 'DRY RUN — would delete'} ${targets.length} RolePermission row(s) ` +
        `across ${orgCount} organization(s):\n`,
    );
    for (const t of targets) {
      console.log(
        `  ${t.orgSlug.padEnd(14)} role '${t.roleName}' (${BASE_USER_KEY})  ` +
          `permission ${TASKS_PERMISSIONS.VIEW}  — held by ${t.holders} user(s)`,
      );
    }
    if (targets.length === 0) {
      console.log('  (nothing to remove — already absent everywhere)');
    }

    if (!execute) {
      console.log('\nDry run only. Re-run with --execute to remove these rows.\n');
      return;
    }

    // One statement, scoped to exactly the rows listed above.
    const result = await prisma.rolePermission.deleteMany({
      where: {
        permissionId: permission.id,
        roleId: { in: targets.map((t) => t.roleId) },
      },
    });
    console.log(`\nRemoved ${result.count} row(s).\n`);

    if (result.count !== targets.length) {
      throw new Error(
        `Expected to remove ${targets.length} row(s) but removed ${result.count}. ` +
          'The database changed between the count and the delete — re-run the dry run.',
      );
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
