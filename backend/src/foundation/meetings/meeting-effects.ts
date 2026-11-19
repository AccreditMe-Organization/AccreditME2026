import { Logger } from '@nestjs/common';
import type { EngineTx } from '../workflow/workflow.service';
import { peopleDateIn } from '../task/task-sla.service';
import { STAGE_FLAG } from '../workflow/record-registry';
import type { AnyTransitionEffect, TransitionEffectContext } from '../workflow/transition-effect.types';
import { transitionEffect } from '../workflow/transition-effect.types';
import { cancelledNotice, invitationNotice, outsideCancelledEmail, outsideInvitationEmail } from './meeting-notices';
import { emailOutsideGuests, notifyUsers, organisationNames, type OrganisationNames } from './meeting-send';
import type { ITask } from '../task/interfaces/task.interface';
import type { PreparedTask } from '../task/task.service';
import { ACTION_ITEM_PRIORITY, draftActionItems } from './meeting-minutes-rules';
import { lockMeetingRow } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';

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
 *   Minutes        (PR 4) every action item still a draft becomes a task, its
 *   Approved       owner the only assignee, due when the draft says; the
 *                  meeting is stamped approved. The move's own transaction:
 *                  approval and tasks commit together or not at all.
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

/** What MINUTES_FINAL prepared: a task per draft action item, and (after apply) what was inserted. */
interface Approval {
  drafts: { id: string; ownerUserId: string; ownerStatus: string; dueAt: Date; title: string; prepared: PreparedTask }[];
  created: { task: ITask; prepared: PreparedTask }[];
}

/** The draft's fields a task is built from, as one comparable string. */
const draftKey = (d: { id: string; ownerUserId: string; ownerStatus: string; dueAt: Date; title: string }) =>
  `${d.id} ${d.ownerUserId} ${d.ownerStatus} ${d.dueAt.toISOString()} ${d.title}`;

const logger = new Logger('MeetingEffects');

/**
 * ACC-316 PR 4 — the minutes are approved (plan §3.7, §3.8.1). prepare() builds
 * a task per draft action item before the transaction (TaskService's own
 * record-task path: the owner the only assignee, MEDIUM, due when the draft
 * says); apply() locks the meeting row AFTER the instance (ACC-255's order),
 * refuses MEETING_CHANGED if the drafts moved since, inserts the tasks, links
 * each item to its task and stamps the approval; finish() announces the tasks
 * and writes the meeting's audit row.
 */
const minutesFinal = transitionEffect<Approval>({
  key: 'meeting.minutes_final',
  flag: STAGE_FLAG.MINUTES_FINAL,
  async prepare(deps, ctx) {
    const drafts = await draftActionItems(deps.prisma, ctx.objectId, ctx.organizationId);
    const prepared = await Promise.all(
      drafts.map(async (d) => ({
        id: d.id,
        ownerUserId: d.ownerUserId,
        ownerStatus: d.ownerStatus,
        dueAt: d.dueAt,
        title: d.title,
        prepared: await deps.tasks.prepareRecordTask(
          {
            title: d.title,
            titleAr: null,
            description: null,
            priority: ACTION_ITEM_PRIORITY,
            sourceType: 'MEETING',
            sourceId: ctx.objectId,
            assigneeUserIds: [d.ownerUserId],
            dueAt: d.dueAt,
          },
          ctx.organizationId,
        ),
      })),
    );
    return { drafts: prepared, created: [] };
  },
  async apply(tx, ctx, prepared, deps) {
    await lockMeetingRow(tx, ctx.objectId, ctx.organizationId);
    const now = await draftActionItems(tx, ctx.objectId, ctx.organizationId);
    // The drafts as they were prepared, each owner still ACTIVE: never a task with nobody on it.
    if (now.map(draftKey).sort().join('|') !== prepared.drafts.map(draftKey).sort().join('|')) throw new MeetingRefusal('MEETING_CHANGED');
    if (now.some((d) => d.ownerStatus !== 'ACTIVE')) throw new MeetingRefusal('MEETING_CHANGED');
    const created: Approval['created'] = [];
    for (const d of prepared.drafts) {
      const task = await deps.tasks.insertPrepared(tx, d.prepared, ctx.organizationId, ctx.actorId);
      await tx.meetingActionItem.update({ where: { id: d.id }, data: { taskId: task.id } });
      created.push({ task, prepared: d.prepared });
    }
    await tx.meeting.update({ where: { id: ctx.objectId }, data: { minutesApprovedAt: new Date(), approvedById: ctx.actorId } });
    // The approval's audit row commits with it, never after a notice that could fail.
    await tx.auditLog.create({
      data: {
        organizationId: ctx.organizationId,
        actorId: ctx.actorId,
        action: 'UPDATE',
        objectType: 'Meeting',
        objectId: ctx.objectId,
        after: { minutesApproved: true, tasksCreated: created.map((c) => c.task.id) },
      },
    });
    return { ...prepared, created };
  },
  async finish(deps, ctx, prepared) {
    // Each task announced on its own: one failure is logged and the others still go.
    for (const { task, prepared: p } of prepared.created) {
      try {
        await deps.tasks.announceCreated(task, p, ctx.organizationId, ctx.actorId, { meetingActionItem: true });
      } catch (error) {
        logger.error(`Announcing task ${task.id} for meeting ${ctx.objectId} in org ${ctx.organizationId} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
  },
});

export const MEETING_TRANSITION_EFFECTS: readonly AnyTransitionEffect[] = [agendaIssued, cancelled, minutesFinal];
