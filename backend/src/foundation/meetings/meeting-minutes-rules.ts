import { DateTime } from 'luxon';
import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import type { StageRules } from '../workflow/stage-rules.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import type { PreconditionServices, TransitionPreconditionContext } from '../workflow/transition-preconditions';

/**
 * ACC-316 PR 4 — THE MINUTES' RULES, in one place (plan step-316 §3.5–§3.8.3):
 * which phase the minutes are in, the quorum line, whether attendance is
 * complete, the review's state, and what holds Approve Minutes. The minutes
 * service, the review service, the reminder sweep and the engine's
 * precondition (TRANSITION_PRECONDITIONS MEETING) all ask these, never a copy.
 *
 * Every phase is read from the stage's RULES (its record actions and flags),
 * never a stage key or name (ACC-255), so a tenant's renamed stage keeps it.
 */

export type MinutesPhase = 'draft' | 'review' | 'approved';

/**
 * The phase of the minutes at this stage, or null before they exist (Planned,
 * Agenda Issued) and when the meeting is cancelled:
 *   approved  the stage is flagged MINUTES_FINAL;
 *   review    it allows suggesting or applying corrections;
 *   draft     it allows recording the minutes, or the attendance (Agenda
 *             Issued, from the start time: the meeting is under way).
 */
export function minutesPhase(rules: Pick<StageRules, 'flags' | 'actions'>): MinutesPhase | null {
  if (rules.flags.includes(STAGE_FLAG.MINUTES_FINAL)) return 'approved';
  if (rules.actions[MEETING_ACTIONS.SUGGEST_CORRECTION] || rules.actions[MEETING_ACTIONS.APPLY_SUGGESTIONS]) return 'review';
  if (rules.actions[MEETING_ACTIONS.RECORD_MINUTES] || rules.actions[MEETING_ACTIONS.RECORD_ATTENDANCE]) return 'draft';
  return null;
}

/** "The date has passed" for a review date (a day, stored as its UTC midnight), in the organisation's zone. */
export function reviewDatePassed(reviewBy: Date | null, zone: string, now: Date): boolean {
  if (!reviewBy) return false;
  const today = DateTime.fromJSDate(now).setZone(zone).toISODate()!;
  return today > reviewBy.toISOString().slice(0, 10);
}

/** A day (yyyy-MM-dd) as the DateTime a date-only column holds: its UTC midnight. */
export function dayAsDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

type Reader = Pick<PrismaService, '$queryRaw'>;

/** The quorum line: present MEMBERS against the quorum frozen at attendance (else the live one). */
export interface QuorumLine {
  quorum: number | null;
  presentMembers: number;
  /** Null when there is no quorum to meet. */
  met: boolean | null;
}

export function quorumLine(quorum: number | null, presentMembers: number): QuorumLine {
  return { quorum, presentMembers, met: quorum === null ? null : presentMembers >= quorum };
}

/**
 * Whose attendance is still unrecorded: every MEMBER and organisation guest
 * (plan §3.8.3). An outside guest's attendance may be recorded and is never
 * required. Distribute Minutes waits for this list to be empty.
 */
export async function unrecordedAttendance(client: Reader, meetingId: string, organizationId: string): Promise<{ attendeeId: string; name: string }[]> {
  return client.$queryRaw<{ attendeeId: string; name: string }[]>`
    SELECT a.id AS "attendeeId", COALESCE(u.name, '') AS name
    FROM "MeetingAttendee" a
    LEFT JOIN "User" u ON u.id = a."userId" AND u."organizationId" = ${organizationId}
    WHERE a."organizationId" = ${organizationId} AND a."meetingId" = ${meetingId}
      AND a.kind IN ('MEMBER', 'ORG_GUEST') AND a.attendance IS NULL
    ORDER BY u.name, a.id`;
}

/** One reviewer's state in a round: a PRESENT member, and whether they answered (No corrections, or a suggestion). */
export interface Reviewer {
  userId: string;
  name: string;
  answered: boolean;
}

/**
 * The reviewers of a round: the MEMBERS recorded PRESENT, the Chair included
 * (R3-5); guests never review. A member answered with "No corrections" or by
 * suggesting a correction in the round.
 */
export async function reviewers(client: Reader, meetingId: string, organizationId: string, round: number): Promise<Reviewer[]> {
  return client.$queryRaw<Reviewer[]>`
    SELECT a."userId", COALESCE(u.name, '') AS name,
      (EXISTS (SELECT 1 FROM "MeetingReviewAnswer" r
               WHERE r."organizationId" = ${organizationId} AND r."meetingId" = ${meetingId} AND r.round = ${round} AND r."userId" = a."userId")
       OR EXISTS (SELECT 1 FROM "MeetingSuggestion" s
               WHERE s."organizationId" = ${organizationId} AND s."meetingId" = ${meetingId} AND s.round = ${round} AND s."authorId" = a."userId")
      ) AS answered
    FROM "MeetingAttendee" a
    JOIN "User" u ON u.id = a."userId" AND u."organizationId" = ${organizationId}
    WHERE a."organizationId" = ${organizationId} AND a."meetingId" = ${meetingId}
      AND a.kind = 'MEMBER' AND a.attendance = 'PRESENT' AND a."userId" IS NOT NULL
    ORDER BY u.name, a."userId"`;
}

/** The review has closed: its date has passed, or every reviewer answered. */
export function reviewClosed(people: readonly Reviewer[], reviewBy: Date | null, zone: string, now: Date): boolean {
  return reviewDatePassed(reviewBy, zone, now) || people.every((p) => p.answered);
}

/** The action items still drafts (no task yet), in agenda order: what approval turns into tasks. */
export async function draftActionItems(
  client: Reader,
  meetingId: string,
  organizationId: string,
): Promise<{ id: string; title: string; ownerUserId: string; ownerStatus: string; dueAt: Date; agendaItemOrder: number }[]> {
  return client.$queryRaw<{ id: string; title: string; ownerUserId: string; ownerStatus: string; dueAt: Date; agendaItemOrder: number }[]>`
    SELECT ai.id, ai.title, ai."ownerUserId", u.status::text AS "ownerStatus", ai."dueAt", i."order" AS "agendaItemOrder"
    FROM "MeetingActionItem" ai
    JOIN "AgendaItem" i ON i.id = ai."agendaItemId" AND i."organizationId" = ${organizationId}
    JOIN "User" u ON u.id = ai."ownerUserId" AND u."organizationId" = ${organizationId}
    WHERE ai."organizationId" = ${organizationId} AND ai."meetingId" = ${meetingId} AND ai."taskId" IS NULL
    ORDER BY i."order", ai."createdAt", ai.id`;
}

/** The priority an action item's task takes; its SLA limit is counted from approval (ACC-174, plan §3.7). */
export const ACTION_ITEM_PRIORITY = 'MEDIUM' as const;

/**
 * What holds Approve Minutes now, in the order a Secretary fixes it, or null.
 * Read-only: the engine runs it as the MEETING precondition (FOR SHARE on the
 * meeting row inside the move's transaction) and, without the lock, for the
 * moves list's "Why?". (plan §3.8.3)
 */
export async function minutesApprovalBlocks(
  client: Reader,
  meetingId: string,
  organizationId: string,
  services: PreconditionServices,
  lock: 'share' | 'none',
): Promise<{ code: string; details: Record<string, unknown> } | null> {
  const lockClause = lock === 'share' ? Prisma.sql`FOR SHARE` : Prisma.empty;
  const rows = await client.$queryRaw<{ reviewRound: number; reviewBy: Date | null }[]>`
    SELECT "reviewRound", "reviewBy" FROM "Meeting" WHERE id = ${meetingId} AND "organizationId" = ${organizationId} ${lockClause}`;
  const meeting = rows[0];
  if (!meeting) return null;
  const now = services.now();

  if (meeting.reviewRound > 0) {
    const [people, zone] = await Promise.all([reviewers(client, meetingId, organizationId, meeting.reviewRound), services.timeZone(organizationId)]);
    if (!reviewClosed(people, meeting.reviewBy, zone, now)) {
      return {
        code: 'MEETING_REVIEW_OPEN',
        details: {
          reviewBy: meeting.reviewBy?.toISOString().slice(0, 10) ?? null,
          waitingFor: people.filter((p) => !p.answered).map((p) => ({ userId: p.userId, name: p.name })),
        },
      };
    }
  }

  const open = await client.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM "MeetingSuggestion"
    WHERE "organizationId" = ${organizationId} AND "meetingId" = ${meetingId} AND status = 'OPEN'`;
  if ((open[0]?.count ?? 0) > 0) return { code: 'MEETING_SUGGESTION_OPEN', details: { open: open[0]!.count } };

  const drafts = await draftActionItems(client, meetingId, organizationId);
  const name = (d: (typeof drafts)[number]) => ({ id: d.id, title: d.title, agendaItemOrder: d.agendaItemOrder, dueAt: d.dueAt });
  const pastDue = drafts.filter((d) => d.dueAt <= now);
  if (pastDue.length > 0) return { code: 'MEETING_ACTION_PAST_DUE', details: { items: pastDue.map(name) } };

  if (drafts.length > 0) {
    const limit = await services.taskLimitFrom(now, ACTION_ITEM_PRIORITY, organizationId);
    const late = drafts.filter((d) => d.dueAt > limit);
    if (late.length > 0) return { code: 'MEETING_ACTION_PAST_SLA_LIMIT', details: { items: late.map(name), limit } };
  }
  return null;
}

/**
 * TRANSITION_PRECONDITIONS MEETING: a move that ENTERS MINUTES_FINAL (Approve
 * Minutes) is refused while minutesApprovalBlocks() names anything. Any other
 * move passes: Distribute's attendance check is its own endpoint's (Minutes
 * Draft carries no flag to key a precondition on, and ACC-255 retired keys).
 */
export async function meetingMinutesFinalPrecondition(
  client: Reader,
  ctx: TransitionPreconditionContext,
  services?: PreconditionServices,
): Promise<void> {
  const entersFinal = ctx.toStageFlags.includes(STAGE_FLAG.MINUTES_FINAL) && !ctx.fromStageFlags.includes(STAGE_FLAG.MINUTES_FINAL);
  if (!entersFinal) return;
  if (!services) throw new Error('The meeting precondition needs the engine services.');
  const blocked = await minutesApprovalBlocks(client, ctx.objectId, ctx.organizationId, services, ctx.readOnly ? 'none' : 'share');
  if (blocked) throw new WorkflowRefusalException(blocked.code as MeetingApprovalRefusal, blocked.details);
}

export type MeetingApprovalRefusal = 'MEETING_REVIEW_OPEN' | 'MEETING_SUGGESTION_OPEN' | 'MEETING_ACTION_PAST_DUE' | 'MEETING_ACTION_PAST_SLA_LIMIT';

/** Distribute Minutes' review date when none is chosen: this many working days after today. */
export const REVIEW_WORKING_DAYS = 5;

/**
 * Today in the organisation's zone, and the default review date (yyyy-MM-dd,
 * REVIEW_WORKING_DAYS working days ahead). The one home of the default: the
 * Distribute move uses it when no date is sent, and the minutes read offers it
 * to the screen, which does no working-day arithmetic of its own.
 */
export async function reviewDayDefaults(
  calendar: { getEffectiveTimeZone(organizationId: string): Promise<string>; addWorkingDays(from: string, days: number, organizationId: string): Promise<string> },
  organizationId: string,
  now: Date,
): Promise<{ today: string; defaultDay: string }> {
  const today = DateTime.fromJSDate(now).setZone(await calendar.getEffectiveTimeZone(organizationId)).toISODate()!;
  return { today, defaultDay: await calendar.addWorkingDays(today, REVIEW_WORKING_DAYS, organizationId) };
}
