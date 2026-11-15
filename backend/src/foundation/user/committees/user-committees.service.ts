import { ForbiddenException, Injectable } from '@nestjs/common';
import { COMMITTEES_PERMISSIONS, USERS_PERMISSIONS } from '../../../common/constants/permissions';
import { memberCommitteeIds } from '../../../common/services/committee-membership';
import { PrismaService } from '../../../prisma/prisma.service';
import { COMMITTEE_MEMBER_ROLE_CATEGORY } from '../../committees/committee-memberships';
import { LookupService } from '../../lookup/lookup.service';
import type { LookupLayer } from '../../lookup/interfaces/lookup-value.interface';
import { UserService } from '../user.service';
import { IUserCommitteeMembership, IUserCommittees } from './user-committees.interface';

/** ACC-216 — the most memberships one read returns; `total` counts past it. */
export const USER_COMMITTEES_CAP = 200;

export interface UserCommitteesViewer {
  id: string;
  permissions: readonly string[];
}

/**
 * ACC-216 — the gate, with NO query (ACC-101 clause a: the request names the
 * parent, a person). Two permissions, in this order:
 *
 *   1. committees:view, in EVERY case, yourself included. The rows name
 *      committees and seats; reading them is reading committees.
 *   2. users:view, unless you are reading yourself: the record these belong to
 *      is a person, readable by that person or with users:view (the rule
 *      GET /users/:userId/roles and /permissions apply).
 *
 * Each refusal is a 403 naming the missing permission. It is checked before the
 * user is read, so it is the same for a real colleague and an invented id.
 */
export function assertMayReadUserCommittees(viewer: UserCommitteesViewer, userId: string): void {
  if (!viewer.permissions.includes(COMMITTEES_PERMISSIONS.VIEW)) {
    throw new ForbiddenException(`Required permission: ${COMMITTEES_PERMISSIONS.VIEW}`);
  }
  if (viewer.id !== userId && !viewer.permissions.includes(USERS_PERMISSIONS.VIEW)) {
    throw new ForbiddenException(`Required permission: ${USERS_PERMISSIONS.VIEW}`);
  }
}

/**
 * ACC-216 — the committees a person sits on, and sat on, for the Committees panel
 * of their record page (/users/:id).
 *
 * WHAT IS LISTED: every CommitteeMember row of the person in the organisation,
 * former memberships and memberships of an inactive committee included. A row is
 * `current` by ACC-281's one rule (`memberCommitteeIds()`, committee-membership.ts):
 * an active member of an active committee. Nothing here re-derives it.
 *
 * One row per committee: CommitteeMember is reused on rejoining (ACC-32), so a
 * row's dates are its latest period. Earlier periods are the committee's own
 * Membership history.
 *
 * ORDER: current first (by seat, the tenant's own seat order, then longest-served,
 * then the committee's id: the Members panel's order, ACC-230), then past, newest
 * left first. A membership of an inactive committee that was never ended has no
 * left date and comes first among the past.
 *
 * SEATS: through the `committee_member_role` lookup's getValues(), so a seat the
 * organisation relabelled shows its label while keeping the SYSTEM value's id and
 * layer. A seat getValues() leaves out (hidden or deactivated since) is named from
 * its own value row instead, in one more query, only when there is one.
 *
 * QUERIES, whatever the count: the user (1), then ONE Promise.all of the rows
 * (capped at 200), their count, the current set and the seats (3 inside
 * getValues): 7, plus 1 only for a seat getValues() left out. Every query is
 * scoped by organisationId, the membership AND its committee. Nothing runs on
 * the per-request path.
 */
@Injectable()
export class UserCommitteesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupService,
    private readonly users: UserService,
  ) {}

  async forUser(organizationId: string, viewer: UserCommitteesViewer, userId: string): Promise<IUserCommittees> {
    assertMayReadUserCommittees(viewer, userId);
    // Another organisation's user, or an invented id: the identical 404, never an
    // empty list that would read as "sits on no committee".
    await this.users.getById(userId, organizationId);

    const where = { organizationId, userId, committee: { organizationId } };
    const [rows, total, current, seats] = await Promise.all([
      this.prisma.committeeMember.findMany({
        where,
        select: {
          roleValueId: true,
          joinedAt: true,
          leftAt: true,
          committee: { select: { id: true, nameEn: true, nameAr: true } },
        },
        // Current-looking rows first, so the cap drops the oldest past ones.
        orderBy: [
          { isActive: 'desc' },
          { leftAt: { sort: 'desc', nulls: 'first' } },
          { joinedAt: 'desc' },
          { id: 'asc' },
        ],
        take: USER_COMMITTEES_CAP,
      }),
      this.prisma.committeeMember.count({ where }),
      memberCommitteeIds(this.prisma, userId, organizationId),
      this.lookups.getValues(COMMITTEE_MEMBER_ROLE_CATEGORY, organizationId),
    ]);
    if (rows.length === 0) return { total, rows: [] };

    type Seat = IUserCommitteeMembership['seat'];
    const seatById = new Map<string, Seat>(
      seats.map((s) => [s.id, { id: s.id, labelEn: s.labelEn, labelAr: s.labelAr, layer: s.layer }]),
    );
    const missing = [...new Set(rows.map((r) => r.roleValueId))].filter((id) => !seatById.has(id));
    if (missing.length > 0) {
      const values = await this.prisma.lookupValue.findMany({
        where: { id: { in: missing }, OR: [{ organizationId: null }, { organizationId }] },
        select: { id: true, labelEn: true, labelAr: true, organizationId: true },
      });
      for (const v of values) {
        const layer: LookupLayer = v.organizationId === null ? 'SYSTEM' : 'TENANT';
        seatById.set(v.id, { id: v.id, labelEn: v.labelEn, labelAr: v.labelAr, layer });
      }
    }

    const seatOrder = new Map(seats.map((s, i) => [s.id, i]));
    const orderOf = (seatId: string) => seatOrder.get(seatId) ?? Number.MAX_SAFE_INTEGER;
    const memberships = rows.map(
      (r): IUserCommitteeMembership => ({
        committee: r.committee,
        seat: seatById.get(r.roleValueId) ?? { id: r.roleValueId, labelEn: null, labelAr: null, layer: null },
        joinedAt: r.joinedAt,
        leftAt: r.leftAt,
        current: current.has(r.committee.id),
      }),
    );
    memberships.sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.current) {
        return (
          orderOf(a.seat.id) - orderOf(b.seat.id) ||
          a.joinedAt.getTime() - b.joinedAt.getTime() ||
          a.committee.id.localeCompare(b.committee.id)
        );
      }
      const left = (m: IUserCommitteeMembership) => (m.leftAt ? m.leftAt.getTime() : Number.POSITIVE_INFINITY);
      return left(b) - left(a) || a.committee.id.localeCompare(b.committee.id);
    });
    return { total, rows: memberships };
  }
}
