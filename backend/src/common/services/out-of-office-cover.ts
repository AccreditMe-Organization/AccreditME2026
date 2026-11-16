import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-302 — out of office, and who covers. ONE copy of each rule.
 *
 * isOutOfOffice() is the window test StagePoolService, TaskAuthorityService
 * (ACC-173) and the workload hint (ACC-199) each had a copy of: both dates set
 * and now inside them, inclusive. An open-ended window is not out of office.
 *
 * activeCoverOf() is StagePoolService's cover test: away, an acting user set,
 * and that user ACTIVE in the same organisation. Stage pools use it as it is.
 *
 * coversOf() / routeToCovers() are the TASK rule (Ahmad, 13 Nov): a new task
 * for an ACTIVE person who is away with an active cover goes to the cover —
 * ONE HOP ONLY: when the cover is away too, it stays with the person. It is
 * applied to a placement's DIRECT people only (a chosen person, a one-holder
 * position's holder), never to a pool, and never to a task already held.
 */

export interface OutOfOfficeWindow {
  outOfOfficeFrom: Date | null;
  outOfOfficeTo: Date | null;
}

export function isOutOfOffice(user: OutOfOfficeWindow, now: Date): boolean {
  return !!user.outOfOfficeFrom && !!user.outOfOfficeTo && user.outOfOfficeFrom <= now && now <= user.outOfOfficeTo;
}

export interface CoverCandidate extends OutOfOfficeWindow {
  actingUserId: string | null;
  actingUser: { status: string; organizationId: string } | null;
}

/** StagePoolService's test: the acting user's id when this person is away and covered, else null. */
export function activeCoverOf(user: CoverCandidate, organizationId: string, now: Date): string | null {
  if (!isOutOfOffice(user, now) || !user.actingUserId) return null;
  return user.actingUser?.status === 'ACTIVE' && user.actingUser.organizationId === organizationId ? user.actingUserId : null;
}

export type CoverClient = Pick<PrismaService, 'user'>;

/** Who a NEW task for this person goes to now. Never dates, never the reason (Ahmad, 14 Nov). */
export interface TaskCover {
  userId: string;
  name: string;
}

/**
 * The task rule, for many people in ONE read, scoped by organisation: each
 * ACTIVE person who is away with an active cover who is NOT away too, mapped to
 * that cover. Everyone else is absent from the map.
 */
export async function coversOf(
  client: CoverClient,
  organizationId: string,
  userIds: readonly string[],
  now: Date,
): Promise<Map<string, TaskCover>> {
  const covers = new Map<string, TaskCover>();
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return covers;
  const users = await client.user.findMany({
    where: { organizationId, id: { in: ids }, status: 'ACTIVE', actingUserId: { not: null } },
    select: {
      id: true,
      outOfOfficeFrom: true,
      outOfOfficeTo: true,
      actingUserId: true,
      actingUser: { select: { name: true, status: true, organizationId: true, outOfOfficeFrom: true, outOfOfficeTo: true } },
    },
  });
  for (const user of users) {
    const coverId = activeCoverOf(user, organizationId, now);
    // One hop: a cover who is away too means the task stays with the person.
    if (coverId && user.actingUser && !isOutOfOffice(user.actingUser, now)) {
      covers.set(user.id, { userId: coverId, name: user.actingUser.name });
    }
  }
  return covers;
}

export interface CoverDelegation {
  delegationReason: 'OUT_OF_OFFICE_COVERAGE';
  /** The person the cover stands in for (ACC-40's stamp). */
  delegationContextId: string;
}

export interface CoverRouting {
  /** Who the task goes to, in the order given, each once. */
  userIds: string[];
  /** One stamp per cover who stands in for someone, keyed by the cover's id. */
  delegations: Map<string, CoverDelegation>;
}

/**
 * A placement's direct people, routed to their covers. A cover who is already
 * one of the direct people is there in their own right: not added twice, and
 * not stamped.
 */
export function routeWithCovers(directUserIds: readonly string[], covers: ReadonlyMap<string, TaskCover>): CoverRouting {
  const direct = new Set(directUserIds);
  const userIds: string[] = [];
  const delegations = new Map<string, CoverDelegation>();
  for (const id of directUserIds) {
    const cover = covers.get(id);
    const recipient = cover ? cover.userId : id;
    if (!userIds.includes(recipient)) userIds.push(recipient);
    if (cover && !direct.has(cover.userId) && !delegations.has(cover.userId)) {
      delegations.set(cover.userId, { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: id });
    }
  }
  return { userIds, delegations };
}

/** coversOf() then routeWithCovers(): one read for any number of people. */
export async function routeToCovers(
  client: CoverClient,
  organizationId: string,
  directUserIds: readonly string[],
  now: Date,
): Promise<CoverRouting> {
  return routeWithCovers(directUserIds, await coversOf(client, organizationId, directUserIds, now));
}

/** ACC-302 — what the task's audit row records: who stands in for whom, by id. */
export interface OutOfOfficeCoverEntry {
  forUserId: string;
  coverUserId: string;
}

/** The OUT_OF_OFFICE_COVERAGE stamps of a task's assignee map, for its audit row and notices. */
export function coverEntries(
  delegations?: ReadonlyMap<string, { delegationReason: string | null; delegationContextId: string | null }>,
): OutOfOfficeCoverEntry[] {
  if (!delegations) return [];
  return [...delegations].flatMap(([coverUserId, d]) =>
    d.delegationReason === 'OUT_OF_OFFICE_COVERAGE' && d.delegationContextId ? [{ forUserId: d.delegationContextId, coverUserId }] : [],
  );
}
