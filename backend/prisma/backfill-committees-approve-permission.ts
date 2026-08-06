// One-off backfill for ACC-22 — grants committees:approve to every existing
// organization's QUALITY_MANAGER and TENANT_ADMIN roles.
//
// committees:approve is a brand-new permission (module-designs.md's
// transition table for TERMS_REVIEW -> ACTIVE and DISSOLUTION_PENDING ->
// DISSOLVED calls for it distinctly from committees:manage, but the
// already-shipped workflow.seed.ts from ACC-9 used committees:manage for
// all eight committee transitions -- corrected as part of ACC-22, see the
// plan's Pending Discussion #2). role.seed.ts's QUALITY_MANAGER/TENANT_ADMIN
// permission spreads (Object.values(COMMITTEES_PERMISSIONS) / ALL) only
// affect seedSystemRoles() going forward -- organizations already
// provisioned before this fix have RolePermission rows snapshotted without
// committees:approve, and won't get it just because the seed source
// changed. This script closes that gap for every existing tenant, once,
// without touching any other permission or role.
//
// Same pattern as backfill-positions-permissions.ts (ACC-16) -- additive
// only. Idempotent -- safe to re-run. Only ever inserts a single
// RolePermission row per role that doesn't already have it; never deletes
// or modifies anything else (deliberately NOT a full seedSystemRoles()
// replace, which would delete+recreate every RolePermission row for these
// roles -- a much bigger blast radius than this gap actually needs).
//
// Uses the Prisma client directly, same reasoning as demo-seed.ts (plain
// ts-node, not NestJS DI -- see that file's own comment for why).
//
// Run: npm run backfill:committees-approve-permission

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { COMMITTEES_PERMISSIONS } from '../src/common/constants/permissions';

const ROLE_KEYS_NEEDING_APPROVE = ['QUALITY_MANAGER', 'TENANT_ADMIN'];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const [module, action] = COMMITTEES_PERMISSIONS.APPROVE.split(':') as [string, string];

    // Ensure the global Permission catalog row exists -- upsert only,
    // matches RoleService.seedPermissions()'s own idempotent behavior.
    const approvePermission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: { description: COMMITTEES_PERMISSIONS.APPROVE },
      create: { module, action, description: COMMITTEES_PERMISSIONS.APPROVE },
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

      for (const roleKey of ROLE_KEYS_NEEDING_APPROVE) {
        const role = await prisma.role.findFirst({
          where: { organizationId: org.id, key: roleKey },
        });

        if (!role) {
          rolesNotFound++;
          continue;
        }

        const existing = await prisma.rolePermission.findFirst({
          where: { roleId: role.id, permissionId: approvePermission.id },
        });

        if (existing) {
          rolesAlreadyComplete++;
          continue;
        }

        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: approvePermission.id },
        });
        rolePermissionsCreated++;
        console.log(`  granted committees:approve to ${roleKey} in ${org.slug} (${org.name})`);
      }
    }

    console.log('\n--- Backfill summary ---');
    console.log(`Organizations checked:           ${orgsChecked}`);
    console.log(`Role/org pairs already complete: ${rolesAlreadyComplete}`);
    console.log(`RolePermission rows created:     ${rolePermissionsCreated}`);
    console.log(`Role/org pairs with no matching role (skipped): ${rolesNotFound}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
