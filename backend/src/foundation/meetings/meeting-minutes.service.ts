import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { isActiveMember } from '../../common/services/committee-membership';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService, type StageRules } from '../workflow/stage-rules.service';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { mayActInStagePool } from '../workflow/stage-pool.service';
import { MEETING_ACTIONS } from '../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import {
  minutesPhase,
  quorumLine,
  reviewClosed,
  reviewDatePassed,
  reviewDayDefaults,
  reviewers,
  distributeBlockedBy,
  type MinutesPhase,
} from './meeting-minutes-rules';
import type {
  CreateActionItemDto,
  DecisionDto,
  ItemMinutesDto,
  OpenActionNoteDto,
  RecordAttendanceDto,
  UpdateActionItemDto,
} from './dto/meeting.dto';
import type { IMeetingMinutes, IMeetingOpenAction, IMeetingOpenActions } from './interfaces/meeting.interface';
import { TaskAdmissionService } from '../task/task-admission.service';

/**
 * What a minutes write needs its stage to allow. `aiDraft` (ACC-322): an
 * accepted AI suggestion, only where the minutes are written freely
 * (`record_minutes`, Minutes Draft), never as a review change.
 */
type MinutesNeed = 'attendance' | 'minutes' | 'actions' | 'actionDates' | 'aiDraft';

/**
 * ACC-322 — an accepted AI suggestion, written by applyAiDraft() in ONE
 * transaction. A minutes suggestion replaces each part it carries (M5): the
 * discussion when it has one, the item's decisions when it has any.
 */
export type AiDraftWrite =
  | {
      kind: 'ITEM_MINUTES';
      agendaItemId: string;
      discussion: string | null;
      decisions: readonly { text: string; votes: { for: number; against: number; abstain: number } | null }[];
    }
  | { kind: 'ACTION_ITEM'; agendaItemId: string; title: string | null; ownerUserId: string | null; dueAt: string | null };

/** What the audit records of an accepted AI draft (plan step-322 §2): never its text. */
export interface AiDraftMark {
  kind: 'ITEM_MINUTES' | 'ACTION_ITEM';
  interactionId: string | null;
}

/** What the write is doing, for its review change ("Changed during review: item 2, decision"). */
type ReviewChange = 'DISCUSSION' | 'DECISION' | 'ACTION_DATE';

/**
 * ACC-316 PR 4 — A MEETING'S MINUTES: attendance and the quorum line, each
 * agenda item's discussion, decisions and votes, the action item drafts, notes
 * on the last meeting's open actions, and the minutes as one read (plan
 * step-316 §3.4–§3.7, §4.1, §4.2).
 *
 * WHO writes: meeting-authority.ts's RECORDERS (the predicate Minutes Draft's
 * pool reads), else 403 MEETING_NOT_RECORDER. WHAT: the stage's record actions,
 * read inside the write's transaction with the instance FOR SHARE, then the
 * meeting row FOR UPDATE, then the agenda item (the lock order). In Minutes
 * Draft the minutes are written freely (`record_minutes`); in Minutes Review
 * the same writes are the Secretary applying suggestions (`apply_suggestions`)
 * or moving action dates (`change_action_dates`), and each records a review
 * change. WHO reads: §4.1, by the minutes' phase (meeting-minutes-rules.ts).
 *
 * Every write records ONE Meeting audit row through minutesAudit(), the hook
 * ACC-322 extends to name an accepted AI draft.
 */
@Injectable()
export class MeetingMinutesService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly workflow: WorkflowService,
    private readonly calendar: WorkingCalendarService,
    private readonly taskAdmission: TaskAdmissionService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async getMinutes(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    const { rules, recorder, phase, readable } = await this.minutesAccess(id, owner, organizationId, viewer, now);
    // Distribute Minutes leaves the stage where the minutes are written.
    const writing = rules.actions[MEETING_ACTIONS.RECORD_MINUTES] === true;
    if (!phase || !readable) {
      throw new MeetingRefusal('MEETING_MINUTES_NOT_OPEN');
    }

    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId },
      select: {
        scheduledAt: true,
        reviewRound: true,
        reviewBy: true,
        quorumAtAttendance: true,
        unitQuorum: true,
        minutesApprovedAt: true,
        committeeId: true,
        approvedBy: { select: { id: true, name: true } },
        committee: { select: { quorumCount: true } },
      },
    });
    if (!meeting) throw new MeetingRefusal('MEETING_MINUTES_NOT_OPEN');
    const round = meeting.reviewRound;
    // PR 7d-1 (P230) — the approver is named only while the minutes ARE approved:
    // the seeded Minutes Approved is final, but a tenant may add a move out of
    // it, and the stamp would then outlive the approval.
    const approval = phase === 'approved' && meeting.minutesApprovedAt && meeting.approvedBy ? { at: meeting.minutesApprovedAt, by: meeting.approvedBy } : null;
    const [attendees, items, suggestions, changes, people, zone, openActions, pool, blocked, approverSeat, aiUndecided] = await Promise.all([
      this.prisma.meetingAttendee.findMany({
        where: { organizationId, meetingId: id },
        select: {
          id: true,
          kind: true,
          userId: true,
          attendance: true,
          answer: true,
          outsideName: true,
          user: { select: { name: true } },
          seatValue: { select: { id: true, labelEn: true, labelAr: true, sortOrder: true } },
        },
      }),
      this.prisma.agendaItem.findMany({
        where: { organizationId, meetingId: id },
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          order: true,
          title: true,
          standing: true,
          discussion: true,
          decisions: { where: { organizationId }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
          actionItems: {
            where: { organizationId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, title: true, dueAt: true, owner: { select: { id: true, name: true } }, task: { select: { id: true, status: true } } },
          },
        },
      }),
      this.prisma.meetingSuggestion.findMany({
        where: { organizationId, meetingId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          round: true,
          agendaItemId: true,
          text: true,
          status: true,
          reply: true,
          createdAt: true,
          decidedAt: true,
          author: { select: { id: true, name: true } },
        },
      }),
      this.prisma.meetingReviewChange.findMany({
        where: { organizationId, meetingId: id },
        distinct: ['round', 'agendaItemId', 'what'],
        orderBy: [{ round: 'asc' }, { agendaItemId: 'asc' }, { what: 'asc' }],
        select: { round: true, agendaItemId: true, what: true },
      }),
      round > 0 ? reviewers(this.prisma, id, organizationId, round) : Promise.resolve([]),
      this.calendar.getEffectiveTimeZone(organizationId),
      this.openActions(this.prisma, id, organizationId),
      phase === 'review' || phase === 'draft' ? this.workflow.currentStagePool('MEETING', id, organizationId) : Promise.resolve(null),
      writing ? distributeBlockedBy(this.prisma, id, organizationId) : Promise.resolve(null),
      approval && meeting.committeeId ? approverSeatAt(this.prisma, organizationId, meeting.committeeId, approval.by.id, approval.at) : Promise.resolve(null),
      // ACC-322 (M2) — the undecided AI suggestions Distribute will discard.
      writing ? countUndecidedMinutesAi(this.prisma, id, organizationId) : Promise.resolve(0),
    ]);

    const quorum = quorumLine(
      meeting.quorumAtAttendance ?? meeting.committee?.quorumCount ?? meeting.unitQuorum ?? null,
      attendees.filter((a) => a.kind === 'MEMBER' && a.attendance === 'PRESENT').length,
    );
    const withoutQuorum = quorum.met === false;
    const inPool = !!pool && mayActInStagePool(pool.pool, viewer.id);
    const mine = people.find((p) => p.userId === viewer.id);
    const myStatus = !mine
      ? null
      : suggestions.some((s) => s.round === round && s.author.id === viewer.id)
        ? ('SUGGESTED' as const)
        : mine.answered
          ? ('NO_CORRECTIONS' as const)
          : null;
    const kindOrder = { MEMBER: 0, ORG_GUEST: 1, OUTSIDE_GUEST: 2 } as const;

    return {
      phase,
      attendance: attendees
        .map((a) => ({
          attendeeId: a.id,
          kind: a.kind,
          userId: a.userId,
          name: a.user?.name ?? a.outsideName ?? '',
          seat: a.seatValue ? { id: a.seatValue.id, labelEn: a.seatValue.labelEn, labelAr: a.seatValue.labelAr } : null,
          attendance: a.attendance,
          // Pre-filled from "Can't attend" (plan §3.4): shown, never recorded until saved.
          suggested: a.attendance === null && a.answer === 'CANT_ATTEND' ? ('APOLOGIES' as const) : null,
          seatOrder: a.seatValue?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        }))
        .sort((x, y) => kindOrder[x.kind] - kindOrder[y.kind] || x.seatOrder - y.seatOrder || x.name.localeCompare(y.name))
        .map(({ seatOrder: _seatOrder, ...row }) => row),
      quorum,
      items: items.map((i) => ({
        id: i.id,
        order: i.order,
        title: i.title,
        standing: i.standing,
        discussion: i.discussion,
        decisions: i.decisions.map((d) => ({
          id: d.id,
          order: d.order,
          text: d.text,
          votes: d.votesFor === null || d.votesAgainst === null || d.votesAbstain === null ? null : { for: d.votesFor, against: d.votesAgainst, abstain: d.votesAbstain },
          takenWithoutQuorum: withoutQuorum,
        })),
        actionItems: i.actionItems.map((a) => ({ id: a.id, title: a.title, owner: a.owner, dueAt: a.dueAt, task: a.task })),
      })),
      openActions,
      review: {
        round,
        reviewBy: meeting.reviewBy?.toISOString().slice(0, 10) ?? null,
        datePassed: reviewDatePassed(meeting.reviewBy, zone, now),
        closed: round > 0 && reviewClosed(people, meeting.reviewBy, zone, now),
        reviewers: people,
        suggestions: suggestions.map((s) => ({ ...s, author: s.author })),
        changes,
        mine: myStatus,
      },
      distribute: writing
        ? {
            ready: blocked === null,
            blockedBy: blocked,
            // PR 7b — the review date Distribute uses when none is chosen (the screen offers it).
            defaultReviewBy: (await reviewDayDefaults(this.calendar, organizationId, now)).defaultDay,
            // ACC-322 (M2) — named in the Distribute confirm, then discarded. Never holds Distribute.
            aiUndecided,
          }
        : null,
      approvedAt: meeting.minutesApprovedAt,
      // PR 7d-1 — who approved, for the print's approval line: their name even
      // if they have since left or been deactivated, and the seat they held then.
      approvedBy: approval ? { id: approval.by.id, name: approval.by.name, seat: approverSeat } : null,
      may: {
        recordAttendance: recorder && meeting.scheduledAt <= now && rules.actions[MEETING_ACTIONS.RECORD_ATTENDANCE] === true,
        recordMinutes: recorder && rules.actions[MEETING_ACTIONS.RECORD_MINUTES] === true,
        distribute: writing && inPool,
        returnForCorrection: phase === 'review' && (inPool || recorder),
        review: phase === 'review' && !!mine && rules.actions[MEETING_ACTIONS.SUGGEST_CORRECTION] === true,
        applySuggestions: recorder && rules.actions[MEETING_ACTIONS.APPLY_SUGGESTIONS] === true,
        changeActionDates: recorder && rules.actions[MEETING_ACTIONS.CHANGE_ACTION_DATES] === true,
      },
    };
  }

  /**
   * ACC-316 PR 7b — "Open actions from the last meeting", the agenda's fixed
   * first section, for anyone who sees this meeting (P202):
   *
   * 1. This meeting's own visibility first: anyone else gets the identical 404
   *    a missing meeting gets.
   * 2. The rows come from the LAST meeting, so they are shown only to whoever
   *    may read ITS approved minutes, by the same rule as its minutes read
   *    (minutesAccess()); an organisation guest of this meeting only does not.
   *    No earlier approved meeting and "you can't read it" answer the SAME way,
   *    `{ mayRead: false, rows: [] }` (P206): no error, nothing says a section
   *    is hidden, and the screen draws nothing for either. The last meeting is
   *    checked with MeetingAccess.canSee(), which writes no concealed-refusal
   *    log line: nothing is concealed from this caller here.
   * 3. Each row's task is linked only where the task page would open it, asked
   *    for every row at once (TaskAdmissionService.admittedIds()).
   */
  async getOpenActions(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingOpenActions> {
    await this.access.seeing(id, organizationId, viewer, now);
    const last = await this.lastApprovedMeeting(this.prisma, id, organizationId);
    if (!last) return { mayRead: false, rows: [] };
    const lastOwner = await this.access.canSee(last.id, organizationId, viewer, now);
    if (!lastOwner) return { mayRead: false, rows: [] };
    const { readable } = await this.minutesAccess(last.id, lastOwner, organizationId, viewer, now);
    if (!readable) return { mayRead: false, rows: [] };
    const rows = await this.openActions(this.prisma, id, organizationId, last);
    const admitted = await this.taskAdmission.admittedIds(
      rows.map((r) => r.taskId),
      viewer,
      organizationId,
      now,
    );
    return { mayRead: true, rows: rows.map((r) => ({ ...r, mayOpen: admitted.has(r.taskId) })) };
  }

  /**
   * §4.1 for one meeting, the one place it is asked: its phase, whether the
   * viewer records its minutes, and whether they may read them. This meeting's
   * minutes read and the next meeting's open actions both call it.
   */
  private async minutesAccess(id: string, owner: MeetingOwner, organizationId: string, viewer: MeetingViewer, now: Date) {
    const [rules, recorder] = await Promise.all([
      this.stageRules.currentStageRules('MEETING', id, organizationId),
      this.isRecorder(owner, organizationId, viewer.id, now),
    ]);
    const phase = minutesPhase(rules);
    const readable = !!phase && (await this.mayRead(phase, owner, id, organizationId, viewer.id, recorder, now));
    return { rules, recorder, phase, readable };
  }

  /**
   * §4.1: whoever records them reads the minutes from Minutes Draft; the
   * committee's or unit's members, Minutes Review's pool and the approvers
   * (heads above holding approve_subunits included) from Minutes Review;
   * everyone who may see the meeting once they are approved.
   */
  private async mayRead(
    phase: MinutesPhase,
    owner: MeetingOwner,
    id: string,
    organizationId: string,
    viewerId: string,
    recorder: boolean,
    now: Date,
  ): Promise<boolean> {
    if (phase === 'approved' || recorder) return true;
    if (phase === 'draft') return false;
    if (await this.isOwnersMember(owner, organizationId, viewerId)) return true;
    const [pool, approver] = await Promise.all([
      this.workflow.currentStagePool('MEETING', id, organizationId),
      isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_APPROVERS', viewerId, now),
    ]);
    return approver || (!!pool && mayActInStagePool(pool.pool, viewerId));
  }

  /** An active member of the meeting's committee, or an ACTIVE person of its unit (a unit meeting). */
  private async isOwnersMember(owner: MeetingOwner, organizationId: string, viewerId: string): Promise<boolean> {
    if (owner.committeeId) return isActiveMember(this.prisma, owner.committeeId, viewerId, organizationId);
    if (!owner.unitId) return false;
    const person = await this.prisma.user.findFirst({
      where: { id: viewerId, organizationId, status: 'ACTIVE', primaryOrgUnitId: owner.unitId },
      select: { id: true },
    });
    return !!person;
  }

  private isRecorder(owner: MeetingOwner, organizationId: string, viewerId: string, now: Date): Promise<boolean> {
    return isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_RECORDERS', viewerId, now);
  }

  /**
   * "Open actions from the last meeting": the previous meeting of the same
   * committee or unit whose minutes were approved, and its action items whose
   * task is still open, with this meeting's note on each.
   */
  private async openActions(
    client: Pick<PrismaService, 'meeting' | 'meetingActionItem' | 'meetingOpenActionNote'>,
    id: string,
    organizationId: string,
    known?: { id: string },
  ): Promise<IMeetingOpenAction[]> {
    const last = known ?? (await this.lastApprovedMeeting(client, id, organizationId));
    if (!last) return [];
    const [items, notes] = await Promise.all([
      client.meetingActionItem.findMany({
        where: { organizationId, meetingId: last.id, task: { organizationId, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { owner: { select: { id: true, name: true } }, task: { select: { id: true, title: true, status: true, dueAt: true } } },
      }),
      client.meetingOpenActionNote.findMany({ where: { organizationId, meetingId: id }, select: { taskId: true, note: true } }),
    ]);
    const noteOf = new Map(notes.map((n) => [n.taskId, n.note]));
    return items
      .filter((i) => i.task)
      .map((i) => ({
        taskId: i.task!.id,
        title: i.task!.title,
        status: i.task!.status,
        dueAt: i.task!.dueAt,
        owner: i.owner,
        fromMeetingId: last.id,
        note: noteOf.get(i.task!.id) ?? null,
      }));
  }

  /** The newest earlier meeting of the same committee or unit whose minutes were approved, or null. */
  private async lastApprovedMeeting(client: Pick<PrismaService, 'meeting'>, id: string, organizationId: string): Promise<{ id: string } | null> {
    const meeting = await client.meeting.findFirst({
      where: { id, organizationId },
      select: { scheduledAt: true, committeeId: true, orgUnitId: true },
    });
    if (!meeting) return null;
    return client.meeting.findFirst({
      where: {
        organizationId,
        id: { not: id },
        ...(meeting.committeeId ? { committeeId: meeting.committeeId } : { committeeId: null, orgUnitId: meeting.orgUnitId }),
        scheduledAt: { lt: meeting.scheduledAt },
        minutesApprovedAt: { not: null },
      },
      orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
  }

  // ── Attendance ──────────────────────────────────────────────────────────────

  /**
   * Record attendance, one row (saved on tap) or several, from the start time.
   * The quorum is frozen at the first recording (`quorumAtAttendance`): a
   * committee changing its quorum later does not change this meeting's line.
   */
  async recordAttendance(id: string, dto: RecordAttendanceDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    await this.write(id, organizationId, viewer, now, 'attendance', async (tx) => {
      const meeting = await tx.meeting.findFirst({
        where: { id, organizationId },
        select: { scheduledAt: true, quorumAtAttendance: true, unitQuorum: true, committee: { select: { quorumCount: true } } },
      });
      if (!meeting) throw new MeetingRefusal('MEETING_CHANGED');
      if (meeting.scheduledAt > now) throw new MeetingRefusal('MEETING_NOT_STARTED');
      const ids = [...new Set(dto.rows.map((r) => r.attendeeId))];
      const found = await tx.meetingAttendee.findMany({ where: { organizationId, meetingId: id, id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) throw new MeetingRefusal('MEETING_ATTENDEE_NOT_FOUND');
      for (const row of dto.rows) {
        await tx.meetingAttendee.update({
          where: { id: row.attendeeId },
          data: { attendance: row.attendance, attendanceRecordedAt: now, attendanceRecordedById: viewer.id },
        });
      }
      if (meeting.quorumAtAttendance === null) {
        const quorum = meeting.committee?.quorumCount ?? meeting.unitQuorum ?? null;
        if (quorum !== null) await tx.meeting.update({ where: { id }, data: { quorumAtAttendance: quorum } });
      }
      await minutesAudit(tx, organizationId, viewer.id, id, { attendance: dto.rows.map((r) => ({ attendeeId: r.attendeeId, attendance: r.attendance })) });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  // ── Minutes per item ────────────────────────────────────────────────────────

  /** The item's discussion, replaced whole (never appended: an AI Accept is one such write, ACC-322). */
  async setItemMinutes(id: string, itemId: string, dto: ItemMinutesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    await this.write(id, organizationId, viewer, now, 'minutes', async (tx, ctx) => {
      await lockAgendaItem(tx, id, itemId, organizationId);
      await tx.agendaItem.update({ where: { id: itemId }, data: { discussion: dto.discussion } });
      await ctx.reviewChange(itemId, 'DISCUSSION');
      await minutesAudit(tx, organizationId, viewer.id, id, { agendaItemId: itemId, discussion: 'set' });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  async addDecision(id: string, itemId: string, dto: DecisionDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    const text = requireText(dto.text, 'MEETING_DECISION_TEXT_REQUIRED');
    await this.write(id, organizationId, viewer, now, 'minutes', async (tx, ctx) => {
      await lockAgendaItem(tx, id, itemId, organizationId);
      const votes = await checkVotes(tx, id, organizationId, dto);
      const last = await tx.meetingDecision.findFirst({ where: { organizationId, agendaItemId: itemId }, orderBy: { order: 'desc' }, select: { order: true } });
      const row = await tx.meetingDecision.create({
        data: { organizationId, meetingId: id, agendaItemId: itemId, order: (last?.order ?? 0) + 1, text, ...votes },
        select: { id: true },
      });
      await ctx.reviewChange(itemId, 'DECISION');
      await minutesAudit(tx, organizationId, viewer.id, id, { decisionId: row.id, created: true, votes });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  async updateDecision(
    id: string,
    itemId: string,
    decisionId: string,
    dto: DecisionDto,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<IMeetingMinutes> {
    const text = requireText(dto.text, 'MEETING_DECISION_TEXT_REQUIRED');
    await this.write(id, organizationId, viewer, now, 'minutes', async (tx, ctx) => {
      await lockAgendaItem(tx, id, itemId, organizationId);
      const existing = await tx.meetingDecision.findFirst({ where: { id: decisionId, organizationId, meetingId: id, agendaItemId: itemId }, select: { id: true } });
      if (!existing) throw new MeetingRefusal('MEETING_DECISION_NOT_FOUND');
      const votes = await checkVotes(tx, id, organizationId, dto);
      await tx.meetingDecision.update({ where: { id: decisionId }, data: { text, ...votes } });
      await ctx.reviewChange(itemId, 'DECISION');
      await minutesAudit(tx, organizationId, viewer.id, id, { decisionId, updated: true, votes });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  async removeDecision(id: string, itemId: string, decisionId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    await this.write(id, organizationId, viewer, now, 'minutes', async (tx, ctx) => {
      await lockAgendaItem(tx, id, itemId, organizationId);
      const removed = await tx.meetingDecision.deleteMany({ where: { id: decisionId, organizationId, meetingId: id, agendaItemId: itemId } });
      if (removed.count === 0) throw new MeetingRefusal('MEETING_DECISION_NOT_FOUND');
      await ctx.reviewChange(itemId, 'DECISION');
      await minutesAudit(tx, organizationId, viewer.id, id, { decisionId, removed: true });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  // ── Action items ────────────────────────────────────────────────────────────

  /** A draft action item: what, owner (a person in the organisation, never an outside guest) and a future due date. */
  async addActionItem(id: string, itemId: string, dto: CreateActionItemDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    const { title, dueAt } = actionItemFields(dto.title, dto.dueAt, now);
    await this.write(id, organizationId, viewer, now, 'actions', async (tx) => {
      await assertActionOwner(tx, dto.ownerUserId, organizationId);
      await lockAgendaItem(tx, id, itemId, organizationId);
      const row = await tx.meetingActionItem.create({
        data: { organizationId, meetingId: id, agendaItemId: itemId, title, ownerUserId: dto.ownerUserId, dueAt, createdById: viewer.id },
        select: { id: true },
      });
      await minutesAudit(tx, organizationId, viewer.id, id, { actionItemId: row.id, created: true, ownerUserId: dto.ownerUserId, dueAt });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  /** In Minutes Draft any field; in Minutes Review only the due date (`change_action_dates`), recorded as a review change. */
  async updateActionItem(
    id: string,
    actionId: string,
    dto: UpdateActionItemDto,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<IMeetingMinutes> {
    const onlyDate = dto.title === undefined && dto.ownerUserId === undefined;
    const title = dto.title === undefined ? undefined : requireText(dto.title, 'MEETING_ACTION_TITLE_REQUIRED');
    const dueAt = dto.dueAt === undefined ? undefined : futureDue(dto.dueAt, now);
    await this.write(id, organizationId, viewer, now, onlyDate ? 'actionDates' : 'actions', async (tx, ctx) => {
      if (dto.ownerUserId !== undefined) await assertActionOwner(tx, dto.ownerUserId, organizationId);
      const existing = await tx.meetingActionItem.findFirst({
        where: { id: actionId, organizationId, meetingId: id },
        select: { id: true, agendaItemId: true, taskId: true },
      });
      if (!existing || existing.taskId) throw new MeetingRefusal('MEETING_ACTION_NOT_FOUND');
      await lockAgendaItem(tx, id, existing.agendaItemId, organizationId);
      await tx.meetingActionItem.update({
        where: { id: actionId },
        data: { ...(title !== undefined && { title }), ...(dto.ownerUserId !== undefined && { ownerUserId: dto.ownerUserId }), ...(dueAt && { dueAt }) },
      });
      if (dueAt) await ctx.reviewChange(existing.agendaItemId, 'ACTION_DATE');
      await minutesAudit(tx, organizationId, viewer.id, id, { actionItemId: actionId, updated: true, ...(dueAt && { dueAt }) });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  async removeActionItem(id: string, actionId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    await this.write(id, organizationId, viewer, now, 'actions', async (tx) => {
      const removed = await tx.meetingActionItem.deleteMany({ where: { id: actionId, organizationId, meetingId: id, taskId: null } });
      if (removed.count === 0) throw new MeetingRefusal('MEETING_ACTION_NOT_FOUND');
      await minutesAudit(tx, organizationId, viewer.id, id, { actionItemId: actionId, removed: true });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  // ── An accepted AI draft (ACC-322) ──────────────────────────────────────────

  /**
   * ACC-322 — an accepted AI suggestion, as ONE minutes write: the same frame
   * as every write here (whoever records the minutes; the instance FOR SHARE,
   * the meeting row FOR UPDATE, then the agenda item), only where the stage
   * allows `record_minutes`, and ONE audit row naming `aiDraft`.
   *
   * `take(tx)` runs first under the meeting row's lock: it removes the
   * suggestion, and refuses when someone else decided it or Draft again
   * replaced it, so a suggestion is applied at most once.
   *
   * - **A minutes suggestion replaces each part it carries (M5)**: the
   *   discussion, and the item's decisions as a whole. Votes keep checkVotes()'s
   *   all-three-or-none rule and SKIP its total-versus-present refusal (M6):
   *   counts are copied as the notes state them, and Distribute's readiness
   *   check holds the minutes until they are corrected.
   * - **An action suggestion** passes the rules addActionItem() applies
   *   (actionItemFields(), assertActionOwner()): a title, an ACTIVE person as
   *   owner, a due date in the future. It becomes an ordinary draft action item.
   */
  async applyAiDraft(
    id: string,
    draft: AiDraftWrite,
    mark: AiDraftMark,
    take: (tx: EngineTx) => Promise<void>,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date = new Date(),
  ): Promise<IMeetingMinutes> {
    const action = draft.kind === 'ACTION_ITEM' ? { ...actionItemFields(draft.title, draft.dueAt, now), ownerUserId: draft.ownerUserId } : null;
    await this.write(id, organizationId, viewer, now, 'aiDraft', async (tx) => {
      await take(tx);
      if (draft.kind === 'ITEM_MINUTES') {
        await lockAgendaItem(tx, id, draft.agendaItemId, organizationId);
        if (draft.discussion !== null) await tx.agendaItem.update({ where: { id: draft.agendaItemId }, data: { discussion: draft.discussion } });
        let decisions = 0;
        if (draft.decisions.length > 0) {
          await tx.meetingDecision.deleteMany({ where: { organizationId, meetingId: id, agendaItemId: draft.agendaItemId } });
          for (const [i, d] of draft.decisions.entries()) {
            const votes = await checkVotes(
              tx,
              id,
              organizationId,
              { votesFor: d.votes?.for ?? null, votesAgainst: d.votes?.against ?? null, votesAbstain: d.votes?.abstain ?? null },
              { abovePresent: 'keep' },
            );
            await tx.meetingDecision.create({ data: { organizationId, meetingId: id, agendaItemId: draft.agendaItemId, order: i + 1, text: d.text, ...votes } });
          }
          decisions = draft.decisions.length;
        }
        await minutesAudit(tx, organizationId, viewer.id, id, {
          agendaItemId: draft.agendaItemId,
          ...(draft.discussion !== null && { discussion: 'set' }),
          ...(decisions > 0 && { decisions }),
          aiDraft: mark,
        });
        return;
      }
      await assertActionOwner(tx, action!.ownerUserId, organizationId);
      await lockAgendaItem(tx, id, draft.agendaItemId, organizationId);
      const row = await tx.meetingActionItem.create({
        data: { organizationId, meetingId: id, agendaItemId: draft.agendaItemId, title: action!.title, ownerUserId: action!.ownerUserId!, dueAt: action!.dueAt, createdById: viewer.id },
        select: { id: true },
      });
      await minutesAudit(tx, organizationId, viewer.id, id, { actionItemId: row.id, created: true, ownerUserId: action!.ownerUserId, dueAt: action!.dueAt, aiDraft: mark });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  // ── Open actions from the last meeting ──────────────────────────────────────

  /** A note on one of the last meeting's open actions, while the minutes are written. Empty removes it. */
  async setOpenActionNote(id: string, taskId: string, dto: OpenActionNoteDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingMinutes> {
    await this.write(id, organizationId, viewer, now, 'actions', async (tx) => {
      // Under the meeting row's lock: the list can't change between the check and the write.
      const open = await this.openActions(tx, id, organizationId);
      if (!open.some((a) => a.taskId === taskId)) throw new MeetingRefusal('MEETING_OPEN_ACTION_NOT_FOUND');
      if (dto.note === null) {
        await tx.meetingOpenActionNote.deleteMany({ where: { organizationId, meetingId: id, taskId } });
      } else {
        await tx.meetingOpenActionNote.upsert({
          where: { meetingId_taskId: { meetingId: id, taskId } },
          create: { organizationId, meetingId: id, taskId, note: dto.note, updatedById: viewer.id },
          update: { note: dto.note, updatedById: viewer.id },
        });
      }
      await minutesAudit(tx, organizationId, viewer.id, id, { openActionTaskId: taskId, note: dto.note === null ? 'removed' : 'set' });
    });
    return this.getMinutes(id, organizationId, viewer, now);
  }

  // ── One write's frame ───────────────────────────────────────────────────────

  /**
   * Every minutes write: the viewer sees the meeting and records it, then ONE
   * transaction takes the instance FOR SHARE (the stage's rules), then the
   * meeting row FOR UPDATE, and runs the write. `reviewChange()` records what a
   * write in Minutes Review changed (and nothing in Minutes Draft).
   */
  private async write(
    id: string,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date,
    need: MinutesNeed,
    body: (tx: EngineTx, ctx: { reviewChange(agendaItemId: string | null, what: ReviewChange): Promise<void> }) => Promise<void>,
  ): Promise<void> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    if (!(await this.isRecorder(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_RECORDER');
    await this.prisma
      .$transaction(async (tx) => {
        const rules = await this.stageRules.currentStageRules('MEETING', id, organizationId, tx, { lock: 'share' });
        const reviewing = assertWriteAllowed(rules, need);
        await lockMeetingRow(tx, id, organizationId);
        const round = reviewing ? ((await tx.meeting.findFirst({ where: { id, organizationId }, select: { reviewRound: true } }))?.reviewRound ?? 0) : 0;
        await body(tx, {
          reviewChange: async (agendaItemId, what) => {
            if (!reviewing) return;
            await tx.meetingReviewChange.create({ data: { organizationId, meetingId: id, round, agendaItemId, what, actorId: viewer.id } });
          },
        });
      })
      .catch((error: unknown) => asMeetingConflict(error));
  }
}

/**
 * Whether the stage allows this write, and whether it is a review write: in
 * Minutes Draft (`record_minutes`) everything; in Minutes Review the minutes
 * and decisions under `apply_suggestions`, an action's due date under
 * `change_action_dates`. Refuses with the stage's own 409, naming the action.
 */
function assertWriteAllowed(rules: StageRules, need: MinutesNeed): boolean {
  const allows = (action: string) => rules.actions[action] === true;
  const refuse = (action: string): never => {
    throw new WorkflowRefusalException('STAGE_ACTION_NOT_ALLOWED', { action, stageNameEn: rules.stageNameEn, stageNameAr: rules.stageNameAr });
  };
  if (need === 'attendance') return allows(MEETING_ACTIONS.RECORD_ATTENDANCE) ? false : refuse(MEETING_ACTIONS.RECORD_ATTENDANCE);
  if (need === 'aiDraft') return allows(MEETING_ACTIONS.RECORD_MINUTES) ? false : refuse(MEETING_ACTIONS.RECORD_MINUTES);
  if (allows(MEETING_ACTIONS.RECORD_MINUTES)) return false;
  if (need === 'minutes' && allows(MEETING_ACTIONS.APPLY_SUGGESTIONS)) return true;
  if (need === 'actionDates' && allows(MEETING_ACTIONS.CHANGE_ACTION_DATES)) return true;
  return refuse(need === 'actionDates' ? MEETING_ACTIONS.CHANGE_ACTION_DATES : MEETING_ACTIONS.RECORD_MINUTES);
}

/** The agenda item FOR UPDATE, after the meeting row: the last of the lock order. */
async function lockAgendaItem(tx: EngineTx, meetingId: string, itemId: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "AgendaItem" WHERE id = ${itemId} AND "meetingId" = ${meetingId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new MeetingRefusal('MEETING_AGENDA_ITEM_NOT_FOUND');
}

/**
 * The vote check (plan §3.5): all three counts or none, and their sum no more
 * than the MEMBERS recorded present. Read under the meeting row's lock, so an
 * attendance change cannot slip between the count and the write.
 *
 * ACC-322 (M6) — an accepted AI draft passes `abovePresent: 'keep'`: the
 * all-three-or-none rule still holds, the total-versus-present refusal is
 * skipped (counts are copied as the notes state them), and Distribute's
 * readiness check holds the minutes until they are corrected. The only caller
 * that passes it is applyAiDraft().
 */
async function checkVotes(
  tx: EngineTx,
  meetingId: string,
  organizationId: string,
  dto: Pick<DecisionDto, 'votesFor' | 'votesAgainst' | 'votesAbstain'>,
  options: { abovePresent: 'refuse' | 'keep' } = { abovePresent: 'refuse' },
): Promise<{ votesFor: number | null; votesAgainst: number | null; votesAbstain: number | null }> {
  const counts = [dto.votesFor, dto.votesAgainst, dto.votesAbstain];
  const given = counts.filter((c) => c !== undefined && c !== null);
  if (given.length === 0) return { votesFor: null, votesAgainst: null, votesAbstain: null };
  if (given.length !== 3) throw new MeetingRefusal('MEETING_VOTES_PARTIAL');
  if (options.abovePresent === 'keep') return { votesFor: dto.votesFor!, votesAgainst: dto.votesAgainst!, votesAbstain: dto.votesAbstain! };
  const present = await tx.meetingAttendee.count({ where: { organizationId, meetingId, kind: 'MEMBER', attendance: 'PRESENT' } });
  const total = dto.votesFor! + dto.votesAgainst! + dto.votesAbstain!;
  if (total > present) throw new MeetingRefusal('MEETING_VOTES_EXCEED_PRESENT', { present, total });
  return { votesFor: dto.votesFor!, votesAgainst: dto.votesAgainst!, votesAbstain: dto.votesAbstain! };
}

function requireText(text: string | null | undefined, code: 'MEETING_DECISION_TEXT_REQUIRED' | 'MEETING_ACTION_TITLE_REQUIRED'): string {
  if (!text) throw new MeetingRefusal(code);
  return text;
}

/** An action item's due date: an instant in the future. */
function futureDue(dueAt: string | null | undefined, now: Date): Date {
  const at = new Date(dueAt ?? NaN);
  if (Number.isNaN(at.getTime()) || at <= now) throw new MeetingRefusal('MEETING_ACTION_DUE_IN_PAST');
  return at;
}

/**
 * ACC-322 — THE action-item rules, which addActionItem() and an accepted AI
 * action both apply: a title, and a due date in the future. The owner, who
 * must be an ACTIVE person in the organisation, is assertActionOwner(), read
 * inside the write's transaction.
 */
export function actionItemFields(title: string | null | undefined, dueAt: string | null | undefined, now: Date): { title: string; dueAt: Date } {
  return { title: requireText(title, 'MEETING_ACTION_TITLE_REQUIRED'), dueAt: futureDue(dueAt, now) };
}

/** An action item's owner: a person in the organisation, ACTIVE, never an outside guest (who is no user). */
export async function assertActionOwner(tx: Pick<EngineTx, 'user'>, userId: string | null | undefined, organizationId: string): Promise<void> {
  const owner = userId ? await tx.user.findFirst({ where: { id: userId, organizationId, status: 'ACTIVE' }, select: { id: true } }) : null;
  if (!owner) throw new MeetingRefusal('MEETING_PERSON_NOT_FOUND');
}

/** ACC-322 (M2) — the undecided AI minutes and action suggestions on a meeting. */
export function countUndecidedMinutesAi(client: Pick<PrismaService, 'meetingAiSuggestion'>, meetingId: string, organizationId: string): Promise<number> {
  return client.meetingAiSuggestion.count({ where: { organizationId, meetingId, kind: { in: ['ITEM_MINUTES', 'ACTION_ITEM'] } } });
}

/**
 * ONE Meeting audit row per minutes write (plan §6a): fields and ids, never
 * the text. ACC-322: an accepted AI draft adds `aiDraft: { kind,
 * interactionId }`, proved by construction (the suggestion row was written by
 * our code from a charged call); the history reads it.
 */
export async function minutesAudit(
  tx: Pick<EngineTx, 'auditLog'>,
  organizationId: string,
  actorId: string,
  meetingId: string,
  after: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: { organizationId, actorId, action: 'UPDATE', objectType: 'Meeting', objectId: meetingId, after: { minutes: after } as never },
  });
}

/**
 * PR 7d-1 — the seat the approver held on the committee when the minutes were
 * approved, read from the membership ledger: the newest event recorded at or
 * before approval (a LEFT event means no seat).
 *
 * - **`createdAt`, not `effectiveDate`:** the ledger is read by when a change was
 *   RECORDED, because `effectiveDate` may be back- or forward-dated (an add can
 *   name a past or future start), and what the record said at approval is what
 *   was recorded by then.
 * - **Ties** (two events recorded in the same millisecond) are broken by id,
 *   descending, so the answer is the same on every read.
 * - **No event that early** (a membership older than the ledger): their current
 *   seat. That can name a seat they have since left, the best the record has.
 *
 * Null when neither exists: the approval line then names them without a seat.
 * Organisation-scoped throughout; at most three indexed reads, and only for
 * approved minutes.
 */
export async function approverSeatAt(
  prisma: PrismaService,
  organizationId: string,
  committeeId: string,
  userId: string,
  approvedAt: Date,
): Promise<{ id: string; labelEn: string; labelAr: string | null } | null> {
  const event = await prisma.committeeMembershipEvent.findFirst({
    where: { organizationId, committeeId, userId, createdAt: { lte: approvedAt } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { action: true, roleValueId: true },
  });
  let seatId: string | null;
  if (event) seatId = event.action === 'LEFT' ? null : event.roleValueId;
  else {
    const member = await prisma.committeeMember.findFirst({ where: { organizationId, committeeId, userId }, select: { roleValueId: true } });
    seatId = member?.roleValueId ?? null;
  }
  if (!seatId) return null;
  return prisma.lookupValue.findFirst({
    where: { id: seatId, OR: [{ organizationId }, { organizationId: null }] },
    select: { id: true, labelEn: true, labelAr: true },
  });
}
