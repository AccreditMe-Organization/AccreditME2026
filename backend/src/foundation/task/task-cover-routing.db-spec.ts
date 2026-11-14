/**
 * ACC-302 — a new task for someone out of office goes to their cover, against
 * a REAL Postgres (npm run test:db). Plan: backend/Plans/step-302-task-cover-routing.md.
 *
 * Only a database proves:
 *
 *   - New task to a chosen person who is away, and to a one-holder position
 *     whose holder is, lands with the cover: their TaskAssignee row stamped
 *     OUT_OF_OFFICE_COVERAGE with whom they cover, the audit row naming both
 *     by id, the cover's notice naming whom they cover, the away person told
 *     nothing;
 *   - Reassign follows the same rule;
 *   - a stage entry routes all its definitions with ONE cover read;
 *   - one hop: a cover who is away too, an inactive cover, and a cover in
 *     another organisation each leave the task with the person;
 *   - a pool is untouched, and a task already held stays where it is;
 *   - the picker says who a new task goes to (`cover`), and never a date.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { DEFAULT_TASK_SLA_SETTINGS } from '../tenant/task-sla-settings';
import { LookupService } from '../lookup/lookup.service';
import { StageTaskDefinitionService } from '../workflow/stage-task-definition.service';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskSlaService } from './task-sla.service';
import { TaskClosedNoticeService } from './task-closed-notice.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

describe('A new task for someone out of office goes to their cover, against a real database (ACC-302)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = new NotificationService(prisma, audit, { add: async () => undefined } as never);
  // A pool's pick-up clock reads the task SLA: the defaults every new organisation gets.
  const tenant = { getTaskSla: async () => DEFAULT_TASK_SLA_SETTINGS } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);

  const DAY = 86_400_000;
  const awayNow = () => ({ outOfOfficeFrom: new Date(Date.now() - DAY), outOfOfficeTo: new Date(Date.now() + DAY) });

  /**
   * An organisation: a unit; a one-holder position held by Away (out of office,
   * covered by Cover) and a shared position held by Bea and Dana (Dana away,
   * covered by Cover); a committee to hang tasks on; the creator.
   */
  async function org() {
    const slug = `acc302-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${randomUUID().slice(0, 6)}` } });
    const single = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Quality Director', grade: 1, isSingleAssignee: true } });
    const shared = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Quality Officer', grade: 2 } });
    let n = 0;
    const user = (name: string, extra: Record<string, unknown> = {}) =>
      prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } });
    const creator = await user('Creator');
    const cover = await user('The Cover');
    const away = await user('Away Person', { positionId: single.id, primaryOrgUnitId: unit.id, actingUserId: cover.id, ...awayNow() });
    const bea = await user('Bea', { positionId: shared.id, primaryOrgUnitId: unit.id });
    const dana = await user('Dana', { positionId: shared.id, primaryOrgUnitId: unit.id, actingUserId: cover.id, ...awayNow() });
    const committee = await prisma.committee.create({
      data: { organizationId: o.id, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit.id, quorumCount: 1, meetingFrequency: 'MONTHLY' },
    });
    return { id: o.id, slug, unit: unit.id, single: single.id, shared: shared.id, creator: creator.id, cover: cover.id, away: away.id, bea: bea.id, dana: dana.id, committee: committee.id, user };
  }
  type Org = Awaited<ReturnType<typeof org>>;

  const newTask = (o: Org, assignTo: Record<string, unknown>) =>
    tasks.create({ title: 'Collect the audit evidence', sourceType: 'COMMITTEE', sourceId: o.committee, assignTo } as never, o.id, o.creator);
  const assigneesOf = (taskId: string) =>
    prisma.taskAssignee.findMany({
      where: { taskId, removedAt: null },
      select: { userId: true, delegationReason: true, delegationContextId: true },
      orderBy: { userId: 'asc' },
    });
  const inbox = (userId: string) => prisma.notification.findMany({ where: { userId }, select: { titleEn: true, bodyEn: true } });
  const auditMeta = async (taskId: string, action: 'CREATE' | 'DELEGATE') =>
    (await prisma.auditLog.findFirstOrThrow({ where: { objectType: 'Task', objectId: taskId, action }, orderBy: { createdAt: 'desc' } })).metadata as Record<string, unknown> | null;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('New task', () => {
    it('to a chosen person who is away: the cover holds it, stamped, told whom they cover; the away person is told nothing', async () => {
      const o = await org();
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.single, userId: o.away });

      expect(await assigneesOf(task.id)).toEqual([{ userId: o.cover, delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: o.away }]);
      expect(await auditMeta(task.id, 'CREATE')).toEqual({ outOfOfficeCover: [{ forUserId: o.away, coverUserId: o.cover }] });
      expect(await inbox(o.cover)).toEqual([
        { titleEn: 'New task assigned', bodyEn: 'You have been assigned: "Collect the audit evidence" (covering for Away Person)' },
      ]);
      expect(await inbox(o.away)).toEqual([]);
    });

    it('to a one-holder position whose holder is away: the cover holds it the same way', async () => {
      const o = await org();
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.single });
      expect(await assigneesOf(task.id)).toEqual([{ userId: o.cover, delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: o.away }]);
    });

    it('one hop only: when the cover is away too, it stays with the person, unstamped', async () => {
      const o = await org();
      await prisma.user.update({ where: { id: o.cover }, data: awayNow() });
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.single, userId: o.away });
      expect(await assigneesOf(task.id)).toEqual([{ userId: o.away, delegationReason: null, delegationContextId: null }]);
      expect(await auditMeta(task.id, 'CREATE')).toBeNull();
    });

    it('an inactive cover leaves it with the person', async () => {
      const o = await org();
      await prisma.user.update({ where: { id: o.cover }, data: { status: 'INACTIVE' } });
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.single, userId: o.away });
      expect(await assigneesOf(task.id)).toEqual([{ userId: o.away, delegationReason: null, delegationContextId: null }]);
    });

    itEnforcesTenantIsolation('a cover in another organisation is never given the task', async () => {
      const a = await org();
      const b = await org();
      await prisma.user.update({ where: { id: a.away }, data: { actingUserId: b.cover } });
      const task = await newTask(a, { kind: 'POSITION', orgUnitId: a.unit, positionId: a.single, userId: a.away });
      expect(await assigneesOf(task.id)).toEqual([{ userId: a.away, delegationReason: null, delegationContextId: null }]);
      expect(await inbox(b.cover)).toEqual([]);
    });

    it('a pool is untouched: nobody is assigned, even with an away member who has a cover', async () => {
      const o = await org();
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.shared });
      expect(await assigneesOf(task.id)).toEqual([]);
      expect(await inbox(o.cover)).toEqual([]);
    });

    it('someone not away keeps the task, unstamped', async () => {
      const o = await org();
      const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.shared, userId: o.bea });
      expect(await assigneesOf(task.id)).toEqual([{ userId: o.bea, delegationReason: null, delegationContextId: null }]);
    });
  });

  it('a task already held stays where it is when its holder goes away', async () => {
    const o = await org();
    const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.shared, userId: o.bea });
    await prisma.user.update({ where: { id: o.bea }, data: { actingUserId: o.cover, ...awayNow() } });
    expect(await assigneesOf(task.id)).toEqual([{ userId: o.bea, delegationReason: null, delegationContextId: null }]);
  });

  it('Reassign to an away person goes to the cover the same way, stamped and named in the audit and the notice', async () => {
    const o = await org();
    const task = await newTask(o, { kind: 'POSITION', orgUnitId: o.unit, positionId: o.shared, userId: o.bea });
    await tasks.reassign(task.id, { assignTo: { kind: 'POSITION', orgUnitId: o.unit, positionId: o.single, userId: o.away }, reason: 'Needs the director' } as never, o.id, o.creator, []);

    expect(await assigneesOf(task.id)).toEqual([{ userId: o.cover, delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: o.away }]);
    expect(await auditMeta(task.id, 'DELEGATE')).toEqual(
      expect.objectContaining({ outOfOfficeCover: [{ forUserId: o.away, coverUserId: o.cover }] }),
    );
    expect(await inbox(o.cover)).toEqual([
      {
        titleEn: 'Task reassigned to you',
        bodyEn: '"Collect the audit evidence" has been reassigned to you (covering for Away Person). Reason: Needs the director',
      },
    ]);
    expect(await inbox(o.away)).toEqual([]);
  });

  it('a stage entry routes every definition with ONE cover read, never one per definition', async () => {
    const o = await org();
    const template = await prisma.workflowTemplate.create({ data: { organizationId: o.id, nameEn: 'Committee', objectType: 'COMMITTEE' } });
    const stage = await prisma.workflowStage.create({ data: { workflowTemplateId: template.id, nameEn: 'Review', order: 1, isInitial: true, whoMode: 'ANY_ONE' } });
    const definition = (order: number, extra: Record<string, unknown>) =>
      prisma.workflowStageTaskDefinition.create({
        data: { organizationId: o.id, stageId: stage.id, order, titleEn: `Task ${order}`, isMandatory: false, priority: 'MEDIUM', assignKind: 'POSITION', orgUnitId: o.unit, createdById: o.creator, ...extra },
      });
    await definition(1, { positionId: o.single }); // one holder, away: the cover
    await definition(2, { positionId: o.shared, userId: o.bea }); // a chosen person, here
    await definition(3, { positionId: o.shared }); // a pool: untouched

    const reads = jest.spyOn(prisma.user, 'findMany');
    const coverReads = () => reads.mock.calls.filter(([args]) => (args as { where?: Record<string, unknown> } | undefined)?.where?.['actingUserId'] !== undefined).length;
    const { tasks: prepared } = await stageTasks.prepareEntryTasks(stage, { objectType: 'COMMITTEE', objectId: o.committee }, 'COMMITTEE', new Date(), o.id);
    expect(coverReads()).toBe(1);
    reads.mockRestore();

    expect(prepared.map((p) => [p.eligibleAssigneeIds, [...p.delegations]])).toEqual([
      [[o.cover], [[o.cover, { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: o.away }]]],
      [[o.bea], []],
      [[], []],
    ]);
  });

  describe('the picker', () => {
    const viewer = { id: 'configurer', permissions: ['workflows:manage'] };

    it("says who a new task for each person goes to: the cover's id and name, never a date or a reason", async () => {
      const o = await org();
      const holders = await assignment.listHolders(viewer, o.id, o.unit, o.shared);
      expect(holders.map((h) => [h.name, h.cover])).toEqual([
        ['Bea', null],
        ['Dana', { userId: o.cover, name: 'The Cover' }],
      ]);
      const sent = JSON.stringify(holders);
      for (const word of ['outOfOffice', 'From', 'To"', 'reason', 'OUT_OF_OFFICE']) expect(sent).not.toContain(word);
    });

    it('one hop here too: a cover who is away means no cover is named', async () => {
      const o = await org();
      await prisma.user.update({ where: { id: o.cover }, data: awayNow() });
      const holders = await assignment.listHolders(viewer, o.id, o.unit, o.shared);
      expect(holders.map((h) => h.cover)).toEqual([null, null]);
    });

    itEnforcesTenantIsolation("never names a cover from another organisation", async () => {
      const a = await org();
      const b = await org();
      await prisma.user.update({ where: { id: a.dana }, data: { actingUserId: b.cover } });
      const holders = await assignment.listHolders(viewer, a.id, a.unit, a.shared);
      expect(holders.map((h) => h.cover)).toEqual([null, null]);
    });
  });
});
