import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { STAGE_FLAG } from '../workflow/record-registry';
import { committeeStagesAndCounts } from './committee-stage-counts';
import { committeesInForceStanding, isBelowQuorum } from './committee-seat-rules';
import { seatOrderedMemberships } from './committee-memberships';
import { overseesAnyCommittee, seesEveryCommittee } from '../../common/services/committee-membership';
import { ICommitteeHomeCounts, IMyCommitteeRow, IMyCommittees } from './interfaces/committee.interface';

/** Home shows at most this many of a person's committees; `total` counts past it. */
export const MY_COMMITTEES_ROWS = 5;
/**
 * The most memberships read to choose those five. One person on 200 committees is not a real
 * case, and `total` is counted separately, so it stays honest past the cap.
 */
export const MY_COMMITTEES_READ_CAP = 200;

/**
 * ACC-279 — what Home reads about committees, in a fixed number of queries.
 *
 * `mine()` is SELF-SCOPED: only the caller's own active memberships, so the route
 * carries no @Permissions. Being a member IS the entitlement (ACC-101's rule for
 * self-scoped reads, the same reasoning as a notification naming its record).
 *
 * `homeCounts()` is the admin summary's committees part. The caller holds
 * committees:view, checked by HomeService before it is called.
 */
@Injectable()
export class CommitteeHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupService,
  ) {}

  /**
   * The person's committees: active memberships on active committees, by seat (the
   * tenant's own role order: Chair before Secretary before Member), then
   * longest-served, then the committee's id. That is the Members panel's order
   * (ACC-230), and it does not depend on the reader's language.
   *
   * Queries: the memberships, their count and the seats (3, in lookups) in one wave
   * (seatOrderedMemberships(), shared with ACC-295's read); then the stage facts of the
   * five shown (3). That is 8, however many memberships there are.
   */
  //
  // ACC-283 PR 2a — `mayBrowseCommittees`: may this person open the committees list
  // at all? committees:view (no query), OR an active membership on an active
  // committee (`total`, already read), OR a head or cover in force of a unit that
  // owns an active committee there or below (overseesAnyCommittee(), asked only when
  // the first two are false). The rail and the /committees guard key on it, so no
  // screen re-derives the rule.
  async mine(
    organizationId: string,
    userId: string,
    permissions: readonly string[] = [],
    now: Date = new Date(),
  ): Promise<IMyCommittees> {
    const { memberships, total, seatById } = await seatOrderedMemberships(
      this.prisma,
      this.lookups,
      organizationId,
      userId,
      MY_COMMITTEES_READ_CAP,
    );
    const mayBrowseCommittees =
      seesEveryCommittee(permissions) || total > 0 || (await overseesAnyCommittee(this.prisma, organizationId, userId, now));
    if (memberships.length === 0) return { total, rows: [], mayBrowseCommittees };
    const shown = memberships.slice(0, MY_COMMITTEES_ROWS);

    const facts = await committeeStagesAndCounts(
      this.prisma,
      organizationId,
      shown.map((m) => m.committee.id),
    );
    const rows = shown.map((m): IMyCommitteeRow => {
      const fact = facts.get(m.committee.id);
      const seat = seatById.get(m.roleValueId);
      return {
        committeeId: m.committee.id,
        nameEn: m.committee.nameEn,
        nameAr: m.committee.nameAr,
        isActive: m.committee.isActive,
        seat: { id: m.roleValueId, labelEn: seat?.labelEn ?? null, labelAr: seat?.labelAr ?? null },
        stage: { nameEn: fact?.stageNameEn ?? null, nameAr: fact?.stageNameAr ?? null },
        isInForce: fact?.isInForce ?? false,
        isDissolving: fact?.isDissolving ?? false,
      };
    });
    return { total, rows, mayBrowseCommittees };
  }

  /**
   * Committees in force, and how many of them are below quorum, in ONE query.
   *
   * ACC-307 — read through committeesInForceStanding() (committee-seat-rules.ts):
   * the in-force rule is committeeListStatus()'s (active, the newest instance's
   * stage IN_FORCE and not DISSOLVING), and the member count is the one going
   * live and Setup health's "Committee below quorum" read — only active members
   * who are ACTIVE users count. Before, this counted every active membership, so
   * a deactivated member kept a committee at quorum here while going live said
   * it was not (ACC-306, P161).
   */
  async homeCounts(organizationId: string): Promise<ICommitteeHomeCounts> {
    const standing = await committeesInForceStanding(this.prisma, organizationId);
    return { inForce: standing.length, belowQuorum: standing.filter(isBelowQuorum).length };
  }
}
