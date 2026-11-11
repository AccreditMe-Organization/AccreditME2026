import { ForbiddenException, Injectable } from '@nestjs/common';
import { COMMITTEES_PERMISSIONS, USERS_PERMISSIONS } from '../../common/constants/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { COMMITTEE_ACTIONS } from '../workflow/record-registry';
import { StageRulesService } from '../workflow/stage-rules.service';
import { seatOrderedMemberships } from './committee-memberships';
import { ICommitteeMembershipRow, ICommitteeMemberships } from './interfaces/committee.interface';

/** ACC-295 — the most rows one read answers; `total` counts past it. */
export const MEMBERSHIPS_ROWS = 100;
/** The memberships read (in join order) to choose those 100 by seat. */
export const MEMBERSHIPS_READ_CAP = 200;

export interface MembershipsViewer {
  permissions: readonly string[];
}

/**
 * ACC-295 — one person's committee memberships, for lane A's Transfer wizard: each seat
 * with what a remove needs (`memberId`) and whether the committee's stage allows one
 * (`mayRemove`). The removes stay `DELETE /committees/:id/members/:memberId`, each with
 * its own stage check under lock; `mayRemove` only says what that check will answer.
 *
 * WHO MAY ASK: `committees:view` (also on the route) AND `users:view`, both checked
 * BEFORE any read, so the refusal is a 403 naming the permission and costs no query
 * (ACC-101 clause a: the request names the parent, a person).
 *
 * WHAT IS READ: active memberships on active committees, both in the caller's
 * organisation (from the tenant, never the request). Another organisation's user, or
 * an invented id, has none: `{ total: 0, rows: [] }`, never a 404 that would say the
 * person exists.
 */
@Injectable()
export class CommitteeMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupService,
    private readonly stageRules: StageRulesService,
  ) {}

  /**
   * Seat order, then longest-served, then the committee's id (seatOrderedMemberships(),
   * the order `mine()` and the Members panel use). At most 100 rows; `total` is the
   * true count.
   *
   * Queries: the memberships, their count and the seats (3, in lookups) in one
   * Promise.all; then ONE stageRulesFor() for the committees shown (at most 3). That is
   * at most 8, whatever the count. No query in a row loop; nothing on the per-request
   * path.
   */
  async forUser(organizationId: string, viewer: MembershipsViewer, userId: string): Promise<ICommitteeMemberships> {
    for (const permission of [COMMITTEES_PERMISSIONS.VIEW, USERS_PERMISSIONS.VIEW]) {
      if (!viewer.permissions.includes(permission)) {
        throw new ForbiddenException(`Required permission: ${permission}`);
      }
    }

    const { memberships, total, seatById } = await seatOrderedMemberships(
      this.prisma,
      this.lookups,
      organizationId,
      userId,
      MEMBERSHIPS_READ_CAP,
    );
    if (memberships.length === 0) return { total, rows: [] };
    const shown = memberships.slice(0, MEMBERSHIPS_ROWS);

    // The stage, and whether it allows a remove: the same action key removeMember
    // checks (COMMITTEE_ACTIONS.REMOVE_MEMBER), from one batched read.
    const rules = await this.stageRules.stageRulesFor(
      organizationId,
      'COMMITTEE',
      [...new Set(shown.map((m) => m.committee.id))],
    );
    const rows = shown.map((m): ICommitteeMembershipRow => {
      const rule = rules.get(m.committee.id);
      const seat = seatById.get(m.roleValueId);
      return {
        memberId: m.id,
        committeeId: m.committee.id,
        nameEn: m.committee.nameEn,
        nameAr: m.committee.nameAr,
        seat: { id: m.roleValueId, labelEn: seat?.labelEn ?? null, labelAr: seat?.labelAr ?? null },
        joinedAt: m.joinedAt,
        stage: { nameEn: rule?.stageNameEn ?? null, nameAr: rule?.stageNameAr ?? null },
        mayRemove: rule?.actions[COMMITTEE_ACTIONS.REMOVE_MEMBER] === true,
      };
    });
    return { total, rows };
  }
}
