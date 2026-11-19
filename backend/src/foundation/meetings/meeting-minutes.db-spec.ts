/**
 * ACC-316 PR 4 — a meeting's minutes and their review against a REAL Postgres
 * (npm run test:db). Plan: backend/Plans/step-316-meeting-management.md §3.4–§3.9,
 * §4.1, §4.2 and §6 (PR 4).
 *
 * The organisation: a committee owned by a unit, its Chair, Secretary and a
 * member (the defaults: the Secretary records; the Chair works Minutes Review),
 * quorum 2. Each meeting is written straight to the stage a test needs.
 *
 * Only a database proves:
 *   - who reads the minutes at each phase (§4.1), and the refusal for anyone else;
 *   - attendance from the start time, by whoever records, the quorum frozen at
 *     the first recording, "Can't attend" suggested as Apologies;
 *   - the vote check (all three or none; never more than the members present),
 *     and "Taken without quorum";
 *   - action item drafts: a future due date, a person of the organisation; in
 *     Minutes Review only the date, recorded as a review change;
 *   - Distribute (the app's move): Minutes Draft's pool, attendance complete,
 *     the round and review date written with the move, the present members told;
 *   - the review: only members recorded present answer; a suggestion replaces
 *     "No corrections"; apply and decline, the author told;
 *   - Approve Minutes held by each precondition, said by the moves list's
 *     blockedBy and refused on the press, then the tasks created with it;
 *   - Return for Correction by whoever records the minutes;
 *   - the reminder, once per round; Home's rows.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { TaskVisibilityService } from '../task/task-visibility.service';
import { TaskAdmissionService } from '../task/task-admission.service';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { copyDefaultSeatActions } from '../committees/seat-actions';
import { MeetingMinutesService } from './meeting-minutes.service';
import { MeetingReviewService } from './meeting-review.service';
import { MeetingReviewReminderService } from './meeting-review-reminder.service';
import type { MeetingViewer } from './meeting-access';
import { draftActionItems, reviewers, unrecordedAttendance } from './meeting-minutes-rules';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { useFixedClock } from '../../common/testing/fixed-clock';
import { STAGE_FLAG } from '../workflow/record-registry';
import { applyTransitionEffects, finishTransitionEffects, prepareTransitionEffects } from '../workflow/transition-effects';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const MEETING_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'MEETING')!;
const DAY = 86_400_000;

describe("A meeting's minutes and review against a real database (ACC-316 PR 4)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const lookupService = new LookupService(prisma, audit);
  const notices: { userId: string; titleEn: string; bodyEn: string; bodyAr: string }[] = [];
  const notifications = {
    create: async (dto: { userId: string; titleEn: string; bodyEn: string; bodyAr: string }) => {
      notices.push({ userId: dto.userId, titleEn: dto.titleEn, bodyEn: dto.bodyEn, bodyAr: dto.bodyAr });
      return { id: randomUUID() };
    },
    createInAppMany: async () => 0,
    sendOutsideEmail: async () => undefined,
  } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(
    prisma,
    audit,
    labels,
    visibility,
    calendar,
    notifications,
    tenant,
    new TaskAssignmentService(prisma, authority, lookups),
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
  const admission = new TaskAdmissionService(prisma, visibility, tasks, new TaskVisibilityService(prisma, authority));
  const minutes = new MeetingMinutesService(prisma, visibility, stageRules, workflow, calendar, admission);
  const review = new MeetingReviewService(prisma, visibility, stageRules, workflow, notifications, calendar);
  const reminders = new MeetingReviewReminderService(prisma, stageRules, notifications, calendar);

  let seat: Record<string, string> = {};
  let meetingType = '';

  interface World {
    orgId: string;
    unitId: string;
    people: Record<string, string>;
    committeeId: string;
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  async function world(): Promise<World> {
    const slug = `acc316m-${randomUUID().slice(0, 8)}`;
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
      guest: await person('guest'),
      viewer: await person('viewer'),
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
    return { orgId: o.id, unitId: unit.id, people, committeeId: c.id };
  }

  /** A committee meeting at the stage keyed `key`, its members (and an organisation guest) invited. */
  async function meetingAt(w: World, key: string, scheduledAt: Date = new Date(Date.now() - DAY)): Promise<{ id: string; itemId: string; instanceId: string }> {
    const m = await prisma.meeting.create({
      data: { organizationId: w.orgId, organizerId: w.people['secretary']!, title: `IPC ${randomUUID().slice(0, 4)}`, typeValueId: meetingType, scheduledAt, durationMinutes: 60, location: 'Room 4', committeeId: w.committeeId },
    });
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.orgId, objectType: 'MEETING', isDefault: true } });
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: w.orgId, workflowTemplateId: template.id, objectType: 'MEETING', objectId: m.id, status: 'IN_PROGRESS', currentStageId: stage.id },
    });
    await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
    for (const [name, seatKey] of [
      ['chair', 'chairman'],
      ['secretary', 'secretary'],
      ['member', 'member'],
    ] as const) {
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: m.id, kind: 'MEMBER', userId: w.people[name]!, seatValueId: seat[seatKey]!, invitedAt: new Date() } });
    }
    await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: m.id, kind: 'ORG_GUEST', userId: w.people['guest']!, invitedAt: new Date() } });
    const item = await prisma.agendaItem.create({ data: { organizationId: w.orgId, meetingId: m.id, title: 'Hand hygiene', order: 1 } });
    return { id: m.id, itemId: item.id, instanceId: instance.id };
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
  const stageKey = async (meetingId: string) => {
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { objectType: 'MEETING', objectId: meetingId } });
    return (await prisma.workflowStage.findFirstOrThrow({ where: { id: instance.currentStageId! } })).key;
  };
  /** Everyone present (the three members and the guest), recorded by the Secretary. */
  const allPresent = async (w: World, meetingId: string) => {
    const rows = await prisma.meetingAttendee.findMany({ where: { meetingId }, select: { id: true } });
    await minutes.recordAttendance(meetingId, { rows: rows.map((r) => ({ attendeeId: r.id, attendance: 'PRESENT' as const })) }, w.orgId, as(w, 'secretary'));
  };
  /** A meeting distributed for review, everyone present. */
  const inReview = async (w: World) => {
    const m = await meetingAt(w, 'minutes_draft');
    await allPresent(w, m.id);
    await review.distribute(m.id, {}, w.orgId, as(w, 'secretary'));
    return m;
  };
  const approveMove = async (instanceId: string) => {
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { id: instanceId } });
    return prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: instance.currentStageId!, toStage: { key: 'minutes_approved' } } });
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

  describe('open actions from the last meeting, for the agenda (PR 7b, P202)', () => {
    /** The last meeting, approved, with `n` action items whose tasks are open (the member owns each). */
    const lastWithOpenActions = async (w: World, n: number) => {
      const last = await inReview(w);
      for (const name of ['chair', 'secretary', 'member']) await review.noCorrections(last.id, w.orgId, as(w, name));
      const limit = await tasks.slaLimitFrom(new Date(), 'MEDIUM', w.orgId);
      for (let i = 1; i <= n; i++) {
        await prisma.meetingActionItem.create({
          data: { organizationId: w.orgId, meetingId: last.id, agendaItemId: last.itemId, title: `Action ${i}`, ownerUserId: w.people['member']!, dueAt: new Date(limit.getTime() - 60 * 60_000) },
        });
      }
      await workflow.triggerTransition(last.instanceId, { transitionId: (await approveMove(last.instanceId)).id }, w.orgId, w.people['chair']!, []);
      return last;
    };
    const next = (w: World) => meetingAt(w, 'agenda_ready', new Date(Date.now() + DAY));

    it("a member reads the last meeting's open actions, each linked where the task page would open it", async () => {
      const w = await world();
      await lastWithOpenActions(w, 2);
      const m = await next(w);
      const read = await minutes.getOpenActions(m.id, w.orgId, as(w, 'member'));
      expect(read.mayRead).toBe(true);
      expect(read.rows.map((r) => [r.title, r.owner?.id, r.mayOpen])).toEqual([
        ['Action 1', w.people['member'], true],
        ['Action 2', w.people['member'], true],
      ]);
      // Someone who sees every meeting reads them too, but holds no task key and is on none of the tasks: no link.
      const viewer = await minutes.getOpenActions(m.id, w.orgId, as(w, 'viewer', [MEETINGS_PERMISSIONS.VIEW]));
      expect(viewer.mayRead).toBe(true);
      expect(viewer.rows.map((r) => r.mayOpen)).toEqual([false, false]);
    });

    it("an organisation guest of THIS meeting only can't read the last meeting's minutes: no rows, and no error", async () => {
      const w = await world();
      await lastWithOpenActions(w, 1);
      const m = await next(w);
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: m.id, kind: 'ORG_GUEST', userId: w.people['viewer']!, invitedAt: new Date() } });
      // Nothing is concealed from this caller here: no concealed-refusal log line about the last meeting (P206).
      const warn = jest.spyOn(Logger.prototype, 'warn');
      try {
        expect(await minutes.getOpenActions(m.id, w.orgId, as(w, 'viewer'))).toEqual({ mayRead: false, rows: [] });
        expect(warn.mock.calls.filter(([line]) => String(line).includes('Visibility refusal'))).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    });

    it("the last meeting's own minutes rule decides: where its stage no longer marks them final, nobody reads the rows", async () => {
      const w = await world();
      const last = await lastWithOpenActions(w, 1);
      const m = await next(w);
      expect((await minutes.getOpenActions(m.id, w.orgId, as(w, 'member'))).rows.length).toBe(1);
      // The tenant takes MINUTES_FINAL off the stage the last meeting stands in: its minutes are no longer open to read (§4.1).
      const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { id: last.instanceId } });
      await prisma.workflowStage.update({ where: { id: instance.currentStageId! }, data: { flags: [] } });
      expect(await minutes.getOpenActions(m.id, w.orgId, as(w, 'member'))).toEqual({ mayRead: false, rows: [] });
    });

    it('someone who cannot see this meeting gets the identical 404 a missing meeting gets', async () => {
      const w = await world();
      await lastWithOpenActions(w, 1);
      const m = await next(w);
      const refused = await outcome(minutes.getOpenActions(m.id, w.orgId, as(w, 'viewer')));
      expect(refused).toEqual(await outcome(minutes.getOpenActions('no-such-meeting', w.orgId, as(w, 'viewer'))));
      expect((refused as { statusCode?: number }).statusCode).toBe(404);
    });

    it("no earlier approved meeting answers exactly as \"you can't read it\" does (P206)", async () => {
      const w = await world();
      const m = await next(w);
      expect(await minutes.getOpenActions(m.id, w.orgId, as(w, 'member'))).toEqual({ mayRead: false, rows: [] });
    });

    itEnforcesTenantIsolation("the last meeting is never another organisation's, even one filed under this committee's id", async () => {
      const w = await world();
      // The real last meeting, approved, with one open action.
      await lastWithOpenActions(w, 1);
      const m = await next(w);
      // A corrupt row NEWER than it: an approved meeting naming this committee, filed under organisation b.
      const corrupt = await prisma.meeting.create({
        data: {
          organizationId: b.orgId,
          organizerId: b.people['secretary']!,
          title: 'Corrupt',
          typeValueId: meetingType,
          scheduledAt: new Date(Date.now() - DAY / 2),
          durationMinutes: 60,
          location: 'Room 4',
          committeeId: w.committeeId,
          minutesApprovedAt: new Date(),
        },
      });
      try {
        // The real one is still the last meeting: the corrupt row is never read.
        const read = await minutes.getOpenActions(m.id, w.orgId, as(w, 'member'));
        expect(read.mayRead).toBe(true);
        expect(read.rows.map((r) => r.title)).toEqual(['Action 1']);
      } finally {
        await prisma.meeting.delete({ where: { id: corrupt.id } });
      }
    });

    itEnforcesTenantIsolation("another organisation's meeting is the identical refusal a missing one gets", async () => {
      const w = await world();
      await lastWithOpenActions(w, 1);
      const m = await next(w);
      const theirs = await outcome(minutes.getOpenActions(m.id, b.orgId, as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW])));
      expect(theirs).toEqual(await outcome(minutes.getOpenActions('no-such-meeting', b.orgId, as(b, 'chair', [MEETINGS_PERMISSIONS.VIEW]))));
      expect((theirs as { statusCode?: number }).statusCode).toBe(404);
    });

    it('costs a fixed number of queries for any number of rows (the task links are one batch)', async () => {
      // A client that reports every statement, running the same services.
      const pool = new Pool({ connectionString: url, max: 4 });
      const client = new PrismaClient({ adapter: new PrismaPg(pool), log: [{ emit: 'event', level: 'query' }] });
      let statements = 0;
      client.$on('query', () => {
        statements++;
      });
      try {
        const db = client as unknown as PrismaService;
        const counted = new MeetingMinutesService(
          db,
          new ObjectVisibilityService(db),
          new StageRulesService(db),
          workflow,
          calendar,
          new TaskAdmissionService(db, new ObjectVisibilityService(db), tasks, new TaskVisibilityService(db, new TaskAuthorityService(db))),
        );
        const count = async (n: number) => {
          const w = await world();
          await lastWithOpenActions(w, n);
          const m = await next(w);
          statements = 0;
          const read = await counted.getOpenActions(m.id, w.orgId, as(w, 'member'));
          expect(read.rows.length).toBe(n);
          return statements;
        };
        const one = await count(1);
        const five = await count(5);
        // Non-vacuity: the read was counted at all.
        expect(one).toBeGreaterThan(0);
        expect(five).toBe(one);
      } finally {
        await client.$disconnect();
      }
    });
  });

  describe('who reads the minutes (§4.1)', () => {
    it('Minutes Draft: whoever records them; a member is refused', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      expect((await minutes.getMinutes(m.id, a.orgId, as(a, 'secretary'))).phase).toBe('draft');
      expect(await code(minutes.getMinutes(m.id, a.orgId, as(a, 'member')))).toBe('MEETING_MINUTES_NOT_OPEN');
    });

    it('Minutes Draft offers the review date Distribute uses by default: five working days after today (PR 7b)', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      const now = new Date();
      const read = await minutes.getMinutes(m.id, a.orgId, as(a, 'secretary'), now);
      const today = DateTime.fromJSDate(now).setZone(await calendar.getEffectiveTimeZone(a.orgId)).toISODate()!;
      const expected = await calendar.addWorkingDays(today, 5, a.orgId);
      expect(read.distribute?.defaultReviewBy).toBe(expected);
      // The default is a day after today, which Distribute requires.
      expect(expected > today).toBe(true);
    });

    it("Minutes Review: the committee's members; someone who only sees all meetings is refused", async () => {
      const m = await inReview(a);
      expect((await minutes.getMinutes(m.id, a.orgId, as(a, 'member'))).phase).toBe('review');
      expect(await code(minutes.getMinutes(m.id, a.orgId, as(a, 'viewer', [MEETINGS_PERMISSIONS.VIEW])))).toBe('MEETING_MINUTES_NOT_OPEN');
    });

    it('Planned: nobody, not even whoever records them', async () => {
      const m = await meetingAt(a, 'planned', new Date(Date.now() + DAY));
      expect(await code(minutes.getMinutes(m.id, a.orgId, as(a, 'secretary')))).toBe('MEETING_MINUTES_NOT_OPEN');
    });
  });

  describe('attendance', () => {
    it("from the start time, by whoever records it; the quorum is frozen at the first recording; Can't attend is suggested as Apologies", async () => {
      const future = await meetingAt(a, 'agenda_ready', new Date(Date.now() + DAY));
      const row = await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId: future.id, userId: a.people['member']! } });
      expect(await code(minutes.recordAttendance(future.id, { rows: [{ attendeeId: row.id, attendance: 'PRESENT' }] }, a.orgId, as(a, 'secretary')))).toBe('MEETING_NOT_STARTED');

      const m = await meetingAt(a, 'agenda_ready');
      await prisma.meetingAttendee.updateMany({ where: { meetingId: m.id, userId: a.people['member']! }, data: { answer: 'CANT_ATTEND' } });
      const chairRow = await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId: m.id, userId: a.people['chair']! } });
      // The Chair's seat schedules but does not record.
      expect(await code(minutes.recordAttendance(m.id, { rows: [{ attendeeId: chairRow.id, attendance: 'PRESENT' }] }, a.orgId, as(a, 'chair')))).toBe('MEETING_NOT_RECORDER');

      const read = await minutes.recordAttendance(m.id, { rows: [{ attendeeId: chairRow.id, attendance: 'PRESENT' }] }, a.orgId, as(a, 'secretary'));
      expect(read.attendance.find((r) => r.userId === a.people['member'])).toMatchObject({ attendance: null, suggested: 'APOLOGIES' });
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).quorumAtAttendance).toBe(2);
      await prisma.committee.update({ where: { id: a.committeeId }, data: { quorumCount: 3 } });
      try {
        await minutes.recordAttendance(m.id, { rows: [{ attendeeId: chairRow.id, attendance: 'ABSENT' }] }, a.orgId, as(a, 'secretary'));
        expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).quorumAtAttendance).toBe(2);
      } finally {
        await prisma.committee.update({ where: { id: a.committeeId }, data: { quorumCount: 2 } });
      }
    });

    it("isn't recorded where the stage doesn't allow it (Planned)", async () => {
      const m = await meetingAt(a, 'planned');
      const row = await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId: m.id, userId: a.people['member']! } });
      expect(await code(minutes.recordAttendance(m.id, { rows: [{ attendeeId: row.id, attendance: 'PRESENT' }] }, a.orgId, as(a, 'secretary')))).toBe('STAGE_ACTION_NOT_ALLOWED');
    });
  });

  describe('minutes, decisions and votes', () => {
    it('the vote check: all three or none, never more than the members present; below quorum a decision is taken without quorum', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id }, select: { id: true, userId: true } });
      // Only the Chair present: 1 member, below the quorum of 2.
      await minutes.recordAttendance(
        m.id,
        { rows: rows.map((r) => ({ attendeeId: r.id, attendance: r.userId === a.people['chair'] ? ('PRESENT' as const) : ('ABSENT' as const) })) },
        a.orgId,
        as(a, 'secretary'),
      );
      const s = as(a, 'secretary');
      expect(await code(minutes.addDecision(m.id, m.itemId, { text: 'Re-audit', votesFor: 1 }, a.orgId, s))).toBe('MEETING_VOTES_PARTIAL');
      expect(await outcome(minutes.addDecision(m.id, m.itemId, { text: 'Re-audit', votesFor: 1, votesAgainst: 1, votesAbstain: 0 }, a.orgId, s))).toMatchObject({
        code: 'MEETING_VOTES_EXCEED_PRESENT',
        present: 1,
        total: 2,
      });
      expect(await code(minutes.addDecision(m.id, m.itemId, { text: null }, a.orgId, s))).toBe('MEETING_DECISION_TEXT_REQUIRED');
      const read = await minutes.addDecision(m.id, m.itemId, { text: 'Re-audit', votesFor: 1, votesAgainst: 0, votesAbstain: 0 }, a.orgId, s);
      expect(read.items[0]!.decisions[0]).toMatchObject({ text: 'Re-audit', votes: { for: 1, against: 0, abstain: 0 }, takenWithoutQuorum: true });
      expect(read.quorum).toEqual({ quorum: 2, presentMembers: 1, met: false });

      const set = await minutes.setItemMinutes(m.id, m.itemId, { discussion: 'Compliance 84%.' }, a.orgId, s);
      expect(set.items[0]!.discussion).toBe('Compliance 84%.');
      // Replaced whole, never appended (an AI Accept is one such write, ACC-322).
      expect((await minutes.setItemMinutes(m.id, m.itemId, { discussion: 'Compliance 86%.' }, a.orgId, s)).items[0]!.discussion).toBe('Compliance 86%.');
      // Nothing written in Minutes Draft is a review change.
      expect(await prisma.meetingReviewChange.count({ where: { meetingId: m.id } })).toBe(0);
    });

    it('action items: a future due date and a person of the organisation; another organisation\'s person is refused', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      const s = as(a, 'secretary');
      const soon = new Date(Date.now() + DAY).toISOString();
      expect(await code(minutes.addActionItem(m.id, m.itemId, { title: 'Re-audit 4B', ownerUserId: a.people['member']!, dueAt: new Date(Date.now() - DAY).toISOString() }, a.orgId, s))).toBe(
        'MEETING_ACTION_DUE_IN_PAST',
      );
      expect(await code(minutes.addActionItem(m.id, m.itemId, { title: 'Re-audit 4B', ownerUserId: b.people['member']!, dueAt: soon }, a.orgId, s))).toBe('MEETING_PERSON_NOT_FOUND');
      const read = await minutes.addActionItem(m.id, m.itemId, { title: 'Re-audit 4B', ownerUserId: a.people['guest']!, dueAt: soon }, a.orgId, s);
      expect(read.items[0]!.actionItems[0]).toMatchObject({ title: 'Re-audit 4B', owner: { id: a.people['guest'], name: 'guest' }, task: null });
    });

    it('in Minutes Review: only an action\'s date changes, recorded as a review change; a new title is refused by the stage', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      const soon = new Date(Date.now() + DAY).toISOString();
      const added = await minutes.addActionItem(m.id, m.itemId, { title: 'Re-audit 4B', ownerUserId: a.people['member']!, dueAt: soon }, a.orgId, as(a, 'secretary'));
      const actionId = added.items[0]!.actionItems[0]!.id;
      await allPresent(a, m.id);
      await review.distribute(m.id, {}, a.orgId, as(a, 'secretary'));

      expect(await code(minutes.updateActionItem(m.id, actionId, { title: 'Re-audit 6A' }, a.orgId, as(a, 'secretary')))).toBe('STAGE_ACTION_NOT_ALLOWED');
      const later = new Date(Date.now() + 2 * DAY).toISOString();
      const read = await minutes.updateActionItem(m.id, actionId, { dueAt: later }, a.orgId, as(a, 'secretary'));
      expect(read.items[0]!.actionItems[0]!.dueAt.toISOString()).toBe(later);
      expect(read.review.changes).toEqual([{ round: 1, agendaItemId: m.itemId, what: 'ACTION_DATE' }]);
    });
  });

  describe('Distribute Minutes (the app move)', () => {
    it("votes above the members now present hold Distribute, naming the item; the attendance tap itself isn't refused (P206)", async () => {
      const m = await meetingAt(a, 'minutes_draft');
      await allPresent(a, m.id);
      await minutes.addDecision(m.id, m.itemId, { text: 'Approve the audit plan.', votesFor: 2, votesAgainst: 1, votesAbstain: 0 } as never, a.orgId, as(a, 'secretary'));
      expect((await minutes.getMinutes(m.id, a.orgId, as(a, 'secretary'))).distribute?.blockedBy).toBeNull();
      // Lowered after the vote: allowed at the tap.
      const memberRow = await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId: m.id, userId: a.people['member'] } });
      await minutes.recordAttendance(m.id, { rows: [{ attendeeId: memberRow.id, attendance: 'ABSENT' }] } as never, a.orgId, as(a, 'secretary'));
      const read = await minutes.getMinutes(m.id, a.orgId, as(a, 'secretary'));
      expect(read.distribute?.ready).toBe(false);
      expect(read.distribute?.blockedBy).toEqual({ code: 'MEETING_VOTES_EXCEED_PRESENT', items: [{ agendaItemId: m.itemId, title: 'Hand hygiene', total: 3, present: 2 }] });
      // The move refuses it, and nothing moves.
      expect(await code(review.distribute(m.id, {}, a.orgId, as(a, 'secretary')))).toBe('MEETING_VOTES_EXCEED_PRESENT');
      expect(await stageKey(m.id)).toBe('minutes_draft');
    });

    it('refuses incomplete attendance with nothing written, refuses someone outside the pool, then writes the round with the move and tells the present members', async () => {
      const m = await meetingAt(a, 'minutes_draft');
      expect(await outcome(review.distribute(m.id, {}, a.orgId, as(a, 'secretary')))).toMatchObject({ code: 'MEETING_ATTENDANCE_INCOMPLETE' });
      expect(await stageKey(m.id)).toBe('minutes_draft');
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).reviewRound).toBe(0);

      await allPresent(a, m.id);
      // The Chair's seat doesn't record: not in Minutes Draft's pool.
      expect(await code(review.distribute(m.id, {}, a.orgId, as(a, 'chair')))).toBe('NOT_IN_STAGE_POOL');
      expect(await code(review.distribute(m.id, { reviewBy: '2020-01-01' }, a.orgId, as(a, 'secretary')))).toBe('MEETING_REVIEW_DATE_INVALID');

      // The default review date is five working days after the tenant's day, not the UTC day.
      useFixedClock(new Date('2027-02-08T22:30:00.000Z')); // Tuesday 01:30 in Riyadh, still Monday in UTC
      try {
        await review.distribute(m.id, {}, a.orgId, as(a, 'secretary'));
      } finally {
        jest.useRealTimers();
      }
      expect(await stageKey(m.id)).toBe('minutes_review');
      const row = await prisma.meeting.findFirstOrThrow({ where: { id: m.id } });
      expect(row.reviewRound).toBe(1);
      // Tuesday 9 Feb + 5 working days (Sun–Thu) = Tuesday 16 Feb.
      expect(row.reviewBy!.toISOString().slice(0, 10)).toBe('2027-02-16');
      // The present MEMBERS, never the actor, never the guest.
      expect(notices.filter((n) => n.titleEn === 'Review the minutes').map((n) => n.userId).sort()).toEqual([a.people['chair'], a.people['member']].sort());
    });
  });

  describe('the review', () => {
    it('only members recorded present answer; a suggestion replaces "No corrections"; "No corrections" after suggesting is refused', async () => {
      const m = await inReview(a);
      expect(await code(review.noCorrections(m.id, a.orgId, as(a, 'guest')))).toBe('MEETING_NOT_REVIEWER');

      await review.noCorrections(m.id, a.orgId, as(a, 'member'));
      expect(await prisma.meetingReviewAnswer.count({ where: { meetingId: m.id, userId: a.people['member']! } })).toBe(1);
      await review.suggest(m.id, { agendaItemId: m.itemId, text: 'It was 84%, not 86%.' }, a.orgId, as(a, 'member'));
      expect(await prisma.meetingReviewAnswer.count({ where: { meetingId: m.id, userId: a.people['member']! } })).toBe(0);
      expect(await code(review.noCorrections(m.id, a.orgId, as(a, 'member')))).toBe('MEETING_REVIEW_SUGGESTED');
      const read = await minutes.getMinutes(m.id, a.orgId, as(a, 'member'));
      expect(read.review.mine).toBe('SUGGESTED');
      expect(read.review.reviewers.find((r) => r.userId === a.people['member'])!.answered).toBe(true);
    });

    it('a declined suggestion tells its author with the reply; deciding twice is refused; only whoever records decides', async () => {
      const m = await inReview(a);
      const { id } = await review.suggest(m.id, { text: 'Add the apologies.' }, a.orgId, as(a, 'member'));
      expect(await code(review.decideSuggestion(m.id, id, 'DECLINED', { reply: 'Already there.' }, a.orgId, as(a, 'chair')))).toBe('MEETING_NOT_RECORDER');
      await review.decideSuggestion(m.id, id, 'DECLINED', { reply: 'Already there.' }, a.orgId, as(a, 'secretary'));
      expect(notices.find((n) => n.titleEn === 'Correction declined')).toMatchObject({ userId: a.people['member'], bodyEn: expect.stringContaining('Already there.') });
      expect(await code(review.decideSuggestion(m.id, id, 'APPLIED', {}, a.orgId, as(a, 'secretary')))).toBe('MEETING_SUGGESTION_DECIDED');
    });
  });

  describe('Approve Minutes', () => {
    it('is held by the open review, then an open suggestion, then a past-due action, then one past its SLA limit — said by blockedBy and refused on the press', async () => {
      const m = await inReview(a);
      const blockedBy = async () => (await workflow.getMovesForViewer(m.instanceId, a.orgId, [], a.people['chair']!)).moves.find((x) => x.kind === 'ADVANCE')!.blockedBy;
      const press = async () => code(workflow.triggerTransition(m.instanceId, { transitionId: (await approveMove(m.instanceId)).id }, a.orgId, a.people['chair']!, []));

      expect(await blockedBy()).toMatchObject({ code: 'MEETING_REVIEW_OPEN', waitingFor: expect.arrayContaining([{ userId: a.people['member'], name: 'member' }]) });
      expect(await press()).toBe('MEETING_REVIEW_OPEN');

      for (const name of ['chair', 'secretary']) await review.noCorrections(m.id, a.orgId, as(a, name));
      const { id: suggestionId } = await review.suggest(m.id, { text: 'Typo in item 1.' }, a.orgId, as(a, 'member'));
      expect(await blockedBy()).toMatchObject({ code: 'MEETING_SUGGESTION_OPEN', open: 1 });
      expect(await press()).toBe('MEETING_SUGGESTION_OPEN');

      await review.decideSuggestion(m.id, suggestionId, 'APPLIED', {}, a.orgId, as(a, 'secretary'));
      const past = await prisma.meetingActionItem.create({
        data: { organizationId: a.orgId, meetingId: m.id, agendaItemId: m.itemId, title: 'Late', ownerUserId: a.people['member']!, dueAt: new Date(Date.now() - 60_000) },
      });
      expect(await blockedBy()).toMatchObject({ code: 'MEETING_ACTION_PAST_DUE', items: [expect.objectContaining({ id: past.id })] });
      expect(await press()).toBe('MEETING_ACTION_PAST_DUE');

      const limit = await tasks.slaLimitFrom(new Date(), 'MEDIUM', a.orgId);
      await prisma.meetingActionItem.update({ where: { id: past.id }, data: { dueAt: new Date(limit.getTime() + 30 * DAY) } });
      expect(await blockedBy()).toMatchObject({ code: 'MEETING_ACTION_PAST_SLA_LIMIT', items: [expect.objectContaining({ id: past.id })] });
      expect(await press()).toBe('MEETING_ACTION_PAST_SLA_LIMIT');
      expect(await stageKey(m.id)).toBe('minutes_review');
    });

    it('then approves: each draft becomes a task (its owner the assignee, its due date kept), linked, with the approval stamped', async () => {
      const m = await inReview(a);
      for (const name of ['chair', 'secretary', 'member']) await review.noCorrections(m.id, a.orgId, as(a, name));
      const limit = await tasks.slaLimitFrom(new Date(), 'MEDIUM', a.orgId);
      const dueAt = new Date(limit.getTime() - 60 * 60_000);
      const draft = await prisma.meetingActionItem.create({
        data: { organizationId: a.orgId, meetingId: m.id, agendaItemId: m.itemId, title: 'Re-audit 4B', ownerUserId: a.people['member']!, dueAt },
      });
      expect((await workflow.getMovesForViewer(m.instanceId, a.orgId, [], a.people['chair']!)).moves.find((x) => x.kind === 'ADVANCE')!.blockedBy).toBeNull();

      await workflow.triggerTransition(m.instanceId, { transitionId: (await approveMove(m.instanceId)).id }, a.orgId, a.people['chair']!, []);
      expect(await stageKey(m.id)).toBe('minutes_approved');
      const item = await prisma.meetingActionItem.findFirstOrThrow({ where: { id: draft.id }, include: { task: { include: { assignees: true } } } });
      expect(item.task).toMatchObject({ sourceType: 'MEETING', sourceId: m.id, title: 'Re-audit 4B', priority: 'MEDIUM', dueAt });
      expect(item.task!.assignees.map((x) => x.userId)).toEqual([a.people['member']]);
      expect(await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).toMatchObject({ approvedById: a.people['chair'], minutesApprovedAt: expect.any(Date) });
      // Approved minutes are open to anyone who may see the meeting.
      expect((await minutes.getMinutes(m.id, a.orgId, as(a, 'viewer', [MEETINGS_PERMISSIONS.VIEW]))).phase).toBe('approved');
    });
  });

  describe('Return for Correction (the app move)', () => {
    it("by whoever records the minutes, outside the review's pool: the reason kept, the round closed, the present members told", async () => {
      const m = await inReview(a);
      expect(await code(review.returnForCorrection(m.id, { reason: 'Wrong date' }, a.orgId, as(a, 'guest')))).toBe('NOT_IN_STAGE_POOL');
      await review.returnForCorrection(m.id, { reason: 'Wrong date' }, a.orgId, as(a, 'secretary'));
      expect(await stageKey(m.id)).toBe('minutes_draft');
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).reviewBy).toBeNull();
      const left = await prisma.workflowInstanceStage.findFirstOrThrow({ where: { workflowInstanceId: m.instanceId, outcome: 'RETURNED' } });
      expect(left.comment).toBe('Wrong date');
      expect(notices.filter((n) => n.titleEn === 'Minutes returned for correction').map((n) => n.userId).sort()).toEqual([a.people['chair'], a.people['member']].sort());
    });
  });

  describe('the reminder and Home', () => {
    /**
     * ACC-248: the clock is held, on a working day in the tenant's zone, so the
     * day "today" is the same however and whenever this runs. Monday 8 Feb
     * 2027, 10:00 in Riyadh (the default calendar: Sunday to Thursday).
     */
    const MONDAY = new Date('2027-02-08T07:00:00.000Z');
    const reminded = () => notices.filter((n) => n.titleEn === 'The minutes review closes soon').map((n) => n.userId);
    /** Ids compared as sets: a query's or a sweep's order is not a fact under test. */
    const sorted = (ids: readonly (string | undefined)[]) => [...ids].sort();

    it('never reminds on the day the minutes went out; then once per round, on the working day before the date', async () => {
      useFixedClock(MONDAY);
      try {
        const m = await inReview(a);
        await review.noCorrections(m.id, a.orgId, as(a, 'chair'));
        // The review date is Tuesday, the next working day: Monday is the day before it.
        await prisma.meeting.update({ where: { id: m.id }, data: { reviewBy: new Date('2027-02-09T00:00:00.000Z') } });

        // Distributed today: the Distribute notice has just told them.
        await reminders.sweep(MONDAY);
        expect(reminded()).toEqual([]);

        // As if distributed on Friday: the two members recorded present who haven't answered, once.
        await prisma.workflowInstanceStage.updateMany({ where: { workflowInstanceId: m.instanceId, exitedAt: null }, data: { enteredAt: new Date('2027-02-05T07:00:00.000Z') } });
        await reminders.sweep(MONDAY);
        expect(sorted(reminded())).toEqual(sorted([a.people['member'], a.people['secretary']]));
        await reminders.sweep(MONDAY);
        expect(sorted(reminded())).toEqual(sorted([a.people['member'], a.people['secretary']]));
      } finally {
        jest.useRealTimers();
      }
    });

    it('sends no reminder while the review date is two working days out', async () => {
      useFixedClock(MONDAY);
      try {
        const m = await inReview(a);
        await prisma.workflowInstanceStage.updateMany({ where: { workflowInstanceId: m.instanceId, exitedAt: null }, data: { enteredAt: new Date('2027-02-05T07:00:00.000Z') } });
        // Wednesday: Tuesday is the day before it, not Monday.
        await prisma.meeting.update({ where: { id: m.id }, data: { reviewBy: new Date('2027-02-10T00:00:00.000Z') } });
        await reminders.sweep(MONDAY);
        expect(reminded()).toEqual([]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("Home's rows: a review to answer, and an invitation to answer", async () => {
      const m = await inReview(a);
      const invite = await meetingAt(a, 'agenda_ready', new Date(Date.now() + 2 * DAY));
      const mine = await review.awaitingMe(a.orgId, a.people['member']!);
      expect(mine.review.map((r) => r.meetingId)).toContain(m.id);
      expect(mine.answer.map((r) => r.meetingId)).toContain(invite.id);
      await review.noCorrections(m.id, a.orgId, as(a, 'member'));
      expect((await review.awaitingMe(a.orgId, a.people['member']!)).review.map((r) => r.meetingId)).not.toContain(m.id);
      // Another organisation's rows never appear.
      expect((await review.awaitingMe(b.orgId, a.people['member']!)).review).toEqual([]);
    });
  });

  describe('review findings (Prompt 165)', () => {
    /** A meeting in review, everyone answered, with one draft action due inside its SLA limit. */
    const readyToApprove = async (w: World) => {
      const m = await inReview(w);
      for (const name of ['chair', 'secretary', 'member']) await review.noCorrections(m.id, w.orgId, as(w, name));
      const limit = await tasks.slaLimitFrom(new Date(), 'MEDIUM', w.orgId);
      const draft = await prisma.meetingActionItem.create({
        data: { organizationId: w.orgId, meetingId: m.id, agendaItemId: m.itemId, title: 'Re-audit 4B', ownerUserId: w.people['member']!, dueAt: new Date(limit.getTime() - 3_600_000) },
      });
      return { ...m, draftId: draft.id };
    };
    const tasksOf = (meetingId: string) => prisma.task.count({ where: { sourceType: 'MEETING', sourceId: meetingId } });
    const effectCtx = (w: World, meetingId: string) => ({
      objectType: 'MEETING' as const,
      objectId: meetingId,
      organizationId: w.orgId,
      actorId: w.people['chair']!,
      kind: 'ADVANCE' as const,
      fromStageFlags: [],
      toStageFlags: [STAGE_FLAG.MINUTES_FINAL],
      comment: null,
    });
    const deps = { prisma, notifications, calendar, tasks };

    it("every minutes and review write refuses another organisation's meeting, and writes nothing", async () => {
      const m = await meetingAt(a, 'minutes_draft');
      const before = await prisma.auditLog.count({ where: { objectId: m.id } });
      const other = as(b, 'secretary', [MEETINGS_PERMISSIONS.VIEW]);
      const soon = new Date(Date.now() + DAY).toISOString();
      const row = await prisma.meetingAttendee.findFirstOrThrow({ where: { meetingId: m.id } });
      for (const call of [
        () => minutes.recordAttendance(m.id, { rows: [{ attendeeId: row.id, attendance: 'PRESENT' }] }, b.orgId, other),
        () => minutes.setItemMinutes(m.id, m.itemId, { discussion: 'x' }, b.orgId, other),
        () => minutes.addDecision(m.id, m.itemId, { text: 'x' }, b.orgId, other),
        () => minutes.addActionItem(m.id, m.itemId, { title: 'x', ownerUserId: b.people['member']!, dueAt: soon }, b.orgId, other),
        () => minutes.setOpenActionNote(m.id, 'task', { note: 'x' }, b.orgId, other),
        () => review.distribute(m.id, {}, b.orgId, other),
        () => review.returnForCorrection(m.id, {}, b.orgId, other),
        () => review.noCorrections(m.id, b.orgId, other),
        () => review.suggest(m.id, { text: 'x' }, b.orgId, other),
        () => review.decideSuggestion(m.id, 'suggestion', 'DECLINED', {}, b.orgId, other),
      ]) {
        expect(await code(call())).toBe(404);
      }
      expect(await prisma.auditLog.count({ where: { objectId: m.id } })).toBe(before);
      expect(await stageKey(m.id)).toBe('minutes_draft');
    });

    itEnforcesTenantIsolation('the raw-SQL minutes reads return nothing for another organisation', async () => {
      const m = await readyToApprove(a);
      await prisma.meetingAttendee.updateMany({ where: { meetingId: m.id, kind: 'ORG_GUEST' }, data: { attendance: null } });
      // Each has rows in its own organisation (non-vacuity) and none in another.
      expect(await draftActionItems(prisma, m.id, a.orgId)).toHaveLength(1);
      expect(await unrecordedAttendance(prisma, m.id, a.orgId)).toHaveLength(1);
      expect(await reviewers(prisma, m.id, a.orgId, 1)).toHaveLength(3);
      expect(await draftActionItems(prisma, m.id, b.orgId)).toEqual([]);
      expect(await unrecordedAttendance(prisma, m.id, b.orgId)).toEqual([]);
      expect(await reviewers(prisma, m.id, b.orgId, 1)).toEqual([]);
    });

    it('a task insert that fails rolls the whole approval back: the stage stays, no task, no taskId', async () => {
      const m = await readyToApprove(a);
      const failing = Object.create(tasks) as TaskService;
      failing.insertPrepared = async () => {
        throw new Error('insert failed');
      };
      const failingWorkflow = new WorkflowService(
        prisma,
        audit,
        labels,
        visibility,
        calendar,
        notifications,
        failing,
        { add: async () => undefined } as never,
        new StageTaskDefinitionService(prisma, audit, tasks),
        new StagePoolService(prisma),
      );
      await expect(failingWorkflow.triggerTransition(m.instanceId, { transitionId: (await approveMove(m.instanceId)).id }, a.orgId, a.people['chair']!, [])).rejects.toThrow(
        'insert failed',
      );
      expect(await stageKey(m.id)).toBe('minutes_review');
      expect(await tasksOf(m.id)).toBe(0);
      expect((await prisma.meetingActionItem.findFirstOrThrow({ where: { id: m.draftId } })).taskId).toBeNull();
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).minutesApprovedAt).toBeNull();
    });

    it('a draft changed, or its owner deactivated, between prepare and apply is MEETING_CHANGED, and nothing is written', async () => {
      const m = await readyToApprove(a);
      const run = async () => {
        const prepared = await prepareTransitionEffects(deps, effectCtx(a, m.id));
        return { prepared };
      };
      const apply = (prepared: Awaited<ReturnType<typeof prepareTransitionEffects>>) =>
        prisma.$transaction(async (tx) => {
          await applyTransitionEffects(tx as never, prepared);
        });

      const changed = await run();
      await prisma.meetingActionItem.update({ where: { id: m.draftId }, data: { title: 'Re-audit 6A' } });
      expect(await code(apply(changed.prepared))).toBe('MEETING_CHANGED');

      const deactivated = await run();
      await prisma.user.update({ where: { id: a.people['member']! }, data: { status: 'INACTIVE' } });
      try {
        expect(await code(apply(deactivated.prepared))).toBe('MEETING_CHANGED');
      } finally {
        await prisma.user.update({ where: { id: a.people['member']! }, data: { status: 'ACTIVE' } });
      }
      expect(await tasksOf(m.id)).toBe(0);
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).minutesApprovedAt).toBeNull();
    });

    it('creates no second task: a second press is refused, and running the effect again finds no draft', async () => {
      const m = await readyToApprove(a);
      const moveId = (await approveMove(m.instanceId)).id;
      await workflow.triggerTransition(m.instanceId, { transitionId: moveId }, a.orgId, a.people['chair']!, []);
      expect(await tasksOf(m.id)).toBe(1);
      expect(await code(workflow.triggerTransition(m.instanceId, { transitionId: moveId }, a.orgId, a.people['chair']!, []))).not.toBe('OK');
      // A retry of the effect itself: the draft is linked, so there is nothing to make.
      const again = await prepareTransitionEffects(deps, effectCtx(a, m.id));
      await prisma.$transaction((tx) => applyTransitionEffects(tx as never, again));
      expect(await tasksOf(m.id)).toBe(1);
    });

    it("the approval's audit row commits with it, and one failed task notice doesn't stop the others", async () => {
      const m = await readyToApprove(a);
      await prisma.meetingActionItem.create({
        data: { organizationId: a.orgId, meetingId: m.id, agendaItemId: m.itemId, title: 'Second', ownerUserId: a.people['secretary']!, dueAt: (await prisma.meetingActionItem.findFirstOrThrow({ where: { id: m.draftId } })).dueAt },
      });
      const announced: string[] = [];
      let calls = 0;
      const flaky = Object.create(tasks) as TaskService;
      flaky.announceCreated = async (task) => {
        calls += 1;
        if (calls === 1) throw new Error('notice failed');
        announced.push(task.id);
      };
      const prepared = await prepareTransitionEffects({ ...deps, tasks: flaky }, effectCtx(a, m.id));
      await prisma.$transaction((tx) => applyTransitionEffects(tx as never, prepared));
      await finishTransitionEffects(prepared);
      expect(calls).toBe(2);
      expect(announced).toHaveLength(1);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { objectId: m.id, objectType: 'Meeting', after: { path: ['minutesApproved'], equals: true } } });
      expect((row.after as { tasksCreated: string[] }).tasksCreated).toHaveLength(2);
    });

    it("the moves list's \"Why?\" takes no lock on the meeting row", async () => {
      const m = await inReview(a);
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const locker = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${m.id} FOR UPDATE`;
        await held;
      }, { timeout: 20_000 });
      try {
        await new Promise((r) => setTimeout(r, 200));
        const answered = await Promise.race([
          workflow.getMovesForViewer(m.instanceId, a.orgId, [], a.people['chair']!).then(() => 'answered'),
          new Promise((r) => setTimeout(() => r('blocked'), 5_000)),
        ]);
        expect(answered).toBe('answered');
      } finally {
        release();
        await locker;
      }
    });

    it("Home lists only reviews in a stage that takes them: approved minutes don't appear", async () => {
      const m = await readyToApprove(a);
      await prisma.meetingReviewAnswer.deleteMany({ where: { meetingId: m.id, userId: a.people['member']! } });
      expect((await review.awaitingMe(a.orgId, a.people['member']!)).review.map((r) => r.meetingId)).toContain(m.id);
      await workflow.triggerTransition(m.instanceId, { transitionId: (await approveMove(m.instanceId)).id }, a.orgId, a.people['chair']!, []).catch(() => undefined);
      await prisma.meetingReviewAnswer.deleteMany({ where: { meetingId: m.id } });
      const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: a.orgId, objectType: 'MEETING', isDefault: true } });
      const approved = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'minutes_approved' } });
      await prisma.workflowInstance.update({ where: { id: m.instanceId }, data: { currentStageId: approved.id } });
      expect((await review.awaitingMe(a.orgId, a.people['member']!)).review.map((r) => r.meetingId)).not.toContain(m.id);
    });
  });

  it("another organisation's meeting is the same 404 as a missing one", async () => {
    const m = await meetingAt(a, 'minutes_draft');
    expect(await code(minutes.getMinutes(m.id, b.orgId, as(b, 'secretary', [MEETINGS_PERMISSIONS.VIEW])))).toBe(404);
    expect(await code(review.distribute(m.id, {}, b.orgId, as(b, 'secretary', [MEETINGS_PERMISSIONS.VIEW])))).toBe(404);
  });
});
