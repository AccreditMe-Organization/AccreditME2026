import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { COMMITTEES_PERMISSIONS } from '../constants/permissions';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  findUnitAncestorIds,
  findUnitHeadedBy,
  findUnitLeadersAmong,
  findUnitSubtreeIds,
  findUnitsCoveredBy,
} from '../../foundation/organization/unit-headship';

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
 *
 * ACC-283 PR 2a (Ahmad, 16 Nov, Q6) — HEADS SEE THE COMMITTEES OF THEIR UNITS,
 * READ ONLY. A unit's head holders and its acting cover in force may READ every
 * committee owned by that unit or any unit below it. So a READ admits:
 * committees:view, OR an active member, OR a head/cover in force of the owning
 * unit or an ancestor of it (mayReadCommittee, readableCommitteeIds). A WRITE is
 * unchanged: committees:view OR an active member (maySeeCommittee). Headship is
 * read only through unit-headship.ts, from two sides: committeeOversightUnitIds()
 * walks DOWN from what a viewer leads (lists: readableCommitteeIds), and
 * committeeOverseersAmong() walks UP from one committee's owning unit (one
 * committee: mayReadCommittee, and ACC-245's committeeReadersAmong for many
 * people). Never a third copy. A non-member pays it only after membership has
 * said no. Active committees only, as for members.
 */

type MembershipClient = Pick<PrismaService, 'committeeMember'>;
type OversightClient = Pick<PrismaService, 'user' | 'orgUnitHeadAssignment' | '$queryRaw'>;
type ReadClient = MembershipClient & OversightClient & Pick<PrismaService, 'committee'>;

export interface CommitteeViewer {
  id: string;
  permissions: readonly string[];
}

/**
 * ACC-245 — the ONE seat predicate: an ACTIVE seat on an ACTIVE committee, both in
 * the organisation. activeSeatOf(), memberCommitteeIds() and
 * committeeReadersAmong() all read it, beside their own committee and person.
 */
export function activeSeatWhere(organizationId: string): Prisma.CommitteeMemberWhereInput {
  return { organizationId, isActive: true, committee: { organizationId, isActive: true } };
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
  return (await activeSeatOf(client, committeeId, userId, organizationId)) !== null;
}

/**
 * ACC-283 PR 6 — `userId`'s seat (the committee_member_role value) on this ACTIVE
 * committee, through their ACTIVE membership, in this organisation; or null. The
 * one membership read: isActiveMember() is this, so asking for the seat costs no
 * second query. One query.
 */
export async function activeSeatOf(
  client: MembershipClient,
  committeeId: string,
  userId: string,
  organizationId: string,
): Promise<string | null> {
  const row = await client.committeeMember.findFirst({
    where: { committeeId, userId, ...activeSeatWhere(organizationId) },
    select: { roleValueId: true },
  });
  return row ? row.roleValueId : null;
}

/**
 * ACC-282 — is `userId` an active member of the active committee this change request
 * belongs to? A change request is part of its committee's record (ACC-239), so a
 * member who may open the request (ACC-281) may read its workflow too. One query:
 * the membership row, its committee and the request, together.
 */
export async function isActiveMemberOfRequestCommittee(
  client: MembershipClient,
  requestId: string,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const row = await client.committeeMember.findFirst({
    where: {
      userId,
      organizationId,
      isActive: true,
      committee: { organizationId, isActive: true, changeRequests: { some: { id: requestId, organizationId } } },
    },
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
      ...activeSeatWhere(organizationId),
      ...(among ? { committeeId: { in: [...new Set(among)] } } : {}),
    },
    select: { committeeId: true },
  });
  return new Set(rows.map((r) => r.committeeId));
}

/**
 * ACC-283 PR 2a — the units whose committees `viewerId` may read as their
 * overseer: the unit they head now (findUnitHeadedBy) and the units whose acting
 * cover is in force for them at `now` (findUnitsCoveredBy), with every unit below
 * them (findUnitSubtreeIds). All through unit-headship.ts, scoped by
 * organisation. Two reads at once, then the walk only when they lead something.
 */
export async function committeeOversightUnitIds(
  client: OversightClient,
  organizationId: string,
  viewerId: string,
  now: Date,
): Promise<Set<string>> {
  const [headed, covered] = await Promise.all([
    findUnitHeadedBy(client, organizationId, viewerId),
    findUnitsCoveredBy(client, organizationId, viewerId, now),
  ]);
  const roots = [...new Set([...(headed ? [headed] : []), ...covered])];
  if (roots.length === 0) return new Set();
  return new Set(await findUnitSubtreeIds(client, organizationId, roots));
}

/**
 * ACC-283 PR 2a — does `viewerId` oversee this ACTIVE committee: a head or cover
 * in force of its owning unit or an active unit above it? ACC-245: read from the
 * committee's side (committeeOverseersAmong(), the one copy committeeReadersAmong()
 * reads too), which is the same set as walking down from the viewer's units
 * (committeeOversightUnitIds()): a unit is in an active root's subtree exactly
 * when that root is among its active ancestors. The parity db-spec holds them equal.
 */
export async function overseesCommittee(
  client: OversightClient & Pick<PrismaService, 'committee'>,
  committeeId: string,
  organizationId: string,
  viewerId: string,
  now: Date,
): Promise<boolean> {
  return (await committeeOverseersAmong(client, committeeId, organizationId, [viewerId], now)).has(viewerId);
}

/**
 * ACC-245 — which of `userIds` oversee this ACTIVE committee: a head holder or a
 * cover in force of its owning unit or an active unit above it. The committee
 * (active, in the organisation), then findUnitAncestorIds(), then
 * findUnitLeadersAmong(): headship through unit-headship.ts only. An inactive or
 * invented committee is overseen by nobody.
 */
export async function committeeOverseersAmong(
  client: OversightClient & Pick<PrismaService, 'committee'>,
  committeeId: string,
  organizationId: string,
  userIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const committee = await client.committee.findFirst({
    where: { id: committeeId, organizationId, isActive: true },
    select: { orgUnitId: true },
  });
  if (!committee?.orgUnitId) return new Set();
  const units = await findUnitAncestorIds(client, organizationId, committee.orgUnitId);
  return findUnitLeadersAmong(client, organizationId, units, userIds, now);
}

/** ACC-283 PR 2a — does `viewerId` oversee the active committee this change request belongs to? */
export async function overseesRequestCommittee(
  client: OversightClient & Pick<PrismaService, 'committee'>,
  requestId: string,
  organizationId: string,
  viewerId: string,
  now: Date,
): Promise<boolean> {
  const units = await committeeOversightUnitIds(client, organizationId, viewerId, now);
  if (units.size === 0) return false;
  const row = await client.committee.findFirst({
    where: {
      organizationId,
      isActive: true,
      orgUnitId: { in: [...units] },
      changeRequests: { some: { id: requestId, organizationId } },
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * ACC-283 PR 2a — does `viewerId` oversee ANY active committee: a head or cover in
 * force of a unit that owns one, at that unit or below? For GET /committees/mine's
 * `mayBrowseCommittees`. The two headship reads, then (only when they lead
 * something) the sub-unit walk and one existence check.
 */
export async function overseesAnyCommittee(
  client: OversightClient & Pick<PrismaService, 'committee'>,
  organizationId: string,
  viewerId: string,
  now: Date,
): Promise<boolean> {
  const units = await committeeOversightUnitIds(client, organizationId, viewerId, now);
  if (units.size === 0) return false;
  const row = await client.committee.findFirst({
    where: { organizationId, isActive: true, orgUnitId: { in: [...units] } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * ACC-283 PR 2a — which of `among` this viewer may READ: all of them for
 * committees:view; otherwise those they are an active member of, then, for the
 * rest, those they oversee as a head or cover. One query of each kind, never one
 * per row: the mayOpen flags and the task-row record names read it once.
 */
export async function readableCommitteeIds(
  client: ReadClient,
  organizationId: string,
  viewer: CommitteeViewer,
  among: readonly string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  const ids = [...new Set(among)];
  if (ids.length === 0) return new Set();
  if (seesEveryCommittee(viewer.permissions)) return new Set(ids);
  const readable = await memberCommitteeIds(client, viewer.id, organizationId, ids);
  const rest = ids.filter((id) => !readable.has(id));
  if (rest.length === 0) return readable;
  const units = await committeeOversightUnitIds(client, organizationId, viewer.id, now);
  if (units.size === 0) return readable;
  const overseen = await client.committee.findMany({
    where: { id: { in: rest }, organizationId, isActive: true, orgUnitId: { in: [...units] } },
    select: { id: true },
  });
  for (const c of overseen) readable.add(c.id);
  return readable;
}

/**
 * ACC-245 — which of `userIds` may READ this committee, by mayReadCommittee()'s
 * rule, for MANY people at once (a review stage's pool, before a notice names the
 * committee). The same three clauses, in the same order, never one query per
 * person:
 *   1. committees:view, through their active roles in this organisation (what
 *      the permission resolver grants) — one query;
 *   2. for the rest, an active seat on this committee (activeSeatWhere()) — one
 *      query;
 *   3. for the rest, committeeOverseersAmong() — the one copy overseesCommittee()
 *      reads.
 * Callers pass the people they would tell (a stage pool is ACTIVE people only);
 * like mayReadCommittee(), this asks about the committee, not the person's status.
 * The parity db-spec holds it equal to mayReadCommittee() person by person.
 */
export async function committeeReadersAmong(
  client: ReadClient & Pick<PrismaService, 'userRole'>,
  committeeId: string,
  organizationId: string,
  userIds: readonly string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  let rest = [...new Set(userIds)];
  if (rest.length === 0) return new Set();

  const [module, action] = COMMITTEES_PERMISSIONS.VIEW.split(':') as [string, string];
  const holders = await client.userRole.findMany({
    where: {
      userId: { in: rest },
      role: { isActive: true, organizationId, rolePermissions: { some: { permission: { module, action } } } },
    },
    select: { userId: true },
  });
  const readers = new Set(holders.map((h) => h.userId));
  rest = rest.filter((id) => !readers.has(id));
  if (rest.length === 0) return readers;

  const seats = await client.committeeMember.findMany({
    where: { committeeId, userId: { in: rest }, ...activeSeatWhere(organizationId) },
    select: { userId: true },
  });
  for (const seat of seats) readers.add(seat.userId);
  rest = rest.filter((id) => !readers.has(id));
  if (rest.length === 0) return readers;

  for (const id of await committeeOverseersAmong(client, committeeId, organizationId, rest, now)) readers.add(id);
  return readers;
}

/**
 * ACC-283 PR 2a — may this viewer READ this committee: committees:view (no
 * query), an active member (one query), or its overseer as a head or cover (only
 * after membership said no). Existence-neutral: every clause answers the same for
 * an invented id as for a committee the viewer may not read.
 */
export async function mayReadCommittee(
  client: ReadClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
  now: Date = new Date(),
): Promise<boolean> {
  const access = await committeeAccess(
    client,
    committeeId,
    organizationId,
    viewer,
    now,
  );
  return access.read;
}

/** What one viewer may do with one committee: read it, and pass the write precondition. */
export interface CommitteeAccess {
  read: boolean;
  /** assertMayWriteCommittee()'s precondition: committees:view or an active member. */
  write: boolean;
  /**
   * ACC-283 PR 6 — the viewer's active seat, as read for `write`: a string, or null
   * when they hold none. UNDEFINED when it was not read (a committees:view holder
   * pays no query), so memberActionsFor() reads it only if it needs it.
   */
  seat?: string | null;
}

/**
 * ACC-283 — READ and WRITE from one pass, so the committee read can say whether
 * the viewer may write (`mayWrite`, for the screens) at no extra cost. `write` is
 * maySeeCommittee()'s two clauses (committees:view, else activeSeatOf(), whose
 * non-null is isActiveMember()), so the flag and assertMayWriteCommittee() cannot
 * drift. ACC-283 PR 6: it keeps the seat it read, for memberActionsFor(). A holder
 * pays no query, a member one, anyone else the membership query and then the
 * oversight reads (only for `read`).
 */
export async function committeeAccess(
  client: ReadClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
  now: Date = new Date(),
): Promise<CommitteeAccess> {
  if (seesEveryCommittee(viewer.permissions)) return { read: true, write: true };
  // maySeeCommittee()'s member half, keeping the seat it read (ACC-283 PR 6).
  const seat = await activeSeatOf(client, committeeId, viewer.id, organizationId);
  if (seat !== null) return { read: true, write: true, seat };
  const read = await overseesCommittee(
    client,
    committeeId,
    organizationId,
    viewer.id,
    now,
  );
  return { read, write: false, seat: null };
}

/**
 * May this viewer WRITE to this committee: committees:view, or active membership
 * (one query, only without the key). ACC-283 PR 2a: headship does NOT count here;
 * reads ask mayReadCommittee().
 */
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
 * A READ of one committee (or of something on it): admit committees:view, a
 * member, or (ACC-283 PR 2a) a head or cover in force of its owning unit or an
 * ancestor; refuse anyone else with exactly what PermissionGuard used to answer on
 * these routes, "Required permission: committees:view" (Ahmad, Q1: today's rule).
 * It is existence-neutral: every clause answers the same for a real committee the
 * caller may not read and for an invented id (ACC-101 clause a).
 */
export async function assertMaySeeCommittee(
  client: ReadClient,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
  now: Date = new Date(),
): Promise<CommitteeAccess> {
  const access = await committeeAccess(
    client,
    committeeId,
    organizationId,
    viewer,
    now,
  );
  if (access.read) return access;
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
