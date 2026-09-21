// ACC-101 — creates a tenant's CUSTOM roles and assigns their holders.
//
// Runs after applyPeople(): a holder must exist before a role can be assigned
// to them. Runs through RoleService rather than direct Prisma writes, for the
// same reason every other applier here calls the real services — the seed
// should exercise the paths the product uses, not a parallel set of writes
// that can drift from them. It is also the first thing in the seed to touch
// the tenant-custom-role path at all (createRole with key: null,
// isSystem: false), which the whole permission model rests on and nothing was
// covering.
//
// SYSTEM roles are NOT granted here — apply-system-roles.ts does that
// (ACC-107). The split is deliberate: a custom role has to be CREATED before
// it can be assigned, while a system role already exists from bootstrap() and
// only needs assigning, so the two appliers do genuinely different work.
//
// The sentence that used to be here — "BASE_USER, VIEWER and the rest remain
// unheld by any seeded person" — was true until ACC-107 and is now false.
// Corrected rather than deleted, because a reader who remembers the old
// behaviour should find out when it changed.
import { RoleService } from '../../../src/foundation/roles/role.service';
import { SeedContext, TenantFixture, resolve } from '../fixtures/fixture.types';

export async function applyCustomRoles(
  deps: { roleService: RoleService },
  fixture: TenantFixture,
  ctx: SeedContext,
  actorId: string,
): Promise<void> {
  const roles = fixture.customRoles ?? [];
  if (roles.length === 0) return;

  for (const roleFixture of roles) {
    const role = await deps.roleService.createRole(
      {
        nameEn: roleFixture.nameEn,
        nameAr: roleFixture.nameAr,
        description: roleFixture.description,
        permissionKeys: roleFixture.permissions,
      },
      ctx.organizationId,
      actorId,
    );

    for (const holderKey of roleFixture.holders) {
      await deps.roleService.assignRoleToUser(
        resolve(ctx.personIdByKey, holderKey, 'person'),
        { roleId: role.id },
        ctx.organizationId,
        actorId,
      );
    }

    console.log(
      `    custom role '${roleFixture.nameEn}' (${roleFixture.permissions.join(', ')}) ` +
        `-> ${roleFixture.holders.join(', ')}`,
    );
  }
}
