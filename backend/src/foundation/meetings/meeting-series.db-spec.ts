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
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
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
import { MeetingsService } from './meetings.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingSeriesService } from './meeting-series.service';
import type { MeetingViewer } from './meeting-access';

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

  async function world(): Promise<World> {
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

  describe('another organisation', () => {
    itEnforcesTenantIsolation("a series and its meetings are out of another organisation's reach", async () => {
      const r = await series.create(weekly(a, { count: 2, weekday: 1, firstDate: nextWeekday(a, 1) }), a.orgId, as(a, 'chair'));
      const other = as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW]);
      expect(await code(series.end(r.seriesId, { reason: 'x' }, b.orgId, other))).toBe('MEETING_SERIES_NOT_FOUND');
      expect(await code(series.updateLater(r.meetingIds[0]!, { location: 'X' }, b.orgId, other))).toBe(404);
      expect(await code(series.rescheduleLater(r.meetingIds[0]!, { scheduledAt: new Date(Date.now() + 9e8).toISOString(), reason: 'x' }, b.orgId, other))).toBe(404);
      expect((await meetings.list({ view: 'all', seriesId: r.seriesId }, b.orgId, other)).total).toBe(0);
      expect((await meetings.list({ view: 'all', seriesId: r.seriesId }, a.orgId, as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]))).total).toBe(2);
      expect((await prisma.meetingSeries.findFirstOrThrow({ where: { id: r.seriesId } })).endedAt).toBeNull();
    });
  });
});
