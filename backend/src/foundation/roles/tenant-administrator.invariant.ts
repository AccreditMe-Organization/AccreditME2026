import { ConflictException, Logger } from '@nestjs/common';

/**
 * ACC-120 — the tenant's root role, and the one invariant that protects it.
 *
 * DECIDED (Ahmad, 3 Oct 2026): **Organization Administrator is the tenant's
 * root role. It exists, and someone active holds it.**
 *
 * ## Why this is a file and not four checks
 *
 * The rule can be broken from at least four places — emptying the role's
 * permission set, deactivating the role, removing the role from its last
 * holder, and deactivating the HOLDER — and before this there were four
 * hand-maintained copies of "is this the last admin?", one per place. They had
 * already drifted: `user.service.ts`'s copy counted holders whose User is
 * ACTIVE, while `role.service.ts`'s two counted raw ASSIGNMENT ROWS with no
 * join to User at all. The weaker pair was the original; the comment on the
 * copy that got it right still says it "mirrors" them.
 *
 * So one assertion, called inside the transaction after the mutation and
 * before commit. A future path that reduces the count fails rather than
 * slipping past, because it does not have to remember to ask.
 *
 * ## It counts ACTIVE HOLDERS, never assignments
 *
 * `userRole.count({ where: { roleId } })` was the old shape and it is not the
 * property anyone cares about: a deactivated user's assignment row keeps that
 * count above zero while nobody can sign in. The count here joins User and
 * requires `status: 'ACTIVE'` — INVITED is deliberately excluded for the same
 * reason vacancy detection excludes it (ACC-43): holding a role is not the
 * same as being able to act.
 *
 * ## The platform organisation is EXCLUDED, structurally
 *
 * Measured on dev before this shipped, across all three organisations:
 *
 *     al-manara   assignments=1  activeHolders=1
 *     al-nakheel  assignments=1  activeHolders=1
 *     platform    assignments=0  activeHolders=0
 *
 * The platform org has the role seeded with NOBODY holding it, and that is
 * correct rather than a breach: its people hold `PLATFORM_ADMIN`, and
 * `PlatformGuard` requires `isPlatformOrg` AND `platform:admin` — a
 * TENANT_ADMIN assignment there would grant nothing the platform shell uses.
 * `SYSTEM_ROLE_SEED` runs identically for every organisation, which is why the
 * row exists at all (the mirror image of CLAUDE.md's note that PLATFORM_ADMIN
 * is seeded inert into every tenant).
 *
 * Without this exclusion the assertion would throw on every platform-org
 * mutation on day one. It is an exclusion, not a tolerance: the platform org
 * is not a tenant and has no tenant administrator to retain.
 *
 * ## A tenant ALREADY at zero is not punished for an unrelated mutation
 *
 * The assertion compares a BASELINE captured before the mutation against the
 * count after it, and refuses only when the mutation is what crossed the line.
 * If a tenant was already at zero active administrators, the mutation did not
 * cause that, and refusing it would brick a tenant that is already locked
 * out — recovery from that state requires mutations. Such a tenant gets a
 * logged line instead, at `error`, naming the organisation.
 *
 * Neither real tenant is in that state today (the census above), so nothing
 * needed repairing before this shipped. The branch exists for a tenant that
 * reaches zero by some path this invariant does not yet cover, and the honest
 * description of where that log lands is ACC-101's: process stdout, with
 * nothing watching it. Making it a Setup health condition is the natural
 * follow-up and is NOT built here — a condition is derived state with a
 * reconciler (ACC-82), which is a different change from an invariant.
 */

export const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

const logger = new Logger('TenantAdministratorInvariant');

/**
 * The slice of a Prisma client this invariant reads.
 *
 * Deliberately structural and minimal rather than `PrismaService` or
 * `Prisma.TransactionClient`: it documents exactly what the rule touches, it
 * accepts both the extended client and a transaction client without either
 * being named here, and a spec can satisfy it with three stubs instead of
 * mocking a whole client.
 */
export interface AdministratorInvariantClient {
  organization: {
    findFirst(args: {
      where: { id: string };
      select: { isPlatformOrg: true };
    }): Promise<{ isPlatformOrg: boolean } | null>;
  };
  role: {
    findFirst(args: {
      where: { organizationId: string; key: string; isActive: true };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  userRole: {
    count(args: {
      where: { roleId: string; user: { organizationId: string; status: 'ACTIVE' } };
    }): Promise<number>;
  };
}

/**
 * How many users hold the tenant's root role AND can actually sign in.
 *
 * Returns 0 when the role is missing OR INACTIVE, which is the same answer for
 * the purpose the caller has: nobody can administer the tenant through it.
 *
 * `isActive: true` is load-bearing and is what makes ONE assertion cover role
 * deactivation as well as holder changes. Verified rather than assumed:
 * `getUserPermissions()` resolves through `role: { isActive: true }`, so an
 * inactive role grants nothing — deactivating it with every assignment row
 * still in place locks the tenant out exactly as surely as removing the rows.
 * Counting holders without this clause would have left `deactivateRole()`
 * needing its own check again, which is the drift this file exists to end.
 *
 * NOT covered here, deliberately: emptying the role's PERMISSION set. That
 * leaves the holders in place, so no count can see it, and it is handled by
 * the separate freeze in `assignPermissions()` — capability and holders are
 * two different properties and conflating them would weaken both.
 */
export async function countActiveAdministrators(
  organizationId: string,
  client: AdministratorInvariantClient,
): Promise<number> {
  const role = await client.role.findFirst({
    where: { organizationId, key: TENANT_ADMIN_KEY, isActive: true },
    select: { id: true },
  });
  if (!role) return 0;

  return client.userRole.count({
    where: { roleId: role.id, user: { organizationId, status: 'ACTIVE' } },
  });
}

/** Captured BEFORE the mutation, so cause can be told from pre-existing state. */
export async function captureAdministratorBaseline(
  organizationId: string,
  client: AdministratorInvariantClient,
): Promise<number> {
  return countActiveAdministrators(organizationId, client);
}

/**
 * Refuse to commit a mutation that leaves the tenant with no active
 * administrator.
 *
 * Call this INSIDE the transaction, after the mutation and before commit, with
 * the baseline captured before it. Throwing rolls the whole transaction back,
 * which is the point: the refusal and the undo are the same act.
 */
export async function assertTenantRetainsAnActiveAdministrator(
  organizationId: string,
  client: AdministratorInvariantClient,
  baseline: number,
): Promise<void> {
  const org = await client.organization.findFirst({
    where: { id: organizationId },
    select: { isPlatformOrg: true },
  });
  if (org?.isPlatformOrg) return;

  const remaining = await countActiveAdministrators(organizationId, client);
  if (remaining > 0) return;

  if (baseline === 0) {
    logger.error(
      `Organization ${organizationId} has no active administrator, and did not have one ` +
        `before this change either. The change was allowed: refusing it would block the ` +
        `mutations needed to recover. Restore a holder of the ${TENANT_ADMIN_KEY} role.`,
    );
    return;
  }

  throw new ConflictException(
    'This would leave the organization with no active administrator. ' +
      'Give the Organization Administrator role to an active user first, then try again.',
  );
}
