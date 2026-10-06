import type { TenantStatus } from '../../../generated/prisma/client';

/**
 * Whether an organisation is open — ACC-168. THE one rule, read everywhere a
 * closed organisation must be refused: sign-in, session refresh, every
 * authenticated request (TenantGuard), the start of an impersonation, and an
 * invitation (open-invitation.ts). Never restate the list anywhere else; import
 * this.
 *
 * Open: TRIAL and ACTIVE (Ahmad, 2026-10-05). Closed: SUSPENDED, CANCELLED and
 * OFFBOARDING.
 *
 * TRIAL counts as open with no end date: nothing moves an organisation off
 * TRIAL when `trialEndsAt` passes. That is a separate decision, not this rule's.
 */
const OPEN_ORGANIZATION_STATUSES: ReadonlySet<TenantStatus> =
  new Set<TenantStatus>(['TRIAL', 'ACTIVE']);

export function isOrganizationOpen(status: TenantStatus): boolean {
  return OPEN_ORGANIZATION_STATUSES.has(status);
}
