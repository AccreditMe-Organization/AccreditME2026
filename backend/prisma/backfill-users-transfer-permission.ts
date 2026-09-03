// One-off backfill for ACC-46 Section 2.6.g — grants users:transfer to
// every existing organization's TENANT_ADMIN role.
//
// users:transfer is a brand-new permission (the transfer wizard moves a
// person's unit/position/manager together and can trigger a promotion —
// deliberately gated separately from users:manage, matching ACC-44's
// action-specific-permission-string pattern). role.seed.ts's TENANT_ADMIN
// permission spread (ALL, via USERS_PERMISSIONS) only affects
// seedSystemRoles() going forward — organizations already provisioned
// before this fix have RolePermission rows snapshotted without
// users:transfer, and won't get it just because the seed source changed.
// This script closes that gap for every existing tenant, once, without
// touching any other permission or role.
//
// Same pattern as backfill-committees-approve-permission.ts (ACC-22) --
// additive only. Idempotent -- safe to re-run. Only ever inserts a single
// RolePermission row per role that doesn't already have it; never deletes
// or modifies anything else (deliberately NOT a full seedSystemRoles()
// replace, which would delete+recreate every RolePermission row for this
// role -- a much bigger blast radius than this gap actually needs).
//
// Scoped to TENANT_ADMIN only, not PLATFORM_ADMIN -- same precedent as
// backfill-positions-permissions.ts (ACC-16): PLATFORM_ADMIN's real gating
// is PlatformGuard (isPlatformOrg + platform:admin), never permission-set
// alone (CLAUDE.md, Key Architecture Decisions ACC-13/14), so drift in its
// permission set is inert, not a live gap.
//
// Uses the Prisma client directly, same reasoning as demo-seed.ts (plain
// ts-node, not NestJS DI -- see that file's own comment for why).
//
// Run: npm run backfill:users-transfer-permission

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { USERS_PERMISSIONS } from '../src/common/constants/permissions';

const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const [module, action] = USERS_PERMISSIONS.TRANSFER.split(':') as [string, string];

    // Ensure the global Permission catalog row exists -- upsert only,
    // matches RoleService.seedPermissions()'s own idempotent behavior.
    const transferPermission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: { description: USERS_PERMISSIONS.TRANSFER },
      create: { module, action, description: USERS_PERMISSIONS.TRANSFER },
    });

    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true },
    });

    let orgsChecked = 0;
    let rolePermissionsCreated = 0;
    let rolesAlreadyComplete = 0;
    let rolesNotFound = 0;

    for (const org of organizations) {
      orgsChecked++;

      const role = await prisma.role.findFirst({
        where: { organizationId: org.id, key: TENANT_ADMIN_KEY },
      });

      if (!role) {
        console.warn(`  ⚠ ${org.slug} (${org.name}) — no TENANT_ADMIN role found, skipping`);
        rolesNotFound++;
        continue;
      }

      const existing = await prisma.rolePermission.findFirst({
        where: { roleId: role.id, permissionId: transferPermission.id },
      });

      if (existing) {
        rolesAlreadyComplete++;
        continue;
      }

      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: transferPermission.id },
      });
      rolePermissionsCreated++;
      console.log(`  granted users:transfer to TENANT_ADMIN in ${org.slug} (${org.name})`);
    }

    console.log('\n--- Backfill summary ---');
    console.log(`Organizations checked:           ${orgsChecked}`);
    console.log(`Roles already complete:          ${rolesAlreadyComplete}`);
    console.log(`RolePermission rows created:     ${rolePermissionsCreated}`);
    console.log(`Organizations missing a TENANT_ADMIN role (skipped): ${rolesNotFound}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
