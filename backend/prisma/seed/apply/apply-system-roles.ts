// ACC-107 — grants each tenant's SYSTEM-role personas.
//
// Runs after applyPeople() and beside applyCustomRoles(), for the same reason:
// a holder must exist before a role can be assigned to them.
//
// ## Why the lookup is Prisma and the write is RoleService
//
// The seed's rule is that it exercises the paths the product uses. The WRITE
// does: assignRoleToUser() is the real method, with its real validation and
// its real audit row. The LOOKUP does not, and cannot — finding a role by its
// system key is not a product operation. getRoles() is paginated, filters
// PLATFORM_ADMIN out by org type, and returns a shape keyed for a list screen;
// reaching through it to find 'QUALITY_MANAGER' would be inventing a product
// capability inside a seed. So the id comes from Prisma and every mutation
// goes through the service.
//
// ## Idempotent on TENANT_ADMIN, deliberately
//
// bootstrap() already granted TENANT_ADMIN to the tenant's own admin when
// createTenant() ran. assignRoleToUser() throws ConflictException on a second
// grant, so this skips anything already held rather than treating it as an
// error. The fixture still DECLARES that persona — a credentials table that
// omitted the tenant admin would be the one gap a reader most notices — and
// validateFixture() proves the declared holder is the real adminKey, so the
// declaration cannot drift into a claim the seed never carries out.
import { PrismaService } from '../../../src/prisma/prisma.service';
import { RoleService } from '../../../src/foundation/roles/role.service';
import { SeedContext, TenantFixture, resolve } from '../fixtures/fixture.types';

export async function applySystemRolePersonas(
  deps: { prisma: PrismaService; roleService: RoleService },
  fixture: TenantFixture,
  ctx: SeedContext,
  actorId: string,
): Promise<void> {
  for (const persona of fixture.systemRolePersonas) {
    const role = await deps.prisma.role.findFirst({
      where: { organizationId: ctx.organizationId, key: persona.roleKey },
    });
    if (!role) {
      // seedSystemRoles() runs inside bootstrap(), so this means the role seed
      // and the fixture disagree about what exists. Fail loudly: seeding on
      // would leave a persona silently unheld, which is the defect this whole
      // applier exists to end.
      throw new Error(
        `System role '${persona.roleKey}' not found in tenant '${fixture.slug}'. ` +
          'bootstrap() seeds every SYSTEM_ROLE_SEED entry, so the fixture and the role seed disagree.',
      );
    }

    const userId = resolve(ctx.personIdByKey, persona.holder, 'person');
    const held = await deps.roleService.getUserRoles(userId, ctx.organizationId);

    if (held.some((r) => r.id === role.id)) {
      console.log(`    ${persona.roleKey} -> ${persona.holder} (already held, from bootstrap)`);
      continue;
    }

    await deps.roleService.assignRoleToUser(
      userId,
      { roleId: role.id },
      ctx.organizationId,
      actorId,
    );
    console.log(`    ${persona.roleKey} -> ${persona.holder}`);
  }
}
