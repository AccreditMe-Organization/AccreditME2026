// One-off backfill for ACC-123 — grants admin:access (the Administration
// section's own gate) to every existing organization's TENANT_ADMIN role.
//
// ## RUN THIS BEFORE THE CODE IS DEPLOYED. Not after.
//
// This one is NOT like the earlier backfills, and the difference is the whole
// reason this paragraph exists. Every previous backfill granted a permission
// that unlocked something NEW: running it late meant a feature arrived late.
// admin:access gates something that already works. The moment the frontend
// requires it, an existing TENANT_ADMIN whose RolePermission rows predate this
// ticket loses the entire Administration section — every admin page, by a
// hidden link AND a refused URL — until this script has run.
//
// The backfill is purely additive, so running it EARLY costs nothing: the
// permission sits unread until the code that reads it deploys. Running it late
// locks the tenant's administrator out of their own tenant. The safe order is
// therefore not "with the deploy" but strictly before it:
//
//   1. run this against the target database
//   2. confirm an existing tenant admin still sees Administration
//   3. merge / deploy the code that requires the permission
//
// On the shared dev database that means running it before the PR is merged,
// because the Railway dev deployment tracks `dev` and would otherwise pick up
// the requirement while the rows are still missing (CLAUDE.md, Open/Deferred
// Items — local development points at shared infrastructure).
//
// ## What it does
//
// role.seed.ts's TENANT_ADMIN permission spread (ALL, via ADMIN_PERMISSIONS)
// only affects seedSystemRoles() going forward — organizations provisioned
// before this ticket have RolePermission rows snapshotted without admin:access,
// and won't get it just because the seed source changed.
//
// Same pattern as the earlier backfill-*.ts scripts (ACC-16, ACC-22, ACC-46,
// ACC-82) — additive only. Idempotent — safe to re-run. Only ever inserts a
// single RolePermission row per role that doesn't already have it; never
// deletes or modifies anything else (deliberately NOT a full seedSystemRoles()
// replace, which would delete+recreate every RolePermission row for the role).
//
// Scoped to TENANT_ADMIN only, not PLATFORM_ADMIN — PLATFORM_ADMIN's real
// gating is PlatformGuard (isPlatformOrg + platform:admin), never permission-set
// alone (CLAUDE.md, Key Architecture Decisions ACC-13/14), and the platform
// shell has no Administration section to reach.
//
// Uses the Prisma client directly, same reasoning as demo-seed.ts (plain
// ts-node, not NestJS DI).
//
// Run: npm run backfill:admin-access-permission

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { ADMIN_PERMISSIONS } from '../src/common/constants/permissions';

const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const [module, action] = ADMIN_PERMISSIONS.ACCESS.split(':') as [string, string];

    // Ensure the global Permission catalog row exists — upsert only, matching
    // RoleService.seedPermissions()'s own idempotent behaviour.
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: { description: ADMIN_PERMISSIONS.ACCESS },
      create: { module, action, description: ADMIN_PERMISSIONS.ACCESS },
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
        where: { roleId: role.id, permissionId: permission.id },
      });

      if (existing) {
        rolesAlreadyComplete++;
        continue;
      }

      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
      rolePermissionsCreated++;
      console.log(`  ✓ ${org.slug} (${org.name}) — granted ${ADMIN_PERMISSIONS.ACCESS}`);
    }

    console.log('');
    console.log(`Organizations checked:        ${orgsChecked}`);
    console.log(`RolePermission rows created:  ${rolePermissionsCreated}`);
    console.log(`Roles already complete:       ${rolesAlreadyComplete}`);
    console.log(`Organizations without TENANT_ADMIN: ${rolesNotFound}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
