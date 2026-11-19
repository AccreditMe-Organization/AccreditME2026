import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { mayActInStagePool } from '../workflow/stage-pool.service';
import { MEETING_ACTIONS } from '../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import { dayAsDate, reviewDayDefaults, unrecordedAttendance } from './meeting-minutes-rules';
import { minutesAudit } from './meeting-minutes.service';
import { distributedNotice, peopleDay, returnedNotice, suggestionDeclinedNotice } from './meeting-notices';
import { notifyUsers } from './meeting-send';
import type { DecideSuggestionDto, DistributeMinutesDto, ReturnMinutesDto, SuggestCorrectionDto } from './dto/meeting.dto';
import type { IMeetingAwaitingMe } from './interfaces/meeting.interface';

/** The seeded stage keys the meeting's two APP moves land in (app-moves.ts). */
const TO_REVIEW = 'minutes_review';
const TO_DRAFT = 'minutes_draft';
/** Distribute Minutes' default review window, in working days (plan §3.6). */
/** Home reads at most this many candidate rows per part (the performance rule). */
const AWAITING_CAP = 200;

/**
 * ACC-316 PR 4 — THE MINUTES' REVIEW (plan step-316 §3.6, §3.8):
 *
 *   Distribute Minutes (the app's move, Minutes Draft → Minutes Review): whoever
 *     is in Minutes Draft's pool; attendance complete; a review date (default 5
 *     working days ahead); the round goes up; the members recorded present are
 *     told after the commit. Its writes ride the move (`inTx`).
 *   Return for Correction (the app's move back): Minutes Review's pool OR whoever
 *     records the minutes; closes the round (its answers stay with it, the next
 *     distribution opens a new one); the reason is stored on the stage entry
 *     left and told to the present members.
 *   "No corrections" and Suggest a correction: a member recorded present, while
 *     the stage allows `suggest_correction`. A suggestion is that member's
 *     answer and replaces "No corrections" in the round (R3-2).
 *   Apply or decline a suggestion: whoever records the minutes, while the stage
 *     allows `apply_suggestions`; a declined suggestion's author is told.
 *   Home's rows: a self-scoped read, needing no permission.
 *
 * Writes take the instance FOR SHARE (or the move's own lock), then the meeting
 * row FOR UPDATE. Notices after the commit.
 */
@Injectable()
export class MeetingReviewService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly workflow: WorkflowService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  // ── Distribute and Return (the app's moves) ─────────────────────────────────

  /**
   * The ONE place Distribute Minutes writes, inside the move's transaction
   * (ACC-322 extends this `inTx` to discard undecided AI suggestions and the
   * rough notes, plan §6a).
   */
  async distribute(id: string, dto: DistributeMinutesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    await this.access.seeing(id, organizationId, viewer, now);
    const current = await this.assertInPool(id, organizationId, viewer.id);
    const { today, defaultDay } = await reviewDayDefaults(this.calendar, organizationId, now);
    const day = dto.reviewBy ?? defaultDay;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day <= today) throw new MeetingRefusal('MEETING_REVIEW_DATE_INVALID');

    let told: { title: string; userIds: string[] } = { title: '', userIds: [] };
    await this.workflow
      .triggerSystemTransition(current.instanceId, TO_REVIEW, organizationId, viewer.id, {
        inTx: async (tx) => {
          await lockMeetingRow(tx, id, organizationId);
          const missing = await unrecordedAttendance(tx, id, organizationId);
          if (missing.length > 0) throw new MeetingRefusal('MEETING_ATTENDANCE_INCOMPLETE', { missing });
          const meeting = await tx.meeting.update({
            where: { id },
            data: { reviewRound: { increment: 1 }, reviewBy: dayAsDate(day) },
            select: { title: true, reviewRound: true },
          });
          await minutesAudit(tx, organizationId, viewer.id, id, { distributed: true, round: meeting.reviewRound, reviewBy: day });
          told = { title: meeting.title, userIds: await presentMembers(tx, id, organizationId) };
        },
      })
      .catch((error: unknown) => asMeetingConflict(error));
    await notifyUsers(this.notifications, organizationId, id, viewer.id, told.userIds, distributedNotice(told.title, peopleDay(day)));
  }

  /** Return for Correction: Minutes Review's pool, or whoever records the minutes. */
  async returnForCorrection(id: string, dto: ReturnMinutesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    const current = await this.workflow.currentStagePool('MEETING', id, organizationId);
    if (!current) throw new MeetingRefusal('MEETING_CHANGED');
    if (!mayActInStagePool(current.pool, viewer.id) && !(await this.isRecorder(owner, organizationId, viewer.id, now))) {
      const names = { stageNameEn: current.stage.nameEn, stageNameAr: current.stage.nameAr };
      throw new WorkflowRefusalException(current.pool.members.length === 0 ? 'STAGE_HAS_NO_ONE' : 'NOT_IN_STAGE_POOL', names);
    }
    const reason = dto.reason ?? null;
    let told: { title: string; userIds: string[] } = { title: '', userIds: [] };
    await this.workflow
      .triggerSystemTransition(current.instanceId, TO_DRAFT, organizationId, viewer.id, {
        ...(reason && { comment: reason }),
        inTx: async (tx) => {
          await lockMeetingRow(tx, id, organizationId);
          // The round closes: its answers and suggestions stay with it (R3-3).
          const meeting = await tx.meeting.update({ where: { id }, data: { reviewBy: null }, select: { title: true, reviewRound: true } });
          await minutesAudit(tx, organizationId, viewer.id, id, { returned: true, round: meeting.reviewRound });
          told = { title: meeting.title, userIds: await presentMembers(tx, id, organizationId) };
        },
      })
      .catch((error: unknown) => asMeetingConflict(error));
    await notifyUsers(this.notifications, organizationId, id, viewer.id, told.userIds, returnedNotice(told.title, reason));
  }

  // ── Answers and suggestions (members recorded present) ──────────────────────

  async noCorrections(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    await this.access.seeing(id, organizationId, viewer, now);
    await this.reviewWrite(id, organizationId, viewer, async (tx, round) => {
      const suggested = await tx.meetingSuggestion.findFirst({ where: { organizationId, meetingId: id, round, authorId: viewer.id }, select: { id: true } });
      if (suggested) throw new MeetingRefusal('MEETING_REVIEW_SUGGESTED');
      await tx.meetingReviewAnswer.upsert({
        where: { meetingId_round_userId: { meetingId: id, round, userId: viewer.id } },
        create: { organizationId, meetingId: id, round, userId: viewer.id, answeredAt: now },
        update: { answeredAt: now },
      });
      await minutesAudit(tx, organizationId, viewer.id, id, { review: 'NO_CORRECTIONS', round });
    });
  }

  async suggest(id: string, dto: SuggestCorrectionDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ id: string }> {
    if (!dto.text) throw new MeetingRefusal('MEETING_SUGGESTION_TEXT_REQUIRED');
    await this.access.seeing(id, organizationId, viewer, now);
    return this.reviewWrite(id, organizationId, viewer, async (tx, round) => {
      if (dto.agendaItemId) {
        const item = await tx.agendaItem.findFirst({ where: { id: dto.agendaItemId, organizationId, meetingId: id }, select: { id: true } });
        if (!item) throw new MeetingRefusal('MEETING_AGENDA_ITEM_NOT_FOUND');
      }
      const row = await tx.meetingSuggestion.create({
        data: { organizationId, meetingId: id, round, agendaItemId: dto.agendaItemId ?? null, authorId: viewer.id, text: dto.text! },
        select: { id: true },
      });
      // The suggestion is the member's answer: it replaces "No corrections" (R3-2).
      await tx.meetingReviewAnswer.deleteMany({ where: { organizationId, meetingId: id, round, userId: viewer.id } });
      await minutesAudit(tx, organizationId, viewer.id, id, { review: 'SUGGESTED', round, suggestionId: row.id });
      return { id: row.id };
    });
  }

  /** The frame of a reviewer's write: the stage allows suggesting, the round is open, the viewer a member recorded present. */
  private async reviewWrite<T>(id: string, organizationId: string, viewer: MeetingViewer, body: (tx: EngineTx, round: number) => Promise<T>): Promise<T> {
    return this.prisma
      .$transaction(async (tx) => {
        await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.SUGGEST_CORRECTION, organizationId, tx, { lock: 'share' });
        await lockMeetingRow(tx, id, organizationId);
        const [meeting, me] = await Promise.all([
          tx.meeting.findFirst({ where: { id, organizationId }, select: { reviewRound: true } }),
          tx.meetingAttendee.findFirst({
            where: { organizationId, meetingId: id, userId: viewer.id, kind: 'MEMBER', attendance: 'PRESENT' },
            select: { id: true },
          }),
        ]);
        if (!me) throw new MeetingRefusal('MEETING_NOT_REVIEWER');
        if (!meeting || meeting.reviewRound < 1) throw new MeetingRefusal('MEETING_CHANGED');
        return body(tx, meeting.reviewRound);
      })
      .catch((error: unknown) => asMeetingConflict(error));
  }

  // ── Apply or decline (whoever records the minutes) ──────────────────────────

  async decideSuggestion(
    id: string,
    suggestionId: string,
    decision: 'APPLIED' | 'DECLINED',
    dto: DecideSuggestionDto,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<void> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    if (!(await this.isRecorder(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_RECORDER');
    const decided = await this.prisma
      .$transaction(async (tx) => {
        await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.APPLY_SUGGESTIONS, organizationId, tx, { lock: 'share' });
        await lockMeetingRow(tx, id, organizationId);
        const suggestion = await tx.meetingSuggestion.findFirst({
          where: { id: suggestionId, organizationId, meetingId: id },
          select: { status: true, authorId: true, meeting: { select: { title: true } } },
        });
        if (!suggestion) throw new MeetingRefusal('MEETING_SUGGESTION_NOT_FOUND');
        if (suggestion.status !== 'OPEN') throw new MeetingRefusal('MEETING_SUGGESTION_DECIDED');
        await tx.meetingSuggestion.update({
          where: { id: suggestionId },
          data: { status: decision, reply: dto.reply ?? null, decidedById: viewer.id, decidedAt: now },
        });
        await minutesAudit(tx, organizationId, viewer.id, id, { suggestionId, decision });
        return { authorId: suggestion.authorId, title: suggestion.meeting.title };
      })
      .catch((error: unknown) => asMeetingConflict(error));
    if (decision === 'DECLINED') {
      await notifyUsers(this.notifications, organizationId, id, viewer.id, [decided.authorId], suggestionDeclinedNotice(decided.title, dto.reply ?? null));
    }
  }

  // ── Home: what is waiting for me ────────────────────────────────────────────

  /**
   * Home's meeting rows, self-scoped (being the invitee or the reviewer IS the
   * entitlement, ACC-101): reviews where the viewer is a member recorded present
   * and hasn't answered this round, and invitations not answered before the
   * start. Bounded reads, stage rules in one batch.
   */
  async awaitingMe(organizationId: string, viewerId: string, now: Date = new Date()): Promise<IMeetingAwaitingMe> {
    // Every filter in SQL BEFORE the cap (the stage's action, the round not yet
    // answered, the start not passed), so an old meeting can never push a
    // current one off Home. Each meeting's stage is its newest instance's.
    const current = (meetingAlias: Prisma.Sql) => Prisma.sql`(
      SELECT wi."currentStageId" FROM "WorkflowInstance" wi
      WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = 'MEETING'::"WorkflowObjectType" AND wi."objectId" = ${meetingAlias}
      ORDER BY wi."createdAt" DESC LIMIT 1)`;
    const allows = (action: string) => Prisma.sql`EXISTS (
      SELECT 1 FROM "WorkflowStageRecordAction" ra
      WHERE ra."organizationId" = ${organizationId} AND ra."actionKey" = ${action} AND ra."stageId" = ${current(Prisma.sql`m.id`)})`;
    const [review, answer] = await Promise.all([
      this.prisma.$queryRaw<{ meetingId: string; title: string; reviewBy: Date | null }[]>`
        SELECT m.id AS "meetingId", m.title, m."reviewBy"
        FROM "MeetingAttendee" a
        JOIN "Meeting" m ON m.id = a."meetingId" AND m."organizationId" = ${organizationId}
        WHERE a."organizationId" = ${organizationId} AND a."userId" = ${viewerId} AND a.kind = 'MEMBER' AND a.attendance = 'PRESENT'
          AND m."reviewRound" > 0
          AND ${allows(MEETING_ACTIONS.SUGGEST_CORRECTION)}
          AND NOT EXISTS (SELECT 1 FROM "MeetingReviewAnswer" r
                          WHERE r."organizationId" = ${organizationId} AND r."meetingId" = m.id AND r.round = m."reviewRound" AND r."userId" = ${viewerId})
          AND NOT EXISTS (SELECT 1 FROM "MeetingSuggestion" s
                          WHERE s."organizationId" = ${organizationId} AND s."meetingId" = m.id AND s.round = m."reviewRound" AND s."authorId" = ${viewerId})
        ORDER BY m."reviewBy" ASC NULLS LAST, m.id
        LIMIT ${AWAITING_CAP}`,
      this.prisma.$queryRaw<{ meetingId: string; title: string; scheduledAt: Date }[]>`
        SELECT m.id AS "meetingId", m.title, m."scheduledAt"
        FROM "MeetingAttendee" a
        JOIN "Meeting" m ON m.id = a."meetingId" AND m."organizationId" = ${organizationId}
        WHERE a."organizationId" = ${organizationId} AND a."userId" = ${viewerId} AND a."invitedAt" IS NOT NULL AND a.answer IS NULL
          AND m."scheduledAt" > ${now}
          AND ${allows(MEETING_ACTIONS.ANSWER_INVITATION)}
        ORDER BY m."scheduledAt" ASC, m.id
        LIMIT ${AWAITING_CAP}`,
    ]);
    return {
      review: review.map((r) => ({ meetingId: r.meetingId, title: r.title, reviewBy: r.reviewBy?.toISOString().slice(0, 10) ?? null })),
      answer,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** The viewer is in the pool of the meeting's current stage (Distribute: Minutes Draft's). */
  private async assertInPool(id: string, organizationId: string, viewerId: string): Promise<{ instanceId: string }> {
    const current = await this.workflow.currentStagePool('MEETING', id, organizationId);
    if (!current) throw new MeetingRefusal('MEETING_CHANGED');
    const names = { stageNameEn: current.stage.nameEn, stageNameAr: current.stage.nameAr };
    if (current.pool.members.length === 0) throw new WorkflowRefusalException('STAGE_HAS_NO_ONE', names);
    if (!mayActInStagePool(current.pool, viewerId)) throw new WorkflowRefusalException('NOT_IN_STAGE_POOL', names);
    return { instanceId: current.instanceId };
  }

  private isRecorder(owner: MeetingOwner, organizationId: string, viewerId: string, now: Date): Promise<boolean> {
    return isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_RECORDERS', viewerId, now);
  }
}

/** The members recorded present: who reviews, and who is told. */
async function presentMembers(tx: EngineTx, meetingId: string, organizationId: string): Promise<string[]> {
  const rows = await tx.meetingAttendee.findMany({
    where: { organizationId, meetingId, kind: 'MEMBER', attendance: 'PRESENT', userId: { not: null } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId!);
}
