import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { COMMITTEES_PERMISSIONS } from '../constants/permissions';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-281 — the ONE membership rule (Ahmad, 7 Nov): an ACTIVE member of an ACTIVE
 * committee may open that committee, and see all of its details, without
 * committees:view. Being a member is the entitlement: ACC-101's rule for
 * self-scoped reads, as Home's My committees (ACC-279) already applies it.
 *
 * committees:view is unchanged: oversight of every committee. Membership adds a
 * member's OWN committees for someone without it; a non-member without it sees none.
 *
 * Who counts: a CommitteeMember row with isActive (no leftAt), on a Committee with
 * isActive, both in the caller's organisation. A member who left, or a member of
 * an inactive committee, does not count, and loses access on their next request:
 * the check is live, never cached.
 *
 * COST: only callers WITHOUT committees:view pay, and only inside the reads and
 * writes that ask. One query on the (committeeId, userId) unique index, or one
 * batched findMany for a list. Nothing here runs on the per-request path.
 */

type MembershipClient = Pick<PrismaService, 'committeeMember'>;

export interface CommitteeViewer {
  id: string;
  permissions: readonly string[];
}

/** committees:view: oversight of every committee in the organisation. */
export function seesEveryCommittee(permissions: readonly string[]): boolean {
  return permissions.includes(COMMITTEES_PERMISSIONS.VIEW);
}

/** Is `userId` an active member of this active committee, in this organisation? One query. */
export async function isActiveMember(
  client: MembershipClient,
  committeeId: string,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const row = await client.committeeMember.findFirst({
    where: { committeeId, userId, organizationId, isActive: true, committee: { organizationId, isActive: true } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * The active committees `userId` is an active member of, among `among` when given.
 * One query, for a list or a batch: never call isActiveMember() once per row.
 */
export async function memberCommitteeIds(
  client: MembershipClient,
  userId: string,
  organizationId: string,
  among?: readonly string[],
): Promise<Set<string>> {
  if (among && among.length === 0) return new Set();
  const rows = await client.committeeMember.findMany({
    where: {
      userId,
      organizationId,
      isActive: true,
      committee: { organizationId, isActive: true },
      ...(among ? { committeeId: { in: [...new Set(among)] } } : {}),
    },
    select: { committeeId: true },
  });
  return new Set(rows.map((r) => r.committeeId));
}

/** May this viewer see this committee: committees:view, or active membership (one query, only without the key). */
export async function maySeeCommittee(
  client: MembershipClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
): Promise<boolean> {
  if (seesEveryCommittee(viewer.permissions)) return true;
  return isActiveMember(client, committeeId, viewer.id, organizationId);
}

/**
 * A READ of one committee (or of something on it): admit committees:view or a
 * member; refuse anyone else with exactly what PermissionGuard used to answer on
 * these routes, "Required permission: committees:view" (Ahmad, Q1: today's rule).
 * It is existence-neutral: the membership query answers the same for a real
 * committee the caller is not on and for an invented id (ACC-101 clause a).
 */
export async function assertMaySeeCommittee(
  client: MembershipClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
): Promise<void> {
  if (await maySeeCommittee(client, committeeId, organizationId, viewer)) return;
  throw new ForbiddenException(`Required permission: ${COMMITTEES_PERMISSIONS.VIEW}`);
}

/**
 * A WRITE on one committee (Ahmad, 7 Nov): the action's own permission is checked
 * by the caller first; this adds "committees:view OR an active member of THIS
 * committee". Anyone else gets the identical refusal a missing committee gets.
 */
export async function assertMayWriteCommittee(
  client: MembershipClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
  notFoundMessage = 'Committee not found',
): Promise<void> {
  if (await maySeeCommittee(client, committeeId, organizationId, viewer)) return;
  throw new NotFoundException(notFoundMessage);
}
