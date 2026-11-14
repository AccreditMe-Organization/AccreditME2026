import { ConflictException } from '@nestjs/common';
import { TENANT_ADMIN_KEY } from '../../roles/tenant-administrator.invariant';

/**
 * Who may reset whose two-step sign-in — ACC-164.
 *
 * ONE rule, read by BOTH the reset route (which refuses) and the user record
 * read (which hides the panel and the action), so the screen never offers a
 * reset the server would refuse (lane B, 14 Nov). Never write a second copy.
 *
 * Checked in this order, after the 404 and before any write:
 *   1. yourself                  → MFA_RESET_SELF (turn it off on your profile,
 *                                  with your password and a code)
 *   2. signed in as someone else → MFA_RESET_IMPERSONATING (ACC-99)
 *   3. the account owner         → ACCOUNT_OWNER_PROTECTED (Ahmad, 14 Nov:
 *                                  AccreditMe support resets the owner)
 *   4. the floor                 → MFA_RESET_HIGHER_ACCOUNT: a holder without
 *                                  Organization Administrator can't reset
 *                                  someone who has it (lane B, 14 Nov)
 *
 * "Has Organization Administrator" is `holdsActiveRootRole()`: a role row on
 * the tenant's root role while that role is ACTIVE — an inactive role grants
 * nothing (`getUserPermissions()` reads `role: { isActive: true }`).
 */
export type MfaResetBlock =
  | 'MFA_RESET_SELF'
  | 'MFA_RESET_IMPERSONATING'
  | 'ACCOUNT_OWNER_PROTECTED'
  | 'MFA_RESET_HIGHER_ACCOUNT';

export interface MfaResetFacts {
  isSelf: boolean;
  impersonating: boolean;
  isAccountOwner: boolean;
  /** Read only when needed: the floor matters only above a non-administrator. */
  targetHoldsRootRole: () => Promise<boolean>;
  actorHoldsRootRole: () => Promise<boolean>;
}

export async function mfaResetBlock(facts: MfaResetFacts): Promise<MfaResetBlock | null> {
  if (facts.isSelf) return 'MFA_RESET_SELF';
  if (facts.impersonating) return 'MFA_RESET_IMPERSONATING';
  if (facts.isAccountOwner) return 'ACCOUNT_OWNER_PROTECTED';
  if ((await facts.targetHoldsRootRole()) && !(await facts.actorHoldsRootRole())) {
    return 'MFA_RESET_HIGHER_ACCOUNT';
  }
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

// --- The refusals, each with its code (said in both languages by the screen) ---

export const MFA_RESET_REFUSAL_MESSAGES: Readonly<Record<Exclude<MfaResetBlock, 'ACCOUNT_OWNER_PROTECTED'> | 'MFA_NOT_ENABLED', string>> = {
  MFA_RESET_SELF:
    "You can't reset your own two-step sign-in here. Turn it off on your profile with your password and a code.",
  MFA_RESET_IMPERSONATING: "This can't be done while signed in as someone else.",
  MFA_RESET_HIGHER_ACCOUNT:
    "Only an Organization Administrator can reset an Organization Administrator's two-step sign-in.",
  MFA_NOT_ENABLED: 'Two-step sign-in is already off for this person.',
};

export class MfaResetRefusalException extends ConflictException {
  constructor(readonly code: keyof typeof MFA_RESET_REFUSAL_MESSAGES) {
    super({ statusCode: 409, message: MFA_RESET_REFUSAL_MESSAGES[code], error: 'Conflict', code });
  }
}
