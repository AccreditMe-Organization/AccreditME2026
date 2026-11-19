import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import {
  meetingMemberSql,
  meetingOversightUnitIds,
  meetingOverseenSql,
} from '../../common/services/meeting-membership';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { peopleDateIn } from '../task/task-sla.service';
import { expectedMembers } from './invitees/meeting-invitee-sync.service';
import { meetingAnswerSummary } from './meeting-people.service';
import { outsideRescheduledEmail, rescheduledNotice } from './meeting-notices';
import { emailOutsideGuests, notifyUsers, organisationNames, type OrganisationNames } from './meeting-send';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { COMMITTEE_ACTIONS, MEETING_ACTIONS } from '../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { committeeTypeValues } from '../committees/committee-type-values';
import { SEAT_ACTIONS } from '../committees/seat-actions';
import { MeetingRefusal } from './meeting-refusal';
import { MeetingAccess, MEETING_NOT_FOUND, type MeetingViewer } from './meeting-access';
import type { ListMeetingsDto, RescheduleMeetingDto, ScheduleMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import type { IMeeting, IMeetingList, IMeetingListItem, IMeetingOwner } from './interfaces/meeting.interface';

export type { MeetingViewer } from './meeting-access';

const NOT_FOUND = MEETING_NOT_FOUND;
const PAGE = 25;
const MEETING_TYPE = 'meeting_type';

/** The fields an edit may change, in the order the audit names them. */
const EDITABLE = ['title', 'typeValueId', 'durationMinutes', 'location', 'meetingUrl', 'unitQuorum'] as const;
type Editable = (typeof EDITABLE)[number];

/**
 * ACC-316 PR 3a — ONE MEETING'S RECORD: schedule, read, the list views, edit and
 * reschedule (plan step-316 §3.1, §4). Cancel is the workflow's own move (the
 * reason rule, move-reasons.ts), and its notices the MEETING_CANCELLED effect.
 *
 * WHO: every write asks meeting-authority.ts's SCHEDULERS predicate — the one
 * the Planned and Agenda Issued pools read — so a button and a pool cannot
 * disagree. WHAT: the meeting's stage must allow the action (StageRulesService,
 * the instance FOR SHARE first, then the meeting row FOR UPDATE: ACC-255's lock
 * order). SEEING: the parent rule (ObjectVisibilityService MEETING), the
 * identical 404 for a meeting the viewer may not see.
 *
 * Invitees, guests, answers, the agenda and the clash check are PR 3b's.
 */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ObjectVisibilityService,
    private readonly workflow: WorkflowService,
    private readonly stageRules: StageRulesService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  /** Who may see and write a meeting: one rule, shared with every meeting route. */
  private readonly access: MeetingAccess;

  // ── Schedule ────────────────────────────────────────────────────────────────

  async schedule(dto: ScheduleMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting> {
    const owner = await this.resolveNewOwner(dto, organizationId);
    if (!(await isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now))) {
      throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    }
    // A title of spaces passes the DTO and would be stored as ''.
    const title = dto.title.trim();
    if (!title) throw new MeetingRefusal('MEETING_TITLE_REQUIRED');
    if (owner.committeeId && dto.unitQuorum != null) throw new MeetingRefusal('MEETING_QUORUM_UNIT_ONLY');
    if (!dto.location && !dto.meetingUrl) throw new MeetingRefusal('MEETING_PLACE_REQUIRED');
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    await this.assertMeetingType(dto.typeValueId, organizationId);

    // Every read the engine can do first (the template, the first stage).
    const meetingId = randomUUID();
    const prepared = await this.workflow.prepareInstanceStart('MEETING', meetingId, organizationId);

    const started = await this.prisma.$transaction(async (tx) => {
      // A committee's meeting only while its stage allows scheduling (the
      // committee's instance FOR SHARE: a transition into Dissolved in flight
      // finishes first, or waits for this).
      if (owner.committeeId) {
        await this.stageRules.assertStageAllows('COMMITTEE', owner.committeeId, COMMITTEE_ACTIONS.SCHEDULE_MEETING, organizationId, tx, {
          lock: 'share',
        });
      }
      const meeting = await tx.meeting.create({
        data: {
          id: meetingId,
          organizationId,
          committeeId: owner.committeeId,
          orgUnitId: owner.committeeId ? null : owner.unitId,
          organizerId: viewer.id,
          title,
          typeValueId: dto.typeValueId,
          scheduledAt,
          durationMinutes: dto.durationMinutes,
          location: dto.location ?? null,
          meetingUrl: dto.meetingUrl ?? null,
          unitQuorum: owner.committeeId ? null : (dto.unitQuorum ?? null),
        },
      });
      // ACC-316 PR 3b — the MEMBER invitees, from the owner as it stands now:
      // a committee's active members with their seats, or the unit's own
      // people. The invitee sync keeps them current from here.
      const expected = await expectedMembers(tx, organizationId, [
        { id: meetingId, committeeId: owner.committeeId, orgUnitId: owner.committeeId ? null : owner.unitId },
      ]);
      const members = [...expected.get(meetingId)!];
      if (members.length > 0) {
        await tx.meetingAttendee.createMany({
          data: members.map(([userId, seatValueId]) => ({ organizationId, meetingId, kind: 'MEMBER' as const, userId, seatValueId })),
        });
      }
      const instance = await this.workflow.insertInstanceStartInTx(tx, prepared, meetingId, organizationId, viewer.id);
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'CREATE',
          objectType: 'Meeting',
          objectId: meetingId,
          after: {
            title: meeting.title,
            committeeId: meeting.committeeId,
            orgUnitId: meeting.orgUnitId,
            typeValueId: meeting.typeValueId,
            scheduledAt: meeting.scheduledAt.toISOString(),
            durationMinutes: meeting.durationMinutes,
            location: meeting.location,
            meetingUrl: meeting.meetingUrl,
            unitQuorum: meeting.unitQuorum,
          },
        },
      });
      return instance;
    }, { maxWait: 10_000, timeout: 30_000 });
    // The meeting's own notices come with the agenda (AGENDA_ISSUED); the
    // generic "new workflow assignment" would tell the scheduler about their own meeting.
    await this.workflow.finishInstanceStart(prepared, started, organizationId, viewer.id, { notifyInitialAssignee: false });
    return this.getForViewer(meetingId, organizationId, viewer, now);
  }

  /** The new meeting's owner: exactly one ACTIVE committee or unit of this organisation. */
  private async resolveNewOwner(dto: Pick<ScheduleMeetingDto, 'committeeId' | 'orgUnitId'>, organizationId: string): Promise<MeetingOwner> {
    if (!!dto.committeeId === !!dto.orgUnitId) throw new MeetingRefusal('MEETING_OWNER_REQUIRED');
    if (dto.committeeId) {
      const committee = await this.prisma.committee.findFirst({
        where: { id: dto.committeeId, organizationId, isActive: true },
        select: { id: true, orgUnitId: true },
      });
      if (!committee) throw new MeetingRefusal('MEETING_OWNER_NOT_FOUND');
      return { key: 'new', committeeId: committee.id, unitId: committee.orgUnitId };
    }
    const unit = await this.prisma.orgUnit.findFirst({ where: { id: dto.orgUnitId!, organizationId, isActive: true }, select: { id: true } });
    if (!unit) throw new MeetingRefusal('MEETING_OWNER_NOT_FOUND');
    return { key: 'new', committeeId: null, unitId: unit.id };
  }

  /** An offered meeting_type value, shared or the organisation's own. */
  private async assertMeetingType(typeValueId: string, organizationId: string): Promise<void> {
    const values = await committeeTypeValues(this.prisma, organizationId, [typeValueId], MEETING_TYPE);
    if (!values.get(typeValueId)?.offered) throw new MeetingRefusal('MEETING_TYPE_UNKNOWN');
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async getForViewer(id: string, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting> {
    // A read: the head of a unit above may open it too (oversight).
    await this.visibility.assertCanViewOrNotFound('MEETING', id, organizationId, viewer.permissions, NOT_FOUND, viewer.id, {
      oversight: true,
      now,
    });
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        durationMinutes: true,
        location: true,
        meetingUrl: true,
        unitQuorum: true,
        typeValueId: true,
        updatedAt: true,
        committeeId: true,
        orgUnitId: true,
        committee: { select: { id: true, nameEn: true, nameAr: true, orgUnitId: true, quorumCount: true } },
        orgUnit: { select: { id: true, nameEn: true, nameAr: true } },
        organizer: { select: { id: true, name: true } },
        reschedules: { orderBy: { createdAt: 'desc' }, take: 1, select: { fromAt: true, reason: true, createdAt: true } },
      },
    });
    if (!meeting) throw new NotFoundException(NOT_FOUND);

    const owner: MeetingOwner = { key: id, committeeId: meeting.committeeId, unitId: meeting.orgUnitId ?? meeting.committee?.orgUnitId ?? null };
    const [rules, types, scheduler, mine] = await Promise.all([
      this.stageRules.currentStageRules('MEETING', id, organizationId),
      committeeTypeValues(this.prisma, organizationId, [meeting.typeValueId], MEETING_TYPE),
      isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now),
      this.prisma.meetingAttendee.findFirst({ where: { organizationId, meetingId: id, userId: viewer.id }, select: { answer: true, answerNote: true } }),
    ]);
    // ACC-316 PR 3b — the answers' summary, only for whoever may edit the meeting.
    const answers = scheduler ? await meetingAnswerSummary(this.prisma, id, organizationId, meeting.committee?.quorumCount ?? meeting.unitQuorum ?? null) : null;
    const started = meeting.scheduledAt <= now;
    const type = types.get(meeting.typeValueId);
    const latest = meeting.reschedules[0];
    return {
      id: meeting.id,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt,
      durationMinutes: meeting.durationMinutes,
      location: meeting.location,
      meetingUrl: meeting.meetingUrl,
      owner: this.ownerOf(meeting),
      stage: { id: rules.stageId, nameEn: rules.stageNameEn, nameAr: rules.stageNameAr, flags: rules.flags },
      type: type ? { id: type.id, labelEn: type.labelEn, labelAr: type.labelAr } : null,
      unitQuorum: meeting.unitQuorum,
      organizer: meeting.organizer,
      rescheduledFrom: latest ? { fromAt: latest.fromAt, reason: latest.reason, at: latest.createdAt } : null,
      updatedAt: meeting.updatedAt,
      may: {
        edit: scheduler && rules.actions[MEETING_ACTIONS.EDIT_DETAILS] === true,
        reschedule: scheduler && rules.actions[MEETING_ACTIONS.RESCHEDULE] === true,
        manageGuests: scheduler && rules.actions[MEETING_ACTIONS.MANAGE_GUESTS] === true,
        manageAgenda: scheduler && rules.actions[MEETING_ACTIONS.MANAGE_AGENDA] === true,
        answer: !!mine && !started && rules.actions[MEETING_ACTIONS.ANSWER_INVITATION] === true,
      },
      answers,
      myAnswer: mine ? { answer: mine.answer, note: mine.answerNote } : null,
    };
  }

  private ownerOf(m: {
    committee: { id: string; nameEn: string; nameAr: string | null } | null;
    orgUnit: { id: string; nameEn: string; nameAr: string | null } | null;
  }): IMeetingOwner {
    if (m.committee) return { kind: 'COMMITTEE', id: m.committee.id, nameEn: m.committee.nameEn, nameAr: m.committee.nameAr };
    return { kind: 'UNIT', id: m.orgUnit?.id ?? '', nameEn: m.orgUnit?.nameEn ?? '', nameAr: m.orgUnit?.nameAr ?? null };
  }

  // ── The list ────────────────────────────────────────────────────────────────

  /**
   * The saved views (Design 1) and "Sub-units' meetings" (Ahmad, 18 Nov). The
   * visibility rule is in the WHERE, before LIMIT; ordered by time with the id
   * last, so a page never repeats or skips. Two queries, then the page's
   * owners, types and stages in batches.
   *
   *   mine      meetings the viewer is a member of, or organised; upcoming, soonest first
   *
   * Every view keeps the visibility rule in its WHERE, so a listed row always
   * opens: an organiser who has since left the unit or committee no longer
   * lists the meeting they could not open.
   *   past      every meeting the viewer may see that has started; latest first
   *   minutes   meetings whose minutes the viewer records (meeting-authority's RECORDERS, as SQL)
   *   all       every meeting: meetings:view only
   *   subunits  meetings of the units the viewer heads or covers, and below, that no other clause gives them
   */
  async list(dto: ListMeetingsDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingList> {
    const view = dto.view ?? 'mine';
    const seesAll = viewer.permissions.includes(MEETINGS_PERMISSIONS.VIEW);
    if (view === 'all' && !seesAll) throw new ForbiddenException(`Required permission: ${MEETINGS_PERMISSIONS.VIEW}`);

    const oversight = [...(await meetingOversightUnitIds(this.prisma, organizationId, viewer.id, now))];
    const member = meetingMemberSql('m', viewer.id);
    const overseen = meetingOverseenSql('m', oversight);
    const visible = seesAll ? Prisma.sql`TRUE` : Prisma.sql`(${member} OR ${overseen})`;

    let where: Prisma.Sql;
    let order: Prisma.Sql;
    switch (view) {
      case 'mine':
        where = Prisma.sql`${visible} AND (${member} OR m."organizerId" = ${viewer.id}) AND m."scheduledAt" >= ${now}`;
        order = Prisma.sql`m."scheduledAt" ASC, m.id ASC`;
        break;
      case 'past':
        where = Prisma.sql`${visible} AND m."scheduledAt" < ${now}`;
        order = Prisma.sql`m."scheduledAt" DESC, m.id DESC`;
        break;
      case 'minutes':
        where = this.recorderSql(viewer);
        order = Prisma.sql`m."scheduledAt" DESC, m.id DESC`;
        break;
      case 'all':
        where = Prisma.sql`TRUE`;
        order = Prisma.sql`m."scheduledAt" DESC, m.id DESC`;
        break;
      case 'subunits':
        where = Prisma.sql`${overseen} AND NOT ${member}`;
        order = Prisma.sql`m."scheduledAt" DESC, m.id DESC`;
        break;
    }
    const owner = dto.committeeId
      ? Prisma.sql`m."committeeId" = ${dto.committeeId}`
      : dto.orgUnitId
        ? Prisma.sql`m."orgUnitId" = ${dto.orgUnitId}`
        : Prisma.sql`TRUE`;
    const base = Prisma.sql`m."organizationId" = ${organizationId} AND ${where} AND ${owner}`;

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM "Meeting" m WHERE ${base}
        ORDER BY ${order}
        LIMIT ${dto.take ?? PAGE} OFFSET ${dto.skip ?? 0}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM "Meeting" m WHERE ${base}`,
    ]);
    const ids = rows.map((r) => r.id);
    return { items: await this.listItems(ids, organizationId), total: Number(counts[0]?.total ?? 0) };
  }

  /**
   * meeting-authority.ts's RECORDERS for this viewer, as SQL: a committee seat
   * with record_minutes on the meeting's committee, or (a unit meeting) the
   * viewer's own unit with meetings:record_minutes, which the viewer's resolved
   * permissions already say.
   */
  private recorderSql(viewer: MeetingViewer): Prisma.Sql {
    const recordsKey = viewer.permissions.includes(MEETINGS_PERMISSIONS.RECORD_MINUTES);
    return Prisma.sql`(
      (m."committeeId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "CommitteeMember" cm
        JOIN "CommitteeSeatAction" sa
          ON sa."committeeId" = cm."committeeId" AND sa."roleValueId" = cm."roleValueId"
         AND sa."organizationId" = cm."organizationId" AND sa."actionKey" = ${SEAT_ACTIONS.RECORD_MINUTES}
        WHERE cm."committeeId" = m."committeeId" AND cm."organizationId" = m."organizationId"
          AND cm."userId" = ${viewer.id} AND cm."isActive"))
      OR (${recordsKey} AND m."orgUnitId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "User" u
        WHERE u.id = ${viewer.id} AND u."organizationId" = m."organizationId"
          AND u."primaryOrgUnitId" = m."orgUnitId" AND u.status = 'ACTIVE'))
    )`;
  }

  /** The page's rows, in the order given: one read of the meetings, one of their stages. */
  private async listItems(ids: string[], organizationId: string): Promise<IMeetingListItem[]> {
    if (ids.length === 0) return [];
    const [meetings, rules] = await Promise.all([
      this.prisma.meeting.findMany({
        where: { id: { in: ids }, organizationId },
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          durationMinutes: true,
          location: true,
          meetingUrl: true,
          committee: { select: { id: true, nameEn: true, nameAr: true } },
          orgUnit: { select: { id: true, nameEn: true, nameAr: true } },
        },
      }),
      this.stageRules.stageRulesFor(organizationId, 'MEETING', ids),
    ]);
    const byId = new Map(meetings.map((m) => [m.id, m]));
    return ids.flatMap((id) => {
      const m = byId.get(id);
      if (!m) return [];
      const r = rules.get(id);
      return [
        {
          id: m.id,
          title: m.title,
          scheduledAt: m.scheduledAt,
          durationMinutes: m.durationMinutes,
          location: m.location,
          meetingUrl: m.meetingUrl,
          owner: this.ownerOf(m),
          stage: { id: r?.stageId ?? null, nameEn: r?.stageNameEn ?? null, nameAr: r?.stageNameAr ?? null, flags: r?.flags ?? [] },
        },
      ];
    });
  }

  // ── Edit ────────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting> {
    const owner = await this.access.writing(id, organizationId, viewer, now);
    if (dto.title !== undefined && !dto.title.trim()) throw new MeetingRefusal('MEETING_TITLE_REQUIRED');
    if (dto.typeValueId !== undefined) await this.assertMeetingType(dto.typeValueId, organizationId);
    if (owner.committeeId && dto.unitQuorum != null) throw new MeetingRefusal('MEETING_QUORUM_UNIT_ONLY');

    await this.prisma.$transaction(async (tx) => {
      // The stage first (its instance FOR SHARE), then the meeting row.
      await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.EDIT_DETAILS, organizationId, tx, { lock: 'share' });
      const current = await this.lockMeeting(tx, id, organizationId, dto.expectedUpdatedAt);

      const next: Record<Editable, unknown> = { ...current };
      for (const field of EDITABLE) if (dto[field] !== undefined) next[field] = typeof dto[field] === 'string' ? (dto[field] as string).trim() : dto[field];
      if (!next['location'] && !next['meetingUrl']) throw new MeetingRefusal('MEETING_PLACE_REQUIRED');
      const changed = EDITABLE.filter((f) => next[f] !== current[f]);
      if (changed.length === 0) return;

      await tx.meeting.update({
        where: { id },
        data: Object.fromEntries(changed.map((f) => [f, next[f]])) as Prisma.MeetingUpdateInput,
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'UPDATE',
          objectType: 'Meeting',
          objectId: id,
          before: Object.fromEntries(changed.map((f) => [f, current[f]])) as Prisma.InputJsonObject,
          after: Object.fromEntries(changed.map((f) => [f, next[f]])) as Prisma.InputJsonObject,
        },
      });
    });
    return this.getForViewer(id, organizationId, viewer, now);
  }

  // ── Reschedule ──────────────────────────────────────────────────────────────

  async reschedule(id: string, dto: RescheduleMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting> {
    await this.access.writing(id, organizationId, viewer, now);
    const toAt = new Date(dto.scheduledAt);
    if (toAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    const reason = dto.reason.trim();

    const title = await this.prisma.$transaction(async (tx) => {
      await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.RESCHEDULE, organizationId, tx, { lock: 'share' });
      const current = await this.lockMeeting(tx, id, organizationId, dto.expectedUpdatedAt);
      if (current.scheduledAt.getTime() === toAt.getTime()) throw new MeetingRefusal('MEETING_RESCHEDULE_SAME_TIME');

      await tx.meetingReschedule.create({
        data: { organizationId, meetingId: id, fromAt: current.scheduledAt, toAt, reason, scope: 'THIS_ONLY', actorId: viewer.id },
      });
      await tx.meeting.update({ where: { id }, data: { scheduledAt: toAt } });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'UPDATE',
          objectType: 'Meeting',
          objectId: id,
          before: { scheduledAt: current.scheduledAt.toISOString() },
          after: { scheduledAt: toAt.toISOString() },
          metadata: { change: 'reschedule', reason },
        },
      });
      return current.title;
    });

    // The new time, absolute, in the organisation's zone, with Latin digits.
    const when = peopleDateIn(toAt, await this.calendar.getEffectiveTimeZone(organizationId));
    const invited = await this.invitedPeople(id, organizationId);
    await notifyUsers(this.notifications, organizationId, id, viewer.id, invited.userIds, rescheduledNotice(title, when, reason));
    // Outside guests only if they were invited (Answers, round 4).
    await emailOutsideGuests(this.notifications, organizationId, id, invited.outsideEmails, outsideRescheduledEmail(title, invited.organisation, when, reason));
    return this.getForViewer(id, organizationId, viewer, now);
  }

  // ── Shared ──────────────────────────────────────────────────────────────────

  /** The meeting row FOR UPDATE, after the instance; a stale `expectedUpdatedAt` is MEETING_CHANGED. */
  private async lockMeeting(
    tx: EngineTx,
    id: string,
    organizationId: string,
    expectedUpdatedAt: string | undefined,
  ): Promise<Record<Editable, unknown> & { scheduledAt: Date; title: string }> {
    await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const row = await tx.meeting.findFirst({
      where: { id, organizationId },
      select: { title: true, typeValueId: true, durationMinutes: true, location: true, meetingUrl: true, unitQuorum: true, scheduledAt: true, updatedAt: true },
    });
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new MeetingRefusal('MEETING_CHANGED');
    return row;
  }

  /** After a commit: everyone already invited — the users to tell, the outside guests to email. */
  private async invitedPeople(
    meetingId: string,
    organizationId: string,
  ): Promise<{ userIds: string[]; outsideEmails: string[]; organisation: OrganisationNames }> {
    const [rows, organization] = await Promise.all([
      this.prisma.meetingAttendee.findMany({
        where: { organizationId, meetingId, invitedAt: { not: null } },
        select: { userId: true, kind: true, outsideEmail: true },
      }),
      this.prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true, nameAr: true } }),
    ]);
    return {
      userIds: rows.filter((r) => r.userId).map((r) => r.userId!),
      outsideEmails: rows.filter((r) => r.kind === 'OUTSIDE_GUEST' && r.outsideEmail).map((r) => r.outsideEmail!),
      organisation: organisationNames(organization),
    };
  }
}
