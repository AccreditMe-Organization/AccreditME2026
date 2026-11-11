import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { STAGE_FLAG } from '../workflow/record-registry';
import { committeeStagesAndCounts } from './committee-stage-counts';
import { seatOrderedMemberships } from './committee-memberships';
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
  async mine(organizationId: string, userId: string): Promise<IMyCommittees> {
    const { memberships, total, seatById } = await seatOrderedMemberships(
      this.prisma,
      this.lookups,
      organizationId,
      userId,
      MY_COMMITTEES_READ_CAP,
    );
    if (memberships.length === 0) return { total, rows: [] };
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
    return { total, rows };
  }

  /**
   * Committees in force, and how many of them are below quorum, in ONE query.
   *
   * The status rule is committeeListStatus()'s (ACC-256): an inactive committee is out,
   * DISSOLVING is read before IN_FORCE, and a committee's stage is that of its NEWEST
   * workflow instance (committeeStagesAndCounts' rule). Below quorum means in force, a
   * quorum above 0, and fewer active members than it. Every table is scoped by
   * organisation in its own right, and every value is bound.
   */
  async homeCounts(organizationId: string): Promise<ICommitteeHomeCounts> {
    const rows = await this.prisma.$queryRaw<{ in_force: bigint; below_quorum: bigint }[]>`
      WITH latest AS (
        SELECT DISTINCT ON (wi."objectId") wi."objectId", wi."currentStageId"
        FROM "WorkflowInstance" wi
        WHERE wi."organizationId" = ${organizationId} AND wi."objectType"::text = 'COMMITTEE'
        ORDER BY wi."objectId", wi."createdAt" DESC
      ), members AS (
        SELECT cm."committeeId", count(*) AS n
        FROM "CommitteeMember" cm
        WHERE cm."organizationId" = ${organizationId} AND cm."isActive"
        GROUP BY cm."committeeId"
      ), standing AS (
        SELECT c."quorumCount" AS quorum, COALESCE(m.n, 0) AS members,
               (${STAGE_FLAG.IN_FORCE} = ANY(s.flags) AND NOT ${STAGE_FLAG.DISSOLVING} = ANY(s.flags)) AS in_force
        FROM "Committee" c
        JOIN latest l ON l."objectId" = c.id
        JOIN "WorkflowStage" s ON s.id = l."currentStageId"
        JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
        LEFT JOIN members m ON m."committeeId" = c.id
        WHERE c."organizationId" = ${organizationId} AND c."isActive"
      )
      SELECT count(*) FILTER (WHERE in_force)::bigint AS in_force,
             count(*) FILTER (WHERE in_force AND quorum > 0 AND members < quorum)::bigint AS below_quorum
      FROM standing`;
    return {
      inForce: Number(rows[0]?.in_force ?? 0),
      belowQuorum: Number(rows[0]?.below_quorum ?? 0),
    };
  }
}
