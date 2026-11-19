import { TENANT_ADMIN_KEY } from '../roles/tenant-administrator.invariant';

/**
 * Who may act on whose ACCOUNT ACCESS — one rule, generalised from ACC-164's
 * two-step reset (`mfa-reset/mfa-reset-rule.ts`) for ACC-216's "Sign out
 * everywhere". Each caller maps the block to its own refusal code and words.
 * Never write a third copy: a new administrator action on someone else's
 * account access asks this.
 *
 * Checked in this order, after the 404 and before any write:
 *   1. yourself                  → SELF (you have your own way to do it)
 *   2. signed in as someone else → IMPERSONATING (ACC-99)
 *   3. the account owner         → ACCOUNT_OWNER_PROTECTED (ACC-221: AccreditMe
 *                                  support acts on the owner)
 *   4. the floor                 → HIGHER_ACCOUNT: a holder without Organization
 *                                  Administrator can't act on someone who has it
 *
 * "Has Organization Administrator" is `holdsActiveRootRole()`: a role row on the
 * tenant's root role while that role is ACTIVE (an inactive role grants nothing).
 */
export type AccountActionBlock = 'SELF' | 'IMPERSONATING' | 'ACCOUNT_OWNER_PROTECTED' | 'HIGHER_ACCOUNT';

export interface AccountActionFacts {
  isSelf: boolean;
  impersonating: boolean;
  isAccountOwner: boolean;
  /** Read only when needed: the floor matters only above a non-administrator. */
  targetHoldsRootRole: () => Promise<boolean>;
  actorHoldsRootRole: () => Promise<boolean>;
}

export async function accountActionBlock(facts: AccountActionFacts): Promise<AccountActionBlock | null> {
  if (facts.isSelf) return 'SELF';
  if (facts.impersonating) return 'IMPERSONATING';
  if (facts.isAccountOwner) return 'ACCOUNT_OWNER_PROTECTED';
  if ((await facts.targetHoldsRootRole()) && !(await facts.actorHoldsRootRole())) return 'HIGHER_ACCOUNT';
  return null;
}

export interface RootRoleClient {
  userRole: {
    findFirst(args: {
      where: {
        userId: string;
        user: { organizationId: string };
        role: { organizationId: string; key: string; isActive: true };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

/** One indexed read: does this person hold the tenant's ACTIVE root role? */
export async function holdsActiveRootRole(
  client: RootRoleClient,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const row = await client.userRole.findFirst({
    where: {
      userId,
      user: { organizationId },
      role: { organizationId, key: TENANT_ADMIN_KEY, isActive: true },
    },
    select: { id: true },
  });
  return row !== null;
}
