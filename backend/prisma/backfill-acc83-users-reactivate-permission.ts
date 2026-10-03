// One-off backfill for ACC-83 — grants users:reactivate to every existing
// organization's TENANT_ADMIN role.
//
// ## WHY THIS EXISTS, AND A CLAIM IT CORRECTS
//
// ACC-83's commit said users:reactivate needs "no seed edit, no backfill".
// Half right, and the wrong half matters: adding the constant means
// role.seed.ts's TENANT_ADMIN spread (ALL.filter non-platform) picks it up for
// every tenant provisioned FROM NOW ON. Organizations that already exist hold
// RolePermission rows snapshotted before the string existed, and they do not
// gain it because the seed source changed.
//
// FOUND BY THE PERSONA GATE, not by reasoning. Queried against dev before the
// browser pass: no Permission row for users:reactivate existed at all, and
// Hessa Al-Dosari — al-nakheel's only active Organization Administrator —
// therefore did not hold it. Without this script she would have signed in,
// seen no Reactivate action, and we would both have concluded the feature was
// broken.
//
// Same shape as ACC-82's setup:view backfill, which this is copied from, and
// additive only. Idempotent — safe to re-run. It inserts at most one
// RolePermission row per role and never deletes or modifies anything else:
// deliberately NOT a full seedSystemRoles() replace, which deletes and
// recreates every RolePermission row for the role (CLAUDE.md, ACC-101 — a far
// bigger blast radius than this gap needs).
//
// Scoped to TENANT_ADMIN only, not PLATFORM_ADMIN — PLATFORM_ADMIN's real
// gating is PlatformGuard (isPlatformOrg + platform:admin), never a permission
// set alone, and the platform org has no tenant users to reactivate.
//
// RUN IT BEFORE THE BROWSER PASS, and before this merges on any environment
// whose tenants already exist.
//
// Run: npm run backfill:users-reactivate-permission

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
    const [module, action] = USERS_PERMISSIONS.REACTIVATE.split(':') as [string, string];

    // Ensure the global Permission catalog row exists — upsert only, matching
    // RoleService.seedPermissions()'s own idempotent behaviour.
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: { description: USERS_PERMISSIONS.REACTIVATE },
      create: { module, action, description: USERS_PERMISSIONS.REACTIVATE },
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
      console.log(`  ✓ ${org.slug} (${org.name}) — granted ${USERS_PERMISSIONS.REACTIVATE}`);
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
