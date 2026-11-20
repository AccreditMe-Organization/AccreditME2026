import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { meetingMayOpenSql, meetingOpener } from '../../common/services/meeting-membership';
import { STAGE_FLAG } from '../workflow/record-registry';
import type { MeetingOwner } from '../workflow/meeting-authority';
import { expectedMembers } from './invitees/meeting-invitee-sync.service';
import { MeetingAccess, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import type { CheckMeetingClashesDto } from './dto/meeting.dto';
import type { IMeetingClash } from './interfaces/meeting.interface';

/** A series' cap: the most times one check takes. */
// ACC-316 PR 5 — a series' most meetings (weekly for twelve months, both ends included).
export const CLASH_TIMES_CAP = 53;
/** A meeting saved before durations were required is taken as an hour (here and in the scope preview). */
export const DEFAULT_MINUTES = 60;
/** The longest a meeting may last (ScheduleMeetingDto): how far before a time another meeting may start and still overlap it. */
const MAX_MINUTES = 1440;

interface ClashRow {
  idx: bigint;
  userId: string;
  meetingId: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  mayOpen: boolean;
}

/**
 * ACC-316 PR 3b — THE CLASH CHECK (plan step-316 §3.10). A warning, never a
 * block: for each person with a user, the other meetings they are invited to,
 * not cancelled, whose time STRICTLY overlaps — back-to-back is not a clash,
 * and meetings of the same series count. Outside guests are not checked.
 *
 *   Who may ask: whoever may schedule for the owner (a new meeting), or edit
 *   the meeting (its own time left out). Anyone else gets the refusal the
 *   schedule or edit endpoint gives: the answer names who is busy and when.
 *   The other meeting's title is given only to an asker who may open it;
 *   otherwise null ("another meeting").
 *   One batched query for every time and person, the times capped at a
 *   series' cap.
 */
@Injectable()
export class MeetingClashService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  async check(dto: CheckMeetingClashesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingClash[]> {
    if (dto.times.length > CLASH_TIMES_CAP) throw new MeetingRefusal('MEETING_CLASH_TOO_MANY_TIMES');
    const { owner, excludedId } = await this.askerMay(dto, organizationId, viewer, now);
    const userIds = await this.people(dto, owner, excludedId, organizationId);
    if (dto.times.length === 0 || userIds.length === 0) return dto.times.map((t) => ({ startsAt: t.startsAt, people: [] }));

    const starts = dto.times.map((t) => new Date(t.startsAt).toISOString());
    const ends = dto.times.map((t) => new Date(new Date(t.startsAt).getTime() + t.durationMinutes * 60_000).toISOString());
    // The window every time sits in, padded by the longest meeting: the scheduledAt
    // index narrows the meetings before any overlap is computed.
    const windowFrom = new Date(Math.min(...starts.map((s) => Date.parse(s))) - MAX_MINUTES * 60_000).toISOString();
    const windowTo = new Date(Math.max(...ends.map((e) => Date.parse(e)))).toISOString();
    const mayOpen = meetingMayOpenSql('m', await meetingOpener(this.prisma, organizationId, viewer, now));

    // The stored instants are UTC in timestamp columns: the ISO strings cast to timestamp read as UTC.
    const [rows, users] = await Promise.all([
      this.prisma.$queryRaw<ClashRow[]>`
        SELECT t.idx, a."userId", m.id AS "meetingId", m.title, m."scheduledAt", m."durationMinutes", ${mayOpen} AS "mayOpen"
        FROM unnest(${starts}::timestamp[], ${ends}::timestamp[]) WITH ORDINALITY AS t(s, e, idx)
        JOIN "MeetingAttendee" a ON a."organizationId" = ${organizationId} AND a."userId" = ANY(${userIds}::text[])
        JOIN "Meeting" m ON m.id = a."meetingId" AND m."organizationId" = a."organizationId"
        WHERE m.id <> ${excludedId ?? ''}
          AND m."scheduledAt" >= ${windowFrom}::timestamp AND m."scheduledAt" < ${windowTo}::timestamp
          AND m."scheduledAt" < t.e
          AND m."scheduledAt" + make_interval(mins => COALESCE(m."durationMinutes", ${DEFAULT_MINUTES})) > t.s
          AND NOT EXISTS (
            SELECT 1 FROM "WorkflowInstance" wi
            JOIN "WorkflowStage" s ON s.id = wi."currentStageId"
            WHERE wi."organizationId" = m."organizationId" AND wi."objectType"::text = 'MEETING' AND wi."objectId" = m.id
              AND ${STAGE_FLAG.MEETING_CANCELLED} = ANY(s.flags))
        ORDER BY t.idx, a."userId", m."scheduledAt", m.id`,
      this.prisma.user.findMany({ where: { organizationId, id: { in: userIds } }, select: { id: true, name: true } }),
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    return dto.times.map((t, i) => {
      const byUser = new Map<string, IMeetingClash['people'][number]>();
      for (const r of rows) {
        if (Number(r.idx) !== i + 1) continue;
        const person = byUser.get(r.userId) ?? { userId: r.userId, name: names.get(r.userId) ?? '', meetings: [] };
        person.meetings.push({
          // A meeting the asker may not open is "another meeting": neither its id nor its title.
          id: r.mayOpen ? r.meetingId : null,
          title: r.mayOpen ? r.title : null,
          startsAt: r.scheduledAt,
          durationMinutes: r.durationMinutes ?? DEFAULT_MINUTES,
        });
        byUser.set(r.userId, person);
      }
      return { startsAt: t.startsAt, people: [...byUser.values()] };
    });
  }

  /** Scheduling for the owner, or editing the meeting — the same refusal those endpoints give. */
  private async askerMay(
    dto: CheckMeetingClashesDto,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date,
  ): Promise<{ owner: MeetingOwner; excludedId: string | null }> {
    if (dto.meetingId) return { owner: await this.access.writing(dto.meetingId, organizationId, viewer, now), excludedId: dto.meetingId };
    if (!!dto.committeeId === !!dto.orgUnitId) throw new MeetingRefusal('MEETING_CLASH_OWNER_REQUIRED');
    let owner: MeetingOwner;
    if (dto.committeeId) {
      const committee = await this.prisma.committee.findFirst({ where: { id: dto.committeeId, organizationId, isActive: true }, select: { id: true, orgUnitId: true } });
      if (!committee) throw new MeetingRefusal('MEETING_OWNER_NOT_FOUND');
      owner = { key: 'new', committeeId: committee.id, unitId: committee.orgUnitId };
    } else {
      const unit = await this.prisma.orgUnit.findFirst({ where: { id: dto.orgUnitId!, organizationId, isActive: true }, select: { id: true } });
      if (!unit) throw new MeetingRefusal('MEETING_OWNER_NOT_FOUND');
      owner = { key: 'new', committeeId: null, unitId: unit.id };
    }
    if (!(await this.access.isScheduler(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    return { owner, excludedId: null };
  }

  /**
   * The people to check. Only the owner's members and this meeting's invitees
   * with a user may be checked (lane B's review): the answer says who is busy
   * when, so a sent `userIds` is refused for anyone else
   * (MEETING_CLASH_PERSON_NOT_INVITEE). With none sent, all of them.
   */
  private async people(dto: CheckMeetingClashesDto, owner: MeetingOwner, excludedId: string | null, organizationId: string): Promise<string[]> {
    const [expected, invitees] = await Promise.all([
      expectedMembers(this.prisma, organizationId, [{ id: 'owner', committeeId: owner.committeeId, orgUnitId: owner.committeeId ? null : owner.unitId }]),
      excludedId
        ? this.prisma.meetingAttendee.findMany({ where: { organizationId, meetingId: excludedId, userId: { not: null } }, select: { userId: true } })
        : Promise.resolve([] as { userId: string | null }[]),
    ]);
    const allowed = new Set([...expected.get('owner')!.keys(), ...invitees.map((r) => r.userId!)]);
    if (!dto.userIds) return [...allowed];
    if (dto.userIds.some((id) => !allowed.has(id))) throw new MeetingRefusal('MEETING_CLASH_PERSON_NOT_INVITEE');
    return [...new Set(dto.userIds)];
  }
}
