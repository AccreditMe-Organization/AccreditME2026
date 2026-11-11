import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LookupService } from '../lookup/lookup.service';
import type { ILookupValue } from '../lookup/interfaces/lookup-value.interface';

export const COMMITTEE_MEMBER_ROLE_CATEGORY = 'committee_member_role';

export interface SeatOrderedMembership {
  id: string;
  roleValueId: string;
  joinedAt: Date;
  committee: { id: string; nameEn: string; nameAr: string | null; isActive: boolean };
}

export interface SeatOrderedMemberships {
  /** Up to `readCap` memberships, in seat order (see below). */
  memberships: SeatOrderedMembership[];
  /** Every active membership on an active committee, counted past the cap. */
  total: number;
  /** The tenant's seats, by id, for the labels. */
  seatById: Map<string, ILookupValue>;
}

/**
 * ACC-279, shared since ACC-295 — one person's active memberships on active committees,
 * in the Members panel's order (ACC-230): by seat (the tenant's own role order: Chair
 * before Secretary before Member), then longest-served, then the committee's id. The
 * order does not depend on the reader's language.
 *
 * Read by Home's own committees (`CommitteeHomeService.mine()`, self-scoped) and by
 * one person's memberships for the Transfer wizard (`CommitteeMembershipsService`,
 * gated). Each caller decides who may ask; this decides nothing about that.
 *
 * Queries: the memberships, their count and the seats (3, in lookups) in ONE
 * Promise.all; 5 whatever the count. The membership and its committee are both scoped
 * by `organizationId`, so another organisation's user simply has none.
 *
 * `readCap` bounds the rows read (in join order) before the seat sort; `total` stays
 * the true count.
 */
export async function seatOrderedMemberships(
  prisma: Pick<PrismaService, 'committeeMember'>,
  lookups: Pick<LookupService, 'getValues'>,
  organizationId: string,
  userId: string,
  readCap: number,
): Promise<SeatOrderedMemberships> {
  const where: Prisma.CommitteeMemberWhereInput = {
    organizationId,
    userId,
    isActive: true,
    committee: { organizationId, isActive: true },
  };
  const [rows, total, seats] = await Promise.all([
    prisma.committeeMember.findMany({
      where,
      select: {
        id: true,
        roleValueId: true,
        joinedAt: true,
        committee: { select: { id: true, nameEn: true, nameAr: true, isActive: true } },
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      take: readCap,
    }),
    prisma.committeeMember.count({ where }),
    // The seats as THIS tenant names and orders them (hidden values and label
    // overrides applied), the same resolution the Members panel reads.
    lookups.getValues(COMMITTEE_MEMBER_ROLE_CATEGORY, organizationId),
  ]);

  const seatIndex = new Map(seats.map((s, i) => [s.id, i]));
  const seatOf = (roleValueId: string) => seatIndex.get(roleValueId) ?? Number.MAX_SAFE_INTEGER;
  const memberships = [...rows].sort(
    (a, b) =>
      seatOf(a.roleValueId) - seatOf(b.roleValueId) ||
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      a.committee.id.localeCompare(b.committee.id),
  );
  return { memberships, total, seatById: new Map(seats.map((s) => [s.id, s])) };
}
