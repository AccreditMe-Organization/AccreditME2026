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
import { STAGE_FLAG } from '../workflow/record-registry';
import { applyTransitionEffects, finishTransitionEffects, prepareTransitionEffects } from '../workflow/transition-effects';
import { copyDefaultSeatActions } from '../committees/seat-actions';
import { peopleDateIn } from '../task/task-sla.service';
import { MeetingsService, type MeetingViewer } from './meetings.service';
import type { EngineTx } from '../workflow/workflow.service';
import { MeetingInviteeSyncService } from './invitees/meeting-invitee-sync.service';
import { CommitteesService } from '../committees/committees.service';
import { MeetingPeopleService } from './meeting-people.service';
import { MeetingAgendaService } from './meeting-agenda.service';
import { MeetingFilesService } from './meeting-files.service';
import { MeetingClashService } from './meeting-clash.service';
import { MeetingFormChoicesService } from './meeting-form-choices.service';
import { StoredFileService } from '../file-storage/stored-file.service';
import { RecycleBinService } from '../file-storage/recycle-bin.service';
import { StorageResolverService } from '../file-storage/storage-resolver.service';
import { StorageNoticesService } from '../file-storage/storage-notices.service';
import { SharePointAccessService } from '../file-storage/sharepoint-access.service';

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
  const notices: { userId: string; titleEn: string; bodyEn: string; bodyAr: string; organizationId: string }[] = [];
  const emails: { organizationId: string; to: string; subjectEn: string; bodyEn: string; bodyAr: string }[] = [];
  const notifications = {
    create: async (dto: { userId: string; titleEn: string; bodyEn: string; bodyAr: string }, organizationId: string) => {
      notices.push({ userId: dto.userId, titleEn: dto.titleEn, bodyEn: dto.bodyEn, bodyAr: dto.bodyAr, organizationId });
      return { id: randomUUID() };
    },
    createInAppMany: async () => 0,
    // ACC-316 PR 3b — an outside guest's email (no user, the organisation's language).
    sendOutsideEmail: async (organizationId: string, to: string, text: { subjectEn: string; bodyEn: string; bodyAr: string }) => {
      emails.push({ organizationId, to, subjectEn: text.subjectEn, bodyEn: text.bodyEn, bodyAr: text.bodyAr });
    },
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
  const meetings = new MeetingsService(prisma, visibility, workflow, stageRules, notifications, calendar);
  const sync = new MeetingInviteeSyncService(prisma, notifications, calendar, stageRules);
  const committees = new CommitteesService(prisma, audit, workflow, stageRules, sync);
  // PR 3b — files with their storage stubbed (no bucket on this database): the
  // real soft delete, a link that names the file.
  const storedFiles = new StoredFileService(
    prisma,
    null as unknown as StorageResolverService,
    null as unknown as StorageNoticesService,
    null as unknown as SharePointAccessService,
  );
  storedFiles.openView = async (f: { id: string }) => ({ url: `view/${f.id}`, viaApi: true, expiresAt: new Date().toISOString() });
  storedFiles.openDownload = async (f: { id: string }) => ({ url: `download/${f.id}`, viaApi: true, expiresAt: new Date().toISOString() });
  const people = new MeetingPeopleService(prisma, visibility, stageRules, notifications, calendar);
  const agenda = new MeetingAgendaService(prisma, visibility, stageRules, notifications, calendar, storedFiles);
  const files = new MeetingFilesService(prisma, visibility, stageRules, storedFiles, audit);
  const clashes = new MeetingClashService(prisma, visibility);
  const formChoices = new MeetingFormChoicesService(lookupService);
  const recycleBin = new RecycleBinService(
    prisma,
    { removeBytes: () => Promise.resolve(), reviewWarning: () => Promise.resolve() } as unknown as StoredFileService,
    audit,
    { assertReachable: () => Promise.resolve() } as unknown as SharePointAccessService,
  );

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

  /** An invitee's row (scheduling already made a member's), with its invitation state set. */
  const attend = (w: World, meetingId: string, name: string, invitedAt: Date | null) =>
    prisma.meetingAttendee.upsert({
      where: { meetingId_userId: { meetingId, userId: w.people[name]! } },
      update: { invitedAt },
      create: { organizationId: w.orgId, meetingId, kind: 'MEMBER', userId: w.people[name]!, invitedAt },
    });

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
    // Organisation A works in London, so a notice's time must be London's, not the default Riyadh.
    await calendar.getOrCreate(a.orgId);
    await prisma.workingCalendar.update({ where: { organizationId: a.orgId }, data: { timezone: 'Europe/London' } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  beforeEach(() => {
    notices.length = 0;
    emails.length = 0;
  });

  describe('schedule', () => {
    it("a committee meeting: the meeting, its instance at Planned and one audit row, and the chair may edit it", async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);

      expect(m.owner).toEqual({ kind: 'COMMITTEE', id: a.committeeId, nameEn: 'Committee active', nameAr: null });
      expect(m.stage.nameEn).toBe('Planned');
      expect(m.may).toMatchObject({ edit: true, reschedule: true });
      expect(m.organizer).toEqual({ id: a.people['chair'], name: 'chair' });
      // PR 3b — scheduling fills in the committee's active members, each with their seat, not yet invited.
      const invitees = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id }, select: { userId: true, kind: true, seatValueId: true, invitedAt: true } });
      expect(invitees.map((r) => [r.userId, r.kind, r.seatValueId, r.invitedAt]).sort()).toEqual(
        [
          [a.people['chair'], 'MEMBER', seat['chairman'], null],
          [a.people['secretary'], 'MEMBER', seat['secretary'], null],
          [a.people['member'], 'MEMBER', seat['member'], null],
        ].sort(),
      );
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
        // A title of spaces passes the DTO's IsNotEmpty and would store ''.
        ['MEETING_TITLE_REQUIRED', meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }, { title: '   ' }), a.orgId, as(a, 'chair'), now)],
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
      const guest = await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: unitMeeting.id, kind: 'ORG_GUEST', userId: a.people['invitee']! } });

      const sees = async (id: string, viewer: MeetingViewer) => outcome(meetings.getForViewer(id, a.orgId, viewer, now));
      // A guest sees the meeting only once invited (the agenda issued), never while it is being planned.
      expect(await sees(unitMeeting.id, as(a, 'invitee'))).toEqual({ statusCode: 404, message: 'Meeting not found', error: 'Not Found' });
      expect((await meetings.list({ view: 'mine' } as never, a.orgId, as(a, 'invitee'), now)).items.map((i) => i.id)).not.toContain(unitMeeting.id);
      await prisma.meetingAttendee.update({ where: { id: guest.id }, data: { invitedAt: now } });
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
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'member'), now)).may).toMatchObject({ edit: false, reschedule: false });
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'clinicalHead'), now)).may).toMatchObject({ edit: false, reschedule: false });
      expect((await meetings.getForViewer(committeeMeeting.id, a.orgId, as(a, 'rootHead'), now)).may).toMatchObject({ edit: true, reschedule: true });
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

    it('a listed row always opens, in every view — an organiser who has left the unit no longer lists the meeting', async () => {
      const w = await world();
      const now = new Date();
      const upcomingClinical = await meetingRow(w, { orgUnitId: w.units.clinical }, later(2, now), w.people['clinicalScheduler']!);
      await meetingRow(w, { committeeId: w.committeeId }, later(3, now), w.people['chair']!);
      await meetingRow(w, { orgUnitId: w.units.ward }, later(-4, now), w.people['rootHead']!);
      // The organiser moves out of Clinical: no longer a person of the meeting's unit.
      await prisma.user.update({ where: { id: w.people['clinicalScheduler']! }, data: { primaryOrgUnitId: null } });

      const ids = async (view: string, viewer: MeetingViewer) =>
        (await meetings.list({ view } as never, w.orgId, viewer, now)).items.map((i) => i.id);
      expect(await ids('mine', as(w, 'clinicalScheduler'))).not.toContain(upcomingClinical);

      for (const name of Object.keys(w.people)) {
        for (const view of ['mine', 'past', 'minutes', 'subunits']) {
          const viewer = as(w, name);
          for (const id of await ids(view, viewer)) {
            expect([name, view, await outcome(meetings.getForViewer(id, w.orgId, viewer, now))]).toEqual([name, view, 'OK']);
          }
        }
      }
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
      expect(await code(meetings.update(m.id, { title: '  ' } as never, a.orgId, as(a, 'chair'), now))).toBe('MEETING_TITLE_REQUIRED');
      // A member sees it and may not write; Clinical's head oversees it and holds no key; an outsider gets the 404.
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'clinicalHead'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(meetings.update(m.id, { title: 'X' } as never, a.orgId, as(a, 'outsider'), now))).toBe(404);
      expect((await prisma.meeting.findFirstOrThrow({ where: { id: m.id } })).title).toBe('Renamed');
    });

    it('a reschedule keeps the old time with its reason and tells the invited, never the actor', async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      await attend(a, m.id, 'member', now);
      await attend(a, m.id, 'chair', now);
      await attend(a, m.id, 'secretary', null);
      await prisma.meetingAttendee.create({
        data: { organizationId: a.orgId, meetingId: m.id, kind: 'OUTSIDE_GUEST', outsideName: 'Guest', outsideEmail: 'invited@example.test', invitedAt: now },
      });
      await prisma.meetingAttendee.create({
        data: { organizationId: a.orgId, meetingId: m.id, kind: 'OUTSIDE_GUEST', outsideName: 'Later', outsideEmail: 'not-yet@example.test' },
      });
      const toAt = later(10, now);

      const moved = await meetings.reschedule(m.id, { scheduledAt: toAt.toISOString(), reason: ' Chair travelling ' } as never, a.orgId, as(a, 'chair'), now);
      expect(moved.scheduledAt).toEqual(toAt);
      expect(moved.rescheduledFrom).toMatchObject({ fromAt: m.scheduledAt, reason: 'Chair travelling' });
      const row = await prisma.meetingReschedule.findFirstOrThrow({ where: { meetingId: m.id } });
      expect([row.fromAt, row.toAt, row.scope, row.actorId, row.organizationId]).toEqual([m.scheduledAt, toAt, 'THIS_ONLY', a.people['chair'], a.orgId]);
      // The invited member only: not the actor, not the secretary who was never invited.
      expect(notices.map((n) => [n.userId, n.titleEn])).toEqual([[a.people['member'], 'Meeting rescheduled']]);
      // The outside guest already invited is emailed; one not yet invited is not.
      expect(emails.map((e) => e.to)).toEqual(['invited@example.test']);
      expect(emails[0]!.bodyEn).toContain(peopleDateIn(toAt, 'Europe/London').en);
      expect(emails[0]!.bodyEn).toContain('Reason: Chair travelling');
      expect(emails[0]!.bodyEn).not.toMatch(/https?:\/\/(?!example)/);
      expect(notices[0]!.bodyEn).toContain('Reason: Chair travelling');
      // The new time, in the organisation's zone, in both languages, with Latin digits.
      const when = peopleDateIn(toAt, 'Europe/London');
      expect(notices[0]!.bodyEn).toContain(when.en);
      expect(notices[0]!.bodyAr).toContain(when.ar);
      expect(notices[0]!.bodyAr).not.toMatch(/[٠-٩]/);

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
      await attend(a, m.id, 'member', null);
      await attend(a, m.id, 'chair', null);
      await attend(a, m.id, 'secretary', earlier);
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
      // The outside guest is emailed the invitation, in the organisation's language (English here).
      expect(emails.map((e) => [e.to, e.subjectEn])).toEqual([['guest@example.test', 'Invitation: Monthly review']]);
      emails.length = 0;
      const invitation = notices.find((n) => n.titleEn === 'Meeting invitation')!;
      const starts = peopleDateIn(m.scheduledAt, 'Europe/London');
      expect(invitation.bodyEn).toContain(starts.en);
      expect(invitation.bodyAr).toContain(starts.ar);

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
      // The outside guest, invited at issue, is emailed the cancellation with the reason.
      expect(emails.map((e) => [e.to, e.subjectEn])).toEqual([['guest@example.test', 'Cancelled: Monthly review']]);
      expect(emails[0]!.bodyEn).toContain('Reason: Quorum not available');

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

    it('Agenda Issued invites whoever is an attendee when the move commits, not when it was prepared', async () => {
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      const ctx = {
        objectType: 'MEETING' as const,
        objectId: m.id,
        organizationId: a.orgId,
        actorId: a.people['chair']!,
        kind: 'ADVANCE' as const,
        fromStageFlags: [],
        toStageFlags: [STAGE_FLAG.AGENDA_ISSUED],
        comment: null,
      };

      const prepared = await prepareTransitionEffects({ prisma, notifications, calendar, tasks: {} as never }, ctx);
      // Added after the reads, before the move's transaction.
      await prisma.meetingAttendee.create({ data: { organizationId: a.orgId, meetingId: m.id, kind: 'ORG_GUEST', userId: a.people['invitee']! } });
      await prisma.$transaction((tx) => applyTransitionEffects(tx as never, prepared));
      await finishTransitionEffects(prepared);

      const rows = await prisma.meetingAttendee.findMany({ where: { meetingId: m.id }, select: { userId: true, invitedAt: true } });
      expect(rows.every((r) => r.invitedAt !== null)).toBe(true);
      // The members scheduling filled in, and the guest added in between; never the actor (the Chair).
      expect(notices.filter((n) => n.titleEn === 'Meeting invitation').map((n) => n.userId).sort()).toEqual(
        [a.people['member'], a.people['secretary'], a.people['invitee']].sort(),
      );
    });
  });

  describe('the invitee sync (PR 3b)', () => {
    const rowsOf = async (meetingId: string) =>
      (await prisma.meetingAttendee.findMany({ where: { meetingId }, select: { userId: true, kind: true, seatValueId: true, invitedAt: true, answer: true } }))
        .map((r) => ({ ...r, invited: r.invitedAt !== null }));
    const kindOf = async (meetingId: string, userId: string) => (await rowsOf(meetingId)).find((r) => r.userId === userId)?.kind ?? null;

    it("follows the committee: a seat added, changed, left — and a guest who joins becomes a MEMBER, keeping their answer", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      // An organisation guest who has answered, then joins the committee.
      await prisma.meetingAttendee.create({ data: { organizationId: w.orgId, meetingId: m.id, kind: 'ORG_GUEST', userId: w.people['invitee']!, answer: 'ATTENDING' } });
      await prisma.committeeMember.create({ data: { organizationId: w.orgId, committeeId: w.committeeId, userId: w.people['invitee']!, roleValueId: seat['member']! } });
      // The member moves to the Secretary's seat; the Secretary leaves.
      await prisma.committeeMember.updateMany({ where: { committeeId: w.committeeId, userId: w.people['member']! }, data: { roleValueId: seat['secretary']! } });
      await prisma.committeeMember.updateMany({ where: { committeeId: w.committeeId, userId: w.people['secretary']! }, data: { isActive: false } });

      expect(await sync.forCommittee(w.orgId, w.committeeId, now)).toEqual({ meetings: 1, added: 0, removed: 1, converted: 1, reseated: 1, demoted: 0 });
      const rows = await rowsOf(m.id);
      expect(rows.find((r) => r.userId === w.people['invitee'])).toMatchObject({ kind: 'MEMBER', seatValueId: seat['member'], answer: 'ATTENDING' });
      expect(rows.find((r) => r.userId === w.people['member'])).toMatchObject({ kind: 'MEMBER', seatValueId: seat['secretary'] });
      expect(rows.some((r) => r.userId === w.people['secretary'])).toBe(false);
      // A second run changes nothing.
      expect(await sync.forCommittee(w.orgId, w.committeeId, now)).toEqual({ meetings: 0, added: 0, removed: 0, converted: 0, reseated: 0, demoted: 0 });
    });

    it("a member who leaves while presenting stays as an organisation guest, keeping their answer, and the organiser is told (review fix 1)", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const memberRow = (await people.attendees(m.id, w.orgId, as(w, 'chair'), now)).find((a) => a.userId === w.people['member'])!;
      await people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'member'), now);
      await agenda.create(m.id, { title: 'Budget', presenter: { attendeeId: memberRow.id } } as never, w.orgId, as(w, 'chair'), now);
      // An organisation guest joins the committee (becomes a MEMBER), presents, and leaves again.
      await people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now);
      await prisma.committeeMember.create({ data: { organizationId: w.orgId, committeeId: w.committeeId, userId: w.people['invitee']!, roleValueId: seat['member']! } });
      await sync.forCommittee(w.orgId, w.committeeId, now);
      const joined = (await people.attendees(m.id, w.orgId, as(w, 'chair'), now)).find((a) => a.userId === w.people['invitee'])!;
      expect(joined.kind).toBe('MEMBER');
      await agenda.create(m.id, { title: 'Risks', presenter: { attendeeId: joined.id } } as never, w.orgId, as(w, 'chair'), now);
      notices.length = 0;

      await prisma.committeeMember.updateMany({ where: { committeeId: w.committeeId, userId: { in: [w.people['member']!, w.people['invitee']!] } }, data: { isActive: false } });
      const result = await sync.forCommittee(w.orgId, w.committeeId, now);
      expect(result).toMatchObject({ removed: 0, demoted: 2 });

      const rows = await people.attendees(m.id, w.orgId, as(w, 'chair'), now);
      expect(rows.find((a) => a.userId === w.people['member'])).toMatchObject({ id: memberRow.id, kind: 'ORG_GUEST', seat: null, answer: 'ATTENDING', addedAsPresenter: true });
      expect(rows.find((a) => a.userId === w.people['invitee'])).toMatchObject({ id: joined.id, kind: 'ORG_GUEST', seat: null });
      // Still the presenters of their items.
      expect((await agenda.list(m.id, w.orgId, as(w, 'chair'), now)).map((i) => [i.title, i.presenter?.attendeeId])).toEqual([
        ['Budget', memberRow.id],
        ['Risks', joined.id],
      ]);
      // The organiser (the Chair) is told, in the app, once per person.
      const told = notices.filter((x) => x.titleEn === 'A presenter left the committee or unit');
      expect(told.map((x) => x.userId)).toEqual([w.people['chair'], w.people['chair']]);
      expect(told.map((x) => x.bodyEn).sort()).toEqual([
        'invitee presents "Risks" at Monthly review and has left the committee or unit. They stay invited as a guest.',
        'member presents "Budget" at Monthly review and has left the committee or unit. They stay invited as a guest.',
      ]);
    });

    it('follows the unit: a person who moves in becomes an invitee, one deactivated leaves', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { orgUnitId: w.units.clinical }), w.orgId, as(w, 'clinicalScheduler'), now);
      expect(await kindOf(m.id, w.people['clinicalHead']!)).toBe('MEMBER');
      expect(await kindOf(m.id, w.people['wardPerson']!)).toBeNull();

      await prisma.user.update({ where: { id: w.people['wardPerson']! }, data: { primaryOrgUnitId: w.units.clinical } });
      await prisma.user.update({ where: { id: w.people['clinicalHead']! }, data: { status: 'INACTIVE' } });
      await sync.forUser(w.orgId, w.people['wardPerson']!, now);
      await sync.forUser(w.orgId, w.people['clinicalHead']!, now);
      expect(await kindOf(m.id, w.people['wardPerson']!)).toBe('MEMBER');
      expect(await kindOf(m.id, w.people['clinicalHead']!)).toBeNull();
    });

    it("a member who joins after the agenda is issued is invited at once and told; a held or cancelled meeting never changes", async () => {
      const w = await world();
      const now = new Date();
      const issued = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      await workflow.triggerTransition((await instanceOf(issued.id)).id, { transitionId: (await move(issued.id, 'agenda_ready')).id } as never, w.orgId, w.people['chair']!, []);
      const cancelledMeeting = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { title: 'Off' }), w.orgId, as(w, 'chair'), now);
      await workflow.triggerTransition(
        (await instanceOf(cancelledMeeting.id)).id,
        { transitionId: (await move(cancelledMeeting.id, 'cancelled')).id, comment: 'Not needed' } as never,
        w.orgId,
        w.people['chair']!,
        [],
      );
      const held = await meetingRow(w, { committeeId: w.committeeId }, later(-1, now), w.people['chair']!);
      notices.length = 0;

      await prisma.committeeMember.create({ data: { organizationId: w.orgId, committeeId: w.committeeId, userId: w.people['invitee']!, roleValueId: seat['member']! } });
      await sync.forCommittee(w.orgId, w.committeeId, now);

      expect((await rowsOf(issued.id)).find((r) => r.userId === w.people['invitee'])).toMatchObject({ kind: 'MEMBER', invited: true });
      expect(notices.filter((n) => n.titleEn === 'Meeting invitation').map((n) => n.userId)).toEqual([w.people['invitee']]);
      expect(await kindOf(cancelledMeeting.id, w.people['invitee']!)).toBeNull();
      expect(await kindOf(held, w.people['invitee']!)).toBeNull();
    });

    it("the committee writer refreshes its meetings after it commits (CommitteesService.addMember)", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      await committees.addMember(w.committeeId, { userId: w.people['invitee']!, roleValueId: seat['member']! } as never, w.orgId, w.people['rootHead']!, [
        'committees:view',
        'committees:add_member',
      ]);
      expect(await kindOf(m.id, w.people['invitee']!)).toBe('MEMBER');
    });

    it('the sweep repairs every organisation, and a sync for one never touches another', async () => {
      const x = await world();
      const y = await world();
      const now = new Date();
      const mx = await meetings.schedule(scheduleDto(now, { committeeId: x.committeeId }), x.orgId, as(x, 'chair'), now);
      const my = await meetings.schedule(scheduleDto(now, { committeeId: y.committeeId }), y.orgId, as(y, 'chair'), now);
      await prisma.committeeMember.create({ data: { organizationId: x.orgId, committeeId: x.committeeId, userId: x.people['invitee']!, roleValueId: seat['member']! } });
      await prisma.committeeMember.create({ data: { organizationId: y.orgId, committeeId: y.committeeId, userId: y.people['invitee']!, roleValueId: seat['member']! } });

      // x's committee asked in y's organisation: nothing found, nothing changed.
      expect((await sync.forCommittee(y.orgId, x.committeeId, now)).meetings).toBe(0);
      expect(await kindOf(mx.id, x.people['invitee']!)).toBeNull();

      await sync.sweep(now);
      expect(await kindOf(mx.id, x.people['invitee']!)).toBe('MEMBER');
      expect(await kindOf(my.id, y.people['invitee']!)).toBe('MEMBER');
    });
  });

  /** Issue the meeting's agenda, as its Chair. */
  const issue = async (w: World, meetingId: string) =>
    workflow.triggerTransition((await instanceOf(meetingId)).id, { transitionId: (await move(meetingId, 'agenda_ready')).id } as never, w.orgId, w.people['chair']!, []);

  describe('guests (PR 3b)', () => {
    it("a guest added while planned is invited only when the agenda is issued; one added after is invited at once — an outside guest by email", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const early = await people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now);
      expect(early).toMatchObject({ kind: 'ORG_GUEST', invited: false });
      expect(await code(meetings.getForViewer(m.id, w.orgId, as(w, 'invitee'), now))).toBe(404);
      expect(notices).toEqual([]);

      await issue(w, m.id);
      expect(notices.filter((n) => n.titleEn === 'Meeting invitation').map((n) => n.userId)).toContain(w.people['invitee']);
      expect(await outcome(meetings.getForViewer(m.id, w.orgId, as(w, 'invitee'), now))).toBe('OK');

      notices.length = 0;
      const late = await people.addGuest(m.id, { userId: w.people['wardPerson'] } as never, w.orgId, as(w, 'chair'), now);
      expect(late).toMatchObject({ kind: 'ORG_GUEST', invited: true });
      expect(notices.map((n) => [n.userId, n.titleEn])).toEqual([[w.people['wardPerson'], 'Meeting invitation']]);
      const outside = await people.addGuest(
        m.id,
        { outsideName: 'Dr Sara', outsideEmail: 'sara@example.test', outsideOrganisation: 'University' } as never,
        w.orgId,
        as(w, 'chair'),
        now,
      );
      expect(outside).toMatchObject({ kind: 'OUTSIDE_GUEST', name: 'Dr Sara', outsideEmail: 'sara@example.test', invited: true });
      expect(emails.map((e) => [e.to, e.subjectEn])).toEqual([['sara@example.test', 'Invitation: Monthly review']]);
      // No link into AccreditMe, no papers: the place only.
      expect(emails[0]!.bodyEn).toContain('Location: Room 4.');
      expect(emails[0]!.bodyEn).not.toMatch(/meetings\/|files\//);
    });

    it('each refusal by its code, and the guest rules', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const guest = await people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now);
      const outsideGuest = await people.addGuest(m.id, { outsideName: 'Dr Sara', outsideEmail: 'sara@example.test' } as never, w.orgId, as(w, 'chair'), now);
      const memberRow = (await people.attendees(m.id, w.orgId, as(w, 'chair'), now)).find((a) => a.userId === w.people['member'])!;
      await agenda.create(m.id, { title: 'Budget', presenter: { attendeeId: outsideGuest.id } } as never, w.orgId, as(w, 'chair'), now);

      expect(await code(people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now))).toBe('MEETING_ALREADY_INVITED');
      expect(await code(people.addGuest(m.id, { outsideName: 'x', outsideEmail: 'SARA@example.test' } as never, w.orgId, as(w, 'chair'), now))).toBe('MEETING_ALREADY_INVITED');
      expect(await code(people.addGuest(m.id, {} as never, w.orgId, as(w, 'chair'), now))).toBe('MEETING_GUEST_REQUIRED');
      expect(await code(people.addGuest(m.id, { userId: b.people['member'] } as never, w.orgId, as(w, 'chair'), now))).toBe('MEETING_PERSON_NOT_FOUND');
      expect(await code(people.addGuest(m.id, { userId: w.people['outsider'] } as never, w.orgId, as(w, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(people.removeGuest(m.id, memberRow.id, w.orgId, as(w, 'chair'), now))).toBe('MEETING_MEMBER_NOT_REMOVABLE');
      // An outside guest presents but cannot be removed while presenting.
      expect(await code(people.removeGuest(m.id, outsideGuest.id, w.orgId, as(w, 'chair'), now))).toBe('MEETING_GUEST_PRESENTS');

      expect(await outcome(people.removeGuest(m.id, guest.id, w.orgId, as(w, 'chair'), now))).toBe('OK');
      expect(await prisma.auditLog.count({ where: { objectType: 'MeetingAttendee', objectId: guest.id, action: 'DELETE' } })).toBe(1);
    });
  });

  describe('answers (PR 3b)', () => {
    it("an invitee answers until the start; a change to Can't attend tells the organiser, flagged; the summary is the editor's", async () => {
      const w = await world();
      await prisma.committee.update({ where: { id: w.committeeId }, data: { quorumCount: 3 } });
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);

      await people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'member'), now);
      expect(notices).toEqual([]);
      await people.answer(m.id, { answer: 'CANT_ATTEND', note: 'On leave' } as never, w.orgId, as(w, 'secretary'), now);
      // The organiser (the Chair), in the app only: below the quorum (2 of 3), and the Secretary's seat.
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ userId: w.people['chair'], titleEn: "Can't attend — needs your attention" });
      expect(notices[0]!.bodyEn).toContain('Note: On leave');
      expect(notices[0]!.bodyEn).toContain('Attending is now below the quorum.');
      expect(notices[0]!.bodyEn).toContain('They hold the Chair or Secretary seat.');
      expect(notices[0]!.bodyAr).not.toMatch(/[٠-٩]/);
      // Saying it again tells nobody again.
      notices.length = 0;
      await people.answer(m.id, { answer: 'CANT_ATTEND' } as never, w.orgId, as(w, 'secretary'), now);
      expect(notices).toEqual([]);

      const forChair = await meetings.getForViewer(m.id, w.orgId, as(w, 'chair'), now);
      expect(forChair.answers).toEqual({ members: 3, attending: 1, cantAttend: 1, noAnswer: 1, quorum: 3, belowQuorum: true });
      const forMember = await meetings.getForViewer(m.id, w.orgId, as(w, 'member'), now);
      expect(forMember.answers).toBeNull();
      expect(forMember.myAnswer).toEqual({ answer: 'ATTENDING', note: null });
      expect(forMember.may.answer).toBe(true);

      // The attendee list: the editor sees every answer; a member only their own.
      const memberView = await people.attendees(m.id, w.orgId, as(w, 'member'), now);
      expect(memberView.find((a) => a.userId === w.people['secretary'])!.answer).toBeNull();
      expect(memberView.find((a) => a.userId === w.people['member'])!.answer).toBe('ATTENDING');

      expect(await code(people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW]), now))).toBe('MEETING_NOT_INVITED');
      expect(await code(people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'member'), later(8, now)))).toBe('MEETING_STARTED');
    });
  });

  describe('agenda (PR 3b)', () => {
    it("ordered items; a presenter who isn't invited is added as a guest; after issue the invited are told what changed", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      await agenda.create(m.id, { title: 'Minutes of the last meeting', durationMinutes: 10 } as never, w.orgId, as(w, 'secretary'), now);
      const items = await agenda.create(m.id, { title: 'Budget', durationMinutes: 30, presenter: { userId: w.people['wardPerson'] } } as never, w.orgId, as(w, 'secretary'), now);
      expect(items.map((i) => [i.order, i.title, i.presenter?.name ?? null])).toEqual([
        [1, 'Minutes of the last meeting', null],
        [2, 'Budget', 'wardPerson'],
      ]);
      const presenterRow = (await people.attendees(m.id, w.orgId, as(w, 'chair'), now)).find((a) => a.userId === w.people['wardPerson'])!;
      expect(presenterRow).toMatchObject({ kind: 'ORG_GUEST', addedAsPresenter: true, invited: false });

      const reordered = await agenda.order(m.id, { itemIds: [items[1]!.id, items[0]!.id] } as never, w.orgId, as(w, 'secretary'), now);
      expect(reordered.map((i) => i.title)).toEqual(['Budget', 'Minutes of the last meeting']);
      expect(await code(agenda.order(m.id, { itemIds: [items[0]!.id] } as never, w.orgId, as(w, 'secretary'), now))).toBe('MEETING_AGENDA_ORDER_MISMATCH');
      expect(await code(agenda.create(m.id, { title: '  ' } as never, w.orgId, as(w, 'secretary'), now))).toBe('MEETING_AGENDA_TITLE_REQUIRED');
      expect(await code(agenda.create(m.id, { title: 'X', presenter: { userId: b.people['member'] } } as never, w.orgId, as(w, 'secretary'), now))).toBe(
        'MEETING_PRESENTER_NOT_FOUND',
      );
      expect(await code(agenda.update(m.id, 'no-such-item', { title: 'X' } as never, w.orgId, as(w, 'secretary'), now))).toBe('MEETING_AGENDA_ITEM_NOT_FOUND');
      expect(await code(agenda.create(m.id, { title: 'X' } as never, w.orgId, as(w, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      // A member reads the agenda.
      expect((await agenda.list(m.id, w.orgId, as(w, 'member'), now)).length).toBe(2);

      await issue(w, m.id);
      notices.length = 0;
      await agenda.update(m.id, items[0]!.id, { title: 'Approve the minutes' } as never, w.orgId, as(w, 'secretary'), now);
      const changed = notices.filter((n) => n.titleEn === 'Agenda changed');
      expect(changed.map((n) => n.userId).sort()).toEqual([w.people['chair'], w.people['member'], w.people['wardPerson']].sort());
      expect(changed[0]!.bodyEn).toBe('The agenda for Monthly review changed: "Approve the minutes" was changed.');
    });
  });

  it("a presenter added as a guest needs the stage to allow guests, as Add a guest does (review fix 2)", async () => {
    const w = await world();
    const now = new Date();
    const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
    // This organisation's Planned stage allows agenda changes but not guests.
    const planned = await prisma.workflowStage.findFirstOrThrow({ where: { key: 'planned', workflowTemplate: { organizationId: w.orgId, objectType: 'MEETING' } } });
    await prisma.workflowStageRecordAction.deleteMany({ where: { organizationId: w.orgId, stageId: planned.id, actionKey: 'manage_guests' } });

    const before = await prisma.meetingAttendee.count({ where: { meetingId: m.id } });
    const refused = await outcome(agenda.create(m.id, { title: 'Budget', presenter: { userId: w.people['wardPerson'] } } as never, w.orgId, as(w, 'chair'), now));
    const viaGuests = await outcome(people.addGuest(m.id, { userId: w.people['wardPerson'] } as never, w.orgId, as(w, 'chair'), now));
    expect(refused).toMatchObject({ code: 'STAGE_ACTION_NOT_ALLOWED', action: 'manage_guests' });
    expect(refused).toEqual(viaGuests);
    expect(await prisma.meetingAttendee.count({ where: { meetingId: m.id } })).toBe(before);
    expect(await prisma.agendaItem.count({ where: { meetingId: m.id } })).toBe(0);
    // A presenter who is already an invitee needs no guest rule.
    const member = (await people.attendees(m.id, w.orgId, as(w, 'chair'), now)).find((a) => a.userId === w.people['member'])!;
    expect(await code(agenda.create(m.id, { title: 'Budget', presenter: { attendeeId: member.id } } as never, w.orgId, as(w, 'chair'), now))).toBe('OK');
  });

  describe('files (PR 3b)', () => {
    const fileRow = (w: World, ownerType: 'MEETING' | 'MEETING_AGENDA_ITEM', ownerId: string, name: string) =>
      prisma.storedFile.create({
        data: {
          organizationId: w.orgId,
          provider: 'S3',
          bucket: 'test',
          storageKey: `${w.orgId}/meetings/${ownerId}/${randomUUID()}-${name}`,
          originalName: name,
          mimeType: 'application/pdf',
          sizeBytes: 100,
          sha256: 'a'.repeat(64),
          ownerType,
          ownerId,
          uploadedById: w.people['chair']!,
        },
      });

    it("attachments and papers open for whoever sees the meeting, and for nobody outside it; a removed paper's item takes it to the recycle bin", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const other = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { title: 'Other' }), w.orgId, as(w, 'chair'), now);
      const [item] = await agenda.create(m.id, { title: 'Budget' } as never, w.orgId, as(w, 'chair'), now);
      const attachment = await fileRow(w, 'MEETING', m.id, 'terms.pdf');
      const paper = await fileRow(w, 'MEETING_AGENDA_ITEM', item!.id, 'budget.pdf');
      const otherFile = await fileRow(w, 'MEETING', other.id, 'other.pdf');

      const listed = await files.list(m.id, w.orgId, as(w, 'member'), now);
      expect(listed.attachments.map((f) => f.name)).toEqual(['terms.pdf']);
      expect(listed.papers.map((f) => [f.name, f.agendaItemId])).toEqual([['budget.pdf', item!.id]]);
      expect(await files.openView(m.id, paper.id, w.orgId, as(w, 'member'), now)).toMatchObject({ url: `view/${paper.id}` });
      // Nobody outside the meeting: the identical 404.
      expect(await outcome(files.openView(m.id, paper.id, w.orgId, as(w, 'outsider'), now))).toEqual({
        statusCode: 404,
        message: 'Meeting not found',
        error: 'Not Found',
      });
      // Another meeting's file asked through this meeting: not found.
      expect(await code(files.openDownload(m.id, otherFile.id, w.orgId, as(w, 'member'), now))).toBe(404);
      // A member reads but does not delete.
      expect(await code(files.remove(m.id, attachment.id, w.orgId, as(w, 'member'), now))).toBe('MEETING_NOT_ALLOWED');

      // Removing the agenda item soft-deletes its paper; with the item gone, the bin cannot restore it.
      await agenda.remove(m.id, item!.id, w.orgId, as(w, 'chair'), now);
      expect((await prisma.storedFile.findFirstOrThrow({ where: { id: paper.id } })).deletedAt).not.toBeNull();
      expect(await code(recycleBin.restore(w.orgId, paper.id, w.people['rootHead']!))).toBe('FILE_RECORD_GONE');
      // The attachment, deleted and restored, goes back to its meeting.
      await files.remove(m.id, attachment.id, w.orgId, as(w, 'chair'), now);
      expect((await files.list(m.id, w.orgId, as(w, 'chair'), now)).attachments).toEqual([]);
      await recycleBin.restore(w.orgId, attachment.id, w.people['rootHead']!);
      expect((await files.list(m.id, w.orgId, as(w, 'chair'), now)).attachments.map((f) => f.name)).toEqual(['terms.pdf']);
    });
  });

  describe('file uploads (PR 3b)', () => {
    it('are refused before any byte is stored: a stage with no agenda changes, an agenda item of another meeting', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const other = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { title: 'Other' }), w.orgId, as(w, 'chair'), now);
      const [otherItem] = await agenda.create(other.id, { title: 'Elsewhere' } as never, w.orgId, as(w, 'chair'), now);
      const prepare = jest.spyOn(storedFiles, 'prepare');
      try {
        const upload = { originalname: 'terms.pdf', mimetype: 'application/pdf', size: 10, buffer: Buffer.from('%PDF-1.4') } as never;
        expect(await code(files.add(m.id, otherItem!.id, upload, w.orgId, as(w, 'chair'), now))).toBe('MEETING_AGENDA_ITEM_NOT_FOUND');
        await workflow.triggerTransition((await instanceOf(m.id)).id, { transitionId: (await move(m.id, 'cancelled')).id, comment: 'No' } as never, w.orgId, w.people['chair']!, []);
        expect(await code(files.add(m.id, null, upload, w.orgId, as(w, 'chair'), now))).toBe('STAGE_ACTION_NOT_ALLOWED');
        expect(prepare).not.toHaveBeenCalled();
      } finally {
        prepare.mockRestore();
      }
    });
  });

  describe('concurrent writes (review fixes 3, 6, 7)', () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** Holds a row lock in its own transaction until released; `after` runs inside it before it commits. */
    const hold = (sql: (tx: EngineTx) => Promise<unknown>, after: (tx: EngineTx) => Promise<unknown> = async () => undefined) => {
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let locked!: () => void;
      const isLocked = new Promise<void>((r) => (locked = r));
      const done = prisma.$transaction(
        async (tx) => {
          await sql(tx as never);
          locked();
          await released;
          await after(tx as never);
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
      return { isLocked, release, done };
    };
    /** Resolves to 'pending' if the promise has not settled within `ms`. */
    const settledWithin = async (p: Promise<unknown>, ms: number) => Promise.race([p.then(() => 'settled', () => 'settled'), sleep(ms).then(() => 'pending')]);

    it('the same guest added twice at once: one is added, the other is the coded refusal, never a 500', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const results = await Promise.all(
        [0, 1, 2].map(() => code(people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now))),
      );
      expect(results.sort()).toEqual(['MEETING_ALREADY_INVITED', 'MEETING_ALREADY_INVITED', 'OK']);
      // Agenda items created at once each get their own place.
      await Promise.all([1, 2, 3, 4].map((i) => agenda.create(m.id, { title: `Item ${i}` } as never, w.orgId, as(w, 'chair'), now)));
      const orders = (await agenda.list(m.id, w.orgId, as(w, 'chair'), now)).map((i) => i.order);
      expect(orders).toEqual([1, 2, 3, 4]);
    });

    it('guest, agenda and answer writes wait for the meeting row (another write on the meeting finishes first)', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      const lock = hold((tx) => tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${m.id} FOR UPDATE`);
      await lock.isLocked;
      const writes = [
        people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now),
        agenda.create(m.id, { title: 'Budget' } as never, w.orgId, as(w, 'chair'), now),
        people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'member'), now),
      ];
      for (const write of writes) expect(await settledWithin(write, 800)).toBe('pending');
      lock.release();
      await lock.done;
      await Promise.all(writes);
    });

    it('an answer is judged against the start time AFTER it gets the lock', async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      // The meeting now starts 1.5 s from here; a write holds its row for 2.5 s.
      await prisma.meeting.update({ where: { id: m.id }, data: { scheduledAt: new Date(Date.now() + 1500) } });
      const lock = hold((tx) => tx.$queryRaw`SELECT id FROM "Meeting" WHERE id = ${m.id} FOR UPDATE`);
      await lock.isLocked;
      const answering = code(people.answer(m.id, { answer: 'ATTENDING' } as never, w.orgId, as(w, 'member')));
      await sleep(2500);
      lock.release();
      await lock.done;
      expect(await answering).toBe('MEETING_STARTED');
    });

    it("an agenda item's removal waits for a paper being recorded on it, and a paper is refused once its item is gone", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);

      // 1. An upload holds the item (FOR SHARE): a removal waits for it.
      const [first] = await agenda.create(m.id, { title: 'Budget' } as never, w.orgId, as(w, 'chair'), now);
      const paperId = randomUUID();
      const upload = hold(
        (tx) => tx.$queryRaw`SELECT id FROM "AgendaItem" WHERE id = ${first!.id} FOR SHARE`,
        // The upload records its paper, then commits.
        (tx) =>
          tx.storedFile.create({
            data: {
              id: paperId,
              organizationId: w.orgId,
              provider: 'S3',
              bucket: 'test',
              storageKey: `${w.orgId}/meetings/${first!.id}/${paperId}-budget.pdf`,
              originalName: 'budget.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 10,
              sha256: 'a'.repeat(64),
              ownerType: 'MEETING_AGENDA_ITEM',
              ownerId: first!.id,
              uploadedById: w.people['chair']!,
            },
          }),
      );
      await upload.isLocked;
      const removing = agenda.remove(m.id, first!.id, w.orgId, as(w, 'chair'), now);
      expect(await settledWithin(removing, 1500)).toBe('pending');
      upload.release();
      await upload.done;
      await removing;
      // The removal read the item's papers only after the upload committed: the new paper goes with it.
      expect((await prisma.storedFile.findFirstOrThrow({ where: { id: paperId } })).deletedAt).not.toBeNull();

      // 2. A removal holds the item (FOR UPDATE) and deletes it: the upload waits, then is refused, its bytes discarded.
      const [second] = await agenda.create(m.id, { title: 'Risks' } as never, w.orgId, as(w, 'chair'), now);
      const stub = {
        prepare: jest.spyOn(storedFiles, 'prepare').mockResolvedValue({ originalName: 'risks.pdf', mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a', location: { provider: 'S3' } } as never),
        after: jest.spyOn(storedFiles, 'afterUpload').mockResolvedValue(undefined),
        put: jest.spyOn(storedFiles, 'put').mockResolvedValue(undefined),
        discard: jest.spyOn(storedFiles, 'discard').mockResolvedValue(undefined),
        record: jest.spyOn(storedFiles, 'recordInTx').mockImplementation(async (tx) =>
          (tx as unknown as typeof prisma).storedFile.create({
            data: {
              organizationId: w.orgId,
              provider: 'S3',
              bucket: 'test',
              storageKey: `${w.orgId}/meetings/${second!.id}/${randomUUID()}-risks.pdf`,
              originalName: 'risks.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 10,
              sha256: 'a'.repeat(64),
              ownerType: 'MEETING_AGENDA_ITEM',
              ownerId: second!.id,
              uploadedById: w.people['chair']!,
            },
          }) as never,
        ),
      };
      try {
        const removal = hold(
          (tx) => tx.$queryRaw`SELECT id FROM "AgendaItem" WHERE id = ${second!.id} FOR UPDATE`,
          (tx) => tx.agendaItem.delete({ where: { id: second!.id } }),
        );
        await removal.isLocked;
        const uploading = code(files.add(m.id, second!.id, { originalname: 'risks.pdf' } as never, w.orgId, as(w, 'chair'), now));
        await sleep(1000);
        removal.release();
        await removal.done;
        expect(await uploading).toBe('MEETING_AGENDA_ITEM_NOT_FOUND');
        expect(stub.discard).toHaveBeenCalledTimes(1);
        expect(await prisma.storedFile.count({ where: { ownerType: 'MEETING_AGENDA_ITEM', ownerId: second!.id } })).toBe(0);
      } finally {
        for (const spy of Object.values(stub)) spy.mockRestore();
      }
    });
  });

  describe('the clash check (PR 3b)', () => {
    it("strict overlap only, cancelled meetings left out, another meeting's title only for who may open it", async () => {
      const w = await world();
      const now = new Date();
      const at = (days: number, hours: number) => new Date(later(days, now).setUTCHours(hours, 0, 0, 0));
      // The member is in a 09:00–10:00 committee meeting and a cancelled one at 11:00.
      const busy = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { scheduledAt: at(5, 9).toISOString(), durationMinutes: 60 }), w.orgId, as(w, 'chair'), now);
      const off = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { scheduledAt: at(5, 11).toISOString(), title: 'Off' }), w.orgId, as(w, 'chair'), now);
      await workflow.triggerTransition((await instanceOf(off.id)).id, { transitionId: (await move(off.id, 'cancelled')).id, comment: 'No' } as never, w.orgId, w.people['chair']!, []);

      const times = [
        { startsAt: at(5, 9).toISOString(), durationMinutes: 30 }, // overlaps
        { startsAt: at(5, 10).toISOString(), durationMinutes: 30 }, // back to back
        { startsAt: at(5, 11).toISOString(), durationMinutes: 30 }, // only the cancelled meeting
        { startsAt: new Date(at(5, 9).getTime() - 30 * 60_000).toISOString(), durationMinutes: 30 }, // ends as it starts
      ];
      const asChair = await clashes.check({ committeeId: w.committeeId, times } as never, w.orgId, as(w, 'chair'), now);
      expect(asChair[0]!.people.map((p) => p.userId).sort()).toEqual([w.people['chair'], w.people['member'], w.people['secretary']].sort());
      expect(asChair[0]!.people[0]!.meetings).toEqual([{ id: busy.id, title: 'Monthly review', startsAt: at(5, 9), durationMinutes: 60 }]);
      expect(asChair[1]!.people).toEqual([]);
      expect(asChair[2]!.people).toEqual([]);
      expect(asChair[3]!.people).toEqual([]);

      // Root's head schedules a Ward meeting for wardPerson, who is also invited to the committee meeting:
      // the committee meeting is above Ward, so its title is withheld from them.
      await people.addGuest(busy.id, { userId: w.people['wardPerson'] } as never, w.orgId, as(w, 'chair'), now);
      const asWard = await clashes.check(
        { orgUnitId: w.units.ward, times: [times[0]!], userIds: [w.people['wardPerson']!] } as never,
        w.orgId,
        as(w, 'rootHead'),
        now,
      );
      expect(asWard[0]!.people[0]!.meetings[0]!.title).toBe('Monthly review'); // Root's head oversees it
      // Editing the meeting itself leaves its own time out.
      expect((await clashes.check({ meetingId: busy.id, times: [times[0]!] } as never, w.orgId, as(w, 'chair'), now))[0]!.people).toEqual([]);

      expect(await code(clashes.check({ committeeId: w.committeeId, times } as never, w.orgId, as(w, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      // Only the owner's members and this meeting's invitees may be checked: never anyone else's diary.
      expect(await code(clashes.check({ committeeId: w.committeeId, times, userIds: [w.people['outsider']!] } as never, w.orgId, as(w, 'chair'), now))).toBe(
        'MEETING_CLASH_PERSON_NOT_INVITEE',
      );
      expect(await code(clashes.check({ meetingId: busy.id, times, userIds: [w.people['wardPerson']!] } as never, w.orgId, as(w, 'chair'), now))).toBe('OK');
      expect(await code(clashes.check({ meetingId: busy.id, times, userIds: [w.people['outsider']!] } as never, w.orgId, as(w, 'chair'), now))).toBe(
        'MEETING_CLASH_PERSON_NOT_INVITEE',
      );
      expect(await code(clashes.check({ times } as never, w.orgId, as(w, 'chair'), now))).toBe('MEETING_CLASH_OWNER_REQUIRED');
      expect(await code(clashes.check({ committeeId: w.committeeId, times: Array(54).fill(times[0]) } as never, w.orgId, as(w, 'chair'), now))).toBe(
        'MEETING_CLASH_TOO_MANY_TIMES',
      );
    });

    it('a title the asker may not open reads as another meeting', async () => {
      const w = await world();
      const now = new Date();
      const start = later(6, now);
      // A Ward meeting with the member as a guest; Clinical's scheduler cannot open it.
      const ward = await meetings.schedule(scheduleDto(now, { orgUnitId: w.units.ward }, { scheduledAt: start.toISOString() }), w.orgId, as(w, 'rootHead'), now);
      await people.addGuest(ward.id, { userId: w.people['clinicalHead'] } as never, w.orgId, as(w, 'rootHead'), now);
      const asked = await clashes.check(
        { orgUnitId: w.units.clinical, times: [{ startsAt: start.toISOString(), durationMinutes: 30 }] } as never,
        w.orgId,
        as(w, 'clinicalScheduler'),
        now,
      );
      const head = asked[0]!.people.find((p) => p.userId === w.people['clinicalHead'])!;
      // Neither its title nor its id: the asker learns only that the person is busy then.
      expect(head.meetings.map((x) => [x.id, x.title])).toEqual([[null, null]]);
      expect(head.meetings[0]!.startsAt).toEqual(start);
      expect(ward.id).toBeTruthy();
    });
  });

  // ACC-316 PR 6 — the reads the screens need: whether Schedule meeting is
  // offered, Add a guest's people, Schedule's types, and the list's search.
  describe('the screens\' reads (PR 6)', () => {
    it("may-schedule answers exactly as schedule() does, for every person and owner", async () => {
      const w = await world();
      const now = new Date();
      const owners = [
        { committeeId: w.committeeId },
        { committeeId: w.dissolvedCommitteeId },
        { orgUnitId: w.units.clinical },
        { orgUnitId: w.units.ward },
      ];
      const seen = new Set<boolean>();
      for (const name of Object.keys(w.people)) {
        for (const owner of owners) {
          const may = (await meetings.maySchedule(owner, w.orgId, as(w, name), now)).may;
          const result = await outcome(meetings.schedule(scheduleDto(now, owner), w.orgId, as(w, name), now));
          const accepted = result === 'OK';
          expect([name, owner, may, result]).toEqual([name, owner, accepted, result]);
          seen.add(may);
        }
      }
      // Non-vacuity: some people may and some may not.
      expect(seen).toEqual(new Set([true, false]));
      // The chair schedules for their committee; a plain member does not.
      expect((await meetings.maySchedule({ committeeId: w.committeeId }, w.orgId, as(w, 'chair'), now)).may).toBe(true);
      expect((await meetings.maySchedule({ committeeId: w.committeeId }, w.orgId, as(w, 'member'), now)).may).toBe(false);
      expect(await code(meetings.maySchedule({}, w.orgId, as(w, 'chair'), now))).toBe('MEETING_OWNER_REQUIRED');
      // A Dissolved committee schedules nothing, whoever asks (its stage).
      expect((await meetings.maySchedule({ committeeId: w.dissolvedCommitteeId }, w.orgId, as(w, 'chair'), now)).may).toBe(false);
      // Clinical's scheduler is a scheduler for the committee Clinical owns, but
      // not a member, so would not see the meeting (plan §4.1 against §4.2):
      // Schedule is not offered. meetings:view lets them see it, so it is.
      expect((await meetings.maySchedule({ committeeId: w.committeeId }, w.orgId, as(w, 'clinicalScheduler'), now)).may).toBe(false);
      expect((await meetings.maySchedule({ committeeId: w.committeeId }, w.orgId, as(w, 'clinicalScheduler', [MEETINGS_PERMISSIONS.VIEW]), now)).may).toBe(true);
    });

    itEnforcesTenantIsolation("may-schedule — another organisation's committee or unit is MEETING_OWNER_NOT_FOUND, as schedule() answers", async () => {
      const now = new Date();
      expect(await code(meetings.maySchedule({ committeeId: b.committeeId }, a.orgId, as(a, 'chair'), now))).toBe('MEETING_OWNER_NOT_FOUND');
      expect(await code(meetings.maySchedule({ orgUnitId: b.units.clinical }, a.orgId, as(a, 'clinicalScheduler'), now))).toBe('MEETING_OWNER_NOT_FOUND');
      expect(await code(meetings.maySchedule({ committeeId: 'no-such-committee' }, a.orgId, as(a, 'chair'), now))).toBe('MEETING_OWNER_NOT_FOUND');
    });

    it("guest candidates: active people not invited, searched and paged by name, never an email; only for whoever may write the meeting", async () => {
      const w = await world();
      const now = new Date();
      const m = await meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }), w.orgId, as(w, 'chair'), now);
      await people.addGuest(m.id, { userId: w.people['invitee'] } as never, w.orgId, as(w, 'chair'), now);
      await prisma.user.update({ where: { id: w.people['wardPerson']! }, data: { status: 'INACTIVE' } });
      const all = await people.guestCandidates(m.id, { take: 50 }, w.orgId, as(w, 'chair'), now);
      const names = all.items.map((i) => i.name);
      // Members and the guest are invited already; the inactive person is never offered.
      expect(names).toEqual(['clinicalHead', 'clinicalScheduler', 'outsider', 'rootHead']);
      expect(all.total).toBe(4);
      expect(all.matching).toBe(4);
      expect(Object.keys(all.items[0]!).sort()).toEqual(['id', 'name', 'position', 'unit']);
      expect(all.items.find((i) => i.name === 'clinicalScheduler')!.unit).toEqual({ nameEn: 'Clinical', nameAr: null });

      const searched = await people.guestCandidates(m.id, { q: '  CLINICAL ', take: 50 }, w.orgId, as(w, 'chair'), now);
      expect(searched.items.map((i) => i.name)).toEqual(['clinicalHead', 'clinicalScheduler']);
      expect([searched.total, searched.matching]).toEqual([4, 2]);

      const pages = [];
      for (let skip = 0; skip < 4; skip++) pages.push(...(await people.guestCandidates(m.id, { skip, take: 1 }, w.orgId, as(w, 'chair'), now)).items.map((i) => i.name));
      expect(pages).toEqual(names);
      expect((await people.guestCandidates(m.id, { take: 500 }, w.orgId, as(w, 'chair'), now)).items.length).toBe(4);

      expect(await code(people.guestCandidates(m.id, {}, w.orgId, as(w, 'member'), now))).toBe('MEETING_NOT_ALLOWED');
      expect(await code(people.guestCandidates(m.id, {}, w.orgId, as(w, 'outsider'), now))).toBe(404);
    });

    itEnforcesTenantIsolation("guest candidates — another organisation's meeting is the same 404, and its people are never offered", async () => {
      const now = new Date();
      const theirs = await meetings.schedule(scheduleDto(now, { committeeId: b.committeeId }), b.orgId, as(b, 'chair'), now);
      const mine = await meetings.schedule(scheduleDto(now, { committeeId: a.committeeId }), a.orgId, as(a, 'chair'), now);
      expect(await code(people.guestCandidates(theirs.id, {}, a.orgId, as(a, 'chair'), now))).toEqual(await code(people.guestCandidates('no-such-meeting', {}, a.orgId, as(a, 'chair'), now)));
      expect(await code(people.guestCandidates(theirs.id, {}, a.orgId, as(a, 'chair'), now))).toBe(404);
      const offered = (await people.guestCandidates(mine.id, { take: 50 }, a.orgId, as(a, 'chair'), now)).items.map((i) => i.id);
      expect(offered.length).toBeGreaterThan(0);
      expect(offered.filter((id) => Object.values(b.people).includes(id))).toEqual([]);
    });

    it("form choices: the meeting types the organisation offers, each one schedule() accepts; a hidden one is neither", async () => {
      const w = await world();
      const now = new Date();
      const shared = await prisma.lookupValue.findMany({ where: { organizationId: null, isActive: true, category: { key: 'meeting_type', organizationId: null } } });
      expect(shared.length).toBeGreaterThan(1);
      const hidden = shared[shared.length - 1]!;
      await prisma.lookupValue.create({ data: { organizationId: w.orgId, categoryId: hidden.categoryId, key: hidden.key, labelEn: hidden.labelEn, layer: 'TENANT', isHidden: true } });

      const { types } = await formChoices.forOrganization(w.orgId);
      expect(types.map((t) => t.id)).not.toContain(hidden.id);
      expect(types.length).toBe(shared.length - 1);
      for (const t of types) {
        expect(await outcome(meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { typeValueId: t.id, title: `Type ${t.labelEn}` }), w.orgId, as(w, 'chair'), now))).toBe('OK');
      }
      expect(await code(meetings.schedule(scheduleDto(now, { committeeId: w.committeeId }, { typeValueId: hidden.id }), w.orgId, as(w, 'chair'), now))).toBe('MEETING_TYPE_UNKNOWN');
    });

    itEnforcesTenantIsolation("form choices — another organisation's own meeting type is never offered", async () => {
      const category = await prisma.lookupCategory.findFirstOrThrow({ where: { key: 'meeting_type', organizationId: null } });
      const theirs = await prisma.lookupValue.create({ data: { organizationId: b.orgId, categoryId: category.id, key: `theirs-${randomUUID().slice(0, 6)}`, labelEn: 'Their type', layer: 'TENANT' } });
      expect((await formChoices.forOrganization(b.orgId)).types.map((t) => t.id)).toContain(theirs.id);
      expect((await formChoices.forOrganization(a.orgId)).types.map((t) => t.id)).not.toContain(theirs.id);
    });

    it("the list's search matches the title, any case, with LIKE's own wildcards taken literally", async () => {
      const w = await world();
      const now = new Date();
      const viewer = as(w, 'outsider', [MEETINGS_PERMISSIONS.VIEW]);
      const titled = async (title: string) => {
        const id = await meetingRow(w, { committeeId: w.committeeId }, later(2, now), w.people['chair']!);
        await prisma.meeting.update({ where: { id }, data: { title } });
        return id;
      };
      const pharmacy = await titled('Pharmacy review');
      const percent = await titled('100% attendance check');
      const underscore = await titled('Room_4 handover');
      await titled('Quality board');
      const ids = async (q: string) => (await meetings.list({ view: 'all', q } as never, w.orgId, viewer, now)).items.map((i) => i.id);

      expect(await ids('PHARMACY')).toEqual([pharmacy]);
      expect(await ids('  review  ')).toEqual([pharmacy]);
      expect(await ids('%')).toEqual([percent]);
      expect(await ids('_')).toEqual([underscore]);
      expect(await ids('Room_4')).toEqual([underscore]);
      expect((await ids('')).length).toBe(4);
      expect((await meetings.list({ view: 'all', q: 'review' } as never, w.orgId, viewer, now)).total).toBe(1);
    });
  });

  itEnforcesTenantIsolation("meeting people, agenda, files and clashes — another organisation's meeting is the same 404, and its people never count", async () => {
    const now = new Date();
    const theirs = await meetings.schedule(scheduleDto(now, { committeeId: b.committeeId }), b.orgId, as(b, 'chair'), now);
    const viewer = as(a, 'chair', [MEETINGS_PERMISSIONS.VIEW]);
    const notFound = { statusCode: 404, message: 'Meeting not found', error: 'Not Found' };
    expect(await outcome(people.attendees(theirs.id, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(people.addGuest(theirs.id, { userId: a.people['invitee'] } as never, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(people.answer(theirs.id, { answer: 'ATTENDING' } as never, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(agenda.list(theirs.id, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(files.list(theirs.id, a.orgId, viewer, now))).toEqual(notFound);
    expect(await outcome(clashes.check({ meetingId: theirs.id, times: [] } as never, a.orgId, viewer, now))).toEqual(notFound);
    expect(await code(clashes.check({ committeeId: b.committeeId, times: [] } as never, a.orgId, viewer, now))).toBe('MEETING_OWNER_NOT_FOUND');
    expect(await prisma.meetingAttendee.count({ where: { meetingId: theirs.id, userId: a.people['invitee']! } })).toBe(0);
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
