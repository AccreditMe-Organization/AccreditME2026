import type { EngineTx } from '../workflow/workflow.service';
import { peopleDateIn } from '../task/task-sla.service';
import { Logger } from '@nestjs/common';
import { STAGE_FLAG } from '../workflow/record-registry';
import type { AnyTransitionEffect, TransitionEffectContext, TransitionEffectDeps } from '../workflow/transition-effect.types';
import { transitionEffect } from '../workflow/transition-effect.types';

/**
 * ACC-316 PR 3a — what entering a meeting's stages does (TRANSITION_EFFECTS,
 * plan step-316 §3.8.1 and §3.9). Notices are written in English and Arabic
 * and link the meeting. The invitation names the meeting's date and time,
 * absolute, in the organisation's zone (the working calendar's), with Latin
 * digits: peopleDateIn(), the helper the task reminders use.
 *
 * Invitees arrive in PR 3b; until then a meeting has none, so these send
 * nothing on a real record. The outside guests' emails are PR 3b's too.
 */

const logger = new Logger('MeetingEffects');

/**
 * What a meeting effect hands to finish(): read inside the move's transaction,
 * under the instance's lock, so it is the meeting and its attendees as they
 * stand when the move commits. Null until apply() has run.
 */
interface Invited {
  title: string;
  startsAt: Date | null;
  /** The users to tell. */
  userIds: string[];
}

async function meetingOf(tx: EngineTx, ctx: TransitionEffectContext): Promise<{ title: string; startsAt: Date | null }> {
  const meeting = await tx.meeting.findFirst({
    where: { id: ctx.objectId, organizationId: ctx.organizationId },
    select: { title: true, scheduledAt: true },
  });
  return { title: meeting?.title ?? '', startsAt: meeting?.scheduledAt ?? null };
}

async function notifyAll(
  deps: TransitionEffectDeps,
  ctx: TransitionEffectContext,
  userIds: readonly string[],
  text: { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string },
): Promise<void> {
  // One by one, each on its own: a notice that fails is logged and the rest
  // still go (MeetingsService.tellInvited does the same).
  for (const userId of userIds) {
    if (userId === ctx.actorId) continue;
    try {
      await deps.notifications.create(
        { userId, ...text, channel: 'BOTH', objectType: 'MEETING', objectId: ctx.objectId },
        ctx.organizationId,
      );
    } catch (error) {
      logger.warn(
        `A meeting notice failed for meeting ${ctx.objectId} in org ${ctx.organizationId}: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }
}

/**
 * The agenda is issued: EVERY attendee with a user and no `invitedAt`, as the
 * rows stand inside the move's transaction, is stamped and told after it
 * commits. Not the rows prepare() could read before the lock: someone added in
 * between would never be invited. (PR 3b: adding an invitee takes the
 * meeting's instance FOR SHARE first, so it waits for this move or follows it.)
 */
const agendaIssued = transitionEffect<Invited | null>({
  key: 'meeting.agenda_issued',
  flag: STAGE_FLAG.AGENDA_ISSUED,
  async prepare() {
    return null;
  },
  async apply(tx, ctx) {
    const [meeting, stamped] = await Promise.all([
      meetingOf(tx, ctx),
      tx.meetingAttendee.updateManyAndReturn({
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, userId: { not: null }, invitedAt: null },
        data: { invitedAt: new Date() },
        select: { userId: true },
      }),
    ]);
    return { ...meeting, userIds: stamped.map((r) => r.userId!) };
  },
  async finish(deps, ctx, prepared) {
    if (!prepared || prepared.userIds.length === 0) return;
    const when = prepared.startsAt ? peopleDateIn(prepared.startsAt, await deps.calendar.getEffectiveTimeZone(ctx.organizationId)) : null;
    await notifyAll(deps, ctx, prepared.userIds, {
      titleEn: 'Meeting invitation',
      titleAr: 'دعوة إلى اجتماع',
      bodyEn: `You're invited to ${prepared.title}${when ? ` on ${when.en}` : ''}. The agenda is issued.`,
      bodyAr: `دعوة إلى ${prepared.title}${when ? ` في ${when.ar}` : ''}. صدرت الأجندة.`,
    });
  },
});

/** The meeting is cancelled: everyone invited when the move commits is told, with the reason. */
const cancelled = transitionEffect<Invited | null>({
  key: 'meeting.cancelled',
  flag: STAGE_FLAG.MEETING_CANCELLED,
  async prepare() {
    return null;
  },
  async apply(tx, ctx) {
    const [meeting, rows] = await Promise.all([
      meetingOf(tx, ctx),
      tx.meetingAttendee.findMany({
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, userId: { not: null }, invitedAt: { not: null } },
        select: { userId: true },
      }),
    ]);
    return { ...meeting, userIds: rows.map((r) => r.userId!) };
  },
  async finish(deps, ctx, prepared) {
    if (!prepared) return;
    const reason = ctx.comment?.trim() ?? '';
    await notifyAll(deps, ctx, prepared.userIds, {
      titleEn: 'Meeting cancelled',
      titleAr: 'إلغاء اجتماع',
      bodyEn: `${prepared.title} is cancelled. Reason: ${reason}`,
      bodyAr: `أُلغي ${prepared.title}. السبب: ${reason}`,
    });
  },
});

export const MEETING_TRANSITION_EFFECTS: readonly AnyTransitionEffect[] = [agendaIssued, cancelled];
