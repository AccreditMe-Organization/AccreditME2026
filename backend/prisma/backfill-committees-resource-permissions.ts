// One-off backfill for ACC-28's authority-mechanism correction -- grants
// the 5 new per-action committee permissions (committees:create,
// committees:edit_details, committees:add_member, committees:remove_member,
// committees:change_member_role) to every existing organization's
// PLATFORM_ADMIN, TENANT_ADMIN, and QUALITY_MANAGER roles -- the three
// roles that hold committees:manage exclusively via a wholesale
// Object.values(COMMITTEES_PERMISSIONS) spread in role.seed.ts, and so
// automatically pick up the 5 new keys for any NEWLY-provisioned tenant.
// Existing tenants' RolePermission rows were snapshotted before this
// change and won't get them just because the seed source changed.
//
// This replaces committees.service.ts's Chairman-specific
// assertCommitteeAuthority() check entirely -- committees:manage holders
// must keep full capability via the permission bundle itself, not via any
// runtime "does manage cover this" fallback logic, so this backfill is not
// optional for existing tenants the way a purely additive nice-to-have
// would be: without it, an existing tenant's committees:manage holders
// would be LOCKED OUT of updateCommittee/addMember/changeMemberRole/
// removeMember the moment this ships, since PermissionGuard checks the
// specific permission string, not MANAGE.
//
// Same pattern as backfill-committees-approve-permission.ts (ACC-22) --
// additive only, idempotent, upserts the global Permission catalog rows
// itself (matches RoleService.seedPermissions()'s own idempotent
// behavior) rather than assuming they already exist.
//
// Run: npm run backfill:committees-resource-permissions

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { COMMITTEES_PERMISSIONS } from '../src/common/constants/permissions';

const ROLE_KEYS_HOLDING_MANAGE = ['PLATFORM_ADMIN', 'TENANT_ADMIN', 'QUALITY_MANAGER'];

const NEW_PERMISSIONS = [
  COMMITTEES_PERMISSIONS.CREATE,
  COMMITTEES_PERMISSIONS.EDIT_DETAILS,
  COMMITTEES_PERMISSIONS.ADD_MEMBER,
  COMMITTEES_PERMISSIONS.REMOVE_MEMBER,
  COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE,
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Ensure the global Permission catalog rows exist -- upsert only,
    // matches RoleService.seedPermissions()'s own idempotent behavior.
    const permissionRows = [];
    for (const value of NEW_PERMISSIONS) {
      const [module, action] = value.split(':') as [string, string];
      const row = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: { description: value },
        create: { module, action, description: value },
      });
      permissionRows.push(row);
    }

    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true },
    });

    let orgsChecked = 0;
    let rolePermissionsCreated = 0;
    let rolePermissionsAlreadyComplete = 0;
    let rolesNotFound = 0;

    for (const org of organizations) {
      orgsChecked++;

      for (const roleKey of ROLE_KEYS_HOLDING_MANAGE) {
        const role = await prisma.role.findFirst({
          where: { organizationId: org.id, key: roleKey },
        });

        if (!role) {
          rolesNotFound++;
          continue;
        }

        const existing = await prisma.rolePermission.findMany({
          where: { roleId: role.id, permissionId: { in: permissionRows.map((p) => p.id) } },
        });
        const existingPermissionIds = new Set(existing.map((rp) => rp.permissionId));
        const missing = permissionRows.filter((p) => !existingPermissionIds.has(p.id));

        if (missing.length === 0) {
          rolePermissionsAlreadyComplete++;
          continue;
        }

        await prisma.rolePermission.createMany({
          data: missing.map((p) => ({ roleId: role.id, permissionId: p.id })),
        });
        rolePermissionsCreated += missing.length;
        console.log(
          `  granted ${missing.map((p) => `${p.module}:${p.action}`).join(', ')} to ${roleKey} in ${org.slug} (${org.name})`,
        );
      }
    }

    console.log('\n--- Backfill summary ---');
    console.log(`Organizations checked:            ${orgsChecked}`);
    console.log(`Role/org pairs already complete:  ${rolePermissionsAlreadyComplete}`);
    console.log(`RolePermission rows created:      ${rolePermissionsCreated}`);
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
