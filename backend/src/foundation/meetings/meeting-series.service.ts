import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { WorkflowService, type EngineTx } from '../workflow/workflow.service';
import { COMMITTEE_ACTIONS, MEETING_ACTIONS, STAGE_FLAG } from '../workflow/record-registry';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { MeetingsService } from './meetings.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingAccess, asMeetingConflict, lockMeetingRow, type MeetingViewer } from './meeting-access';
import { MeetingRefusal } from './meeting-refusal';
import { insertMeetingInTx } from './meeting-create';
import { patternDays, seriesTitle, type SeriesPattern } from './meeting-series-dates';
import type { CreateMeetingSeriesDto, EndMeetingSeriesDto, RescheduleMeetingDto, UpdateMeetingDto } from './dto/meeting.dto';
import type { IMeeting, IMeetingScopeResult, IMeetingSeriesDate, IMeetingSeriesPreview } from './interfaces/meeting.interface';

/** The fields "this and all later" carries to later meetings. The title is each meeting's own (plan §3.2). */
const SERIES_FIELDS = ['typeValueId', 'durationMinutes', 'location', 'meetingUrl', 'unitQuorum'] as const;
type SeriesField = (typeof SERIES_FIELDS)[number];
/** A series' transaction writes up to 53 meetings with their instances. */
const SERIES_TX = { maxWait: 10_000, timeout: 120_000 } as const;
/** How far a moved day may walk forward looking for a free working day. */
const MOVE_LIMIT = 31;

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
    // Every read the engine can do first, one per meeting (template, first stage, its tasks).
    const prepared = await Promise.all(ids.map((id) => this.workflow.prepareInstanceStart('MEETING', id, organizationId)));

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
          firstDate: new Date(`${dto.firstDate}T00:00:00.000Z`),
          endsOn: dto.endsOn ? new Date(`${dto.endsOn}T00:00:00.000Z`) : null,
          count: dto.count ?? null,
          standingAgenda: (dto.standingAgenda ?? []) as unknown as Prisma.InputJsonValue,
          createdById: viewer.id,
        },
      });
      const out = [];
      for (const [i, date] of plan.dates.entries()) {
        out.push(
          await insertMeetingInTx(tx, this.workflow, prepared[i]!, {
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
          }),
        );
        await this.copyStandingAgenda(tx, ids[i]!, organizationId, viewer.id, dto, presenters);
      }
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

    for (const [i, s] of started.entries()) {
      await this.workflow.finishInstanceStart(prepared[i]!, s, organizationId, viewer.id, { notifyInitialAssignee: false });
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
      const startsAt = DateTime.fromISO(held, { zone }).plus({ minutes: startMinute }).toJSDate();
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

  /** The standing agenda, copied into a new meeting as `standing` items; a presenter not yet invited becomes an organisation guest. */
  private async copyStandingAgenda(tx: EngineTx, meetingId: string, organizationId: string, actorId: string, dto: CreateMeetingSeriesDto, presenters: Set<string>): Promise<void> {
    for (const [i, item] of (dto.standingAgenda ?? []).entries()) {
      let presenterAttendeeId: string | null = null;
      if (item.presenterUserId && presenters.has(item.presenterUserId)) {
        const row =
          (await tx.meetingAttendee.findFirst({ where: { organizationId, meetingId, userId: item.presenterUserId }, select: { id: true } })) ??
          (await tx.meetingAttendee.create({
            data: { organizationId, meetingId, kind: 'ORG_GUEST', userId: item.presenterUserId, addedAsPresenter: true, createdById: actorId },
            select: { id: true },
          }));
        presenterAttendeeId = row.id;
      }
      await tx.agendaItem.create({
        data: { organizationId, meetingId, title: item.title.trim(), order: i + 1, duration: item.durationMinutes ?? null, standing: true, presenterAttendeeId },
      });
    }
  }

  // ── End series ──────────────────────────────────────────────────────────────

  /**
   * Cancels every later meeting still in Planned or Agenda Issued, each by its
   * own Cancel Meeting with the reason, then stamps endedAt. Safe to run again:
   * an ended series still cancels what is left.
   */
  async end(seriesId: string, dto: EndMeetingSeriesDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<{ cancelled: string[]; failed: string[] }> {
    const series = await this.prisma.meetingSeries.findFirst({
      where: { id: seriesId, organizationId },
      select: { id: true, committeeId: true, orgUnitId: true, committee: { select: { orgUnitId: true } } },
    });
    if (!series) throw new MeetingRefusal('MEETING_SERIES_NOT_FOUND');
    const owner: MeetingOwner = { key: seriesId, committeeId: series.committeeId, unitId: series.orgUnitId ?? series.committee?.orgUnitId ?? null };
    if (!(await isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    const reason = dto.reason.trim();

    const later = await this.prisma.meeting.findMany({
      where: { organizationId, seriesId, scheduledAt: { gt: now } },
      orderBy: [{ seriesIndex: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', later.map((m) => m.id));
    const open = later.filter((m) => rules.get(m.id)?.actions[MEETING_ACTIONS.RESCHEDULE] === true);
    const cancelled: string[] = [];
    const failed: string[] = [];
    for (const m of open) {
      try {
        const instance = await this.prisma.workflowInstance.findFirst({
          where: { organizationId, objectType: 'MEETING', objectId: m.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, currentStageId: true },
        });
        const move = instance?.currentStageId
          ? await this.prisma.workflowTransition.findFirst({
              where: { fromStageId: instance.currentStageId, mover: 'PERSON', toStage: { flags: { has: STAGE_FLAG.MEETING_CANCELLED } } },
              select: { id: true },
            })
          : null;
        if (!instance || !move) throw new Error('no cancel move');
        await this.workflow.triggerTransition(instance.id, { transitionId: move.id, comment: reason }, organizationId, viewer.id, [...viewer.permissions]);
        cancelled.push(m.id);
      } catch (error) {
        // One meeting that can't be cancelled doesn't stop the others; it is named, and End can run again.
        this.logger.warn(`Ending series ${seriesId}: meeting ${m.id} in org ${organizationId} not cancelled: ${error instanceof Error ? error.name : 'unknown error'}`);
        failed.push(m.id);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const stamped = await tx.meetingSeries.updateMany({ where: { id: seriesId, organizationId, endedAt: null }, data: { endedAt: now, endReason: reason } });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorId: viewer.id,
          action: 'UPDATE',
          objectType: 'MeetingSeries',
          objectId: seriesId,
          after: { ended: stamped.count > 0 || undefined, cancelled, failed },
          metadata: { reason },
        },
      });
    });
    return { cancelled, failed };
  }

  // ── "This and all later" ────────────────────────────────────────────────────

  /** Edit this meeting and the later ones still in Planned or Agenda Issued, keeping each one's own edits. */
  async updateLater(id: string, dto: UpdateMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting & { scope: IMeetingScopeResult }> {
    const owner = await this.access.writing(id, organizationId, viewer, now);
    if (dto.title !== undefined && !dto.title.trim()) throw new MeetingRefusal('MEETING_TITLE_REQUIRED');
    if (dto.typeValueId !== undefined) await this.meetings.assertMeetingType(dto.typeValueId, organizationId);
    if (owner.committeeId && dto.unitQuorum != null) throw new MeetingRefusal('MEETING_QUORUM_UNIT_ONLY');
    const targets = await this.laterMeetings(id, organizationId, now, MEETING_ACTIONS.EDIT_DETAILS);
    const wanted: Partial<Record<SeriesField, unknown>> = {};
    for (const f of SERIES_FIELDS) if (dto[f] !== undefined) wanted[f] = typeof dto[f] === 'string' ? (dto[f] as string).trim() : dto[f];

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
          const row = await tx.meeting.findFirstOrThrow({
            where: { id: target.id, organizationId },
            select: { title: true, typeValueId: true, durationMinutes: true, location: true, meetingUrl: true, unitQuorum: true, ownEdits: true, updatedAt: true },
          });
          if (anchor && dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new MeetingRefusal('MEETING_CHANGED');
          const keep = anchor ? [] : SERIES_FIELDS.filter((f) => wanted[f] !== undefined && row.ownEdits.includes(f));
          const fields = SERIES_FIELDS.filter((f) => wanted[f] !== undefined && !keep.includes(f) && wanted[f] !== row[f]);
          const data: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f, wanted[f]]));
          if (anchor && dto.title !== undefined && dto.title.trim() !== row.title) data['title'] = dto.title.trim();
          const location = 'location' in data ? data['location'] : row.location;
          const link = 'meetingUrl' in data ? data['meetingUrl'] : row.meetingUrl;
          if (!location && !link) throw new MeetingRefusal('MEETING_PLACE_REQUIRED');
          if (keep.length > 0) scope.kept.push({ meetingId: target.id, title: row.title, fields: keep });
          if (Object.keys(data).length === 0) continue;
          // The anchor's change is the series': its own edits of those fields are no longer its own.
          if (anchor) data['ownEdits'] = row.ownEdits.filter((f) => !(f in data));
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
   * Issued by the same shift; a later one that lands on a day that isn't a
   * working day moves to the next one, keeping its time. A meeting rescheduled
   * on its own keeps its time.
   */
  async rescheduleLater(id: string, dto: RescheduleMeetingDto, organizationId: string, viewer: MeetingViewer, now: Date = new Date()): Promise<IMeeting & { scope: IMeetingScopeResult }> {
    await this.access.writing(id, organizationId, viewer, now);
    const toAt = new Date(dto.scheduledAt);
    if (toAt <= now) throw new MeetingRefusal('MEETING_TIME_IN_PAST');
    const reason = dto.reason.trim();
    const targets = await this.laterMeetings(id, organizationId, now, MEETING_ACTIONS.RESCHEDULE);
    const anchorAt = targets.find((t) => t.id === id)!.scheduledAt;
    const shift = toAt.getTime() - anchorAt.getTime();
    if (shift === 0) throw new MeetingRefusal('MEETING_RESCHEDULE_SAME_TIME');
    const zone = await this.calendar.getEffectiveTimeZone(organizationId);

    // Every new time read before the transaction (the working calendar's).
    const moves = new Map<string, Date>();
    for (const t of targets) {
      if (t.id === id) {
        moves.set(t.id, toAt);
        continue;
      }
      if (t.ownEdits.includes('scheduledAt')) continue;
      const shifted = DateTime.fromJSDate(new Date(t.scheduledAt.getTime() + shift)).setZone(zone);
      const working = await this.calendar.nextWorkingDay(shifted.toISODate()!, organizationId);
      const at = DateTime.fromISO(working, { zone }).set({ hour: shifted.hour, minute: shifted.minute }).toJSDate();
      if (at > now) moves.set(t.id, at);
    }

    const scope: IMeetingScopeResult = { changed: [], kept: [] };
    const told: { id: string; title: string; at: Date }[] = [];
    await this.prisma
      .$transaction(async (tx) => {
        for (const t of targets) {
          const anchor = t.id === id;
          const rules = await this.stageRules.currentStageRules('MEETING', t.id, organizationId, tx, { lock: 'share' });
          if (rules.actions[MEETING_ACTIONS.RESCHEDULE] !== true) {
            if (anchor) await this.stageRules.assertStageAllows('MEETING', id, MEETING_ACTIONS.RESCHEDULE, organizationId, tx);
            continue;
          }
          await lockMeetingRow(tx, t.id, organizationId);
          const row = await tx.meeting.findFirstOrThrow({ where: { id: t.id, organizationId }, select: { title: true, scheduledAt: true, ownEdits: true, updatedAt: true } });
          if (anchor && dto.expectedUpdatedAt && new Date(dto.expectedUpdatedAt).getTime() !== row.updatedAt.getTime()) throw new MeetingRefusal('MEETING_CHANGED');
          if (!anchor && row.ownEdits.includes('scheduledAt')) {
            scope.kept.push({ meetingId: t.id, title: row.title, fields: ['scheduledAt'] });
            continue;
          }
          const at = moves.get(t.id);
          if (!at || at.getTime() === row.scheduledAt.getTime()) continue;
          await tx.meetingReschedule.create({
            data: { organizationId, meetingId: t.id, fromAt: row.scheduledAt, toAt: at, reason, scope: 'THIS_AND_LATER', actorId: viewer.id },
          });
          await tx.meeting.update({
            where: { id: t.id },
            data: { scheduledAt: at, ...(anchor && { ownEdits: row.ownEdits.filter((f) => f !== 'scheduledAt') }) },
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              actorId: viewer.id,
              action: 'UPDATE',
              objectType: 'Meeting',
              objectId: t.id,
              before: { scheduledAt: row.scheduledAt.toISOString() },
              after: { scheduledAt: at.toISOString() },
              metadata: { change: 'reschedule', scope: 'THIS_AND_LATER', from: id, reason },
            },
          });
          scope.changed.push(t.id);
          told.push({ id: t.id, title: row.title, at });
        }
      }, SERIES_TX)
      .catch((error: unknown) => asMeetingConflict(error));

    for (const t of told) await this.meetings.tellRescheduled(t.id, t.title, t.at, reason, organizationId, viewer.id);
    return { ...(await this.meetings.getForViewer(id, organizationId, viewer, now)), scope };
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
  ): Promise<{ id: string; seriesId: string; scheduledAt: Date; ownEdits: string[] }[]> {
    const anchor = await this.prisma.meeting.findFirst({ where: { id, organizationId }, select: { seriesId: true, seriesIndex: true } });
    if (!anchor?.seriesId || anchor.seriesIndex === null) throw new MeetingRefusal('MEETING_NOT_IN_SERIES');
    const rows = await this.prisma.meeting.findMany({
      where: { organizationId, seriesId: anchor.seriesId, OR: [{ id }, { seriesIndex: { gt: anchor.seriesIndex }, scheduledAt: { gt: now } }] },
      orderBy: { id: 'asc' },
      select: { id: true, seriesId: true, scheduledAt: true, ownEdits: true },
    });
    const rules = await this.stageRules.stageRulesFor(organizationId, 'MEETING', rows.map((r) => r.id));
    return rows
      .filter((r) => r.id === id || rules.get(r.id)?.actions[action] === true)
      .map((r) => ({ id: r.id, seriesId: r.seriesId!, scheduledAt: r.scheduledAt, ownEdits: r.ownEdits }));
  }
}
