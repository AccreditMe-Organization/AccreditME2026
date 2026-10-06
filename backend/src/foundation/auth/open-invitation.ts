import type {
  TenantStatus,
  UserStatus,
} from '../../../generated/prisma/client';
import { isOrganizationOpen } from '../../common/tenant/organization-status';

/**
 * When an invitation can still be used — ACC-120 slice 9c. ONE rule, read by
 * both the invitation lookup and accept-invitation, so the two can never
 * disagree about whether a token works.
 *
 * Open means all of:
 *   - a row holds the token. A USED invitation has its token cleared on
 *     acceptance, and a REVOKED one has its row deleted, so neither matches
 *     any row: both are "no row", indistinguishable from a token that never
 *     existed, by construction.
 *   - the person is still INVITED. `deactivate()` flips an invitee to INACTIVE
 *     but leaves the token in place; without this check that token would
 *     still accept, and acceptance would make the person ACTIVE again.
 *   - the expiry is set and not past. A missing expiry is refused, as accept
 *     always refused it. "Past" is strictly earlier than now — the same `<`
 *     accept used — so the boundary instant is still open.
 *   - the inviting organisation is open, by THE shared rule
 *     (common/tenant/organization-status.ts — ACC-168): TRIAL or ACTIVE.
 */

/** The shape every invitation token has: randomBytes(24) as hex. */
export const INVITATION_TOKEN_SHAPE = /^[0-9a-f]{48}$/;

/** The fields the rule reads — the row findInvitation() returns. */
export interface InvitationRow {
  status: UserStatus;
  invitationExpiresAt: Date | null;
  organization: { status: TenantStatus; name: string; nameAr: string | null };
}

export function isOpenInvitation<T extends InvitationRow>(
  row: T | null,
  now: Date,
): row is T {
  if (!row) return false;
  if (row.status !== 'INVITED') return false;
  if (!row.invitationExpiresAt || row.invitationExpiresAt < now) return false;
  return isOrganizationOpen(row.organization.status);
}
