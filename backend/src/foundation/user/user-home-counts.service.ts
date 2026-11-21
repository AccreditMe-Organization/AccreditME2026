import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { holdsSeatWhere } from '../../common/services/seat-holders';

/** ACC-279 — the admin summary's users part. */
export interface IUserHomeCounts {
  active: number;
  invited: number;
  /** Invitations past their expiry (two days, ACC-159), still INVITED. */
  invitedExpired: number;
  /**
   * Seats in use against the limit the invite refusal enforces (ACTIVE + open
   * invitations of Organization.maxUsers, by seat-holders.ts, the rule
   * assertSeatAvailable() counts by: an expired invitation holds no seat). Null when the caller
   * may not read plan limits (tenant:view), or when there is no seat limit: no plan, or
   * the plan's maxFullUsers not set (Ahmad, 6 Nov). It never reads "of 0".
   */
  seats: { occupied: number; maxUsers: number } | null;
}

/**
 * ACC-279 — the people counts behind Home's Active users and Pending invites tiles.
 * Its own small service so Home's admin summary needs nothing of UserService's
 * dependencies. Two queries, or four with seats, in parallel; every one scoped
 * by organisation. The seats count is holdsSeatWhere(), the rule
 * assertSeatAvailable() refuses by (ACC-159).
 */
@Injectable()
export class UserHomeCountsService {
  constructor(private readonly prisma: PrismaService) {}

  async counts(organizationId: string, options: { withSeats: boolean }, now: Date = new Date()): Promise<IUserHomeCounts> {
    const [byStatus, invitedExpired, organization, seatHolders] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['status'],
        where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] } },
        _count: { _all: true },
      }),
      // The same expiry open-invitation.ts reads.
      this.prisma.user.count({
        where: { organizationId, status: 'INVITED', invitationExpiresAt: { lt: now } },
      }),
      options.withSeats
        ? this.prisma.organization.findFirst({
            where: { id: organizationId },
            select: { maxUsers: true, planCatalog: { select: { maxFullUsers: true } } },
          })
        : Promise.resolve(null),
      // ACC-159 — the seat holders by the one rule: an expired invitation holds none.
      options.withSeats
        ? this.prisma.user.count({ where: { organizationId, ...holdsSeatWhere(now) } })
        : Promise.resolve(0),
    ]);
    const countOf = (status: 'ACTIVE' | 'INVITED') => byStatus.find((g) => g.status === status)?._count._all ?? 0;
    const active = countOf('ACTIVE');
    const invited = countOf('INVITED');
    const maxUsers = organization?.maxUsers ?? 0;
    const limited = !!organization?.planCatalog?.maxFullUsers && maxUsers > 0;
    return {
      active,
      invited,
      invitedExpired,
      seats: limited ? { occupied: seatHolders, maxUsers } : null,
    };
  }
}
