import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService, type StageRules } from '../workflow/stage-rules.service';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { COMMITTEE_ACTIONS, MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { MeetingsService } from './meetings.service';
import { DEFAULT_MINUTES, MeetingClashService } from './meeting-clash.service';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import { mayActInStagePool } from '../workflow/stage-pool.service';
import { insertMeetingsInTx, ownerMembers, type NewMeeting } from './meeting-create';
import { patternDays, seriesTitle, type SeriesPattern } from './meeting-series-dates';
import { searchOrgPeople } from './meeting-people.service';
import type { CheckMeetingClashesDto, CreateMeetingSeriesDto, EndMeetingSeriesDto, EndMeetingSeriesPreviewDto, MeetingScopePreviewDto, PresenterCandidatesQueryDto, RescheduleMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import type { IMeeting, IMeetingEndSeriesPreview, IMeetingGuestCandidates, IMeetingScopePreview, IMeetingScopeResult, IMeetingSeriesDate, IMeetingSeriesPreview } from './interfaces/meeting.interface';

/** The fields "this and all later" carries to later meetings. The title is each meeting's own (plan §3.2). */
const SERIES_FIELDS = ['typeValueId', 'durationMinutes', 'location', 'meetingUrl', 'unitQuorum'] as const;
type SeriesField = (typeof SERIES_FIELDS)[number];
/** A series' transaction writes up to 53 meetings with their instances. */
const SERIES_TX = { maxWait: 10_000, timeout: 120_000 } as const;
/** How far a moved day may walk forward looking for a free working day. */
const MOVE_LIMIT = 31;

/** What an edit reads of each meeting it may change. */
const EDIT_ROW = { id: true, title: true, typeValueId: true, durationMinutes: true, location: true, meetingUrl: true, unitQuorum: true, ownEdits: true, updatedAt: true } as const;
/** What a reschedule reads of each meeting it may move. */
const MOVE_ROW = { id: true, title: true, scheduledAt: true, ownEdits: true, updatedAt: true, seriesIndex: true, durationMinutes: true } as const;

/** A meeting "this and all later" may move, as read (under its lock in the write, without one in the preview). */
interface MovingRow {
  id: string;
  title: string;
  scheduledAt: Date;
  ownEdits: string[];
  seriesIndex: number;
  durationMinutes: number | null;
}

interface EditRow {
  title: string;
  typeValueId: string;
  durationMinutes: number | null;
  location: string | null;
  meetingUrl: string | null;
  unitQuorum: number | null;
  ownEdits: string[];
}

/** The series fields an edit asks for, trimmed. */
function wantedFields(dto: Partial<Record<SeriesField, unknown>>): Partial<Record<SeriesField, unknown>> {
  const wanted: Partial<Record<SeriesField, unknown>> = {};
  for (const f of SERIES_FIELDS) if (dto[f] !== undefined) wanted[f] = typeof dto[f] === 'string' ? (dto[f] as string).trim() : dto[f];
  return wanted;
}

/**
 * THE EDIT RULE for "this and all later", ONE copy, used by the write and the
 * preview: the fields this meeting changes, and those it keeps as its own (a
 * later meeting's `ownEdits`). The anchor alone may change its title, and its
 * change is the series': its own edits of those fields stop being its own. A
 * meeting left with neither a place nor a link is refused.
 */
function planEdit(row: EditRow, anchor: boolean, wanted: Partial<Record<SeriesField, unknown>>, title: string | undefined): { keep: SeriesField[]; data: Record<string, unknown> } {
  const keep = anchor ? [] : SERIES_FIELDS.filter((f) => wanted[f] !== undefined && row.ownEdits.includes(f));
  const fields = SERIES_FIELDS.filter((f) => wanted[f] !== undefined && !keep.includes(f) && wanted[f] !== row[f]);
  const data: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f, wanted[f]]));
  if (anchor && title !== undefined && title.trim() !== row.title) data['title'] = title.trim();
  const location = 'location' in data ? data['location'] : row.location;
  const link = 'meetingUrl' in data ? data['meetingUrl'] : row.meetingUrl;
  if (!location && !link) throw new MeetingRefusal('MEETING_PLACE_REQUIRED');
  if (anchor && Object.keys(data).length > 0) data['ownEdits'] = row.ownEdits.filter((f) => !(f in data));
  return { keep, data };
}

interface Planned {
  owner: MeetingOwner;
  subject: string;
  startMinute: number;
  dates: IMeetingSeriesDate[];
}

/**
 * ACC-316 PR 5 — A MEETING SERIES (plan step-316 §3.2, §3.10):
 *
 *   preview  the dates the repeat makes, each moved off a weekend, a holiday
 *            or a day the owner already meets, with its title, and their
 *            clashes (one batched query, MeetingClashService).
 *   create   the series and EVERY meeting it makes, each with its instance, its
 *            invitees and the standing agenda, in ONE transaction. At most 12
 *            months ahead (53 meetings).
 *   end      cancels every later meeting still in Planned or Agenda Issued,
 *            each by its own Cancel Meeting with the reason (so each tells its
 *            invitees), then stamps endedAt.
 *   "this and all later" edit and reschedule: this meeting and the later ones
 *            still in Planned or Agenda Issued; a field a later meeting changed
 *            on its own (`ownEdits`) is kept, and the answer says so.
 *
 * WHO: whoever schedules for the owner (meeting-authority.ts's SCHEDULERS),
 * as for one meeting. WHAT: each meeting's stage (the instance FOR SHARE, then
 * the meeting row FOR UPDATE, meeting by meeting in id order). Working days
 * are WorkingCalendarService's. Notices after the commit.
 */
@Injectable()
export class MeetingSeriesService {
  private readonly logger = new Logger(MeetingSeriesService.name);
  private readonly access: MeetingAccess;

  constructor(
    private readonly prisma: PrismaService,
    visibility: ObjectVisibilityService,
    private readonly workflow: WorkflowService,
    private readonly stageRules: StageRulesService,
    private readonly calendar: WorkingCalendarService,
    private readonly meetings: MeetingsService,
    private readonly clashes: MeetingClashService,
  ) {
    this.access = new MeetingAccess(prisma, visibility);
  }

  /**
   * PR 8a (Q5) — who a standing agenda item may name as presenter, for a series
   * not yet made: anyone ACTIVE in the organisation (one not invited becomes a
   * guest of each meeting, as built). Asked only by whoever may schedule for
   * that owner, by the schedule's own answer (maySchedule()); anyone else is
   * MEETING_NOT_ALLOWED, and another organisation's owner
   * MEETING_OWNER_NOT_FOUND, as schedule() answers.
   */
  async presenterCandidates(dto: PresenterCandidatesQueryDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingGuestCandidates> {
    const { may } = await this.meetings.maySchedule(dto, organizationId, viewer, now);
    if (!may) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    return searchOrgPeople(this.prisma, organizationId, dto);
  }

  // ── Preview and create ──────────────────────────────────────────────────────

  async preview(dto: CreateMeetingSeriesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingSeriesPreview> {
    const plan = await this.plan(dto, organizationId, viewer, now);
    const clashes = await this.clashes.check(
      {
        ...(plan.owner.committeeId ? { committeeId: plan.owner.committeeId } : { orgUnitId: plan.owner.unitId! }),
        times: plan.dates.map((d) => ({ startsAt: d.startsAt.toISOString(), durationMinutes: dto.durationMinutes })),
      },
      organizationId,
      viewer,
      now,
    );
    return { dates: plan.dates, clashes };
  }

  async create(dto: CreateMeetingSeriesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ seriesId: string; meetingIds: string[] }> {
    const plan = await this.plan(dto, organizationId, viewer, now);
    const presenters = await this.standingPresenters(dto, organizationId);
    const seriesId = randomUUID();
    const ids = plan.dates.map(() => randomUUID());
    // Every engine read first, once for the whole series: the template and first
    // stage, shared by every meeting.
    const prepared = await this.workflow.prepareInstanceStarts('MEETING', ids, organizationId);
    const meetings: NewMeeting[] = plan.dates.map((date, i) => ({
      id: ids[i]!,
      organizationId,
      owner: plan.owner,
      organizerId: viewer.id,
      title: date.title,
      typeValueId: dto.typeValueId,
      scheduledAt: date.startsAt,
      durationMinutes: dto.durationMinutes,
      location: dto.location ?? null,
      meetingUrl: dto.meetingUrl ?? null,
      unitQuorum: dto.unitQuorum ?? null,
      seriesId,
      seriesIndex: date.index,
    }));

    const started = await this.prisma.$transaction(async (tx) => {
      if (plan.owner.committeeId) {
        await this.stageRules.assertStageAllows('COMMITTEE', plan.owner.committeeId, COMMITTEE_ACTIONS.SCHEDULE_MEETING, organizationId, tx, { lock: 'share' });
      }
      await tx.meetingSeries.create({
        data: {
          id: seriesId,
          organizationId,
          committeeId: plan.owner.committeeId,
          orgUnitId: plan.owner.committeeId ? null : plan.owner.unitId,
          subject: plan.subject,
          typeValueId: dto.typeValueId,
          startMinute: plan.startMinute,
          durationMinutes: dto.durationMinutes,
          location: dto.location ?? null,
          meetingUrl: dto.meetingUrl ?? null,
          every: dto.every,
          onKind: dto.onKind,
          weekday: dto.weekday ?? null,
          dayOfMonth: dto.dayOfMonth ?? null,
          ordinal: dto.ordinal ?? null,
          firstDate: new Date(`${dto.firstDate.slice(0, 10)}T00:00:00.000Z`),
          endsOn: dto.endsOn ? new Date(`${dto.endsOn.slice(0, 10)}T00:00:00.000Z`) : null,
          count: dto.count ?? null,
          standingAgenda: (dto.standingAgenda ?? []) as unknown as Prisma.InputJsonValue,
          createdById: viewer.id,
        },
      });
      // The owner's invitees, read ONCE and inside the transaction (as schedule()
      // reads them), so a membership change can't leave every meeting stale.
      const members = await ownerMembers(tx, organizationId, plan.owner);
      const { attendees, items } = standingRows(organizationId, ids, members, dto, presenters, viewer.id);
      // Batched: the rows, the invitees (presenters included), the audit rows; the instances one by one.
      const out = await insertMeetingsInTx(tx, this.workflow, prepared, meetings, { attendees });
      if (items.length > 0) await tx.agendaItem.createMany({ data: items });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'CREATE',
          objectType: 'MeetingSeries',
          objectId: seriesId,
          after: { every: dto.every, onKind: dto.onKind, firstDate: dto.firstDate, endsOn: dto.endsOn ?? null, count: dto.count ?? null, meetings: ids.length },
        },
      });
      return out;
    }, SERIES_TX);

    // After the commit the series exists: one meeting whose notices fail is
    // logged and the others still go, and the answer is still the series (a
    // 500 here would invite a retry that makes a second series).
    for (const [i, s] of started.entries()) {
      try {
        await this.workflow.finishInstanceStart(prepared[i]!, s, organizationId, viewer.id, { notifyInitialAssignee: false });
      } catch (error) {
        this.logger.error(`Series ${seriesId}: finishing meeting ${ids[i]} in org ${organizationId} failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
    return { seriesId, meetingIds: ids };
  }

  /** The owner, the checks a single meeting has, and the placed dates with their titles. */
  private async plan(dto: CreateMeetingSeriesDto, organizationId: string, viewer: MeetingViewer, now: Date): Promise<Planned> {
    const owner = await this.meetings.resolveNewOwner(dto, organizationId);
    if (!(await isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    const subject = dto.subject.trim();
    if (!subject) throw new MeetingRefusal('MEETING_TITLE_REQUIRED');
    if (owner.committeeId && dto.unitQuorum != null) throw new MeetingRefusal('MEETING_QUORUM_UNIT_ONLY');
    if (!dto.location && !dto.meetingUrl) throw new MeetingRefusal('MEETING_PLACE_REQUIRED');
    const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dto.startTime);
    if (!time) throw new MeetingRefusal('MEETING_SERIES_TIME_INVALID');
    const startMinute = Number(time[1]) * 60 + Number(time[2]);
    await this.meetings.assertMeetingType(dto.typeValueId, organizationId);

    const [zone, organization] = await Promise.all([
      this.calendar.getEffectiveTimeZone(organizationId),
      this.prisma.organization.findFirst({ where: { id: organizationId }, select: { language: true } }),
    ]);
    const today = DateTime.fromJSDate(now).setZone(zone);
    const limit = today.plus({ months: 12 }).toISODate()!;
    const pattern: SeriesPattern = { ...dto, firstDate: dto.firstDate.slice(0, 10), endsOn: dto.endsOn?.slice(0, 10) ?? null };
    const days = patternDays(pattern, limit);
    if (!days.ok) throw new MeetingRefusal(days.code, { field: days.field, ...(days.limit && { limit: days.limit }) });

    // The owner's meetings already on those days (not cancelled): ONE read, then their stages in one batch.
    const from = DateTime.fromISO(days.days[0]!, { zone }).startOf('day').toJSDate();
    const to = DateTime.fromISO(days.days.at(-1)!, { zone }).plus({ days: MOVE_LIMIT + 1 }).toJSDate();
    const existing = await this.prisma.meeting.findMany({
      where: { organizationId, ...(owner.committeeId ? { committeeId: owner.committeeId } : { committeeId: null, orgUnitId: owner.unitId }), scheduledAt: { gte: from, lt: to } },
      select: { id: true, scheduledAt: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', existing.map((m) => m.id));
    const taken = new Set(
      existing.filter((m) => !rules.get(m.id)?.flags.includes(STAGE_FLAG.MEETING_CANCELLED)).map((m) => DateTime.fromJSDate(m.scheduledAt).setZone(zone).toISODate()!),
    );

    const dates: IMeetingSeriesDate[] = [];
    for (const [i, patternDay] of days.days.entries()) {
      const working = await this.calendar.nextWorkingDay(patternDay, organizationId);
      let held = working;
      for (let step = 0; taken.has(held) && step < MOVE_LIMIT; step++) {
        held = await this.calendar.nextWorkingDay(DateTime.fromISO(held, { zone: 'UTC' }).plus({ days: 1 }).toISODate()!, organizationId);
      }
      taken.add(held);
      // The wall-clock time in the zone, so a clock change never moves it (an elapsed-minutes add would).
      const startsAt = DateTime.fromISO(held, { zone }).set({ hour: Math.floor(startMinute / 60), minute: startMinute % 60 }).toJSDate();
      dates.push({
        index: i + 1,
        patternDay,
        day: held,
        startsAt,
        title: seriesTitle(subject, dto.every, patternDay, held, organization?.language ?? 'en'),
        moved: held === patternDay ? null : held === working ? 'NOT_WORKING_DAY' : 'OWNER_MEETS',
      });
    }
    if (dates[0]!.startsAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    return { owner, subject, startMinute, dates };
  }

  /** Each standing item's presenter: an ACTIVE person of the organisation. */
  private async standingPresenters(dto: CreateMeetingSeriesDto, organizationId: string): Promise<Set<string>> {
    const ids = [...new Set((dto.standingAgenda ?? []).map((i) => i.presenterUserId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Set();
    const found = await this.prisma.user.findMany({ where: { organizationId, id: { in: ids }, status: 'ACTIVE' }, select: { id: true } });
    if (found.length !== ids.length) throw new MeetingRefusal('MEETING_PRESENTER_NOT_FOUND');
    return new Set(found.map((u) => u.id));
  }

  // ── End series ──────────────────────────────────────────────────────────────

  /**
   * The series, for whoever may schedule for its owner (End and its preview).
   * Another organisation's series is MEETING_SERIES_NOT_FOUND, as an invented id is.
   */
  private async seriesForEnd(seriesId: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<{ endedAt: Date | null }> {
    const series = await this.prisma.meetingSeries.findFirst({
      where: { id: seriesId, organizationId },
      select: { id: true, committeeId: true, orgUnitId: true, endedAt: true, committee: { select: { orgUnitId: true } } },
    });
    if (!series) throw new MeetingRefusal('MEETING_SERIES_NOT_FOUND');
    const owner: MeetingOwner = { key: seriesId, committeeId: series.committeeId, unitId: series.orgUnitId ?? series.committee?.orgUnitId ?? null };
    if (!(await isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    return { endedAt: series.endedAt };
  }

  /**
   * PR 8d (Q4) — what End would do, the write's and the preview's one rule:
   * the series keeps its last meeting and those before it, and every LATER
   * meeting still in Planned or Agenda Issued (its stage allows Reschedule)
   * is cancelled. The last meeting is `lastMeetingId`, a meeting of THIS
   * series (another series', another organisation's or an invented id is
   * MEETING_NOT_IN_SERIES), else the next meeting held: the first of the
   * open ones. Three queries whatever the series' size.
   */
  private async endPlan(
    seriesId: string,
    lastMeetingId: string | undefined,
    organizationId: string,
    now: Date,
  ): Promise<{ last: { id: string; scheduledAt: Date } | null; open: { id: string; scheduledAt: Date }[]; meetings: { id: string; scheduledAt: Date }[]; rules: Map<string, StageRules> }> {
    const meetings = await this.prisma.meeting.findMany({
      where: { organizationId, seriesId },
      orderBy: [{ seriesIndex: 'asc' }, { id: 'asc' }],
      select: { id: true, scheduledAt: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', meetings.map((m) => m.id));
    const isOpen = (m: { id: string; scheduledAt: Date }): boolean => m.scheduledAt > now && rules.get(m.id)?.actions[MEETING_ACTIONS.RESCHEDULE] === true;
    let at: number;
    if (lastMeetingId !== undefined) {
      at = meetings.findIndex((m) => m.id === lastMeetingId);
      if (at < 0) throw new MeetingRefusal('MEETING_NOT_IN_SERIES');
    } else {
      at = meetings.findIndex(isOpen);
    }
    const last = at >= 0 ? meetings[at]! : null;
    // No open meeting to keep: nothing is left to cancel.
    const open = at >= 0 ? meetings.slice(at + 1).filter(isOpen) : [];
    return { last, open, meetings, rules };
  }

  /**
   * PR 8d — End series' confirm, before End: the last meeting, the meetings it
   * would cancel, and how many have been held (started, not cancelled). The
   * write's own plan, read-only: no write, no lock. Same who-may-ask as End.
   */
  async endPreview(seriesId: string, dto: EndMeetingSeriesPreviewDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingEndSeriesPreview> {
    await this.seriesForEnd(seriesId, organizationId, viewer, now);
    const { last, open, meetings, rules } = await this.endPlan(seriesId, dto.lastMeetingId, organizationId, now);
    const held = meetings.filter((m) => m.scheduledAt <= now && !(rules.get(m.id)?.flags ?? []).includes(STAGE_FLAG.MEETING_CANCELLED)).length;
    return {
      last: last ? { id: last.id, startsAt: last.scheduledAt } : null,
      cancelled: open.map((m) => ({ id: m.id, startsAt: m.scheduledAt })),
      held,
      total: meetings.length,
    };
  }

  /**
   * Cancels every meeting after the last one kept (endPlan) still in Planned
   * or Agenda Issued, each by its own Cancel Meeting with the reason, then
   * stamps endedAt. Safe to run again: an ended series still cancels what is
   * left.
   */
  async end(seriesId: string, dto: EndMeetingSeriesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ cancelled: string[]; failed: string[] }> {
    const series = await this.seriesForEnd(seriesId, organizationId, viewer, now);
    const reason = dto.reason.trim();
    const { open } = await this.endPlan(seriesId, dto.lastMeetingId, organizationId, now);

    // Before cancelling anything: the caller can press Cancel Meeting on every
    // one of them (its stage's pool), or nothing is written.
    const moves: { meetingId: string; instanceId: string; transitionId: string }[] = [];
    const cannot: string[] = [];
    for (const m of open) {
      const current = await this.workflow.currentStagePool('MEETING', m.id, organizationId);
      const move = current
        ? await this.prisma.workflowTransition.findFirst({
            where: {
              fromStageId: current.stage.id,
              fromStage: { workflowTemplate: { organizationId } },
              mover: 'PERSON',
              toStage: { flags: { has: STAGE_FLAG.MEETING_CANCELLED }, workflowTemplate: { organizationId } },
            },
            select: { id: true },
          })
        : null;
      if (!current || !move || !mayActInStagePool(current.pool, viewer.id)) cannot.push(m.id);
      else moves.push({ meetingId: m.id, instanceId: current.instanceId, transitionId: move.id });
    }
    if (cannot.length > 0) throw new MeetingRefusal('MEETING_SERIES_CANNOT_CANCEL', { meetings: cannot });

    const cancelled: string[] = [];
    const failed: string[] = [];
    for (const m of moves) {
      try {
        await this.workflow.triggerTransition(m.instanceId, { transitionId: m.transitionId, comment: reason }, organizationId, viewer.id, [...viewer.permissions]);
        cancelled.push(m.meetingId);
      } catch (error) {
        // One that can't be cancelled doesn't stop the others; the series stays open, and End can run again.
        const code = (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code ?? (error instanceof Error ? error.name : 'unknown');
        this.logger.warn(`Ending series ${seriesId}: meeting ${m.meetingId} in org ${organizationId} not cancelled (${code})`);
        failed.push(m.meetingId);
      }
    }
    // Ended only when nothing is left open; a re-run on an ended series writes nothing.
    const ends = failed.length === 0 && series.endedAt === null;
    if (ends || cancelled.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        const stamped = ends ? await tx.meetingSeries.updateMany({ where: { id: seriesId, organizationId, endedAt: null }, data: { endedAt: now, endReason: reason } }) : { count: 0 };
        await tx.auditLog.create({
          data: {
            organizationId,
            actorId: viewer.id,
            action: 'UPDATE',
            objectType: 'MeetingSeries',
            objectId: seriesId,
            after: { ended: stamped.count > 0, cancelled, failed },
            metadata: { reason },
          },
        });
      });
    }
    return { cancelled, failed };
  }

  // ── "This and all later" ────────────────────────────────────────────────────

  /** Edit this meeting and the later ones still in Planned or Agenda Issued, keeping each one's own edits. */
  async updateLater(id: string, dto: UpdateMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting & { scope: IMeetingScopeResult }> {
    const owner = await this.access.writing(id, organizationId, viewer, now);
    await this.assertEditable(dto, owner, organizationId);
    const targets = await this.laterMeetings(id, organizationId, now, MEETING_ACTIONS.EDIT_DETAILS);
    const wanted = wantedFields(dto);

    const scope: IMeetingScopeResult = { changed: [], kept: [] };
    await this.prisma
      .$transaction(async (tx) => {
        for (const target of targets) {
          const anchor = target.id === id;
          const rules = await this.stageRules.currentStageRules('MEETING', target.id, organizationId, tx, { lock: 'share' });
          if (rules.actions[MEETING_ACTIONS.EDIT_DETAILS] !== true) {
            if (anchor) await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.EDIT_DETAILS, organizationId, tx);
            continue;
          }
          await lockMeetingRow(tx, target.id, organizationId);
          const row = await tx.meeting.findFirstOrThrow({ where: { id: target.id, organizationId }, select: EDIT_ROW });
          if (anchor && dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new MeetingRefusal('MEETING_CHANGED');
          const { keep, data } = planEdit(row, anchor, wanted, dto.title);
          if (keep.length > 0) scope.kept.push({ meetingId: target.id, title: row.title, fields: keep });
          if (Object.keys(data).length === 0) continue;
          await tx.meeting.update({ where: { id: target.id }, data: data as Prisma.MeetingUpdateInput });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: viewer.id,
              action: 'UPDATE',
              objectType: 'Meeting',
              objectId: target.id,
              after: Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'ownEdits')) as Prisma.InputJsonObject,
              metadata: { scope: 'THIS_AND_LATER', from: id },
            },
          });
          scope.changed.push(target.id);
        }
        // The series remembers the change for anything it makes later (nothing today: every meeting is made at once).
        const seriesData = Object.fromEntries(SERIES_FIELDS.filter((f) => f !== 'unitQuorum' && wanted[f] !== undefined).map((f) => [f, wanted[f]]));
        if (Object.keys(seriesData).length > 0) {
          const seriesId = targets[0]!.seriesId;
          await tx.meetingSeries.updateMany({ where: { id: seriesId, organizationId }, data: seriesData });
        }
      }, SERIES_TX)
      .catch((error: unknown) => asMeetingConflict(error));
    return { ...(await this.meetings.getForViewer(id, organizationId, viewer, now)), scope };
  }

  /**
   * Reschedule this meeting and the later ones still in Planned or Agenda
   * Issued by the same shift. Each new time is worked out from the time read
   * under its lock, then placed as creation places a day: off a day that isn't
   * a working day, and past a day the owner already meets (a meeting not
   * moving, not cancelled), keeping the time. A meeting rescheduled on its own
   * keeps its time.
   */
  async rescheduleLater(id: string, dto: RescheduleMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting & { scope: IMeetingScopeResult }> {
    await this.access.writing(id, organizationId, viewer, now);
    const toAt = new Date(dto.scheduledAt);
    if (toAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    const reason = dto.reason.trim();
    const targets = await this.laterMeetings(id, organizationId, now, MEETING_ACTIONS.RESCHEDULE);
    const zone = await this.calendar.getEffectiveTimeZone(organizationId);

    const scope: IMeetingScopeResult = { changed: [], kept: [] };
    const told: { id: string; title: string; at: Date }[] = [];
    await this.prisma
      .$transaction(async (tx) => {
        // 1. Lock each (id order) and read it under its lock.
        const rows: MovingRow[] = [];
        for (const t of targets) {
          const anchor = t.id === id;
          const rules = await this.stageRules.currentStageRules('MEETING', t.id, organizationId, tx, { lock: 'share' });
          if (rules.actions[MEETING_ACTIONS.RESCHEDULE] !== true) {
            if (anchor) await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.RESCHEDULE, organizationId, tx);
            continue;
          }
          await lockMeetingRow(tx, t.id, organizationId);
          const row = await tx.meeting.findFirstOrThrow({ where: { id: t.id, organizationId }, select: MOVE_ROW });
          if (anchor && dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new MeetingRefusal('MEETING_CHANGED');
          rows.push({ id: t.id, title: row.title, scheduledAt: row.scheduledAt, ownEdits: row.ownEdits, seriesIndex: row.seriesIndex ?? 0, durationMinutes: row.durationMinutes });
        }
        // 2. Where each goes: the one placement rule, shared with the preview.
        const placed = await this.placeLater(tx, id, toAt, rows, targets[0]!.owner, zone, organizationId, now);
        if (!placed) return;
        scope.kept.push(...placed.kept);
        // 3. The writes.
        for (const m of placed.moves) {
          await tx.meetingReschedule.create({
            data: { organizationId, meetingId: m.id, fromAt: m.fromAt, toAt: m.at, reason, scope: 'THIS_AND_LATER', actorId: viewer.id },
          });
          await tx.meeting.update({
            where: { id: m.id },
            data: { scheduledAt: m.at, ...(m.id === id && { ownEdits: m.ownEdits.filter((f) => f !== 'scheduledAt') }) },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: viewer.id,
              action: 'UPDATE',
              objectType: 'Meeting',
              objectId: m.id,
              before: { scheduledAt: m.fromAt.toISOString() },
              after: { scheduledAt: m.at.toISOString() },
              metadata: { change: 'reschedule', scope: 'THIS_AND_LATER', from: id, reason },
            },
          });
          scope.changed.push(m.id);
          told.push({ id: m.id, title: m.title, at: m.at });
        }
      }, SERIES_TX)
      .catch((error: unknown) => asMeetingConflict(error));

    for (const t of told) await this.meetings.tellRescheduled(t.id, t.title, t.at, reason, organizationId, viewer.id);
    return { ...(await this.meetings.getForViewer(id, organizationId, viewer, now)), scope };
  }

  /**
   * PR 8-be (P236, Q2) — WHAT "THIS AND ALL LATER" WOULD DO, before Apply: the
   * meetings it reaches with their times as they'd be, what each keeps as its
   * own, and the clashes at those times. For the scope confirm.
   *
   * It runs the write's own decisions (`planEdit()` for an edit,
   * `placeLater()` for a reschedule) on the same rows, read WITHOUT a lock, and
   * writes nothing. The same "who may ask" as the write (`writing()`: the same
   * 404 for a meeting the asker can't see, MEETING_NOT_ALLOWED otherwise), the
   * same refusals, and bounded by the series' size (53).
   *
   * Clashes are asked of the anchor's invitees (in a series, the owner's
   * members) at each meeting's new time; a "clash" with a meeting that is itself
   * moving is left out, since it won't be there.
   */
  async scopePreview(id: string, dto: MeetingScopePreviewDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeetingScopePreview> {
    const owner = await this.access.writing(id, organizationId, viewer, now);
    const action = dto.change === 'RESCHEDULE' ? MEETING_ACTIONS.RESCHEDULE : MEETING_ACTIONS.EDIT_DETAILS;
    let toAt: Date | null = null;
    if (dto.change === 'RESCHEDULE') {
      // The DTO requires scheduledAt for a reschedule.
      toAt = new Date(dto.scheduledAt!);
      if (toAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    } else {
      await this.assertEditable(dto, owner, organizationId);
    }
    // The stage rules laterMeetings() read, once (P237): the anchor's refusal is built from them.
    const targets = await this.laterMeetings(id, organizationId, now, action);
    const anchor = targets.find((t) => t.id === id);
    if (anchor) this.stageRules.assertRulesAllow('MEETING', id, action, organizationId, anchor.rules);
    const allowed = targets.filter((t) => t.rules.actions[action] === true);
    const rows = await this.prisma.meeting.findMany({
      where: { organizationId, id: { in: allowed.map((t) => t.id) } },
      select: { ...EDIT_ROW, ...MOVE_ROW },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const meetings: IMeetingScopePreview['meetings'] = [];
    const kept: IMeetingScopePreview['kept'] = [];
    if (dto.change === 'RESCHEDULE') {
      const zone = await this.calendar.getEffectiveTimeZone(organizationId);
      const moving: MovingRow[] = allowed
        .map((t) => byId.get(t.id))
        .filter((r): r is NonNullable<typeof r> => !!r)
        .map((r) => ({ id: r.id, title: r.title, scheduledAt: r.scheduledAt, ownEdits: r.ownEdits, seriesIndex: r.seriesIndex ?? 0, durationMinutes: r.durationMinutes }));
      const placed = await this.placeLater(this.prisma, id, toAt!, moving, targets[0]!.owner, zone, organizationId, now);
      if (placed) {
        for (const m of placed.moves) meetings.push({ id: m.id, title: m.title, startsAt: m.at, durationMinutes: m.durationMinutes ?? DEFAULT_MINUTES });
        for (const k of placed.kept) kept.push({ ...k, startsAt: byId.get(k.meetingId)!.scheduledAt });
      }
    } else {
      const wanted = wantedFields(dto);
      for (const t of allowed) {
        const row = byId.get(t.id);
        if (!row) continue;
        const { keep, data } = planEdit(row, t.id === id, wanted, undefined);
        if (keep.length > 0) kept.push({ meetingId: t.id, title: row.title, fields: keep, startsAt: row.scheduledAt });
        if (Object.keys(data).length === 0) continue;
        meetings.push({ id: t.id, title: row.title, startsAt: row.scheduledAt, durationMinutes: (data['durationMinutes'] as number | undefined) ?? row.durationMinutes ?? DEFAULT_MINUTES });
      }
    }
    meetings.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());

    // The clashes at the times as they'd be; never with a meeting that is itself
    // moving. An edit that moves no time (no new duration) causes none, so it asks
    // nothing: the confirm must not present a clash that is already there as the
    // edit's (P237).
    const movingIds = new Set(meetings.map((m) => m.id));
    const movesTime = dto.change === 'RESCHEDULE' || dto.durationMinutes !== undefined;
    const clashes =
      meetings.length === 0 || !movesTime
        ? []
        : (
            await this.clashes.check(
              { meetingId: id, times: meetings.map((m) => ({ startsAt: m.startsAt.toISOString(), durationMinutes: m.durationMinutes })) } as CheckMeetingClashesDto,
              organizationId,
              viewer,
              now,
            )
          )
            .map((c) => ({ ...c, people: c.people.map((p) => ({ ...p, meetings: p.meetings.filter((o) => !o.id || !movingIds.has(o.id)) })).filter((p) => p.meetings.length > 0) }))
            .filter((c) => c.people.length > 0);
    return { meetings, kept, clashes };
  }

  /** An edit's own refusals, before anything is read: the title, the type, a quorum on a committee meeting. */
  private async assertEditable(dto: Pick<UpdateMeetingDto, 'title' | 'typeValueId' | 'unitQuorum'>, owner: MeetingOwner, organizationId: string): Promise<void> {
    if (dto.title !== undefined && !dto.title.trim()) throw new MeetingRefusal('MEETING_TITLE_REQUIRED');
    if (dto.typeValueId !== undefined) await this.meetings.assertMeetingType(dto.typeValueId, organizationId);
    if (owner.committeeId && dto.unitQuorum != null) throw new MeetingRefusal('MEETING_QUORUM_UNIT_ONLY');
  }

  /**
   * THE PLACEMENT RULE for "this and all later" reschedules, ONE copy, used by
   * the write (on rows read under their locks) and the preview (on rows read
   * without one). The anchor's move as people read it, in the organisation's
   * zone: a number of calendar days and a wall-clock change, never elapsed
   * time, so a clock change between two meetings doesn't move their hour. Each
   * later meeting then moves by it, off a day that isn't a working day and past
   * a day the owner already meets. A later meeting rescheduled on its own keeps
   * its time (`kept`); one whose new time would be past, or unchanged, isn't
   * moved. Null when the anchor itself isn't among the rows.
   */
  private async placeLater(
    client: Pick<EngineTx, 'meeting' | 'workflowInstance' | 'workflowStage' | 'workflowStageRecordAction'>,
    id: string,
    toAt: Date,
    rows: MovingRow[],
    owner: { committeeId: string | null; orgUnitId: string | null },
    zone: string,
    organizationId: string,
    now: Date,
  ): Promise<{ moves: (MovingRow & { fromAt: Date; at: Date })[]; kept: IMeetingScopeResult['kept'] } | null> {
    const kept: IMeetingScopeResult['kept'] = [];
    const locked = rows.filter((r) => {
      if (r.id !== id && r.ownEdits.includes('scheduledAt')) {
        kept.push({ meetingId: r.id, title: r.title, fields: ['scheduledAt'] });
        return false;
      }
      return true;
    });
    const anchorRow = locked.find((l) => l.id === id);
    if (!anchorRow) return null;
    if (toAt.getTime() === anchorRow.scheduledAt.getTime()) throw new MeetingRefusal('MEETING_RESCHEDULE_SAME_TIME');
    const from = DateTime.fromJSDate(anchorRow.scheduledAt).setZone(zone);
    const to = DateTime.fromJSDate(toAt).setZone(zone);
    const dayShift = Math.round((Date.parse(`${to.toISODate()}T00:00:00Z`) - Date.parse(`${from.toISODate()}T00:00:00Z`)) / 86_400_000);
    const minuteShift = to.hour * 60 + to.minute - (from.hour * 60 + from.minute);

    // The days the owner already meets on, other than the meetings moving now.
    const moving = new Set(locked.map((l) => l.id));
    const taken = await this.ownerDays(client, organizationId, owner, moving, zone, toAt);

    const moves: (MovingRow & { fromAt: Date; at: Date })[] = [];
    for (const l of [...locked].sort((x, y) => x.seriesIndex - y.seriesIndex)) {
      let at = toAt;
      if (l.id !== id) {
        const wall = DateTime.fromJSDate(l.scheduledAt).setZone(zone);
        const minutes = wall.hour * 60 + wall.minute + minuteShift;
        const carry = Math.floor(minutes / 1440);
        const minuteOfDay = ((minutes % 1440) + 1440) % 1440;
        const shiftedDay = DateTime.fromISO(wall.toISODate()!, { zone: 'UTC' }).plus({ days: dayShift + carry }).toISODate()!;
        let day = await this.calendar.nextWorkingDay(shiftedDay, organizationId);
        for (let step = 0; taken.has(day) && step < MOVE_LIMIT; step++) {
          day = await this.calendar.nextWorkingDay(DateTime.fromISO(day, { zone: 'UTC' }).plus({ days: 1 }).toISODate()!, organizationId);
        }
        at = DateTime.fromISO(day, { zone }).set({ hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60 }).toJSDate();
        if (at <= now) continue;
      }
      taken.add(DateTime.fromJSDate(at).setZone(zone).toISODate()!);
      if (at.getTime() === l.scheduledAt.getTime()) continue;
      moves.push({ ...l, fromAt: l.scheduledAt, at });
    }
    return { moves, kept };
  }

  /** The days (organisation's zone) the owner has a meeting that isn't cancelled and isn't one of `except`, from `from` for a year. */
  private async ownerDays(
    client: Pick<EngineTx, 'meeting' | 'workflowInstance' | 'workflowStage' | 'workflowStageRecordAction'>,
    organizationId: string,
    owner: { committeeId: string | null; orgUnitId: string | null },
    except: ReadonlySet<string>,
    zone: string,
    from: Date,
  ): Promise<Set<string>> {
    const rows = await client.meeting.findMany({
      where: {
        organizationId,
        ...(owner.committeeId ? { committeeId: owner.committeeId } : { committeeId: null, orgUnitId: owner.orgUnitId }),
        scheduledAt: { gte: DateTime.fromJSDate(from).minus({ days: 1 }).toJSDate(), lt: DateTime.fromJSDate(from).plus({ months: 13 }).toJSDate() },
        id: { notIn: [...except] },
      },
      select: { id: true, scheduledAt: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', rows.map((r) => r.id), client);
    return new Set(
      rows.filter((r) => !rules.get(r.id)?.flags.includes(STAGE_FLAG.MEETING_CANCELLED)).map((r) => DateTime.fromJSDate(r.scheduledAt).setZone(zone).toISODate()!),
    );
  }

  /**
   * This meeting and the later ones of its series that haven't started and
   * whose stage allows the action now, in id order (the lock order); checked
   * again under each lock.
   */
  private async laterMeetings(
    id: string,
    organizationId: string,
    now: Date,
    action: string,
  ): Promise<{ id: string; seriesId: string; scheduledAt: Date; ownEdits: string[]; owner: { committeeId: string | null; orgUnitId: string | null }; rules: StageRules }[]> {
    const anchor = await this.prisma.meeting.findFirst({ where: { id, organizationId }, select: { seriesId: true, seriesIndex: true } });
    if (!anchor?.seriesId || anchor.seriesIndex === null) throw new MeetingRefusal('MEETING_NOT_IN_SERIES');
    const rows = await this.prisma.meeting.findMany({
      where: { organizationId, seriesId: anchor.seriesId, OR: [{ id }, { seriesIndex: { gt: anchor.seriesIndex }, scheduledAt: { gt: now } }] },
      orderBy: { id: 'asc' },
      select: { id: true, seriesId: true, scheduledAt: true, ownEdits: true, committeeId: true, orgUnitId: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', rows.map((r) => r.id));
    return rows
      .filter((r) => r.id === id || rules.get(r.id)?.actions[action] === true)
      .map((r) => ({
        id: r.id,
        seriesId: r.seriesId!,
        scheduledAt: r.scheduledAt,
        ownEdits: r.ownEdits,
        owner: { committeeId: r.committeeId, orgUnitId: r.orgUnitId },
        // stageRulesFor() answers every id asked: a record with no stage gets empty rules.
        rules: rules.get(r.id)!,
      }));
  }
}

/**
 * Each meeting's invitees and standing agenda as rows, built before the
 * transaction: the owner's MEMBERS (ids chosen here, so a standing item can
 * name its presenter's row), plus an organisation guest for a presenter who
 * isn't a member (`addedAsPresenter`).
 */
function standingRows(
  organizationId: string,
  meetingIds: readonly string[],
  members: readonly [string, string | null][],
  dto: CreateMeetingSeriesDto,
  presenters: ReadonlySet<string>,
  actorId: string,
): { attendees: Prisma.MeetingAttendeeCreateManyInput[]; items: Prisma.AgendaItemCreateManyInput[] } {
  const attendees: Prisma.MeetingAttendeeCreateManyInput[] = [];
  const items: Prisma.AgendaItemCreateManyInput[] = [];
  for (const meetingId of meetingIds) {
    const rowOf = new Map<string, string>();
    for (const [userId, seatValueId] of members) {
      const id = randomUUID();
      rowOf.set(userId, id);
      attendees.push({ id, organizationId, meetingId, kind: 'MEMBER', userId, seatValueId });
    }
    for (const [i, item] of (dto.standingAgenda ?? []).entries()) {
      let presenterAttendeeId: string | null = null;
      if (item.presenterUserId && presenters.has(item.presenterUserId)) {
        if (!rowOf.has(item.presenterUserId)) {
          const id = randomUUID();
          rowOf.set(item.presenterUserId, id);
          attendees.push({ id, organizationId, meetingId, kind: 'ORG_GUEST', userId: item.presenterUserId, addedAsPresenter: true, createdById: actorId });
        }
        presenterAttendeeId = rowOf.get(item.presenterUserId)!;
      }
      items.push({ organizationId, meetingId, title: item.title.trim(), order: i + 1, duration: item.durationMinutes ?? null, standing: true, presenterAttendeeId });
    }
  }
  return { attendees, items };
}
