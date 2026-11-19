import type { EngineTx } from '../workflow/workflow.service';
import { peopleDateIn } from '../task/task-sla.service';
import { STAGE_FLAG } from '../workflow/record-registry';
import type { AnyTransitionEffect, TransitionEffectContext } from '../workflow/transition-effect.types';
import { transitionEffect } from '../workflow/transition-effect.types';
import { cancelledNotice, invitationNotice, outsideCancelledEmail, outsideInvitationEmail } from './meeting-notices';
import { emailOutsideGuests, notifyUsers, organisationNames, type OrganisationNames } from './meeting-send';

/**
 * ACC-316 — what entering a meeting's stages does (TRANSITION_EFFECTS, plan
 * step-316 §3.8.1 and §3.9). The words are meeting-notices.ts's; the sends are
 * meeting-send.ts's, each on its own (a failure is logged and the rest go).
 *
 *   Agenda Issued  every attendee not yet invited is stamped invitedAt; users
 *                  get the invitation in the app and by email, outside guests
 *                  by email in the organisation's language (PR 3b).
 *   Cancelled      everyone invited is told, with the reason; outside guests
 *                  by email, only if they were invited.
 *
 * The invitation names the meeting's date and time, absolute, in the
 * organisation's zone (the working calendar's), with Latin digits:
 * peopleDateIn(). The actor is never told.
 */

/**
 * What a meeting effect hands to finish(): read inside the move's transaction,
 * under the instance's lock, so it is the meeting and its attendees as they
 * stand when the move commits. Null until apply() has run.
 */
interface Invited {
  title: string;
  startsAt: Date | null;
  location: string | null;
  meetingUrl: string | null;
  organisation: OrganisationNames;
  /** The users to tell. */
  userIds: string[];
  /** The outside guests to email. */
  outsideEmails: string[];
}

type Meeting = Omit<Invited, 'userIds' | 'outsideEmails'>;

async function meetingOf(tx: EngineTx, ctx: TransitionEffectContext): Promise<Meeting> {
  const [meeting, organization] = await Promise.all([
    tx.meeting.findFirst({
      where: { id: ctx.objectId, organizationId: ctx.organizationId },
      select: { title: true, scheduledAt: true, location: true, meetingUrl: true },
    }),
    tx.organization.findFirst({ where: { id: ctx.organizationId }, select: { name: true, nameAr: true } }),
  ]);
  return {
    title: meeting?.title ?? '',
    startsAt: meeting?.scheduledAt ?? null,
    location: meeting?.location ?? null,
    meetingUrl: meeting?.meetingUrl ?? null,
    organisation: organisationNames(organization),
  };
}

/** Attendee rows split into the users to tell and the outside guests to email. */
function split(rows: readonly { userId: string | null; kind: string; outsideEmail: string | null }[]): Pick<Invited, 'userIds' | 'outsideEmails'> {
  return {
    userIds: rows.filter((r) => r.userId).map((r) => r.userId!),
    outsideEmails: rows.filter((r) => r.kind === 'OUTSIDE_GUEST' && r.outsideEmail).map((r) => r.outsideEmail!),
  };
}

/**
 * The agenda is issued: EVERY attendee with no `invitedAt` (a user or an
 * outside guest), as the rows stand inside the move's transaction, is stamped
 * and told after it commits. Not the rows prepare() could read before the
 * lock: someone added in between would never be invited. Adding an invitee
 * takes the meeting's instance FOR SHARE first, so it waits for this move or
 * follows it (and is invited at once, being added in Agenda Issued).
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
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, invitedAt: null },
        data: { invitedAt: new Date() },
        select: { userId: true, kind: true, outsideEmail: true },
      }),
    ]);
    return { ...meeting, ...split(stamped) };
  },
  async finish(deps, ctx, prepared) {
    if (!prepared || prepared.userIds.length + prepared.outsideEmails.length === 0) return;
    const when = prepared.startsAt ? peopleDateIn(prepared.startsAt, await deps.calendar.getEffectiveTimeZone(ctx.organizationId)) : null;
    await notifyUsers(deps.notifications, ctx.organizationId, ctx.objectId, ctx.actorId, prepared.userIds, invitationNotice(prepared.title, when));
    if (when && prepared.outsideEmails.length > 0) {
      await emailOutsideGuests(
        deps.notifications,
        ctx.organizationId,
        ctx.objectId,
        prepared.outsideEmails,
        outsideInvitationEmail(prepared.title, prepared.organisation, when, prepared),
      );
    }
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
        where: { organizationId: ctx.organizationId, meetingId: ctx.objectId, invitedAt: { not: null } },
        select: { userId: true, kind: true, outsideEmail: true },
      }),
    ]);
    return { ...meeting, ...split(rows) };
  },
  async finish(deps, ctx, prepared) {
    if (!prepared) return;
    const reason = ctx.comment?.trim() ?? '';
    await notifyUsers(deps.notifications, ctx.organizationId, ctx.objectId, ctx.actorId, prepared.userIds, cancelledNotice(prepared.title, reason));
    await emailOutsideGuests(
      deps.notifications,
      ctx.organizationId,
      ctx.objectId,
      prepared.outsideEmails,
      outsideCancelledEmail(prepared.title, prepared.organisation, reason),
    );
  },
});

export const MEETING_TRANSITION_EFFECTS: readonly AnyTransitionEffect[] = [agendaIssued, cancelled];
