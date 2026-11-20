import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import {
  meetingInviteeSql,
  meetingMayOpenSql,
  meetingMemberSql,
  meetingOversightUnitIds,
  meetingOverseenSql,
  wouldSeeNewMeeting,
} from '../../common/services/meeting-membership';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { peopleDateIn } from '../task/task-sla.service';
import { insertMeetingsInTx } from './meeting-create';
import { meetingAnswerSummary } from './meeting-people.service';
import { outsideRescheduledEmail, rescheduledNotice } from './meeting-notices';
import { emailOutsideGuests, notifyUsers, organisationNames, type OrganisationNames } from './meeting-send';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { COMMITTEE_ACTIONS, MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
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
/** PR 8b (P240) — the whole series view's hard cap: a series' most meetings (weekly for twelve months, CLASH_TIMES_CAP). */
export const SERIES_LIST_CAP = 53;
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
    // ACC-316 PR 6 — never write a meeting its scheduler could not then open
    // (the parent rule for a new meeting, as may-schedule asks). Since Ahmad's
    // 19 Nov decision every scheduler sees what they schedule, so this refuses
    // nothing today; it is what keeps a create from answering 404 if the two
    // rules ever part again.
    if (!viewer.permissions.includes(MEETINGS_PERMISSIONS.VIEW) && !(await wouldSeeNewMeeting(this.prisma, organizationId, owner, viewer.id, now))) {
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
      const [started] = await insertMeetingsInTx(tx, this.workflow, [prepared], [{
        id: meetingId,
        organizationId,
        owner,
        organizerId: viewer.id,
        title,
        typeValueId: dto.typeValueId,
        scheduledAt,
        durationMinutes: dto.durationMinutes,
        location: dto.location ?? null,
        meetingUrl: dto.meetingUrl ?? null,
        unitQuorum: dto.unitQuorum ?? null,
      }]);
      return started!;
    }, { maxWait: 10_000, timeout: 30_000 });
    // The meeting's own notices come with the agenda (AGENDA_ISSUED); the
    // generic "new workflow assignment" would tell the scheduler about their own meeting.
    await this.workflow.finishInstanceStart(prepared, started, organizationId, viewer.id, { notifyInitialAssignee: false });
    return this.getForViewer(meetingId, organizationId, viewer, now);
  }

  /** The new meeting's owner: exactly one ACTIVE committee or unit of this organisation. */
  async resolveNewOwner(dto: Pick<ScheduleMeetingDto, 'committeeId' | 'orgUnitId'>, organizationId: string): Promise<MeetingOwner> {
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
  async assertMeetingType(typeValueId: string, organizationId: string): Promise<void> {
    const values = await committeeTypeValues(this.prisma, organizationId, [typeValueId], MEETING_TYPE);
    if (!values.get(typeValueId)?.offered) throw new MeetingRefusal('MEETING_TYPE_UNKNOWN');
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  /**
   * ACC-316 PR 6 — whether Schedule meeting is offered for this committee or
   * unit: exactly when schedule() would make a meeting this person can then
   * open. Three answers, read at once, each one schedule() checks too: the
   * SCHEDULERS predicate (meeting-authority.ts); for a committee, its stage's
   * `schedule_meeting` (a Dissolved committee schedules nothing); and the
   * parent rule for a new meeting of this owner (meetings:view, or
   * wouldSeeNewMeeting()). Since 19 Nov (Ahmad) a scheduler always sees what
   * they schedule (meeting-membership.ts's SCHEDULER clause), so the last
   * answer only guards against the two rules parting. Another organisation's
   * owner is MEETING_OWNER_NOT_FOUND, as schedule() answers.
   */
  async maySchedule(dto: { committeeId?: string; orgUnitId?: string }, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ may: boolean }> {
    const owner = await this.resolveNewOwner(dto, organizationId);
    const [schedules, stageAllows, sees] = await Promise.all([
      isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now),
      owner.committeeId ? this.stageRules.stageAllows('COMMITTEE', owner.committeeId, COMMITTEE_ACTIONS.SCHEDULE_MEETING, organizationId) : Promise.resolve(true),
      viewer.permissions.includes(MEETINGS_PERMISSIONS.VIEW) ? Promise.resolve(true) : wouldSeeNewMeeting(this.prisma, organizationId, owner, viewer.id, now),
    ]);
    return { may: schedules && stageAllows && sees };
  }

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
        seriesIndex: true,
        series: {
          select: {
            id: true,
            every: true,
            onKind: true,
            weekday: true,
            dayOfMonth: true,
            ordinal: true,
            firstDate: true,
            endsOn: true,
            count: true,
            endedAt: true,
            _count: { select: { meetings: true } },
          },
        },
      },
    });
    if (!meeting) throw new NotFoundException(NOT_FOUND);

    const owner: MeetingOwner = { key: id, committeeId: meeting.committeeId, unitId: meeting.orgUnitId ?? meeting.committee?.orgUnitId ?? null };
    const [rules, types, scheduler, mine, neighbours] = await Promise.all([
      this.stageRules.currentStageRules('MEETING', id, organizationId),
      committeeTypeValues(this.prisma, organizationId, [meeting.typeValueId], MEETING_TYPE),
      isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now),
      this.prisma.meetingAttendee.findFirst({ where: { organizationId, meetingId: id, userId: viewer.id }, select: { answer: true, answerNote: true } }),
      meeting.series
        ? this.seriesNeighbours(meeting.series.id, id, meeting.series.endedAt !== null, organizationId, viewer, now)
        : Promise.resolve({ previousId: null, previousAt: null, nextId: null, nextAt: null, endedAfter: null }),
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
      series: meeting.series
        ? {
            id: meeting.series.id,
            index: meeting.seriesIndex ?? 0,
            total: meeting.series._count.meetings,
            every: meeting.series.every,
            ended: meeting.series.endedAt !== null,
            // PR 8-be (P236, Q1) — what the header's readback needs.
            on: { kind: meeting.series.onKind, weekday: meeting.series.weekday, dayOfMonth: meeting.series.dayOfMonth, ordinal: meeting.series.ordinal },
            firstDate: meeting.series.firstDate.toISOString().slice(0, 10),
            endsOn: meeting.series.endsOn?.toISOString().slice(0, 10) ?? null,
            count: meeting.series.count,
            previousId: neighbours.previousId,
            nextId: neighbours.nextId,
            // PR 8b (P239) — the links' dates, and where an ended series stopped.
            previousAt: neighbours.previousAt,
            nextAt: neighbours.nextAt,
            endedAfter: neighbours.endedAfter,
          }
        : null,
    };
  }

  /**
   * PR 8-be (P236, Q1) — the series' previous and next meetings for the
   * header's links: the nearest ones not cancelled, and only ones this viewer
   * may open, else null. One indexed read of the series' meetings in order,
   * then their stages and who may open them, each in one batch
   * (`MeetingAccess.openable()`, canSee()'s rule batched, never a second copy),
   * and the nearest on each side picked in memory: a fixed number of queries
   * whatever the series' size (P237).
   *
   * PR 8b (P239) — from the same rows, with no further query: each link's date
   * (the header names it, "‹ 27 Aug 2026"), and for an ENDED series the place
   * of its last meeting not cancelled ("ended after 4 of 12"; 0 when every one
   * was cancelled), null while it runs. That is a fact about the series, like
   * its total, so it counts meetings this viewer can't open; it names none.
   */
  private async seriesNeighbours(
    seriesId: string,
    id: string,
    ended: boolean,
    organizationId: string,
    viewer: MeetingViewer,
    now: Date,
  ): Promise<{ previousId: string | null; previousAt: Date | null; nextId: string | null; nextAt: Date | null; endedAfter: number | null }> {
    const rows = await this.prisma.meeting.findMany({
      where: { organizationId, seriesId },
      orderBy: [{ seriesIndex: 'asc' }, { scheduledAt: 'asc' }, { id: 'asc' }],
      select: { id: true, seriesIndex: true, scheduledAt: true },
    });
    const at = rows.findIndex((r) => r.id === id);
    if (at < 0) return { previousId: null, previousAt: null, nextId: null, nextAt: null, endedAfter: null };
    const others = rows.filter((r) => r.id !== id).map((r) => r.id);
    const [rules, open] = await Promise.all([
      this.stageRules.stageRulesFor(organizationId, 'MEETING', rows.map((r) => r.id)),
      this.access.openable(others, organizationId, viewer, now),
    ]);
    const live = (r: { id: string }) => !rules.get(r.id)?.flags.includes(STAGE_FLAG.MEETING_CANCELLED);
    const nearest = (candidates: typeof rows) => candidates.find((c) => live(c) && open.has(c.id)) ?? null;
    const previous = nearest(rows.slice(0, at).reverse());
    const next = nearest(rows.slice(at + 1));
    const held = rows.filter(live).map((r) => r.seriesIndex ?? 0);
    return {
      previousId: previous?.id ?? null,
      previousAt: previous?.scheduledAt ?? null,
      nextId: next?.id ?? null,
      nextAt: next?.scheduledAt ?? null,
      endedAfter: ended ? (held.length > 0 ? Math.max(...held) : 0) : null,
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
   *   mine      meetings the viewer is invited to (a member, a person of the unit, an
   *             invitee) or organised; upcoming, soonest first. Not as a scheduler.
   *
   * Every view keeps the visibility rule in its WHERE, so a listed row always
   * opens: an organiser who has since left the unit or committee no longer
   * lists the meeting they could not open.
   *   upcoming  every meeting the viewer may see that has not started; soonest first
   *             (the committee and unit panels, which list by owner)
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
    // P240 — who may open a meeting: the parent rule's one SQL form (meeting-membership.ts), never a copy.
    const visible = meetingMayOpenSql('m', { viewerId: viewer.id, seesAll, oversight });

    let where: Prisma.Sql;
    let order: Prisma.Sql;
    switch (view) {
      case 'mine':
        // Invited or organiser (P189): the MEMBER clause without SCHEDULER.
        where = Prisma.sql`${visible} AND (${meetingInviteeSql('m', viewer.id)} OR m."organizerId" = ${viewer.id}) AND m."scheduledAt" >= ${now}`;
        order = Prisma.sql`m."scheduledAt" ASC, m.id ASC`;
        break;
      case 'upcoming':
        where = Prisma.sql`${visible} AND m."scheduledAt" >= ${now}`;
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
      case 'series':
        // PR 8b (P240) — the whole series: every meeting of it this viewer may
        // open, past and future, cancelled ones included, by date.
        where = visible;
        order = Prisma.sql`m."scheduledAt" ASC, m.id ASC`;
        break;
    }
    const owner = dto.committeeId
      ? Prisma.sql`m."committeeId" = ${dto.committeeId}`
      : dto.orgUnitId
        ? Prisma.sql`m."orgUnitId" = ${dto.orgUnitId}`
        : Prisma.sql`TRUE`;
    const series = dto.seriesId ? Prisma.sql`m."seriesId" = ${dto.seriesId}` : Prisma.sql`TRUE`;
    // ACC-316 PR 6 — the list's search, on the title; LIKE's own wildcards are matched literally.
    const term = dto.q?.trim();
    const search = term ? Prisma.sql`m.title ILIKE ${'%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%'}` : Prisma.sql`TRUE`;
    const base = Prisma.sql`m."organizationId" = ${organizationId} AND ${where} AND ${owner} AND ${series} AND ${search}`;

    // The whole series is one answer, never paged: at most SERIES_LIST_CAP meetings (a series' most).
    const series_ = view === 'series';
    const [limit, offset] = series_ ? [SERIES_LIST_CAP, 0] : [dto.take ?? PAGE, dto.skip ?? 0];
    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT m.id FROM "Meeting" m WHERE ${base}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*)::bigint AS total FROM "Meeting" m WHERE ${base}`,
    ]);
    const ids = rows.map((r) => r.id);
    return { items: await this.listItems(ids, organizationId, series_), total: Number(counts[0]?.total ?? 0), canSeeAll: seesAll };
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
  private async listItems(ids: string[], organizationId: string, withReschedule = false): Promise<IMeetingListItem[]> {
    if (ids.length === 0) return [];
    const [meetings, rules, moved] = await Promise.all([
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
      // PR 8b — the series view's "Rescheduled from …": each meeting's latest stored reschedule, one batch.
      withReschedule
        ? this.prisma.meetingReschedule.findMany({
            where: { organizationId, meetingId: { in: ids } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            distinct: ['meetingId'],
            select: { meetingId: true, fromAt: true },
          })
        : Promise.resolve([]),
    ]);
    const fromAt = new Map(moved.map((r) => [r.meetingId, r.fromAt]));
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
          ...(withReschedule && { movedFrom: fromAt.get(id) ?? null }),
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
        data: {
          ...(Object.fromEntries(changed.map((f) => [f, next[f]])) as Prisma.MeetingUpdateInput),
          // ACC-316 PR 5 — a series meeting changed on its own keeps it: "this and all later" skips these.
          ...(current.seriesId && { ownEdits: [...new Set([...current.ownEdits, ...changed])] }),
        },
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
      await tx.meeting.update({
        where: { id },
        data: { scheduledAt: toAt, ...(current.seriesId && { ownEdits: [...new Set([...current.ownEdits, 'scheduledAt'])] }) },
      });
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

    await this.tellRescheduled(id, title, toAt, reason, organizationId, viewer.id);
    return this.getForViewer(id, organizationId, viewer, now);
  }

  /** After a commit: everyone invited is told the new time and the reason (outside guests by email, only if invited). */
  async tellRescheduled(id: string, title: string, toAt: Date, reason: string, organizationId: string, actorId: string): Promise<void> {
    // The new time, absolute, in the organisation's zone, with Latin digits.
    const when = peopleDateIn(toAt, await this.calendar.getEffectiveTimeZone(organizationId));
    const invited = await this.invitedPeople(id, organizationId);
    await notifyUsers(this.notifications, organizationId, id, actorId, invited.userIds, rescheduledNotice(title, when, reason));
    // Outside guests only if they were invited (Answers, round 4).
    await emailOutsideGuests(this.notifications, organizationId, id, invited.outsideEmails, outsideRescheduledEmail(title, invited.organisation, when, reason));
  }

  // ── Shared ──────────────────────────────────────────────────────────────────

  /** The meeting row FOR UPDATE, after the instance; a stale `expectedUpdatedAt` is MEETING_CHANGED. */
  private async lockMeeting(
    tx: EngineTx,
    id: string,
    organizationId: string,
    expectedUpdatedAt: string | undefined,
  ): Promise<Record<Editable, unknown> & { scheduledAt: Date; title: string; seriesId: string | null; ownEdits: string[] }> {
    await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const row = await tx.meeting.findFirst({
      where: { id, organizationId },
      select: {
        title: true,
        typeValueId: true,
        durationMinutes: true,
        location: true,
        meetingUrl: true,
        unitQuorum: true,
        scheduledAt: true,
        updatedAt: true,
        seriesId: true,
        ownEdits: true,
      },
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
