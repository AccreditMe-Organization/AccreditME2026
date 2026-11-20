/**
 * ACC-316 PR 5 — a meeting series against a REAL Postgres (npm run test:db).
 * Plan: backend/Plans/step-316-meeting-management.md §3.2, §3.10 and §6 (PR 5).
 *
 * The organisation: a committee owned by a unit, its Chair, Secretary and a
 * member (the defaults: Chair and Secretary schedule), on the GCC working week
 * (Sunday to Thursday).
 *
 * Only a database proves:
 *   - the series and every meeting it makes, each with its instance, invitees
 *     and standing agenda, in one transaction; nothing when it is refused;
 *   - a day off the working week, a holiday or a day the owner already meets
 *     moves to the next free working day, through the working calendar;
 *   - the preview's clashes;
 *   - "this and all later" edit and reschedule keep a meeting's own edits and
 *     leave earlier and closed meetings alone;
 *   - End series cancels the later open meetings with the reason, and only those;
 *   - another organisation's series and meetings are out of reach.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { COMMITTEES_PERMISSIONS, MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { copyDefaultSeatActions } from '../committees/seat-actions';
import { MeetingsService, SERIES_LIST_CAP } from './meetings.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingSeriesService } from './meeting-series.service';
import { MeetingAccess, type MeetingViewer } from './meeting-access';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(240_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const MEETING_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'MEETING')!;

describe('A meeting series against a real database (ACC-316 PR 5)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const lookupService = new LookupService(prisma, audit);
  const notices: { userId: string; titleEn: string; bodyEn: string }[] = [];
  const notifications = {
    create: async (dto: { userId: string; titleEn: string; bodyEn: string }) => {
      notices.push({ userId: dto.userId, titleEn: dto.titleEn, bodyEn: dto.bodyEn });
      return { id: randomUUID() };
    },
    createInAppMany: async () => 0,
    sendOutsideEmail: async () => undefined,
  } as unknown as NotificationService;
  const authority = new TaskAuthorityService(prisma);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(
    prisma,
    audit,
    labels,
    visibility,
    calendar,
    notifications,
    { getTaskSla: async () => null } as unknown as TenantService,
    new TaskAssignmentService(prisma, authority, { getValues: async () => [] } as unknown as LookupService),
    authority,
    sla,
    new TaskClosedNoticeService(prisma, notifications),
  );
  const stageRules = new StageRulesService(prisma);
  const workflow = new WorkflowService(
    prisma,
    audit,
    labels,
    visibility,
    calendar,
    notifications,
    tasks,
    { add: async () => undefined } as never,
    new StageTaskDefinitionService(prisma, audit, tasks),
    new StagePoolService(prisma),
  );
  const meetings = new MeetingsService(prisma, visibility, workflow, stageRules, notifications, calendar);
  const clashes = new MeetingClashService(prisma, visibility);
  const series = new MeetingSeriesService(prisma, visibility, workflow, stageRules, calendar, meetings, clashes);

  let seat: Record<string, string> = {};
  let meetingType = '';

  interface World {
    orgId: string;
    people: Record<string, string>;
    committeeId: string;
    zone: string;
  }

  async function world(timezone?: string): Promise<World> {
    const slug = `acc316s-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED, MEETING_SEED]);
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Clinical', code: `C-${slug}` } });
    const person = async (name: string) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${name}-${slug}@example.test`, name, status: 'ACTIVE' } })).id;
    const people: Record<string, string> = {
      admin: await person('admin'),
      chair: await person('chair'),
      secretary: await person('secretary'),
      member: await person('member'),
      presenter: await person('presenter'),
      outsider: await person('outsider'),
    };
    await writeStartingAssignments(prisma, o.id, people['admin']!, people['admin']!);
    const committeeTemplate = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const active = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: committeeTemplate.id, key: 'active' } });
    const c = await prisma.committee.create({ data: { organizationId: o.id, nameEn: 'IPC', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 2 } });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: o.id, workflowTemplateId: committeeTemplate.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: active.id },
    });
    await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: active.id, enteredAt: new Date() } });
    for (const [key, userId] of [
      ['chairman', people['chair']!],
      ['secretary', people['secretary']!],
      ['member', people['member']!],
    ] as const) {
      await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId, roleValueId: seat[key]! } });
    }
    await prisma.$transaction((tx) => copyDefaultSeatActions(tx, o.id, c.id));
    await calendar.getOrCreate(o.id);
    if (timezone) await prisma.workingCalendar.update({ where: { organizationId: o.id }, data: { timezone } });
    return { orgId: o.id, people, committeeId: c.id, zone: await calendar.getEffectiveTimeZone(o.id) };
  }

  const as = (w: World, name: string, permissions: string[] = []): MeetingViewer => ({ id: w.people[name]!, permissions });
  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );
  const code = async (p: Promise<unknown>): Promise<unknown> => {
    const r = await outcome(p);
    return typeof r === 'object' && r !== null ? ((r as { code?: string }).code ?? (r as { statusCode?: number }).statusCode) : r;
  };
  /** The next date (yyyy-MM-dd, the organisation's zone) after today with this Luxon weekday. */
  const nextWeekday = (w: World, weekday: number) => {
    const today = DateTime.now().setZone(w.zone).startOf('day');
    return today.plus({ days: ((weekday - today.weekday + 7) % 7) || 7 }).toISODate()!;
  };
  const weekly = (w: World, extra: Record<string, unknown> = {}) =>
    ({
      committeeId: w.committeeId,
      subject: 'IPC weekly',
      typeValueId: meetingType,
      startTime: '10:00',
      durationMinutes: 60,
      location: 'Room 4',
      every: 'WEEK_1',
      onKind: 'WEEKDAY',
      weekday: 1, // Monday: a working day on the GCC week
      firstDate: nextWeekday(w, 1),
      count: 4,
      ...extra,
    }) as never;
  const seriesMeetings = (seriesId: string) => prisma.meeting.findMany({ where: { seriesId }, orderBy: { seriesIndex: 'asc' } });
  const stageKey = async (meetingId: string) => {
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { objectType: 'MEETING', objectId: meetingId } });
    return (await prisma.workflowStage.findFirstOrThrow({ where: { id: instance.currentStageId! } })).key;
  };

  let a: World;
  let b: World;

  beforeAll(async () => {
    await prisma.onModuleInit();
    await lookupService.seedSystemData();
    const seats = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(seats.map((s) => [s.key, s.id]));
    meetingType = (await prisma.lookupValue.findFirstOrThrow({ where: { organizationId: null, category: { key: 'meeting_type', organizationId: null } } })).id;
    a = await world();
    b = await world();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    notices.length = 0;
  });

  describe('create', () => {
    it('makes the series and every meeting with its instance, invitees and standing agenda, in one go', async () => {
      const r = await series.create(
        weekly(a, { standingAgenda: [{ title: 'Open actions', presenterUserId: a.people['secretary'] }, { title: 'Infection rates', presenterUserId: a.people['presenter'], durationMinutes: 10 }] }),
        a.orgId,
        as(a, 'chair'),
      );
      expect(r.meetingIds).toHaveLength(4);
      const rows = await seriesMeetings(r.seriesId);
      expect(rows.map((m) => m.seriesIndex)).toEqual([1, 2, 3, 4]);
      expect(rows.map((m) => DateTime.fromJSDate(m.scheduledAt).setZone(a.zone).toFormat('HH:mm'))).toEqual(['10:00', '10:00', '10:00', '10:00']);
      expect(rows[0]!.title).toBe(`IPC weekly · ${DateTime.fromJSDate(rows[0]!.scheduledAt).setZone(a.zone).setLocale('en-GB').toFormat('d LLL yyyy')}`);
      for (const m of rows) expect(await stageKey(m.id)).toBe('planned');
      const items = await prisma.agendaItem.findMany({ where: { meetingId: rows[0]!.id }, orderBy: { order: 'asc' }, include: { presenterAttendee: true } });
      expect(items.map((i) => [i.title, i.standing, i.presenterAttendee?.kind])).toEqual([
        ['Open actions', true, 'MEMBER'],
        ['Infection rates', true, 'ORG_GUEST'],
      ]);
      expect(await prisma.meetingAttendee.count({ where: { meetingId: rows[3]!.id, kind: 'MEMBER' } })).toBe(3);
      expect(await prisma.auditLog.count({ where: { objectType: 'MeetingSeries', objectId: r.seriesId, action: 'CREATE' } })).toBe(1);
    });

    it('moves a day off the working week, and a day the owner already meets, to the next free working day', async () => {
      // Friday isn't a working day on the GCC week: each moves to Sunday.
      const friday = await series.preview(weekly(a, { weekday: 5, firstDate: nextWeekday(a, 5), count: 2 }), a.orgId, as(a, 'chair'));
      expect(friday.dates.map((d) => [DateTime.fromISO(d.day).weekday, d.moved])).toEqual([
        [7, 'NOT_WORKING_DAY'],
        [7, 'NOT_WORKING_DAY'],
      ]);
      // A holiday on the first Monday: moved to Tuesday.
      const firstMonday = nextWeekday(a, 1);
      const cal = await prisma.workingCalendar.findFirstOrThrow({ where: { organizationId: a.orgId } });
      const holiday = await prisma.publicHoliday.create({ data: { workingCalendarId: cal.id, nameEn: 'Holiday', date: new Date(`${firstMonday}T00:00:00.000Z`) } });
      try {
        const moved = await series.preview(weekly(a, { count: 2 }), a.orgId, as(a, 'chair'));
        expect(moved.dates[0]).toMatchObject({ patternDay: firstMonday, moved: 'NOT_WORKING_DAY' });
        expect(DateTime.fromISO(moved.dates[0]!.day).weekday).toBe(2);
      } finally {
        await prisma.publicHoliday.delete({ where: { id: holiday.id } });
      }
      // The committee already meets on the second Monday (the series made above): moved on.
      const taken = await series.preview(weekly(a, { count: 1, firstDate: nextWeekday(a, 1) }), a.orgId, as(a, 'chair'));
      expect(taken.dates[0]!.moved).toBe('OWNER_MEETS');
    });

    it('refuses someone who may not schedule, and an end past twelve months, writing nothing', async () => {
      const before = await prisma.meeting.count({ where: { organizationId: a.orgId } });
      expect(await code(series.create(weekly(a), a.orgId, as(a, 'member')))).toBe('MEETING_NOT_ALLOWED');
      expect(await outcome(series.create(weekly(a, { count: null, endsOn: DateTime.now().plus({ months: 13 }).toISODate() }), a.orgId, as(a, 'chair')))).toMatchObject({
        code: 'MEETING_SERIES_TOO_LONG',
        field: 'endsOn',
      });
      expect(await prisma.meeting.count({ where: { organizationId: a.orgId } })).toBe(before);
    });

    it("a committee whose stage doesn't allow scheduling gets no series at all", async () => {
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: a.orgId, objectType: 'COMMITTEE', isDefault: true } });
      const dissolved = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'dissolved' } });
      const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { objectType: 'COMMITTEE', objectId: a.committeeId } });
      const before = await prisma.meeting.count({ where: { organizationId: a.orgId } });
      const seriesBefore = await prisma.meetingSeries.count({ where: { organizationId: a.orgId } });
      await prisma.workflowInstance.update({ where: { id: instance.id }, data: { currentStageId: dissolved.id } });
      try {
        expect(await code(series.create(weekly(a), a.orgId, as(a, 'chair')))).toBe('STAGE_ACTION_NOT_ALLOWED');
      } finally {
        await prisma.workflowInstance.update({ where: { id: instance.id }, data: { currentStageId: instance.currentStageId } });
      }
      expect(await prisma.meeting.count({ where: { organizationId: a.orgId } })).toBe(before);
      expect(await prisma.meetingSeries.count({ where: { organizationId: a.orgId } })).toBe(seriesBefore);
    });

    it('the preview names a member who is busy at one of the dates', async () => {
      const plan = await series.preview(weekly(a, { count: 2, firstDate: nextWeekday(a, 3) , weekday: 3 }), a.orgId, as(a, 'chair'));
      const busyAt = plan.dates[1]!.startsAt;
      const other = await prisma.meeting.create({
        data: { organizationId: a.orgId, organizerId: a.people['chair']!, title: 'Other', typeValueId: meetingType, scheduledAt: busyAt, durationMinutes: 60, location: 'Room 1', orgUnitId: (await prisma.committee.findFirstOrThrow({ where: { id: a.committeeId } })).orgUnitId },
      });
      await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: other.id, kind: 'ORG_GUEST', userId: a.people['member']!, invitedAt: new Date() } });
      const again = await series.preview(weekly(a, { count: 2, firstDate: nextWeekday(a, 3), weekday: 3 }), a.orgId, as(a, 'chair'));
      const second = again.clashes.find((c) => c.startsAt === again.dates[1]!.startsAt.toISOString())!;
      expect(second.people.map((p) => p.userId)).toEqual([a.people['member']]);
      expect(again.clashes.find((c) => c.startsAt === again.dates[0]!.startsAt.toISOString())!.people).toEqual([]);
    });
  });

  describe('this and all later', () => {
    it("edits this one and the later open ones, keeping a meeting's own edits and leaving an earlier one alone", async () => {
      const r = await series.create(weekly(a, { weekday: 2, firstDate: nextWeekday(a, 2) }), a.orgId, as(a, 'chair'));
      const [first, second, third, fourth] = r.meetingIds;
      // The third changed its place on its own.
      await meetings.update(third!, { location: 'Room 9' }, a.orgId, as(a, 'chair'));
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: third! } })).ownEdits).toEqual(['location']);

      const res = await series.updateLater(second!, { location: 'Hall A', durationMinutes: 90 }, a.orgId, as(a, 'chair'));
      expect(res.scope.changed.sort()).toEqual([second, third, fourth].sort());
      expect(res.scope.kept).toEqual([{ meetingId: third, title: expect.any(String), fields: ['location'] }]);
      const rows = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m]));
      expect([rows[first!]!.location, rows[second!]!.location, rows[third!]!.location, rows[fourth!]!.location]).toEqual(['Room 4', 'Hall A', 'Room 9', 'Hall A']);
      expect(rows[third!]!.durationMinutes).toBe(90);
      expect(rows[first!]!.durationMinutes).toBe(60);
    });

    it('reschedules this one and the later ones by the same shift, keeping one rescheduled on its own', async () => {
      const r = await series.create(weekly(a, { weekday: 3, firstDate: nextWeekday(a, 3) }), a.orgId, as(a, 'chair'));
      const [first, second, third, fourth] = r.meetingIds;
      const before = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt]));
      // The fourth moved on its own: an hour later.
      await meetings.reschedule(fourth!, { scheduledAt: new Date(before[fourth!]!.getTime() + 3_600_000).toISOString(), reason: 'Room clash' }, a.orgId, as(a, 'chair'));

      const twoHours = 2 * 3_600_000;
      const res = await series.rescheduleLater(second!, { scheduledAt: new Date(before[second!]!.getTime() + twoHours).toISOString(), reason: 'Afternoon' }, a.orgId, as(a, 'chair'));
      expect(res.scope.changed.sort()).toEqual([second, third].sort());
      expect(res.scope.kept.map((k) => k.meetingId)).toEqual([fourth]);
      const after = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt.getTime()]));
      expect(after[first!]).toBe(before[first!]!.getTime());
      expect(after[second!]).toBe(before[second!]!.getTime() + twoHours);
      expect(after[third!]).toBe(before[third!]!.getTime() + twoHours);
      expect(after[fourth!]).toBe(before[fourth!]!.getTime() + 3_600_000);
      expect(await prisma.meetingReschedule.count({ where: { meetingId: { in: [second!, third!] }, scope: 'THIS_AND_LATER' } })).toBe(2);
    });

    it('a meeting outside a series is refused', async () => {
      const r = await series.create(weekly(a, { count: 1, weekday: 4, firstDate: nextWeekday(a, 4) }), a.orgId, as(a, 'chair'));
      await prisma.meeting.update({ where: { id: r.meetingIds[0]! }, data: { seriesId: null, seriesIndex: null } });
      expect(await code(series.updateLater(r.meetingIds[0]!, { location: 'X' }, a.orgId, as(a, 'chair')))).toBe('MEETING_NOT_IN_SERIES');
    });
  });

  describe('end series', () => {
    it('cancels every later open meeting with the reason, leaves a past one alone, and can run again', async () => {
      const r = await series.create(weekly(a, { weekday: 0 + 7, firstDate: nextWeekday(a, 7) }), a.orgId, as(a, 'chair'));
      // The first already happened.
      await prisma.meeting.update({ where: { id: r.meetingIds[0]! }, data: { scheduledAt: new Date(Date.now() - 86_400_000) } });
      expect(await code(series.end(r.seriesId, { reason: 'Merged into the quality committee' }, a.orgId, as(a, 'member')))).toBe('MEETING_NOT_ALLOWED');

      const res = await series.end(r.seriesId, { reason: 'Merged into the quality committee' }, a.orgId, as(a, 'chair'));
      expect(res).toEqual({ cancelled: r.meetingIds.slice(1), failed: [] });
      expect(await stageKey(r.meetingIds[0]!)).toBe('planned');
      for (const id of r.meetingIds.slice(1)) expect(await stageKey(id)).toBe('cancelled');
      const row = await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } });
      expect(row.endedAt).not.toBeNull();
      expect(row.endReason).toBe('Merged into the quality committee');
      expect(await series.end(r.seriesId, { reason: 'Again' }, a.orgId, as(a, 'chair'))).toEqual({ cancelled: [], failed: [] });
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endReason).toBe('Merged into the quality committee');
    });
  });

  describe('review findings (Prompt 170)', () => {
    /** The series service with some of the engine's calls made to fail. */
    const withWorkflow = (overrides: Partial<WorkflowService>) => {
      const wrapped = Object.assign(Object.create(workflow) as WorkflowService, overrides);
      return new MeetingSeriesService(prisma, visibility, wrapped, stageRules, calendar, meetings, clashes);
    };

    it('a series across a clock change keeps its wall-clock start (Europe/London, 28 Mar 2027)', async () => {
      const london = await world('Europe/London');
      const r = await series.create(weekly(london, { weekday: 7, firstDate: '2027-03-21', count: 2, startTime: '08:00' }), london.orgId, as(london, 'chair'));
      const rows = await seriesMeetings(r.seriesId);
      expect(rows.map((m) => DateTime.fromJSDate(m.scheduledAt).setZone('Europe/London').toFormat('yyyy-MM-dd HH:mm'))).toEqual(['2027-03-21 08:00', '2027-03-28 08:00']);
      // Non-vacuity: the two are 08:00 GMT and 07:00 UTC (BST).
      expect(rows.map((m) => m.scheduledAt.toISOString().slice(11, 16))).toEqual(['08:00', '07:00']);
    });

    it("End refuses the whole call, writing nothing, when the caller can't cancel every meeting", async () => {
      const c = await world();
      const r = await series.create(weekly(c, { count: 2 }), c.orgId, as(c, 'chair'));
      // Planned is reconfigured to be worked by the admin alone: the Chair schedules but can't press Cancel Meeting.
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: c.orgId, objectType: 'MEETING', isDefault: true } });
      const planned = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'planned' } });
      await prisma.workflowStageAssignee.deleteMany({ where: { stageId: planned.id } });
      await prisma.workflowStageAssignee.create({ data: { organizationId: c.orgId, stageId: planned.id, order: 1, kind: 'SPECIFIC_USER', userId: c.people['admin']! } });
      const audits = () => prisma.auditLog.count({ where: { objectType: 'MeetingSeries', objectId: r.seriesId, action: 'UPDATE' } });

      expect(await outcome(series.end(r.seriesId, { reason: 'Stop' }, c.orgId, as(c, 'chair')))).toMatchObject({ code: 'MEETING_SERIES_CANNOT_CANCEL', meetings: r.meetingIds });
      for (const id of r.meetingIds) expect(await stageKey(id)).toBe('planned');
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endedAt).toBeNull();
      expect(await audits()).toBe(0);
    });

    it('a partial failure leaves the series open; a re-run finishes it; a run on an ended series writes nothing', async () => {
      const r = await series.create(weekly(a, { weekday: 4, firstDate: nextWeekday(a, 4), count: 3 }), a.orgId, as(a, 'chair'));
      let calls = 0;
      const flaky = withWorkflow({
        triggerTransition: (...args: Parameters<WorkflowService['triggerTransition']>) => {
          calls += 1;
          if (calls === 2) return Promise.reject(new Error('cancel failed'));
          return workflow.triggerTransition(...args);
        },
      });
      const first = await flaky.end(r.seriesId, { reason: 'Merged' }, a.orgId, as(a, 'chair'));
      expect(first.failed).toEqual([r.meetingIds[1]]);
      expect(first.cancelled).toEqual([r.meetingIds[0], r.meetingIds[2]]);
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endedAt).toBeNull();

      expect(await series.end(r.seriesId, { reason: 'Merged' }, a.orgId, as(a, 'chair'))).toEqual({ cancelled: [r.meetingIds[1]], failed: [] });
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endedAt).not.toBeNull();
      const audits = () => prisma.auditLog.count({ where: { objectType: 'MeetingSeries', objectId: r.seriesId, action: 'UPDATE' } });
      const before = await audits();
      expect(await series.end(r.seriesId, { reason: 'Again' }, a.orgId, as(a, 'chair'))).toEqual({ cancelled: [], failed: [] });
      expect(await audits()).toBe(before);
    });

    it("one meeting's failing notices after the commit still answer the series, and the others' still go", async () => {
      let calls = 0;
      const finished: string[] = [];
      const flaky = withWorkflow({
        finishInstanceStart: (...args: Parameters<WorkflowService['finishInstanceStart']>) => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error('notice failed'));
          finished.push(args[1].instance.objectId);
          return workflow.finishInstanceStart(...args);
        },
      });
      const r = await flaky.create(weekly(a, { weekday: 1, firstDate: nextWeekday(a, 1), count: 3, location: 'Room 7' }), a.orgId, as(a, 'chair'));
      expect(r.meetingIds).toHaveLength(3);
      expect(calls).toBe(3);
      expect(finished).toEqual(r.meetingIds.slice(1));
      expect(await prisma.meetingSeries.count({ where: { id: r.seriesId } })).toBe(1);
    });

    it("reads the engine's first stage once for the whole series", async () => {
      let prepares = 0;
      const counting = withWorkflow({
        prepareInstanceStart: (...args: Parameters<WorkflowService['prepareInstanceStart']>) => {
          prepares += 1;
          return workflow.prepareInstanceStart(...args);
        },
      });
      const r = await counting.create(weekly(a, { weekday: 2, firstDate: nextWeekday(a, 2), count: 4, location: 'Room 8' }), a.orgId, as(a, 'chair'));
      expect(r.meetingIds).toHaveLength(4);
      expect(prepares).toBe(1);
    });

    it('a this-and-later reschedule across a clock change keeps each meeting\'s wall-clock time (Europe/London)', async () => {
      const london = await world('Europe/London');
      // Thursdays 18 Mar, 25 Mar and 1 Apr 2027 at 09:00; the clocks go forward on Sunday 28 Mar.
      const r = await series.create(weekly(london, { weekday: 4, firstDate: '2027-03-18', count: 3, startTime: '09:00' }), london.orgId, as(london, 'chair'));
      const [first] = await seriesMeetings(r.seriesId);
      // The first moves three days on, to Sunday 21 Mar at 09:00: the others follow by three calendar days.
      const to = DateTime.fromISO('2027-03-21T09:00', { zone: 'Europe/London' }).toJSDate();
      await series.rescheduleLater(first!.id, { scheduledAt: to.toISOString(), reason: 'Sundays now' }, london.orgId, as(london, 'chair'));
      const rows = await seriesMeetings(r.seriesId);
      expect(rows.map((m) => DateTime.fromJSDate(m.scheduledAt).setZone('Europe/London').toFormat('yyyy-MM-dd HH:mm'))).toEqual([
        '2027-03-21 09:00',
        '2027-03-28 09:00',
        '2027-04-04 09:00',
      ]);
      // Non-vacuity: the 28th is after the change, so its 09:00 is 08:00 UTC, not 09:00.
      expect(rows[1]!.scheduledAt.toISOString().slice(11, 16)).toBe('08:00');
    });

    it('a this-and-later reschedule moves a later meeting past a day the owner already meets', async () => {
      const d = await world();
      const r = await series.create(weekly(d, { weekday: 1, firstDate: nextWeekday(d, 1), count: 2 }), d.orgId, as(d, 'chair'));
      const [first, second] = await seriesMeetings(r.seriesId);
      // The committee already meets the day after the second meeting.
      const busy = new Date(second!.scheduledAt.getTime() + 86_400_000);
      const other = await prisma.meeting.create({
        data: { organizationId: d.orgId, organizerId: d.people['chair']!, title: 'Other', typeValueId: meetingType, scheduledAt: busy, durationMinutes: 60, location: 'Room 1', committeeId: d.committeeId },
      });
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: d.orgId, objectType: 'MEETING', isDefault: true } });
      const planned = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'planned' } });
      const inst = await prisma.workflowInstance.create({ data: { organizationId: d.orgId, workflowTemplateId: template.id, objectType: 'MEETING', objectId: other.id, status: 'IN_PROGRESS', currentStageId: planned.id } });
      await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: inst.id, stageId: planned.id, enteredAt: new Date() } });

      await series.rescheduleLater(first!.id, { scheduledAt: new Date(first!.scheduledAt.getTime() + 86_400_000).toISOString(), reason: 'A day later' }, d.orgId, as(d, 'chair'));
      const moved = await prisma.meeting.findFirstOrThrow({ where: { id: second!.id } });
      const day = (x: Date) => DateTime.fromJSDate(x).setZone(d.zone).toISODate();
      expect(day(moved.scheduledAt)).not.toBe(day(busy));
      expect(moved.scheduledAt > busy).toBe(true);
      expect(DateTime.fromJSDate(moved.scheduledAt).setZone(d.zone).toFormat('HH:mm')).toBe('10:00');
    });
  });

  // ── PR 8-be (P236) ──────────────────────────────────────────────────────────

  describe('the series on a meeting (Q1)', () => {
    it('names the pattern, the dates and the nearest meetings either side', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [first, second, third] = r.meetingIds;
      const s = (await meetings.getForViewer(second!, w.orgId, as(w, 'chair'))).series!;
      expect(s).toMatchObject({ id: r.seriesId, index: 2, total: 4, every: 'WEEK_1', ended: false, count: 4, endsOn: null, previousId: first, nextId: third });
      expect(s.on).toEqual({ kind: 'WEEKDAY', weekday: 2, dayOfMonth: null, ordinal: null });
      expect(s.firstDate).toBe(nextWeekday(w, 2));
    });

    it("names the neighbours' dates, and endedAfter is null while the series runs (P239)", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [first, second, third] = r.meetingIds;
      const at = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt.toISOString()]));
      const s = (await meetings.getForViewer(second!, w.orgId, as(w, 'chair'))).series!;
      expect([s.previousAt?.toISOString(), s.nextAt?.toISOString(), s.endedAfter]).toEqual([at[first!], at[third!], null]);
      // The first meeting has no previous one: no date either.
      const f = (await meetings.getForViewer(first!, w.orgId, as(w, 'chair'))).series!;
      expect([f.previousId, f.previousAt]).toEqual([null, null]);
    });

    it('an ended series says where it stopped: the place of its last meeting not cancelled (P239)', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [first, second, third, fourth] = r.meetingIds;
      const rows = await seriesMeetings(r.seriesId);
      // Ended between the second and the third meeting: the third and fourth are cancelled.
      const ended = await series.end(r.seriesId, { reason: 'Merged into the weekly round' }, w.orgId, as(w, 'chair'), new Date(rows[1]!.scheduledAt.getTime() + 3_600_000));
      expect([...ended.cancelled].sort()).toEqual([third, fourth].sort());
      for (const id of [first, second, third]) {
        const s = (await meetings.getForViewer(id!, w.orgId, as(w, 'chair'))).series!;
        expect([id, s.ended, s.endedAfter, s.total]).toEqual([id, true, 2, 4]);
      }
      expect((await meetings.getForViewer(second!, w.orgId, as(w, 'chair'))).series!.nextId).toBeNull();
    });

    it('previous and next skip a cancelled meeting', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [, second, third, fourth] = r.meetingIds;
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.orgId, objectType: 'MEETING', isDefault: true } });
      const cancelled = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'cancelled' } });
      await prisma.workflowInstance.updateMany({ where: { objectType: 'MEETING', objectId: third! }, data: { currentStageId: cancelled.id } });
      expect((await meetings.getForViewer(second!, w.orgId, as(w, 'chair'))).series!.nextId).toBe(fourth);
      expect((await meetings.getForViewer(fourth!, w.orgId, as(w, 'chair'))).series!.previousId).toBe(second);
    });

    it("previous and next are null where the viewer can't open them (the parent rule)", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [, second] = r.meetingIds;
      // Invited to the second meeting only: they may open it, and no other of the series.
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: second!, kind: 'ORG_GUEST', userId: w.people['outsider']!, invitedAt: new Date() } });
      const s = (await meetings.getForViewer(second!, w.orgId, as(w, 'outsider'))).series!;
      expect([s.previousId, s.nextId]).toEqual([null, null]);
    });

    it("who may open the neighbours is canSee()'s answer, batched: equal for every candidate and every kind of viewer (P237)", async () => {
      const w = await world();
      const other = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const theirs = await series.create(weekly(other, { count: 2, weekday: 2, firstDate: nextWeekday(other, 2) }), other.orgId, as(other, 'chair'));
      const [, second] = r.meetingIds;
      // The overseer: the head of the unit that owns the committee.
      const unit = (await prisma.committee.findFirstOrThrow({ where: { id: w.committeeId } })).orgUnitId!;
      const headPosition = await prisma.orgPosition.create({ data: { organizationId: w.orgId, nameEn: `Head ${randomUUID().slice(0, 6)}`, grade: 1, isUnitHeadPosition: true } });
      const head = await prisma.user.create({
        data: { organizationId: w.orgId, email: `head-${randomUUID().slice(0, 8)}@example.test`, name: 'head', status: 'ACTIVE', primaryOrgUnitId: unit, positionId: headPosition.id },
      });
      // Invited to the second meeting only.
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: second!, kind: 'ORG_GUEST', userId: w.people['presenter']!, invitedAt: new Date() } });
      const viewers: [string, MeetingViewer][] = [
        ['member', as(w, 'member')],
        ['overseer', { id: head.id, permissions: [] }],
        ['invited to one', as(w, 'presenter')],
        ['meetings:view', as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW])],
        ['committees:view', as(w, 'outsider', [COMMITTEES_PERMISSIONS.VIEW])],
        ['outsider', as(w, 'outsider')],
      ];
      // Every candidate kind: this series, another organisation's meetings, an invented id.
      const ids = [...r.meetingIds, ...theirs.meetingIds, 'no-such-meeting'];
      const access = new MeetingAccess(prisma, visibility);
      const now = new Date();
      const grid: Record<string, Record<string, boolean>> = {};
      for (const [kind, viewer] of viewers) {
        const batched = await access.openable(ids, w.orgId, viewer, now);
        const single: Record<string, boolean> = {};
        for (const id of ids) single[id] = (await access.canSee(id, w.orgId, viewer, now)) !== null;
        expect([kind, Object.fromEntries(ids.map((id) => [id, batched.has(id)]))]).toEqual([kind, single]);
        grid[kind] = single;
      }
      // Non-vacuity: the rule says yes and no, and each viewer kind is the kind it is meant to be.
      const seen = (kind: string) => r.meetingIds.filter((id) => grid[kind]![id]).length;
      expect([seen('member'), seen('overseer'), seen('invited to one'), seen('meetings:view'), seen('committees:view'), seen('outsider')]).toEqual([4, 4, 1, 4, 0, 0]);
      for (const kind of Object.keys(grid)) for (const id of [...theirs.meetingIds, 'no-such-meeting']) expect([kind, id, grid[kind]![id]]).toEqual([kind, id, false]);
    });

    it('costs the same number of queries for a series of 3 and a series of 30 (P237)', async () => {
      // A client that reports every statement, running the same services.
      const pool = new Pool({ connectionString: url, max: 4 });
      const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
      let statements = 0;
      client.$on('query', () => {
        statements++;
      });
      try {
        const db = client as unknown as PrismaService;
        const counted = new MeetingsService(db, new ObjectVisibilityService(db), workflow, new StageRulesService(db), notifications, calendar);
        const count = async (n: number) => {
          const w = await world();
          const r = await series.create(weekly(w, { count: n, weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
          // Invited to the middle meeting only: every other candidate is one they can't open, the worst case.
          const middle = r.meetingIds[Math.floor(n / 2)]!;
          await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: middle, kind: 'ORG_GUEST', userId: w.people['outsider']!, invitedAt: new Date() } });
          statements = 0;
          const read = await counted.getForViewer(middle, w.orgId, as(w, 'outsider'));
          expect([read.series!.total, read.series!.previousId, read.series!.nextId]).toEqual([n, null, null]);
          return statements;
        };
        const three = await count(3);
        const thirty = await count(30);
        // Non-vacuity: the read was counted at all.
        expect(three).toBeGreaterThan(0);
        expect(thirty).toBe(three);
      } finally {
        await client.$disconnect();
      }
    });
  });

  describe('the whole series view (view=series, P240)', () => {
    const cancel = async (w: World, meetingId: string) => {
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.orgId, objectType: 'MEETING', isDefault: true } });
      const cancelled = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'cancelled' } });
      await prisma.workflowInstance.updateMany({ where: { objectType: 'MEETING', objectId: meetingId }, data: { currentStageId: cancelled.id } });
    };

    it('every meeting of the series, by date, a cancelled one included as Cancelled, with where a moved one came from', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [first, second, third, fourth] = r.meetingIds;
      const rows = await seriesMeetings(r.seriesId);
      // The second moved past the third: the list follows the dates, not the series' order.
      const from = rows[1]!.scheduledAt;
      await meetings.reschedule(second!, { scheduledAt: new Date(rows[2]!.scheduledAt.getTime() + 3_600_000).toISOString(), reason: 'Room clash' }, w.orgId, as(w, 'chair'));
      await cancel(w, fourth!);

      const list = await meetings.list({ view: 'series', seriesId: r.seriesId }, w.orgId, as(w, 'member'));
      expect(list.items.map((m) => m.id)).toEqual([first, third, second, fourth]);
      expect(list.total).toBe(4);
      const dates = list.items.map((m) => m.scheduledAt.getTime());
      expect(dates).toEqual([...dates].sort((x, y) => x - y));
      expect(list.items.find((m) => m.id === fourth)!.stage.flags).toContain('MEETING_CANCELLED');
      expect(list.items.map((m) => [m.id, m.movedFrom?.toISOString() ?? null])).toEqual([
        [first, null],
        [third, null],
        [second, from.toISOString()],
        [fourth, null],
      ]);
      // Another view carries no note.
      const upcoming = await meetings.list({ view: 'upcoming', seriesId: r.seriesId }, w.orgId, as(w, 'member'));
      expect(upcoming.items.every((m) => !('movedFrom' in m))).toBe(true);
    });

    it("a meeting the viewer can't open is absent: a guest invited to one sees that one", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [, second] = r.meetingIds;
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: second!, kind: 'ORG_GUEST', userId: w.people['outsider']!, invitedAt: new Date() } });
      const asGuest = await meetings.list({ view: 'series', seriesId: r.seriesId }, w.orgId, as(w, 'outsider'));
      expect([asGuest.items.map((m) => m.id), asGuest.total]).toEqual([[second], 1]);
      // Non-vacuity: a member sees the whole series.
      expect((await meetings.list({ view: 'series', seriesId: r.seriesId }, w.orgId, as(w, 'member'))).total).toBe(4);
    });

    it(`the answer is never more than SERIES_LIST_CAP (${SERIES_LIST_CAP}) meetings, past the list's own page size`, async () => {
      const w = await world();
      const r = await series.create(weekly(w, { count: 2, weekday: 4, firstDate: nextWeekday(w, 4) }), w.orgId, as(w, 'chair'));
      const first = (await seriesMeetings(r.seriesId))[0]!;
      // Rows straight into the series, past what create allows, to reach the cap.
      await prisma.meeting.createMany({
        data: Array.from({ length: SERIES_LIST_CAP }, (_, i) => ({
          organizationId: w.orgId,
          organizerId: w.people['chair']!,
          title: `Extra ${i}`,
          typeValueId: meetingType,
          scheduledAt: new Date(first.scheduledAt.getTime() + (i + 2) * 7 * 86_400_000),
          durationMinutes: 60,
          committeeId: w.committeeId,
          seriesId: r.seriesId,
          seriesIndex: i + 3,
        })),
      });
      const list = await meetings.list({ view: 'series', seriesId: r.seriesId, take: 10 }, w.orgId, as(w, 'chair', [MEETINGS_PERMISSIONS.VIEW]));
      // The cap, not `take` (10) and not the page size (25): one answer of exactly the cap.
      expect(list.items.length).toBe(SERIES_LIST_CAP);
      // Its total is what it lists, never the uncapped count (P243).
      expect(list.total).toBe(SERIES_LIST_CAP);
      expect(list.items[0]!.id).toBe(first.id);
      // Non-vacuity: the series really holds more than the cap.
      expect(await prisma.meeting.count({ where: { seriesId: r.seriesId } })).toBe(SERIES_LIST_CAP + 2);

      // 3 (P243) — the cap with visibility: someone without meetings:view, invited
      // to the 2nd, the 54th and the 55th by date, sees exactly those, by date.
      // The rule is in the WHERE before the LIMIT, so the two past the cap are there.
      const byDate = await prisma.meeting.findMany({ where: { seriesId: r.seriesId }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }], select: { id: true } });
      const invited = [byDate[1]!.id, byDate[53]!.id, byDate[54]!.id];
      await prisma.meetingAttendee.createMany({
        data: invited.map((meetingId) => ({ organizationId: w.orgId, meetingId, kind: 'ORG_GUEST' as const, userId: w.people['outsider']!, invitedAt: new Date() })),
      });
      const asGuest = await meetings.list({ view: 'series', seriesId: r.seriesId }, w.orgId, as(w, 'outsider'));
      expect([asGuest.items.map((m) => m.id), asGuest.total]).toEqual([invited, 3]);
    });

    it("a moved meeting's note is its LATEST reschedule, and a tie on the time is broken by id, as the meeting page reads it (P243)", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { count: 2, weekday: 1, firstDate: nextWeekday(w, 1) }), w.orgId, as(w, 'chair'));
      const [first, second] = r.meetingIds;
      const at = (await prisma.meeting.findFirstOrThrow({ where: { id: first! } })).scheduledAt;
      const day = (n: number) => new Date(at.getTime() - n * 86_400_000);
      const row = (id: string, fromAt: Date, createdAt: Date, meetingId = first!) => ({
        id, organizationId: w.orgId, meetingId, fromAt, toAt: at, reason: 'x', scope: 'THIS_ONLY' as const, actorId: w.people['chair']!, createdAt,
      });
      const t1 = new Date('2026-01-01T08:00:00.000Z');
      const t2 = new Date('2026-01-02T08:00:00.000Z');
      // Two reschedules of the first: the newer one is the note.
      await prisma.meetingReschedule.createMany({ data: [row(`${first}-old`, day(2), t1), row(`${first}-new`, day(1), t2)] });
      // Two of the second at the SAME moment: the larger id is the note.
      await prisma.meetingReschedule.createMany({ data: [row(`${second}-a`, day(5), t2, second!), row(`${second}-b`, day(4), t2, second!)] });

      const list = await meetings.list({ view: 'series', seriesId: r.seriesId }, w.orgId, as(w, 'member'));
      const note = (id: string) => list.items.find((m) => m.id === id)!.movedFrom?.toISOString();
      expect(note(first!)).toBe(day(1).toISOString());
      expect(note(second!)).toBe(day(4).toISOString());
      // The meeting page reads the same one.
      expect((await meetings.getForViewer(first!, w.orgId, as(w, 'member'))).rescheduledFrom?.fromAt.toISOString()).toBe(day(1).toISOString());
      expect((await meetings.getForViewer(second!, w.orgId, as(w, 'member'))).rescheduledFrom?.fromAt.toISOString()).toBe(day(4).toISOString());
    });

    itEnforcesTenantIsolation("another organisation's series lists nothing", async () => {
      const r = await series.create(weekly(a, { count: 2, weekday: 3, firstDate: nextWeekday(a, 3) }), a.orgId, as(a, 'chair'));
      const theirs = await meetings.list({ view: 'series', seriesId: r.seriesId }, b.orgId, as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW]));
      expect([theirs.items, theirs.total]).toEqual([[], 0]);
      // Non-vacuity: the series is there for its own organisation.
      expect((await meetings.list({ view: 'series', seriesId: r.seriesId }, a.orgId, as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]))).total).toBe(2);
    });
  });

  describe('what "this and all later" would do (Q2, the scope preview)', () => {
    /** Every row the write could touch, as a fingerprint, to prove the preview changes none. */
    const fingerprint = async (w: World, seriesId: string) => ({
      meetings: (await seriesMeetings(seriesId)).map((m) => [m.id, m.scheduledAt.toISOString(), m.updatedAt.toISOString(), m.location, m.durationMinutes, m.ownEdits.join(',')]),
      reschedules: await prisma.meetingReschedule.count({ where: { organizationId: w.orgId } }),
      audit: await prisma.auditLog.count({ where: { organizationId: w.orgId } }),
      series: (await prisma.meetingSeries.findFirstOrThrow({ where: { id: seriesId } })).updatedAt.toISOString(),
    });

    it('a reschedule: writes nothing, and its times are exactly what the write then stores', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [, second, third, fourth] = r.meetingIds;
      const before = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt]));
      await meetings.reschedule(fourth!, { scheduledAt: new Date(before[fourth!]!.getTime() + 3_600_000).toISOString(), reason: 'Room clash' }, w.orgId, as(w, 'chair'));
      const to = new Date(before[second!]!.getTime() + 2 * 3_600_000).toISOString();

      const untouched = await fingerprint(w, r.seriesId);
      const preview = await series.scopePreview(second!, { change: 'RESCHEDULE', scheduledAt: to }, w.orgId, as(w, 'chair'));
      expect(await fingerprint(w, r.seriesId)).toEqual(untouched);
      expect(preview.meetings.map((m) => m.id)).toEqual([second, third]);
      expect(preview.kept).toEqual([{ meetingId: fourth, title: expect.any(String), fields: ['scheduledAt'], startsAt: expect.any(Date) }]);

      await series.rescheduleLater(second!, { scheduledAt: to, reason: 'Afternoon' }, w.orgId, as(w, 'chair'));
      const stored = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt.toISOString()]));
      for (const m of preview.meetings) expect([m.id, stored[m.id]]).toEqual([m.id, m.startsAt.toISOString()]);
    });

    it("a reschedule that moves a meeting off another of the owner's days: the preview places it as the write does", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [, second, third] = r.meetingIds;
      const rows = await seriesMeetings(r.seriesId);
      // A meeting of the same committee, outside the series, a day after the third:
      // a one-day shift lands the third on it, so the placement must move it on.
      const busyDay = new Date(rows[2]!.scheduledAt.getTime() + 86_400_000);
      await prisma.meeting.create({
        data: { organizationId: w.orgId, organizerId: w.people['chair']!, title: 'Extra', typeValueId: meetingType, scheduledAt: busyDay, durationMinutes: 60, location: 'Room 1', committeeId: w.committeeId },
      });
      const to = new Date(rows[1]!.scheduledAt.getTime() + 86_400_000).toISOString();
      const preview = await series.scopePreview(second!, { change: 'RESCHEDULE', scheduledAt: to }, w.orgId, as(w, 'chair'));
      await series.rescheduleLater(second!, { scheduledAt: to, reason: 'A day later' }, w.orgId, as(w, 'chair'));
      const stored = Object.fromEntries((await seriesMeetings(r.seriesId)).map((m) => [m.id, m.scheduledAt.toISOString()]));
      const previewed = Object.fromEntries(preview.meetings.map((m) => [m.id, m.startsAt.toISOString()]));
      expect(previewed[third!]).toBe(stored[third!]);
      expect(previewed[third!]).not.toBe(new Date(rows[2]!.scheduledAt.getTime() + 86_400_000).toISOString());
    });

    it('an edit: the meetings it changes and those that keep their own, as the write then reports, writing nothing', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      const [, second, third, fourth] = r.meetingIds;
      await meetings.update(third!, { location: 'Room 9' }, w.orgId, as(w, 'chair'));
      const untouched = await fingerprint(w, r.seriesId);
      const preview = await series.scopePreview(second!, { change: 'EDIT', location: 'Hall A', durationMinutes: 90 }, w.orgId, as(w, 'chair'));
      expect(await fingerprint(w, r.seriesId)).toEqual(untouched);
      expect(preview.meetings.map((m) => m.id)).toEqual([second, third, fourth]);
      expect(preview.meetings.map((m) => m.durationMinutes)).toEqual([90, 90, 90]);
      expect(preview.kept).toEqual([{ meetingId: third, title: expect.any(String), fields: ['location'], startsAt: expect.any(Date) }]);
      const res = await series.updateLater(second!, { location: 'Hall A', durationMinutes: 90 }, w.orgId, as(w, 'chair'));
      expect([...res.scope.changed].sort()).toEqual(preview.meetings.map((m) => m.id).sort());
      expect(res.scope.kept.map((k) => [k.meetingId, k.fields])).toEqual(preview.kept.map((k) => [k.meetingId, k.fields]));
    });

    it('takes no row lock: it answers while another transaction holds a meeting and its instance FOR UPDATE', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [, second] = r.meetingIds;
      const at = (await prisma.meeting.findFirstOrThrow({ where: { id: second! } })).scheduledAt;
      const answered = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${second!} FOR UPDATE`;
          // And its workflow instance: a FOR SHARE on it in the preview would wait here too.
          await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE "objectType" = 'MEETING' AND "objectId" = ${second!} FOR UPDATE`;
          const p = await series.scopePreview(second!, { change: 'RESCHEDULE', scheduledAt: new Date(at.getTime() + 3_600_000).toISOString() }, w.orgId, as(w, 'chair'));
          return p.meetings.length;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
      expect(answered).toBeGreaterThan(0);
    });

    it("the clashes at the new times, and never with a meeting that is itself moving", async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [first, second] = r.meetingIds;
      const rows = await seriesMeetings(r.seriesId);
      // A week later: each meeting lands on the next one's old time. Those aren't clashes.
      const week = await series.scopePreview(first!, { change: 'RESCHEDULE', scheduledAt: new Date(rows[0]!.scheduledAt.getTime() + 7 * 86_400_000).toISOString() }, w.orgId, as(w, 'chair'));
      expect(week.clashes).toEqual([]);
      // An hour later, where the member has another (unit) meeting: that one is.
      const to = new Date(rows[1]!.scheduledAt.getTime() + 3_600_000);
      const unit = (await prisma.committee.findFirstOrThrow({ where: { id: w.committeeId } })).orgUnitId;
      const other = await prisma.meeting.create({
        data: { organizationId: w.orgId, organizerId: w.people['chair']!, title: 'Other', typeValueId: meetingType, scheduledAt: to, durationMinutes: 60, location: 'Room 1', orgUnitId: unit },
      });
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: other.id, kind: 'ORG_GUEST', userId: w.people['member']!, invitedAt: new Date() } });
      const hour = await series.scopePreview(second!, { change: 'RESCHEDULE', scheduledAt: to.toISOString() }, w.orgId, as(w, 'chair'));
      const atSecond = hour.clashes.find((c) => c.startsAt === to.toISOString())!;
      expect(atSecond.people.map((p) => p.userId)).toEqual([w.people['member']]);
    });

    it('an edit that moves no time names no clash, even where one is already there; a longer meeting is still checked (P237)', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 3, firstDate: nextWeekday(w, 3) }), w.orgId, as(w, 'chair'));
      const [, second] = r.meetingIds;
      const at = (await prisma.meeting.findFirstOrThrow({ where: { id: second! } })).scheduledAt;
      // The member already has another meeting at the second meeting's time: an existing clash.
      const unit = (await prisma.committee.findFirstOrThrow({ where: { id: w.committeeId } })).orgUnitId;
      const other = await prisma.meeting.create({
        data: { organizationId: w.orgId, organizerId: w.people['chair']!, title: 'Other', typeValueId: meetingType, scheduledAt: at, durationMinutes: 60, location: 'Room 1', orgUnitId: unit },
      });
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: other.id, kind: 'ORG_GUEST', userId: w.people['member']!, invitedAt: new Date() } });
      const moved = await series.scopePreview(second!, { change: 'EDIT', location: 'Hall B' }, w.orgId, as(w, 'chair'));
      expect(moved.meetings.length).toBeGreaterThan(0);
      expect(moved.clashes).toEqual([]);
      // Non-vacuity: the same clash is named once the edit changes the duration.
      const longer = await series.scopePreview(second!, { change: 'EDIT', durationMinutes: 90 }, w.orgId, as(w, 'chair'));
      expect(longer.clashes.flatMap((c) => c.people.map((p) => p.userId))).toContain(w.people['member']);
    });

    it('the same "who may ask" as the write: someone who may not edit is refused, and so is a meeting outside a series', async () => {
      const w = await world();
      const r = await series.create(weekly(w, { weekday: 2, firstDate: nextWeekday(w, 2) }), w.orgId, as(w, 'chair'));
      expect(await code(series.scopePreview(r.meetingIds[1]!, { change: 'EDIT', location: 'X' }, w.orgId, as(w, 'member')))).toBe('MEETING_NOT_ALLOWED');
      await prisma.meeting.update({ where: { id: r.meetingIds[3]! }, data: { seriesId: null, seriesIndex: null } });
      expect(await code(series.scopePreview(r.meetingIds[3]!, { change: 'EDIT', location: 'X' }, w.orgId, as(w, 'chair')))).toBe('MEETING_NOT_IN_SERIES');
    });

    itEnforcesTenantIsolation("another organisation's meeting is the same 404 as a missing one", async () => {
      const r = await series.create(weekly(a, { count: 2, weekday: 4, firstDate: nextWeekday(a, 4) }), a.orgId, as(a, 'chair'));
      const other = as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW]);
      expect(await code(series.scopePreview(r.meetingIds[0]!, { change: 'EDIT', location: 'X' }, b.orgId, other))).toBe(404);
      expect(await code(series.scopePreview('no-such-meeting', { change: 'EDIT', location: 'X' }, b.orgId, other))).toBe(404);
      expect(await code(meetings.getForViewer(r.meetingIds[0]!, b.orgId, other))).toBe(404);
    });
  });

  describe('another organisation', () => {
    itEnforcesTenantIsolation("End series never presses a move into another organisation's stage", async () => {
      const e = await world();
      const r = await series.create(weekly(e, { count: 1 }), e.orgId, as(e, 'chair'));
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: e.orgId, objectType: 'MEETING', isDefault: true } });
      const planned = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'planned' } });
      // This organisation's own Cancel Meeting is gone; a corrupt move leads from its Planned into another organisation's Cancelled.
      const own = await prisma.workflowTransition.findMany({ where: { fromStageId: planned.id, toStage: { flags: { has: 'MEETING_CANCELLED' } } }, select: { id: true } });
      await prisma.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: { in: own.map((t) => t.id) } } });
      await prisma.workflowTransition.deleteMany({ where: { id: { in: own.map((t) => t.id) } } });
      const theirTemplate = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: b.orgId, objectType: 'MEETING', isDefault: true } });
      const theirCancelled = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: theirTemplate.id, key: 'cancelled' } });
      await prisma.workflowTransition.create({ data: { fromStageId: planned.id, toStageId: theirCancelled.id, labelEn: 'Cancel', labelAr: 'إلغاء', mover: 'PERSON', kind: 'EXIT' } });

      expect(await code(series.end(r.seriesId, { reason: 'x' }, e.orgId, as(e, 'chair')))).toBe('MEETING_SERIES_CANNOT_CANCEL');
      expect(await stageKey(r.meetingIds[0]!)).toBe('planned');
    });

    itEnforcesTenantIsolation("a series and its meetings are out of another organisation's reach", async () => {
      const r = await series.create(weekly(a, { count: 2, weekday: 1, firstDate: nextWeekday(a, 1) }), a.orgId, as(a, 'chair'));
      const other = as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW]);
      expect(await code(series.end(r.seriesId, { reason: 'x' }, b.orgId, other))).toBe('MEETING_SERIES_NOT_FOUND');
      // Another organisation's committee is no owner of a series made here.
      expect(await code(series.preview(weekly(a, { count: 1 }), b.orgId, other))).toBe('MEETING_OWNER_NOT_FOUND');
      expect(await code(series.create(weekly(a, { count: 1 }), b.orgId, other))).toBe('MEETING_OWNER_NOT_FOUND');
      expect(await code(series.updateLater(r.meetingIds[0]!, { location: 'X' }, b.orgId, other))).toBe(404);
      expect(await code(series.rescheduleLater(r.meetingIds[0]!, { scheduledAt: new Date(Date.now() + 9e8).toISOString(), reason: 'x' }, b.orgId, other))).toBe(404);
      expect((await meetings.list({ view: 'all', seriesId: r.seriesId }, b.orgId, other)).total).toBe(0);
      expect((await meetings.list({ view: 'all', seriesId: r.seriesId }, a.orgId, as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]))).total).toBe(2);
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endedAt).toBeNull();
    });
  });
});
