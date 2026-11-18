import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { MEETING_ACTIONS, STAGE_FLAG } from '../../workflow/record-registry';
import type { EngineTx } from '../../workflow/workflow.service';
import { peopleDateIn } from '../../task/task-sla.service';
import { invitationNotice, presenterLeftNotice } from '../meeting-notices';
import { notifyUsers } from '../meeting-send';
import { lockMeetingRow } from '../meeting-access';

type Client = Pick<PrismaService, '$queryRaw'>;

/** A meeting whose MEMBER invitees follow its owner. */
export interface OwnedMeeting {
  id: string;
  committeeId: string | null;
  orgUnitId: string | null;
}

/** The MEMBER invitees a meeting expects: user id → seat value id (null for a unit meeting). */
export type ExpectedMembers = Map<string, Map<string, string | null>>;

/** What one sync changed, summed over the meetings it touched. */
export interface InviteeSyncResult {
  meetings: number;
  added: number;
  removed: number;
  converted: number;
  reseated: number;
  /** Leavers who present an agenda item: kept, as organisation guests. */
  demoted: number;
}

/** Meetings read per batch by the sweep. */
const SWEEP_BATCH = 200;

/**
 * The MEMBER invitees each meeting expects, in TWO queries whatever the number:
 *   a committee meeting: the committee's active members of an active committee,
 *     who are ACTIVE people, with their seat (a snapshot);
 *   a unit meeting: the unit's own ACTIVE people (primaryOrgUnitId), no
 *     sub-units (lane B, 18 Nov).
 * Scheduling reads it inside its transaction; the sync reads it again under
 * the instance's lock.
 */
export async function expectedMembers(client: Client, organizationId: string, meetings: readonly OwnedMeeting[]): Promise<ExpectedMembers> {
  const result: ExpectedMembers = new Map(meetings.map((m) => [m.id, new Map()]));
  const committeeIds = [...new Set(meetings.map((m) => m.committeeId).filter((c): c is string => !!c))];
  const unitIds = [...new Set(meetings.filter((m) => !m.committeeId).map((m) => m.orgUnitId).filter((u): u is string => !!u))];
  const [seats, people] = await Promise.all([
    committeeIds.length === 0
      ? Promise.resolve([] as { committeeId: string; userId: string; roleValueId: string }[])
      : client.$queryRaw<{ committeeId: string; userId: string; roleValueId: string }[]>`
          SELECT cm."committeeId", cm."userId", cm."roleValueId"
          FROM "CommitteeMember" cm
          JOIN "Committee" c ON c.id = cm."committeeId" AND c."organizationId" = cm."organizationId" AND c."isActive"
          JOIN "User" u ON u.id = cm."userId" AND u."organizationId" = cm."organizationId" AND u.status = 'ACTIVE'
          WHERE cm."organizationId" = ${organizationId} AND cm."isActive" AND cm."committeeId" = ANY(${committeeIds}::text[])`,
    unitIds.length === 0
      ? Promise.resolve([] as { unitId: string; userId: string }[])
      : client.$queryRaw<{ unitId: string; userId: string }[]>`
          SELECT u."primaryOrgUnitId" AS "unitId", u.id AS "userId"
          FROM "User" u
          WHERE u."organizationId" = ${organizationId} AND u.status = 'ACTIVE' AND u."primaryOrgUnitId" = ANY(${unitIds}::text[])`,
  ]);
  for (const m of meetings) {
    const expected = result.get(m.id)!;
    if (m.committeeId) {
      for (const s of seats) if (s.committeeId === m.committeeId) expected.set(s.userId, s.roleValueId);
    } else if (m.orgUnitId) {
      for (const p of people) if (p.unitId === m.orgUnitId) expected.set(p.userId, null);
    }
  }
  return result;
}

/**
 * ACC-316 PR 3b — KEEPING A MEETING'S MEMBER INVITEES CURRENT (plan step-316
 * §3.4). ONE place recomputes them, for a committee, a unit, a person, or every
 * open meeting:
 *   - it adds the missing MEMBER rows (an organisation guest who becomes a
 *     member is turned into a MEMBER row, keeping their answer);
 *   - it removes the MEMBER rows no longer expected, with their answers —
 *     except a leaver who presents an agenda item, who stays as an
 *     organisation guest (row, answer and presenter kept), and the organiser
 *     is told (lane B's review, fix 1);
 *   - it refreshes a member's seat snapshot.
 * Guests are never touched. Only OPEN meetings change: the current stage
 * allows `manage_guests` (Planned and Agenda Issued, seeded) and the meeting
 * has not started. Held and cancelled meetings never change.
 *
 * ACC-82's rule: correctness rests on the scheduled recomputer,
 * SlaMonitorProcessor.sweepMeetingInvitees() (every 15 minutes, sweep()); the
 * writers' calls after they commit (committee membership, user transfer,
 * profile unit, deactivate, reactivate, invitation accepted) only make a change
 * show sooner, and never fail the write that made them.
 *
 * Each meeting changes in its own short transaction, which takes the meeting's
 * instance FOR SHARE first (an invitee write's lock order, as PR 3a noted) and
 * reads again under it. A member added after the agenda was issued is stamped
 * invited and told, after the commit.
 *
 * A module of its own with only Prisma and the queues (ACC-297's shape), so the
 * committee, user and auth writers and the sweep can call it with no cycle.
 */
@Injectable()
export class MeetingInviteeSyncService {
  private readonly logger = new Logger(MeetingInviteeSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
    private readonly stageRules: StageRulesService,
  ) {}

  /** A committee's open meetings (its membership changed). */
  forCommittee(organizationId: string, committeeId: string, now: Date = new Date()): Promise<InviteeSyncResult> {
    return this.syncWhere(organizationId, Prisma.sql`m."committeeId" = ${committeeId}`, now);
  }

  /** A unit's open meetings (its people changed). */
  forUnit(organizationId: string, orgUnitId: string, now: Date = new Date()): Promise<InviteeSyncResult> {
    return this.syncWhere(organizationId, Prisma.sql`m."orgUnitId" = ${orgUnitId}`, now);
  }

  /**
   * Every open meeting this person's change can reach: those of the committees
   * they have a seat row in, of their unit, and those they are a MEMBER
   * invitee of (the unit or committee they just left).
   */
  forUser(organizationId: string, userId: string, now: Date = new Date()): Promise<InviteeSyncResult> {
    return this.syncWhere(
      organizationId,
      Prisma.sql`(
        m."committeeId" IN (SELECT cm."committeeId" FROM "CommitteeMember" cm WHERE cm."organizationId" = ${organizationId} AND cm."userId" = ${userId})
        OR m."orgUnitId" = (SELECT u."primaryOrgUnitId" FROM "User" u WHERE u.id = ${userId} AND u."organizationId" = ${organizationId})
        OR EXISTS (SELECT 1 FROM "MeetingAttendee" a WHERE a."meetingId" = m.id AND a."organizationId" = m."organizationId" AND a."userId" = ${userId} AND a.kind = 'MEMBER'))`,
      now,
    );
  }

  /** The scheduled recomputer: every open meeting of every organisation, in batches. */
  async sweep(now: Date = new Date()): Promise<InviteeSyncResult> {
    const total = emptyResult();
    let after = '';
    for (;;) {
      const batch = await this.prisma.$queryRaw<(OwnedMeeting & { organizationId: string })[]>`
        SELECT m.id, m."organizationId", m."committeeId", m."orgUnitId"
        FROM "Meeting" m
        WHERE m.id > ${after} AND m."scheduledAt" > ${now} AND ${openStageSql()}
        ORDER BY m.id
        LIMIT ${SWEEP_BATCH}`;
      if (batch.length === 0) break;
      after = batch[batch.length - 1]!.id;
      const byOrg = new Map<string, OwnedMeeting[]>();
      for (const m of batch) byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m]);
      for (const [organizationId, meetings] of byOrg) add(total, await this.syncMeetings(organizationId, meetings, now));
      if (batch.length < SWEEP_BATCH) break;
    }
    return total;
  }

  private async syncWhere(organizationId: string, where: Prisma.Sql, now: Date): Promise<InviteeSyncResult> {
    const meetings = await this.prisma.$queryRaw<OwnedMeeting[]>`
      SELECT m.id, m."committeeId", m."orgUnitId"
      FROM "Meeting" m
      WHERE m."organizationId" = ${organizationId} AND m."scheduledAt" > ${now} AND ${openStageSql()} AND ${where}`;
    return this.syncMeetings(organizationId, meetings, now);
  }

  /** One organisation's meetings: read in batches, then each meeting that differs in its own transaction. */
  private async syncMeetings(organizationId: string, meetings: readonly OwnedMeeting[], now: Date): Promise<InviteeSyncResult> {
    const result = emptyResult();
    if (meetings.length === 0) return result;
    const [expected, rows] = await Promise.all([
      expectedMembers(this.prisma, organizationId, meetings),
      this.attendeeRows(this.prisma, organizationId, meetings.map((m) => m.id)),
    ]);
    for (const meeting of meetings) {
      if (!diffOf(expected.get(meeting.id)!, rows.get(meeting.id) ?? []).changed) continue;
      try {
        const done = await this.syncOne(organizationId, meeting, now);
        add(result, done.result);
        if (done.invited.length > 0) await this.tellInvited(organizationId, meeting.id, done.invited);
        if (done.demoted.length > 0) await this.tellOrganiser(organizationId, meeting.id, done.demoted);
      } catch (error) {
        // One meeting failing leaves the rest; the next sweep tries again.
        this.logger.warn(`Meeting invitee sync failed for meeting ${meeting.id} in org ${organizationId}: ${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
    return result;
  }

  private async syncOne(
    organizationId: string,
    meeting: OwnedMeeting,
    now: Date,
  ): Promise<{ result: InviteeSyncResult; invited: string[]; demoted: { userId: string; items: string[] }[] }> {
    return this.prisma.$transaction(async (tx) => {
      const result = emptyResult();
      // The instance FOR SHARE first: a move in flight (Issue Agenda, Cancel) finishes first.
      const rules = await this.stageRules.currentStageRules('MEETING', meeting.id, organizationId, tx, { lock: 'share' });
      if (rules.actions[MEETING_ACTIONS.MANAGE_GUESTS] !== true) return { result, invited: [], demoted: [] };
      // Then the meeting row, as every invitee write (an answer, a guest) takes it.
      await lockMeetingRow(tx, meeting.id, organizationId);
      const current = await tx.meeting.findFirst({ where: { id: meeting.id, organizationId }, select: { scheduledAt: true } });
      if (!current || current.scheduledAt <= now) return { result, invited: [], demoted: [] };

      const [expected, rows] = await Promise.all([
        expectedMembers(tx, organizationId, [meeting]),
        this.attendeeRows(tx, organizationId, [meeting.id]),
      ]);
      const diff = diffOf(expected.get(meeting.id)!, rows.get(meeting.id) ?? []);
      const issued = rules.flags.includes(STAGE_FLAG.AGENDA_ISSUED);
      if (diff.add.length > 0) {
        await tx.meetingAttendee.createMany({
          data: diff.add.map(({ userId, seatValueId }) => ({
            organizationId,
            meetingId: meeting.id,
            kind: 'MEMBER' as const,
            userId,
            seatValueId,
            invitedAt: issued ? now : null,
          })),
          skipDuplicates: true,
        });
      }
      for (const c of diff.convert) {
        await tx.meetingAttendee.update({
          where: { id: c.id },
          data: { kind: 'MEMBER', seatValueId: c.seatValueId, ...(issued && !c.invited ? { invitedAt: now } : {}) },
        });
      }
      for (const r of diff.reseat) await tx.meetingAttendee.update({ where: { id: r.id }, data: { seatValueId: r.seatValueId } });
      // A leaver who presents an item is kept as an organisation guest: the row,
      // its answer and the presenter link survive; everyone else is removed.
      const presenting = diff.remove.length
        ? await tx.agendaItem.findMany({
            where: { organizationId, meetingId: meeting.id, presenterAttendeeId: { in: diff.remove.map((r) => r.id) } },
            select: { presenterAttendeeId: true, title: true },
            orderBy: [{ order: 'asc' }, { id: 'asc' }],
          })
        : [];
      const itemsOf = new Map<string, string[]>();
      for (const item of presenting) itemsOf.set(item.presenterAttendeeId!, [...(itemsOf.get(item.presenterAttendeeId!) ?? []), item.title]);
      const demote = diff.remove.filter((r) => itemsOf.has(r.id));
      const remove = diff.remove.filter((r) => !itemsOf.has(r.id));
      if (demote.length > 0) {
        await tx.meetingAttendee.updateMany({
          where: { organizationId, meetingId: meeting.id, kind: 'MEMBER', id: { in: demote.map((r) => r.id) } },
          data: { kind: 'ORG_GUEST', seatValueId: null, addedAsPresenter: true },
        });
      }
      if (remove.length > 0) {
        await tx.meetingAttendee.deleteMany({ where: { organizationId, meetingId: meeting.id, kind: 'MEMBER', id: { in: remove.map((r) => r.id) } } });
      }
      result.meetings = 1;
      result.added = diff.add.length;
      result.converted = diff.convert.length;
      result.reseated = diff.reseat.length;
      result.removed = remove.length;
      result.demoted = demote.length;
      const invited = issued ? [...diff.add.map((a) => a.userId), ...diff.convert.filter((c) => !c.invited).map((c) => c.userId)] : [];
      return { result, invited, demoted: demote.map((r) => ({ userId: r.userId, items: itemsOf.get(r.id)! })) };
    });
  }

  private async attendeeRows(client: Pick<EngineTx, 'meetingAttendee'>, organizationId: string, meetingIds: readonly string[]): Promise<Map<string, AttendeeRow[]>> {
    const rows = await client.meetingAttendee.findMany({
      where: { organizationId, meetingId: { in: [...meetingIds] }, userId: { not: null } },
      select: { id: true, meetingId: true, userId: true, kind: true, seatValueId: true, invitedAt: true },
    });
    const byMeeting = new Map<string, AttendeeRow[]>();
    for (const r of rows) {
      byMeeting.set(r.meetingId, [
        ...(byMeeting.get(r.meetingId) ?? []),
        { id: r.id, userId: r.userId!, kind: r.kind, seatValueId: r.seatValueId, invited: r.invitedAt !== null },
      ]);
    }
    return byMeeting;
  }

  /** After the commit: the organiser is told, in the app, of each presenter kept as a guest. */
  private async tellOrganiser(organizationId: string, meetingId: string, demoted: readonly { userId: string; items: string[] }[]): Promise<void> {
    const [meeting, users] = await Promise.all([
      this.prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { title: true, organizerId: true } }),
      this.prisma.user.findMany({ where: { organizationId, id: { in: demoted.map((d) => d.userId) } }, select: { id: true, name: true } }),
    ]);
    if (!meeting) return;
    const names = new Map(users.map((u) => [u.id, u.name]));
    for (const d of demoted) {
      await notifyUsers(
        this.notifications,
        organizationId,
        meetingId,
        null,
        [meeting.organizerId],
        presenterLeftNotice(names.get(d.userId) ?? '', d.items, meeting.title),
        'IN_APP',
      );
    }
  }

  /** After the commit: the members added to an issued meeting get the invitation. */
  private async tellInvited(organizationId: string, meetingId: string, userIds: readonly string[]): Promise<void> {
    const meeting = await this.prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { title: true, scheduledAt: true } });
    if (!meeting) return;
    const when = peopleDateIn(meeting.scheduledAt, await this.calendar.getEffectiveTimeZone(organizationId));
    await notifyUsers(this.notifications, organizationId, meetingId, null, userIds, invitationNotice(meeting.title, when));
  }
}

interface AttendeeRow {
  id: string;
  userId: string;
  kind: 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST';
  seatValueId: string | null;
  invited: boolean;
}

interface Diff {
  changed: boolean;
  add: { userId: string; seatValueId: string | null }[];
  convert: { id: string; userId: string; seatValueId: string | null; invited: boolean }[];
  reseat: { id: string; seatValueId: string | null }[];
  remove: { id: string; userId: string }[];
}

/** What a meeting's MEMBER rows must become. Guests are never removed or changed, except a guest who is now a member. */
function diffOf(expected: Map<string, string | null>, rows: readonly AttendeeRow[]): Diff {
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const diff: Diff = { changed: false, add: [], convert: [], reseat: [], remove: [] };
  for (const [userId, seatValueId] of expected) {
    const row = byUser.get(userId);
    if (!row) diff.add.push({ userId, seatValueId });
    else if (row.kind === 'ORG_GUEST') diff.convert.push({ id: row.id, userId, seatValueId, invited: row.invited });
    else if (row.kind === 'MEMBER' && row.seatValueId !== seatValueId) diff.reseat.push({ id: row.id, seatValueId });
  }
  for (const row of rows) if (row.kind === 'MEMBER' && !expected.has(row.userId)) diff.remove.push({ id: row.id, userId: row.userId });
  diff.changed = diff.add.length + diff.convert.length + diff.reseat.length + diff.remove.length > 0;
  return diff;
}

/** An open meeting: its live instance's current stage allows manage_guests. */
function openStageSql(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "WorkflowInstance" wi
    JOIN "WorkflowStageRecordAction" ra
      ON ra."stageId" = wi."currentStageId" AND ra."organizationId" = wi."organizationId" AND ra."actionKey" = ${MEETING_ACTIONS.MANAGE_GUESTS}
    WHERE wi."organizationId" = m."organizationId" AND wi."objectType"::text = 'MEETING' AND wi."objectId" = m.id AND wi.status = 'IN_PROGRESS')`;
}

function emptyResult(): InviteeSyncResult {
  return { meetings: 0, added: 0, removed: 0, converted: 0, reseated: 0, demoted: 0 };
}

function add(total: InviteeSyncResult, part: InviteeSyncResult): void {
  total.meetings += part.meetings;
  total.added += part.added;
  total.removed += part.removed;
  total.converted += part.converted;
  total.reseated += part.reseated;
  total.demoted += part.demoted;
}

/**
 * A writer's call after it commits (ACC-82: it only makes a change show
 * sooner). Never fails the write: a sync error is logged by kind and left to
 * the sweep. A writer built by hand without the sync (a spec) skips it.
 */
export async function refreshMeetingInvitees(
  sync: MeetingInviteeSyncService | undefined,
  logger: Logger,
  context: string,
  run: (sync: MeetingInviteeSyncService) => Promise<unknown>,
): Promise<void> {
  if (!sync) return;
  try {
    await run(sync);
  } catch (error) {
    logger.warn(`Meeting invitees not refreshed after ${context} (${error instanceof Error ? error.name : 'unknown'}); the sweep will.`);
  }
}
