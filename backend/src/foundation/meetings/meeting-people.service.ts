import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import { peopleDateIn } from '../task/task-sla.service';
import { MeetingAccess, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import { cantAttendNotice, invitationNotice, outsideInvitationEmail } from './meeting-notices';
import { emailOutsideGuests, notifyUsers, organisationNames } from './meeting-send';
import type { AddMeetingGuestDto, AnswerMeetingDto } from './dto/meeting.dto';
import type { IMeetingAnswerSummary, IMeetingAttendee } from './interfaces/meeting.interface';

/** The MEMBER answers of one meeting, in one grouped query (the record read and the "Can't attend" flag share it). */
export async function meetingAnswerSummary(
  prisma: Pick<PrismaService, 'meetingAttendee'>,
  meetingId: string,
  organizationId: string,
  quorum: number | null,
): Promise<IMeetingAnswerSummary> {
  const rows = await prisma.meetingAttendee.groupBy({
    by: ['answer'],
    where: { organizationId, meetingId, kind: 'MEMBER' },
    _count: { _all: true },
  });
  const count = (answer: 'ATTENDING' | 'CANT_ATTEND' | null) => rows.find((r) => r.answer === answer)?._count._all ?? 0;
  const members = rows.reduce((n, r) => n + r._count._all, 0);
  const attending = count('ATTENDING');
  return { members, attending, cantAttend: count('CANT_ATTEND'), noAnswer: count(null), quorum, belowQuorum: quorum !== null && attending < quorum };
}

/** The seats whose "Can't attend" is flagged to the scheduler (plan §3.4). */
const OFFICER_SEAT_KEYS = ['chairman', 'secretary'];

/**
 * ACC-316 PR 3b — a meeting's PEOPLE: the invitees and guests, and the answers
 * to the invitation (plan step-316 §3.4, §4.2).
 *
 *   MEMBER invitees are the committee's or the unit's own, kept current by
 *   MeetingInviteeSync; they are never added or removed here.
 *   Guests — an organisation person (ORG_GUEST) or an outside guest
 *   (OUTSIDE_GUEST, name and email) — are added and removed by whoever
 *   schedules the meeting, while its stage allows `manage_guests`. A guest
 *   added once the agenda is issued is invited at once: a user in the app and
 *   by email, an outside guest by email, in the organisation's language.
 *   Answers: a user invitee answers, and changes it, until the start time,
 *   while the stage allows `answer_invitation`. A change TO "Can't attend"
 *   tells the scheduler in the app, flagged when attending falls below the
 *   quorum, or the person holds the Chair or Secretary seat, or presents.
 *
 * Every write takes the meeting's instance FOR SHARE first (the stage's rules),
 * then writes, in one transaction: an Issue Agenda in flight finishes first.
 */
@Injectable()
export class MeetingPeopleService {
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly stageRules: StageRulesService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  // ── Guests ──────────────────────────────────────────────────────────────────

  async addGuest(id: string, dto: AddMeetingGuestDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAttendee> {
    await this.access.writing(id, organizationId, viewer, now);
    const person = !!dto.userId;
    const outside = !!dto.outsideName && !!dto.outsideEmail;
    if (person === outside) throw new MeetingRefusal('MEETING_GUEST_REQUIRED');
    if (person) {
      const user = await this.prisma.user.findFirst({ where: { id: dto.userId!, organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!user) throw new MeetingRefusal('MEETING_PERSON_NOT_FOUND');
    }

    const { attendeeId, issued } = await this.prisma.$transaction(async (tx) => {
      const rules = await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.MANAGE_GUESTS, organizationId, tx, { lock: 'share' });
      const issued = rules.flags.includes(STAGE_FLAG.AGENDA_ISSUED);
      const duplicate = person
        ? await tx.meetingAttendee.findFirst({ where: { organizationId, meetingId: id, userId: dto.userId! }, select: { id: true } })
        : await tx.meetingAttendee.findFirst({
            where: { organizationId, meetingId: id, kind: 'OUTSIDE_GUEST', outsideEmail: { equals: dto.outsideEmail!, mode: 'insensitive' } },
            select: { id: true },
          });
      if (duplicate) throw new MeetingRefusal('MEETING_ALREADY_INVITED');
      const row = await tx.meetingAttendee.create({
        data: person
          ? { organizationId, meetingId: id, kind: 'ORG_GUEST', userId: dto.userId!, invitedAt: issued ? now : null, createdById: viewer.id }
          : {
              organizationId,
              meetingId: id,
              kind: 'OUTSIDE_GUEST',
              outsideName: dto.outsideName!,
              outsideEmail: dto.outsideEmail!,
              outsideOrganisation: dto.outsideOrganisation ?? null,
              outsideRole: dto.outsideRole ?? null,
              invitedAt: issued ? now : null,
              createdById: viewer.id,
            },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'CREATE',
          objectType: 'MeetingAttendee',
          objectId: row.id,
          // Who, never the outside guest's email (the audit names fields, not personal data it need not hold).
          after: { meetingId: id, kind: person ? 'ORG_GUEST' : 'OUTSIDE_GUEST', userId: dto.userId ?? null, invited: issued },
        },
      });
      return { attendeeId: row.id, issued };
    });

    // Added once the agenda is issued: invited at once (Answers, round 4: "Add and send invitation").
    if (issued) await this.inviteNow(id, organizationId, viewer.id, person ? { userId: dto.userId! } : { email: dto.outsideEmail! });
    return (await this.attendees(id, organizationId, viewer, now)).find((a) => a.id === attendeeId)!;
  }

  async removeGuest(id: string, attendeeId: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    await this.access.writing(id, organizationId, viewer, now);
    await this.prisma.$transaction(async (tx) => {
      await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.MANAGE_GUESTS, organizationId, tx, { lock: 'share' });
      const row = await tx.meetingAttendee.findFirst({
        where: { id: attendeeId, organizationId, meetingId: id },
        select: { id: true, kind: true, userId: true },
      });
      if (!row) throw new MeetingRefusal('MEETING_ATTENDEE_NOT_FOUND');
      if (row.kind === 'MEMBER') throw new MeetingRefusal('MEETING_MEMBER_NOT_REMOVABLE');
      const presents = await tx.agendaItem.findFirst({ where: { organizationId, meetingId: id, presenterAttendeeId: row.id }, select: { id: true } });
      if (presents) throw new MeetingRefusal('MEETING_GUEST_PRESENTS');
      await tx.meetingAttendee.delete({ where: { id: row.id } });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'DELETE',
          objectType: 'MeetingAttendee',
          objectId: row.id,
          before: { meetingId: id, kind: row.kind, userId: row.userId },
        },
      });
    });
  }

  /** After the commit: one guest added to an issued meeting gets the invitation now. */
  private async inviteNow(meetingId: string, organizationId: string, actorId: string, to: { userId: string } | { email: string }): Promise<void> {
    const [meeting, organization] = await Promise.all([
      this.prisma.meeting.findFirst({ where: { id: meetingId, organizationId }, select: { title: true, scheduledAt: true, location: true, meetingUrl: true } }),
      this.prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true, nameAr: true } }),
    ]);
    if (!meeting) return;
    const when = peopleDateIn(meeting.scheduledAt, await this.calendar.getEffectiveTimeZone(organizationId));
    if ('userId' in to) await notifyUsers(this.notifications, organizationId, meetingId, actorId, [to.userId], invitationNotice(meeting.title, when));
    else await emailOutsideGuests(this.notifications, organizationId, meetingId, [to.email], outsideInvitationEmail(meeting.title, organisationNames(organization), when, meeting));
  }

  // ── Answers ─────────────────────────────────────────────────────────────────

  async answer(id: string, dto: AnswerMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<void> {
    await this.access.seeing(id, organizationId, viewer, now);
    const changed = await this.prisma.$transaction(async (tx) => {
      await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.ANSWER_INVITATION, organizationId, tx, { lock: 'share' });
      const meeting = await tx.meeting.findFirst({ where: { id, organizationId }, select: { scheduledAt: true } });
      if (!meeting || meeting.scheduledAt <= now) throw new MeetingRefusal('MEETING_STARTED');
      const row = await tx.meetingAttendee.findFirst({
        where: { organizationId, meetingId: id, userId: viewer.id },
        select: { id: true, answer: true, answerNote: true },
      });
      if (!row) throw new MeetingRefusal('MEETING_NOT_INVITED');
      const note = dto.note ?? null;
      await tx.meetingAttendee.update({ where: { id: row.id }, data: { answer: dto.answer, answerNote: note, answeredAt: now } });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'UPDATE',
          objectType: 'MeetingAttendee',
          objectId: row.id,
          before: { answer: row.answer, answerNote: row.answerNote },
          after: { answer: dto.answer, answerNote: note },
        },
      });
      return { attendeeId: row.id, toCantAttend: dto.answer === 'CANT_ATTEND' && row.answer !== 'CANT_ATTEND', note };
    });
    if (changed.toCantAttend) await this.tellScheduler(id, organizationId, viewer.id, changed.attendeeId, changed.note);
  }

  /** A change TO "Can't attend": the organiser is told in the app, flagged (plan §3.4). Never the person themselves. */
  private async tellScheduler(meetingId: string, organizationId: string, personId: string, attendeeId: string, note: string | null): Promise<void> {
    const [meeting, person, attendee, presents] = await Promise.all([
      this.prisma.meeting.findFirst({
        where: { id: meetingId, organizationId },
        select: { title: true, organizerId: true, unitQuorum: true, committee: { select: { quorumCount: true } } },
      }),
      this.prisma.user.findFirst({ where: { id: personId, organizationId }, select: { name: true } }),
      this.prisma.meetingAttendee.findFirst({ where: { id: attendeeId, organizationId }, select: { seatValue: { select: { key: true } } } }),
      this.prisma.agendaItem.findFirst({ where: { organizationId, meetingId, presenterAttendeeId: attendeeId }, select: { id: true } }),
    ]);
    if (!meeting || meeting.organizerId === personId) return;
    const summary = await this.answerSummary(meetingId, organizationId, meeting.committee?.quorumCount ?? meeting.unitQuorum ?? null);
    const flags = {
      belowQuorum: summary.quorum !== null && summary.members - summary.cantAttend < summary.quorum,
      officer: OFFICER_SEAT_KEYS.includes(attendee?.seatValue?.key ?? ''),
      presenter: !!presents,
    };
    await notifyUsers(this.notifications, organizationId, meetingId, null, [meeting.organizerId], cantAttendNotice(person?.name ?? '', meeting.title, note, flags), 'IN_APP');
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  /**
   * The summary whoever may edit the meeting sees: MEMBER answers only ("6
   * attending · 2 can't · quorum 5"). The quorum is the committee's or the
   * unit meeting's own; null when a unit meeting has none (no quorum words).
   */
  answerSummary(meetingId: string, organizationId: string, quorum: number | null): Promise<IMeetingAnswerSummary> {
    return meetingAnswerSummary(this.prisma, meetingId, organizationId, quorum);
  }

  /**
   * The meeting's people, for whoever may see it. An outside guest's email,
   * and everyone's answer, are shown only to whoever may edit the meeting; a
   * person always sees their own answer.
   */
  async attendees(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingAttendee[]> {
    const owner = await this.access.seeing(id, organizationId, viewer, now);
    const [rows, mayEdit] = await Promise.all([
      this.prisma.meetingAttendee.findMany({
        where: { organizationId, meetingId: id },
        select: {
          id: true,
          kind: true,
          userId: true,
          user: { select: { name: true } },
          seatValue: { select: { id: true, labelEn: true, labelAr: true, sortOrder: true } },
          outsideName: true,
          outsideEmail: true,
          outsideOrganisation: true,
          outsideRole: true,
          answer: true,
          answerNote: true,
          invitedAt: true,
          addedAsPresenter: true,
        },
      }),
      this.access.isScheduler(owner, organizationId, viewer.id, now),
    ]);
    const kindOrder = { MEMBER: 0, ORG_GUEST: 1, OUTSIDE_GUEST: 2 } as const;
    return rows
      .map((r) => {
        const own = r.userId === viewer.id;
        return {
          id: r.id,
          kind: r.kind,
          userId: r.userId,
          name: r.user?.name ?? r.outsideName ?? '',
          seat: r.seatValue ? { id: r.seatValue.id, labelEn: r.seatValue.labelEn, labelAr: r.seatValue.labelAr } : null,
          outsideOrganisation: r.outsideOrganisation,
          outsideRole: r.outsideRole,
          outsideEmail: mayEdit ? r.outsideEmail : null,
          answer: mayEdit || own ? r.answer : null,
          answerNote: mayEdit || own ? r.answerNote : null,
          invited: r.invitedAt !== null,
          addedAsPresenter: r.addedAsPresenter,
          seatOrder: r.seatValue?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((x, y) => kindOrder[x.kind] - kindOrder[y.kind] || x.seatOrder - y.seatOrder || x.name.localeCompare(y.name))
      .map(({ seatOrder: _seatOrder, ...rest }) => rest);
  }
}
