// One-off backfill for ACC-16 — grants positions:view/positions:manage to
// every existing organization's TENANT_ADMIN role.
//
// role.seed.ts's ALL array (fixed earlier in this ticket) only affects
// seedSystemRoles() going forward — organizations already provisioned before
// this fix have TENANT_ADMIN RolePermission rows that were snapshotted
// without positions:view/positions:manage, and won't get them just because
// the seed source changed. This script closes that gap for every existing
// tenant, once, without touching any other permission or role.
//
// Idempotent — safe to re-run. Only ever inserts the two Positions
// RolePermission rows for a TENANT_ADMIN role that doesn't already have
// them; never deletes or modifies anything else.
//
// Uses the Prisma client directly, same reasoning as demo-seed.ts (plain
// ts-node, not NestJS DI — see that file's own comment for why).
//
// Run: npm run backfill:positions-permissions

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { POSITIONS_PERMISSIONS } from '../src/common/constants/permissions';

const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const positionsPermissions = await prisma.permission.findMany({
      where: {
        module: 'positions',
        action: { in: [POSITIONS_PERMISSIONS.VIEW.split(':')[1]!, POSITIONS_PERMISSIONS.MANAGE.split(':')[1]!] },
      },
    });

    if (positionsPermissions.length !== 2) {
      throw new Error(
        `Expected 2 global Permission rows for module "positions", found ${positionsPermissions.length}. ` +
          'Run seedPermissions (via any org\'s seedSystemRoles) before this backfill.',
      );
    }

    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true },
    });

    let orgsChecked = 0;
    let orgsMissingRole = 0;
    let rolePermissionsCreated = 0;
    let orgsAlreadyComplete = 0;

    for (const org of organizations) {
      orgsChecked++;

      const adminRole = await prisma.role.findFirst({
        where: { organizationId: org.id, key: TENANT_ADMIN_KEY },
      });

      if (!adminRole) {
        console.warn(`  ⚠ ${org.slug} (${org.name}) — no TENANT_ADMIN role found, skipping`);
        orgsMissingRole++;
        continue;
      }

      const existing = await prisma.rolePermission.findMany({
        where: {
          roleId: adminRole.id,
          permissionId: { in: positionsPermissions.map((p) => p.id) },
        },
      });
      const existingPermissionIds = new Set(existing.map((rp) => rp.permissionId));
      const missing = positionsPermissions.filter((p) => !existingPermissionIds.has(p.id));

      if (missing.length === 0) {
        orgsAlreadyComplete++;
        continue;
      }

      await prisma.rolePermission.createMany({
        data: missing.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
      });

      rolePermissionsCreated += missing.length;
      console.log(
        `  ✓ ${org.slug} (${org.name}) — granted ${missing.map((p) => `${p.module}:${p.action}`).join(', ')}`,
      );
    }

    console.log('\n─── Backfill summary ───');
    console.log(`Organizations checked:        ${orgsChecked}`);
    console.log(`Already had both permissions:  ${orgsAlreadyComplete}`);
    console.log(`RolePermission rows created:   ${rolePermissionsCreated}`);
    console.log(`Organizations missing a TENANT_ADMIN role (skipped): ${orgsMissingRole}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
