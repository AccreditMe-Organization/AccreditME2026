// One-off backfill for ACC-82 — grants setup:view (Setup health visibility) to
// every existing organization's TENANT_ADMIN role.
//
// setup:view is a brand-new permission (SYSTEM-REFERENCE §13.6). role.seed.ts's
// TENANT_ADMIN permission spread (ALL, via SETUP_PERMISSIONS) only affects
// seedSystemRoles() going forward — organizations provisioned before this
// ticket have RolePermission rows snapshotted without setup:view, and won't get
// it just because the seed source changed. This script closes that gap for
// every existing tenant, once, without touching any other permission or role.
//
// Same pattern as the earlier backfill-*.ts scripts (ACC-16, ACC-22, ACC-46;
// removed in ACC-62 once run, recoverable from git history) — additive only.
// Idempotent — safe to re-run. Only ever inserts a single RolePermission row
// per role that doesn't already have it; never deletes or modifies anything
// else (deliberately NOT a full seedSystemRoles() replace, which would
// delete+recreate every RolePermission row for the role — a much bigger blast
// radius than this gap needs).
//
// Scoped to TENANT_ADMIN only, not PLATFORM_ADMIN — PLATFORM_ADMIN's real gating
// is PlatformGuard (isPlatformOrg + platform:admin), never permission-set alone
// (CLAUDE.md, Key Architecture Decisions ACC-13/14), and the platform org has
// no tenant conditions to show.
//
// Uses the Prisma client directly, same reasoning as demo-seed.ts (plain
// ts-node, not NestJS DI).
//
// Run: npm run backfill:setup-view-permission

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { SETUP_PERMISSIONS } from '../src/common/constants/permissions';

const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const [module, action] = SETUP_PERMISSIONS.VIEW.split(':') as [string, string];

    // Ensure the global Permission catalog row exists — upsert only, matching
    // RoleService.seedPermissions()'s own idempotent behaviour.
    const permission = await prisma.permission.upsert({
      where: { module_action: { module, action } },
      update: { description: SETUP_PERMISSIONS.VIEW },
      create: { module, action, description: SETUP_PERMISSIONS.VIEW },
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
      console.log(`  ✓ ${org.slug} (${org.name}) — granted ${SETUP_PERMISSIONS.VIEW}`);
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
