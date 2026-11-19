import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { STAGE_FLAG } from '../../workflow/record-registry';
import { LookupService } from '../../lookup/lookup.service';
import { NotificationService } from '../../notification/notification.service';
import { OFFICER_SEAT_KEYS, committeeAudiences, committeeReaders } from '../committee-audience';
import { COMMITTEE_MEMBER_ROLE_CATEGORY } from '../committee-memberships';
import { recipientsByCommittee, type Named } from '../transfer-notice/committee-transfer-notice';
import { errorKind } from '../transfer-notice/error-kind';
import { departureNoticeText } from './committee-seat-departure-notice';

/**
 * ACC-306 — the answers this service builds on. They are the plan's
 * recommendations (backend/Plans/step-306-committee-seats-on-deactivation.md §2),
 * built before Ahmad confirmed them (P163), so each is one switch here:
 *
 *   endSeats              Q1 — a deactivation ends the person's committee seats.
 *   keepDissolvedRosters  Q1 — except on a committee whose stage is final and
 *                         DISSOLVING (Dissolved): its roster is a closed record
 *                         (ACC-255, Q-A). An inactive committee is never touched.
 *   tellOfficers          Q3 — each committee's officers are told (the admins'
 *                         departure notice counts the seats in user.service.ts).
 *
 * Q4 (reactivation restores nothing) needs no switch: nothing here runs on it.
 */
export const SEAT_DEPARTURE_POLICY = {
  endSeats: true,
  keepDissolvedRosters: true,
  tellOfficers: true,
} as const;

type Policy = { endSeats: boolean; keepDissolvedRosters: boolean; tellOfficers: boolean };

interface SeatToEnd {
  memberId: string;
  committeeId: string;
  roleValueId: string;
  committee: Named;
  orgUnitId: string;
}

interface EndedSeat extends SeatToEnd {
  leftAt: Date;
}

export interface PreparedSeatDeparture {
  organizationId: string;
  leaverId: string;
  actorId: string;
  seats: SeatToEnd[];
  /** What endSeatsInTx() actually ended: a seat removed meanwhile is not here. */
  applied: EndedSeat[];
}

type SeatTx = Pick<PrismaService, '$queryRaw' | 'committeeMember' | 'committeeMembershipEvent'>;

/**
 * ACC-306 — when a person is deactivated, every committee seat they hold ends
 * INSIDE the deactivation's transaction (the ACC-283 PR 2b shape, a second time):
 *
 *   prepare()       before the transaction, while the person is still ACTIVE: ONE
 *                   indexed query (CommitteeMember by userId), scoped by organisation;
 *                   nothing else when they hold no seat.
 *   endSeatsInTx()  inside it, LAST: the committees' rows FOR UPDATE in one
 *                   statement, in id order; then the memberships still active,
 *                   ended (leftAt, isActive false), and one LEFT event each with
 *                   cause DEACTIVATION, approved by the person deactivating.
 *   finish()        after commit: an audit row per ended seat, and the officers'
 *                   notices. Never throws: a deactivation that committed never
 *                   answers with an error.
 *
 * NEVER BLOCKED (plan Q5): no stage rule, no required-seat rule (ACC-286 rule 3),
 * no quorum check. A departure may empty a committee's last Chairman; Setup
 * health then lists the seat. A seat already ended meanwhile is skipped.
 *
 * LOCK ORDER (plan §3.2): the deactivation's own locks first; then, last, each
 * committee's ROW (never its workflow instance: no stage rule is read). Member
 * writes take the instance FOR SHARE and then this row, a going-live transition
 * its instance and then this row FOR SHARE, and change-request approve the
 * request's instance, the committee's, then this row — so taking only rows, after
 * the deactivation's request instances, closes no cycle.
 */
@Injectable()
export class CommitteeSeatDepartureService {
  private readonly logger = new Logger(CommitteeSeatDepartureService.name);
  /** The answers, injectable so a spec can turn one off. */
  policy: Policy = { ...SEAT_DEPARTURE_POLICY };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly lookups: LookupService,
    private readonly notifications: NotificationService,
  ) {}

  /** Before the deactivation's transaction: the seats it will end. */
  async prepare(organizationId: string, leaverId: string, actorId: string): Promise<PreparedSeatDeparture> {
    const prepared: PreparedSeatDeparture = { organizationId, leaverId, actorId, seats: [], applied: [] };
    if (!this.policy.endSeats) return prepared;
    const keepDissolved = this.policy.keepDissolvedRosters
      ? Prisma.sql`AND NOT (COALESCE(st."isFinal", false) AND ${STAGE_FLAG.DISSOLVING} = ANY(COALESCE(st.flags, ARRAY[]::text[])))`
      : Prisma.empty;
    prepared.seats = await this.prisma.$queryRaw<SeatToEnd[]>`
      SELECT cm.id AS "memberId", cm."committeeId", cm."roleValueId", c."orgUnitId",
             json_build_object('nameEn', c."nameEn", 'nameAr', c."nameAr") AS committee
        FROM "CommitteeMember" cm
        JOIN "Committee" c ON c.id = cm."committeeId" AND c."organizationId" = ${organizationId} AND c."isActive"
        LEFT JOIN LATERAL (
          SELECT s."isFinal", s.flags::text[] AS flags
            FROM "WorkflowInstance" wi
            JOIN "WorkflowStage" s ON s.id = wi."currentStageId"
           WHERE wi."organizationId" = ${organizationId} AND wi."objectType"::text = 'COMMITTEE' AND wi."objectId" = c.id
           ORDER BY wi."createdAt" DESC
           LIMIT 1) st ON true
       WHERE cm."organizationId" = ${organizationId} AND cm."userId" = ${leaverId} AND cm."isActive"
         ${keepDissolved}
       ORDER BY cm."committeeId", cm.id`;
    return prepared;
  }

  /** Inside the caller's transaction, LAST. Records what it ended on `prepared`. */
  async endSeatsInTx(tx: SeatTx, prepared: PreparedSeatDeparture): Promise<void> {
    if (prepared.seats.length === 0) return;
    const { organizationId, leaverId, actorId } = prepared;
    const committeeIds = [...new Set(prepared.seats.map((s) => s.committeeId))].sort();
    // The committees' rows, in id order, in one statement (rows are locked as
    // the sorted scan returns them). Serialises with every member write and a
    // going-live transition on these committees (ACC-286).
    await tx.$queryRaw`
      SELECT id FROM "Committee"
       WHERE id IN (${Prisma.join(committeeIds)}) AND "organizationId" = ${organizationId}
       ORDER BY id
       FOR UPDATE`;
    // Re-read under the locks: a seat removed by hand meanwhile is skipped.
    const still = await tx.committeeMember.findMany({
      where: { id: { in: prepared.seats.map((s) => s.memberId) }, organizationId, userId: leaverId, isActive: true },
      select: { id: true },
    });
    if (still.length === 0) return;
    const stillIds = new Set(still.map((m) => m.id));
    const leftAt = new Date();
    const ending = prepared.seats.filter((s) => stillIds.has(s.memberId));
    // isActive derived STRICTLY from leftAt (ACC-22), as removeMember() writes it.
    await tx.committeeMember.updateMany({
      where: { id: { in: ending.map((s) => s.memberId) }, organizationId, isActive: true },
      data: { leftAt, isActive: false },
    });
    await tx.committeeMembershipEvent.createMany({
      data: ending.map((s) => ({
        organizationId,
        committeeId: s.committeeId,
        userId: leaverId,
        roleValueId: s.roleValueId,
        action: 'LEFT' as const,
        effectiveDate: leftAt,
        reason: null,
        cause: 'DEACTIVATION' as const,
        approvedBy: actorId,
      })),
    });
    prepared.applied = ending.map((s) => ({ ...s, leftAt }));
  }

  /** After commit. Never throws. */
  async finish(prepared: PreparedSeatDeparture): Promise<void> {
    if (prepared.applied.length === 0) return;
    try {
      for (const seat of prepared.applied) {
        await this.auditLog.log({
          tenantId: prepared.organizationId,
          actorId: prepared.actorId,
          action: 'UPDATE',
          objectType: 'CommitteeMember',
          objectId: seat.memberId,
          before: { isActive: true, leftAt: null },
          after: { isActive: false, leftAt: seat.leftAt },
          metadata: { cause: 'DEACTIVATION', userId: prepared.leaverId, committeeId: seat.committeeId },
        });
      }
      if (this.policy.tellOfficers) await this.tellOfficers(prepared);
    } catch (err) {
      this.logger.error(
        `Committee seat departure follow-up failed (${errorKind(err)}): organisation ${prepared.organizationId}, user ${prepared.leaverId}.`,
      );
    }
  }

  /**
   * One notice per officer, chair or secretary, or the owning unit's head (or the
   * cover in force instead), listing their committees whose seats ended. Never the
   * leaver or the person deactivating; ACTIVE people only. The rule is ACC-297's
   * (committee-audience.ts, recipientsByCommittee()).
   */
  private async tellOfficers(prepared: PreparedSeatDeparture): Promise<number> {
    const { organizationId, leaverId, actorId } = prepared;
    // One line per committee, in committee order; several seats on one committee are one line each.
    const committees = [...new Map(prepared.applied.map((s) => [s.committeeId, s])).values()];
    const [seats, person] = await Promise.all([
      this.lookups.getValues(COMMITTEE_MEMBER_ROLE_CATEGORY, organizationId),
      this.prisma.user.findFirst({ where: { id: leaverId, organizationId }, select: { name: true } }),
    ]);
    if (!person) return 0;
    const seatById = new Map(seats.map((s) => [s.id, s]));
    const officerSeatIds = seats.filter((s) => OFFICER_SEAT_KEYS.includes(s.key)).map((s) => s.id);
    const audiences = await committeeAudiences(
      this.prisma,
      organizationId,
      committees.map((c) => ({ committeeId: c.committeeId, orgUnitId: c.orgUnitId })),
      officerSeatIds,
    );
    const byRecipient = recipientsByCommittee(audiences, { personId: leaverId, actorId });
    const recipients = [...byRecipient.keys()];
    if (recipients.length === 0) return 0;
    const committeeIds = committees.map((c) => c.committeeId);
    const { isActive, mayOpen } = await committeeReaders(this.prisma, organizationId, recipients, committeeIds);

    const seatName = (roleValueId: string): Named | null => {
      const seat = seatById.get(roleValueId);
      return seat ? { nameEn: seat.labelEn, nameAr: seat.labelAr ?? null } : null;
    };
    const rows = [...byRecipient.entries()]
      .filter(([readerId]) => isActive(readerId))
      .map(([readerId, ids]) => {
        const shown = ids.flatMap((committeeId) =>
          prepared.applied
            .filter((s) => s.committeeId === committeeId)
            .map((s) => ({ committeeId, opens: mayOpen(readerId, committeeId), seat: s })),
        );
        const text = departureNoticeText({
          personName: person.name,
          lines: shown.map((l) => ({ committee: l.opens ? l.seat.committee : null, seat: seatName(l.seat.roleValueId) })),
        });
        const link = shown.find((l) => l.opens);
        return {
          userId: readerId,
          titleEn: text.titleEn,
          titleAr: text.titleAr,
          bodyEn: text.bodyEn,
          bodyAr: text.bodyAr,
          objectType: link ? 'COMMITTEE' : null,
          objectId: link ? link.committeeId : null,
        };
      });
    return this.notifications.createInAppMany(rows, organizationId, 'committee-seat-departure');
  }
}
