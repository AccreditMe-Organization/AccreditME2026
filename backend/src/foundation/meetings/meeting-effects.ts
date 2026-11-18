import type { PrismaService } from '../../prisma/prisma.service';
import { STAGE_FLAG } from '../workflow/record-registry';
import type { AnyTransitionEffect, TransitionEffectContext, TransitionEffectDeps } from '../workflow/transition-effect.types';
import { transitionEffect } from '../workflow/transition-effect.types';

/**
 * ACC-316 PR 3a — what entering a meeting's stages does (TRANSITION_EFFECTS,
 * plan step-316 §3.8.1 and §3.9). Notices are written in English and Arabic,
 * carry no count (ACC-95's helper does not exist), and link the meeting.
 *
 * Invitees arrive in PR 3b; until then a meeting has none, so these send
 * nothing on a real record. The outside guests' emails are PR 3b's too.
 */

interface Invited {
  title: string;
  /** Attendee rows with a user, and their users. */
  attendeeIds: string[];
  userIds: string[];
}

async function meetingTitle(prisma: PrismaService, ctx: TransitionEffectContext): Promise<string> {
  const meeting = await prisma.meeting.findFirst({ where: { id: ctx.objectId, organizationId: ctx.organizationId }, select: { title: true } });
  return meeting?.title ?? '';
}

async function notifyAll(
  deps: TransitionEffectDeps,
  ctx: TransitionEffectContext,
  userIds: readonly string[],
  text: { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string },
): Promise<void> {
  for (const userId of userIds) {
    if (userId === ctx.actorId) continue;
    await deps.notifications.create(
      { userId, ...text, channel: 'BOTH', objectType: 'MEETING', objectId: ctx.objectId },
      ctx.organizationId,
    );
  }
}

/**
 * The agenda is issued: every invitee with a user who has not been invited yet
 * is stamped `invitedAt`, inside the move, and told after it commits.
 */
const agendaIssued = transitionEffect<Invited>({
  key: 'meeting.agenda_issued',
  flag: STAGE_FLAG.AGENDA_ISSUED,
  async prepare(prisma, ctx) {
    const [title, rows] = await Promise.all([
      meetingTitle(prisma, ctx),
      prisma.meetingAttendee.findMany({
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, userId: { not: null }, invitedAt: null },
        select: { id: true, userId: true },
      }),
    ]);
    return { title, attendeeIds: rows.map((r) => r.id), userIds: rows.map((r) => r.userId!) };
  },
  async apply(tx, ctx, prepared) {
    if (prepared.attendeeIds.length === 0) return;
    await tx.meetingAttendee.updateMany({
      where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, id: { in: prepared.attendeeIds }, invitedAt: null },
      data: { invitedAt: new Date() },
    });
  },
  async finish(deps, ctx, prepared) {
    await notifyAll(deps, ctx, prepared.userIds, {
      titleEn: 'Meeting invitation',
      titleAr: 'دعوة إلى اجتماع',
      bodyEn: `You're invited to ${prepared.title}. The agenda is issued.`,
      bodyAr: `دعوة إلى ${prepared.title}. صدرت الأجندة.`,
    });
  },
});

/** The meeting is cancelled: everyone already invited is told, with the reason. */
const cancelled = transitionEffect<Invited>({
  key: 'meeting.cancelled',
  flag: STAGE_FLAG.MEETING_CANCELLED,
  async prepare(prisma, ctx) {
    const [title, rows] = await Promise.all([
      meetingTitle(prisma, ctx),
      prisma.meetingAttendee.findMany({
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, userId: { not: null }, invitedAt: { not: null } },
        select: { id: true, userId: true },
      }),
    ]);
    return { title, attendeeIds: rows.map((r) => r.id), userIds: rows.map((r) => r.userId!) };
  },
  async finish(deps, ctx, prepared) {
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
