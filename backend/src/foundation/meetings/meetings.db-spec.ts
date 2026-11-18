/**
 * ACC-316 PR 3a — one meeting's record against a REAL Postgres (npm run test:db).
 * Plan: backend/Plans/step-316-meeting-management.md §3.1, §4 and §6 (PR 3a).
 *
 * The organisation: Root → Clinical → Ward. Root's head holds
 * meetings:schedule_subunits; Clinical's head holds no meeting key. A committee
 * owned by Clinical (Active), and a Dissolved one.
 *
 * Only a database proves:
 *   - schedule: the meeting, its workflow instance at Planned and its audit row
 *     commit together; who may is meeting-authority's SCHEDULERS; a committee's
 *     meeting only while the committee's stage allows it; each refusal by code,
 *     with nothing written;
 *   - read: meetings:view, a member, a person of the unit, an invitee, a head
 *     above (oversight) — and the identical 404 for anyone else;
 *   - the list's views and paging, visibility in the WHERE before LIMIT;
 *   - edit and reschedule: the stage decides, a stale save is MEETING_CHANGED,
 *     a head above writes only holding the sub-units key;
 *   - the engine's registries: Cancel needs a reason (REASON_REQUIRED,
 *     needsReason), Issue Agenda stamps invitedAt and tells the new invitees,
 *     Cancel tells the invited with the reason — never the actor;
 *   - a cancelled meeting takes no new tasks;
 *   - another organisation's meeting is the same 404 as a missing one.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { MEETINGS_PERMISSIONS, MEETING_TASKS_PERMISSIONS } from '../../common/constants/permissions';
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
import { assertRecordAcceptsTasks, recordChoices } from '../task/task-record-choices';
import { WorkflowService } from '../workflow/workflow.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { StagePoolService } from '../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../workflow/workflow.seed';
import { copyDefaultSeatActions } from '../committees/seat-actions';
import { MeetingsService, type MeetingViewer } from './meetings.service';

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

describe("A meeting's record against a real database (ACC-316 PR 3a)", () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const lookupService = new LookupService(prisma, audit);
  const notices: { userId: string; titleEn: string; bodyEn: string; organizationId: string }[] = [];
  const notifications = {
    create: async (dto: { userId: string; titleEn: string; bodyEn: string }, organizationId: string) => {
      notices.push({ userId: dto.userId, titleEn: dto.titleEn, bodyEn: dto.bodyEn, organizationId });
      return { id: randomUUID() };
    },
    createInAppMany: async () => 0,
  } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const queue = { add: async () => undefined } as never;
  const stageRules = new StageRulesService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, new StagePoolService(prisma));
  const meetings = new MeetingsService(prisma, visibility, workflow, stageRules, notifications);

  let seat: Record<string, string> = {};
  let meetingType = '';

  interface World {
    orgId: string;
    units: { root: string; clinical: string; ward: string };
    people: Record<string, string>;
    committeeId: string;
    dissolvedCommitteeId: string;
  }

  async function permissionId(key: string): Promise<string> {
    const [module, action] = key.split(':') as [string, string];
    return (await prisma.permission.upsert({ where: { module_action: { module, action } }, create: { module, action }, update: {} })).id;
  }

  async function role(orgId: string, keys: string[]): Promise<string> {
    const ids = await Promise.all(keys.map(permissionId));
    return (
      await prisma.role.create({
        data: { organizationId: orgId, nameEn: `Role ${randomUUID().slice(0, 6)}`, rolePermissions: { create: ids.map((permissionId) => ({ permissionId })) } },
      })
    ).id;
  }

  async function world(): Promise<World> {
    const slug = `acc316r-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED, MEETING_SEED]);
    const unit = (nameEn: string, parentId?: string) =>
      prisma.orgUnit.create({ data: { organizationId: o.id, nameEn, code: `${nameEn}-${slug}`, ...(parentId && { parentId }) } });
    const root = await unit('Root');
    const clinical = await unit('Clinical', root.id);
    const ward = await unit('Ward', clinical.id);
    const headPosition = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: `Head ${slug}`, grade: 1, isUnitHeadPosition: true } });

    const person = async (name: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${name}-${slug}@example.test`, name, status: 'ACTIVE', ...extra } })).id;
    const people: Record<string, string> = {
      rootHead: await person('rootHead', { primaryOrgUnitId: root.id, positionId: headPosition.id }),
      clinicalHead: await person('clinicalHead', { primaryOrgUnitId: clinical.id, positionId: headPosition.id }),
      clinicalScheduler: await person('clinicalScheduler', { primaryOrgUnitId: clinical.id }),
      wardPerson: await person('wardPerson', { primaryOrgUnitId: ward.id }),
      chair: await person('chair'),
      secretary: await person('secretary'),
      member: await person('member'),
      invitee: await person('invitee'),
      outsider: await person('outsider'),
    };
    await prisma.userRole.create({ data: { userId: people['rootHead']!, roleId: await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE_SUBUNITS]) } });
    await prisma.userRole.create({ data: { userId: people['clinicalScheduler']!, roleId: await role(o.id, [MEETINGS_PERMISSIONS.SCHEDULE]) } });
    // As a new organisation's first admin: the committee stages start on Root's head.
    await writeStartingAssignments(prisma, o.id, people['rootHead']!, people['rootHead']!);

    const committeeTemplate = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    const committeeAt = async (key: string) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: committeeTemplate.id, key } });
      const c = await prisma.committee.create({ data: { organizationId: o.id, nameEn: `Committee ${key}`, typeValueId: 'type', orgUnitId: clinical.id } });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: committeeTemplate.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
      for (const [key2, userId] of [
        ['chairman', people['chair']!],
        ['secretary', people['secretary']!],
        ['member', people['member']!],
      ] as const) {
        await prisma.committeeMember.create({ data: { organizationId: o.id, committeeId: c.id, userId, roleValueId: seat[key2]! } });
      }
      // The organisation's defaults: Chairman schedules; Secretary schedules and records.
      await prisma.$transaction((tx) => copyDefaultSeatActions(tx, o.id, c.id));
      return c.id;
    };

    return {
      orgId: o.id,
      units: { root: root.id, clinical: clinical.id, ward: ward.id },
      people,
      committeeId: await committeeAt('active'),
      dissolvedCommitteeId: await committeeAt('dissolved'),
    };
  }

  const as = (w: World, name: string, permissions: string[] = []): MeetingViewer => ({ id: w.people[name]!, permissions });
  const later = (days: number, from: Date) => new Date(from.getTime() + days * DAY);
  const scheduleDto = (now: Date, owner: { committeeId?: string; orgUnitId?: string }, extra: Record<string, unknown> = {}) =>
    ({ ...owner, title: 'Monthly review', typeValueId: meetingType, scheduledAt: later(7, now).toISOString(), durationMinutes: 60, location: 'Room 4', ...extra }) as never;

  /** The refusal's body, or 'OK'. */
  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown }) => e.getResponse?.() ?? `ERROR ${String(e)}`,
    );
  const code = async (p: Promise<unknown>): Promise<unknown> => {
    const r = await outcome(p);
    return typeof r === 'object' && r !== null ? ((r as { code?: string }).code ?? (r as { statusCode?: number }).statusCode) : r;
  };

  /** A meeting written straight to the table at Planned, for the list's past rows. */
  async function meetingRow(w: World, owner: { committeeId?: string; orgUnitId?: string }, scheduledAt: Date, organizerId: string): Promise<string> {
    const m = await prisma.meeting.create({
      data: { organizationId: w.orgId, organizerId, title: `Row ${randomUUID().slice(0, 4)}`, typeValueId: meetingType, scheduledAt, durationMinutes: 30, location: 'Room 1', ...owner },
    });
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: w.orgId, objectType: 'MEETING', isDefault: true } });
    const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key: 'planned' } });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: w.orgId, workflowTemplateId: template.id, objectType: 'MEETING', objectId: m.id, status: 'IN_PROGRESS', currentStageId: stage.id },
    });
    await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
    return m.id;
  }

  const instanceOf = async (meetingId: string) => {
    const instance = await prisma.workflowInstance.findFirstOrThrow({ where: { objectType: 'MEETING', objectId: meetingId } });
    const stage = await prisma.workflowStage.findFirst({ where: { id: instance.currentStageId ?? '' }, select: { key: true } });
    return { ...instance, currentStage: stage };
  };
  const move = async (meetingId: string, toKey: string) => {
    const instance = await instanceOf(meetingId);
    return prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: instance.currentStageId!, toStage: { key: toKey } } });
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

  describe('schedule', () => {
    it("a committee meeting: the meeting, its instance at Planned and one audit row, and the chair may edit it", async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);

      expect(m.owner).toEqual({ kind: 'COMMITTEE', id: a.committeeId, nameEn: 'Committee active', nameAr: null });
      expect(m.stage.nameEn).toBe('Planned');
      expect(m.may).toEqual({ edit: true, reschedule: true });
      expect(m.organizer).toEqual({ id: a.people['chair'], name: 'chair' });
      const row = await prisma.meeting.findFirstOrThrow({ where: { id: m.id } });
      expect([row.committeeId, row.orgUnitId, row.unitQuorum]).toEqual([a.committeeId, null, null]);
      expect((await instanceOf(m.id)).currentStage?.key).toBe('planned');
      expect(await prisma.auditLog.count({ where: { objectType: 'Meeting', objectId: m.id, action: 'CREATE' } })).toBe(1);
      // The scheduler is not told about their own meeting.
      expect(notices).toEqual([]);
    });

    it("a unit meeting, by the unit's key holder, with its own quorum", async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { orgUnitId: a.units.clinical }, { unitQuorum: 3 }), a.orgId, as(a, 'clinicalScheduler'), now);
      expect(m.owner.kind).toBe('UNIT');
      expect(m.unitQuorum).toBe(3);
    });

    it("a sub-unit's meeting, by Root's head holding the sub-units key", async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { orgUnitId: a.units.ward }), a.orgId, as(a, 'rootHead'), now);
      expect(m.owner.id).toBe(a.units.ward);
    });

    it('each refusal by its code, and nothing written', async () => {
      const now = new Date();
      const before = await prisma.meeting.count({ where: { organizationId: a.orgId } });
      const cases: [string, Promise<unknown>][] = [
        ['MEETING_OWNER_REQUIRED', meetings.schedule(scheduleDto(now, {}), a.orgId, as(a, 'chair'), now)],
        ['MEETING_OWNER_REQUIRED', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId, orgUnitId: a.units.clinical }), a.orgId, as(a, 'chair'), now)],
        ['MEETING_OWNER_NOT_FOUND', meetings.schedule(scheduleDto(now, { committeeId: b.committeeId }), a.orgId, as(a, 'chair'), now)],
        ['MEETING_OWNER_NOT_FOUND', meetings.schedule(scheduleDto(now, { orgUnitId: b.units.clinical }), a.orgId, as(a, 'clinicalScheduler'), now)],
        // A plain member's seat does not schedule; a ward person holds no key; Clinical's head holds none.
        ['MEETING_NOT_ALLOWED', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'member'), now)],
        ['MEETING_NOT_ALLOWED', meetings.schedule(scheduleDto(now, { orgUnitId: a.units.ward }), a.orgId, as(a, 'wardPerson'), now)],
        ['MEETING_NOT_ALLOWED', meetings.schedule(scheduleDto(now, { orgUnitId: a.units.ward }), a.orgId, as(a, 'clinicalHead'), now)],
        ['MEETING_QUORUM_UNIT_ONLY', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { unitQuorum: 2 }), a.orgId, as(a, 'chair'), now)],
        ['MEETING_PLACE_REQUIRED', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { location: null }), a.orgId, as(a, 'chair'), now)],
        ['MEETING_TIME_IN_PAST', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { scheduledAt: later(-1, now).toISOString() }), a.orgId, as(a, 'chair'), now)],
        ['MEETING_TYPE_UNKNOWN', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { typeValueId: 'no-such-type' }), a.orgId, as(a, 'chair'), now)],
        // The Dissolved committee's stage does not allow scheduling.
        ['STAGE_ACTION_NOT_ALLOWED', meetings.schedule(scheduleDto(now, { committeeId: a.dissolvedCommitteeId }), a.orgId, as(a, 'chair'), now)],
      ];
      for (const [expected, call] of cases) expect(await code(call)).toBe(expected);
      expect(await prisma.meeting.count({ where: { organizationId: a.orgId } })).toBe(before);
    });
  });

  describe('read', () => {
    it("is open to meetings:view, a member, a person of the unit, an invitee and a head above; the identical 404 for anyone else", async () => {
      const now = new Date();
      const unitMeeting = await meetings.schedule(scheduleDto(now, { orgUnitId: a.units.clinical }), a.orgId, as(a, 'clinicalScheduler'), now);
      const committeeMeeting = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: unitMeeting.id, kind: 'ORG_GUEST', userId: a.people['invitee']! } });

      const sees = async (id: string, viewer: MeetingViewer) => outcome(meetings.getForViewer(id, a.orgId, viewer, now));
      expect(await sees(unitMeeting.id, as(a, 'outsider', [MEETINGS_PERMISSIONS.VIEW]))).toBe('OK');
      expect(await sees(unitMeeting.id, as(a, 'clinicalScheduler'))).toBe('OK');
      expect(await sees(unitMeeting.id, as(a, 'invitee'))).toBe('OK');
      expect(await sees(unitMeeting.id, as(a, 'rootHead'))).toBe('OK');
      expect(await sees(committeeMeeting.id, as(a, 'member'))).toBe('OK');
      expect(await sees(committeeMeeting.id, as(a, 'clinicalHead'))).toBe('OK');

      const notFound = { statusCode: 404, message: 'Meeting not found', error: 'Not Found' };
      expect(await sees(unitMeeting.id, as(a, 'outsider'))).toEqual(notFound);
      expect(await sees(unitMeeting.id, as(a, 'member'))).toEqual(notFound);
      // A person of a unit BELOW is not a person of the meeting's unit.
      expect(await sees(unitMeeting.id, as(a, 'wardPerson'))).toEqual(notFound);
      expect(await sees(randomUUID(), as(a, 'outsider'))).toEqual(notFound);

      // What a viewer may do: the member and the head without the key read only.
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'member'), now)).may).toEqual({ edit: false, reschedule: false });
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'clinicalHead'), now)).may).toEqual({ edit: false, reschedule: false });
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'rootHead'), now)).may).toEqual({ edit: true, reschedule: true });
    });
  });

  describe('the list', () => {
    it('mine, past, minutes, all and subunits — each only what the viewer may see — and paging that never repeats', async () => {
      const w = await world();
      const now = new Date();
      const upcomingCommittee = await meetingRow(w, { committeeId: w.committeeId }, later(3, now), w.people['chair']!);
      const pastCommittee = await meetingRow(w, { committeeId: w.committeeId }, later(-3, now), w.people['chair']!);
      const upcomingClinical = await meetingRow(w, { orgUnitId: w.units.clinical }, later(2, now), w.people['clinicalScheduler']!);
      const pastWard = await meetingRow(w, { orgUnitId: w.units.ward }, later(-5, now), w.people['rootHead']!);
      const ids = async (view: string, viewer: MeetingViewer, extra: Record<string, unknown> = {}) =>
        (await meetings.list({ view, ...extra } as never, w.orgId, viewer, now)).items.map((i) => i.id);

      expect(await ids('mine', as(w, 'chair'))).toEqual([upcomingCommittee]);
      expect(await ids('mine', as(w, 'clinicalScheduler'))).toEqual([upcomingClinical]);
      expect(await ids('mine', as(w, 'outsider'))).toEqual([]);
      expect(await ids('past', as(w, 'member'))).toEqual([pastCommittee]);
      // Root's head sees every past meeting below by oversight, latest first.
      expect(await ids('past', as(w, 'rootHead'))).toEqual([pastCommittee, pastWard]);
      // The Secretary's seat records the minutes; the Chair's does not.
      expect(await ids('minutes', as(w, 'secretary'))).toEqual([upcomingCommittee, pastCommittee]);
      expect(await ids('minutes', as(w, 'chair'))).toEqual([]);
      expect(await code(meetings.list({ view: 'all' } as never, w.orgId, as(w, 'outsider'), now))).toBe(403);
      expect(new Set(await ids('all', as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW])))).toEqual(
        new Set([upcomingCommittee, pastCommittee, upcomingClinical, pastWard]),
      );
      // Clinical's head: the committee Clinical owns and the Ward meeting, by oversight;
      // Clinical's own unit meeting is theirs as a person of the unit, so not here.
      expect(await ids('subunits', as(w, 'clinicalHead'))).toEqual([upcomingCommittee, pastCommittee, pastWard]);
      expect(await ids('all', as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW]), { committeeId: w.committeeId })).toEqual([upcomingCommittee, pastCommittee]);

      const viewer = as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW]);
      const pages = [];
      for (let skip = 0; skip < 4; skip++) pages.push(...(await ids('all', viewer, { take: 1, skip })));
      expect(pages).toEqual(await ids('all', viewer));
      expect((await meetings.list({ view: 'all', take: 1 } as never, w.orgId, viewer, now)).total).toBe(4);
      const first = (await meetings.list({ view: 'mine' } as never, w.orgId, as(w, 'chair'), now)).items[0]!;
      expect(first.stage.nameEn).toBe('Planned');
      expect(first.owner).toEqual({ kind: 'COMMITTEE', id: w.committeeId, nameEn: 'Committee active', nameAr: null });
    });
  });

  describe('edit and reschedule', () => {
    it('an edit writes only what changed, with one audit row; a stale save is MEETING_CHANGED', async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);

      const edited = await meetings.update(m.id, { title: 'Renamed', location: 'Room 4', expectedUpdatedAt: m.updatedAt.toISOString() } as never, a.orgId, as(a, 'secretary'), now);
      expect(edited.title).toBe('Renamed');
      const rows = await prisma.auditLog.findMany({ where: { objectType: 'Meeting', objectId: m.id, action: 'UPDATE' } });
      expect(rows.map((r) => [r.before, r.after])).toEqual([[{ title: 'Monthly review' }, { title: 'Renamed' }]]);

      // Nothing changed: nothing written.
      await meetings.update(m.id, { title: 'Renamed' } as never, a.orgId, as(a, 'secretary'), now);
      expect(await prisma.auditLog.count({ where: { objectType: 'Meeting', objectId: m.id, action: 'UPDATE' } })).toBe(1);

      expect(await code(meetings.update(m.id, { title: 'Again', expectedUpdatedAt: m.updatedAt.toISOString() } as never, a.orgId, as(a, 'chair'), now))).toBe('MEETING_CHANGED');
      expect(await code(meetings.update(m.id, { location: null } as never, a.orgId, as(a, 'chair'), now))).toBe('MEETING_PLACE_REQUIRED');
      expect(await code(meetings.update(m.id, { unitQuorum: 4 } as never, a.orgId, as(a, 'chair'), now))).toBe('MEETING_QUORUM_UNIT_ONLY');
      // A member sees it and may not write; Clinical's head oversees it and holds no key; an outsider gets the 404.
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'clinicalHead'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'outsider'), now))).toBe(404);
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).title).toBe('Renamed');
    });

    it('a reschedule keeps the old time with its reason and tells the invited, never the actor', async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      for (const name of ['member', 'chair']) {
        await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'MEMBER', userId: a.people[name]!, invitedAt: now } });
      }
      await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'MEMBER', userId: a.people['secretary']! } });
      const toAt = later(10, now);

      const moved = await meetings.reschedule(m.id, { scheduledAt: toAt.toISOString(), reason: ' Chair travelling ' } as never, a.orgId, as(a, 'chair'), now);
      expect(moved.scheduledAt).toEqual(toAt);
      expect(moved.rescheduledFrom).toMatchObject({ fromAt: m.scheduledAt, reason: 'Chair travelling' });
      const row = await prisma.meetingReschedule.findFirstOrThrow({ where: { meetingId: m.id } });
      expect([row.fromAt, row.toAt, row.scope, row.actorId, row.organizationId]).toEqual([m.scheduledAt, toAt, 'THIS_ONLY', a.people['chair'], a.orgId]);
      // The invited member only: not the actor, not the secretary who was never invited.
      expect(notices.map((n) => [n.userId, n.titleEn])).toEqual([[a.people['member'], 'Meeting rescheduled']]);
      expect(notices[0]!.bodyEn).toContain('Reason: Chair travelling');

      expect(await code(meetings.reschedule(m.id, { scheduledAt: toAt.toISOString(), reason: 'Again' } as never, a.orgId, as(a, 'chair'), now))).toBe(
        'MEETING_RESCHEDULE_SAME_TIME',
      );
      expect(await code(meetings.reschedule(m.id, { scheduledAt: later(-1, now).toISOString(), reason: 'Past' } as never, a.orgId, as(a, 'chair'), now))).toBe(
        'MEETING_TIME_IN_PAST',
      );
      expect(await prisma.meetingReschedule.count({ where: { meetingId: m.id } })).toBe(1);
    });
  });

  describe('the engine: Issue Agenda and Cancel', () => {
    it('Issue Agenda stamps the new invitees and tells them; Cancel needs a reason, tells the invited with it, and closes the meeting to writes and tasks', async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      const earlier = later(-1, now);
      const attendee = (name: string, invitedAt: Date | null) =>
        prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'MEMBER', userId: a.people[name]!, invitedAt } });
      await attendee('member', null);
      await attendee('chair', null);
      await attendee('secretary', earlier);
      await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'OUTSIDE_GUEST', outsideName: 'Guest', outsideEmail: 'guest@example.test' } });
      const instance = await instanceOf(m.id);

      // The moves list says which move needs a reason.
      const moves = await workflow.getMovesForViewer(instance.id, a.orgId, [], a.people['chair']!);
      expect(moves.moves.map((mv) => [mv.labelEn, mv.needsReason]).sort()).toEqual([
        ['Cancel Meeting', true],
        ['Issue Agenda', false],
      ]);

      await workflow.triggerTransition(instance.id, { transitionId: (await move(m.id, 'agenda_ready')).id } as never, a.orgId, a.people['chair']!, []);
      const invited = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id, userId: { not: null } }, select: { userId: true, invitedAt: true } });
      const at = Object.fromEntries(invited.map((r) => [r.userId, r.invitedAt]));
      expect(at[a.people['member']!]).not.toBeNull();
      expect(at[a.people['chair']!]).not.toBeNull();
      expect(at[a.people['secretary']!]).toEqual(earlier);
      expect(notices.filter((n) => n.titleEn === 'Meeting invitation').map((n) => n.userId)).toEqual([a.people['member']]);

      notices.length = 0;
      const cancel = (await move(m.id, 'cancelled')).id;
      // Someone who may not open the meeting learns nothing from the reason rule: the 404 first.
      expect(await outcome(workflow.triggerTransition(instance.id, { transitionId: cancel } as never, a.orgId, a.people['outsider']!, []))).toMatchObject({
        statusCode: 404,
      });
      expect(await outcome(workflow.triggerTransition(instance.id, { transitionId: cancel, comment: '  ' } as never, a.orgId, a.people['chair']!, []))).toMatchObject({
        statusCode: 400,
        code: 'REASON_REQUIRED',
        moveLabelEn: 'Cancel Meeting',
      });
      expect((await instanceOf(m.id)).currentStage?.key).toBe('agenda_ready');

      await workflow.triggerTransition(instance.id, { transitionId: cancel, comment: 'Quorum not available' } as never, a.orgId, a.people['chair']!, []);
      expect((await instanceOf(m.id)).currentStage?.key).toBe('cancelled');
      const cancelled = notices.filter((n) => n.titleEn === 'Meeting cancelled');
      expect(cancelled.map((n) => n.userId).sort()).toEqual([a.people['member'], a.people['secretary']].sort());
      for (const n of cancelled) expect(n.bodyEn).toBe('Monthly review is cancelled. Reason: Quorum not available');

      // Cancelled allows nothing, and takes no new tasks.
      expect(await outcome(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'chair'), now))).toMatchObject({ code: 'STAGE_ACTION_NOT_ALLOWED', action: 'edit_details' });
      expect(await outcome(meetings.reschedule(m.id, { scheduledAt: later(9, now).toISOString(), reason: 'X' } as never, a.orgId, as(a, 'chair'), now))).toMatchObject({
        code: 'STAGE_ACTION_NOT_ALLOWED',
        action: 'reschedule',
      });
      expect(await outcome(assertRecordAcceptsTasks(prisma, 'MEETING', m.id, a.orgId))).toEqual({
        statusCode: 409,
        message: 'This meeting is cancelled, so it takes no new tasks.',
        error: 'Conflict',
        code: 'TASK_RECORD_CLOSED',
      });
      const open = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { title: 'Still open' }), a.orgId, as(a, 'chair'), now);
      expect(await outcome(assertRecordAcceptsTasks(prisma, 'MEETING', open.id, a.orgId))).toBe('OK');
      const picker = await recordChoices(prisma, { type: 'MEETING', take: 50 } as never, a.orgId, {
        id: a.people['outsider']!,
        permissions: [MEETINGS_PERMISSIONS.VIEW, MEETING_TASKS_PERMISSIONS.CREATE],
      });
      expect(picker.items.map((i) => i.id)).toContain(open.id);
      expect(picker.items.map((i) => i.id)).not.toContain(m.id);
      // Without meetings:view: only the meetings the caller is a member of — none for an outsider.
      const own = await recordChoices(prisma, { type: 'MEETING', take: 50 } as never, a.orgId, {
        id: a.people['outsider']!,
        permissions: [MEETING_TASKS_PERMISSIONS.CREATE],
      });
      expect(own.items).toEqual([]);
      const committeeMember = await recordChoices(prisma, { type: 'MEETING', take: 50 } as never, a.orgId, {
        id: a.people['member']!,
        permissions: [MEETING_TASKS_PERMISSIONS.CREATE],
      });
      expect(committeeMember.items.map((i) => i.id)).toContain(open.id);
    });
  });

  itEnforcesTenantIsolation("meetings — another organisation's meeting is the same 404 as a missing one, and never listed", async () => {
    const now = new Date();
    const theirs = await meetings.schedule(scheduleDto(now, { committeeId: b.committeeId }), b.orgId, as(b, 'chair'), now);
    const viewer = as(a, 'outsider', [MEETINGS_PERMISSIONS.VIEW]);
    const notFound = { statusCode: 404, message: 'Meeting not found', error: 'Not Found' };

    expect(await outcome(meetings.getForViewer(theirs.id, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(meetings.update(theirs.id, { title: 'X' } as never, a.orgId, as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]), now))).toEqual(notFound);
    expect(await outcome(meetings.reschedule(theirs.id, { scheduledAt: later(9, now).toISOString(), reason: 'X' } as never, a.orgId, as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]), now))).toEqual(notFound);
    const listed = (await meetings.list({ view: 'all', take: 50 } as never, a.orgId, viewer, now)).items.map((i) => i.id);
    expect(listed).not.toContain(theirs.id);
    expect((await prisma.meeting.findFirstOrThrow({ where: { id: theirs.id } })).title).toBe('Monthly review');
  });
});
