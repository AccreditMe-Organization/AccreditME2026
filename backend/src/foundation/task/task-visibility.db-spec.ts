/**
 * ACC-244 — THE TASK VISIBILITY RULE on a REAL Postgres (npm run test:db), for
 * every kind of viewer the ticket names: relationship only, View all tasks on
 * the type, a head (of a parent unit: sub-units included), an acting head (in
 * force, and before its period), a View unit tasks holder, a Manage tasks
 * holder, and nobody — each also without the record's own view permission,
 * where that matters (rule 1).
 *
 * For each viewer it asserts:
 *   1. the exact set of tasks the rule admits (TaskVisibilityService.isVisible,
 *      which admit() asks for the task page and every file path);
 *   2. LIST = ADMIT: every committee's record list holds exactly the admitted
 *      tasks on that committee, and its total equals its rows;
 *   3. every saved view (All tasks, Unit tasks, Unassigned) lists only admitted
 *      tasks, and exactly the ones it is for;
 *   4. GET /tasks/views offers exactly the views whose lists answer.
 * And, against a second organisation with the same shape, that nothing of it
 * reaches any answer (tenant isolation).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TENANT_ISOLATION_GATE_STRING } from '../../common/testing/tenant-isolation';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);
const HOUR = 3_600_000;

const SEE = 'committees:view';
const VIEW_ALL = 'committees:view_all_tasks';
const MANAGE = 'committees:manage_tasks';
const VIEW_UNIT = 'committees:view_unit_tasks';

describe('The task visibility rule, on a real database (ACC-244)', () => {
  const prisma = new PrismaService();
  const authority = new TaskAuthorityService(prisma);
  const rule = new TaskVisibilityService(prisma, authority);
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const list = new TaskRecordListService(
    prisma,
    new ObjectVisibilityService(prisma),
    tasks,
    rule,
    { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService,
  );

  let A = '';
  let B = '';
  const unit: Record<string, string> = {};
  const committee: Record<string, string> = {};
  const user: Record<string, string> = {};
  const task: Record<string, string> = {};
  let taskB = '';
  let committeeB = '';
  // A corrupt cross-organisation link: B's committee owned by A's department,
  // and a task in A naming it. The owning-unit lookup must stay in A.
  let corruptTask = '';

  /** Which committee each task in A is on. */
  const onCommittee: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc244v-${randomUUID().slice(0, 8)}`;
    A = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    B = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;

    const mkUnit = async (key: string, organizationId: string, parentId: string | null) =>
      (unit[key] = (
        await prisma.orgUnit.create({ data: { organizationId, parentId, nameEn: key, code: `${key}${slug.slice(-4)}`.toUpperCase().slice(0, 10) } })
      ).id);
    await mkUnit('ROOT', A, null);
    await mkUnit('DEPT', A, unit['ROOT']!);
    await mkUnit('WARD', A, unit['DEPT']!);
    await mkUnit('SIB', A, unit['ROOT']!);
    await mkUnit('BROOT', B, null);

    const mkCommittee = async (key: string, organizationId: string, orgUnitId: string) =>
      (await prisma.committee.create({ data: { organizationId, nameEn: `C ${key}`, typeValueId: 'type', orgUnitId } })).id;
    for (const k of ['ROOT', 'DEPT', 'WARD', 'SIB']) committee[k] = await mkCommittee(k, A, unit[k]!);
    committeeB = await mkCommittee('B', B, unit['BROOT']!);

    const head = (await prisma.orgPosition.create({ data: { organizationId: A, nameEn: 'Head', grade: 1, isUnitHeadPosition: true } })).id;
    const staff = (await prisma.orgPosition.create({ data: { organizationId: A, nameEn: 'Staff', grade: 5 } })).id;
    const person = async (key: string, organizationId: string, data: Record<string, unknown> = {}) =>
      (user[key] = (
        await prisma.user.create({ data: { organizationId, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...data } })
      ).id);
    await person('creator', A);
    await person('departed', A, { status: 'INACTIVE' });
    await person('assignee', A);
    await person('deptHead', A, { positionId: head, primaryOrgUnitId: unit['DEPT'] });
    await person('actingNow', A);
    await person('actingFuture', A);
    await person('unitViewer', A, { primaryOrgUnitId: unit['WARD'] });
    await person('viewAll', A);
    await person('manager', A);
    await person('poolMember', A, { positionId: staff, primaryOrgUnitId: unit['WARD'] });
    await person('nobody', A);
    await person('outsider', B);

    const now = Date.now();
    const acting = (orgUnitId: string, userId: string, validFrom: Date) =>
      prisma.orgUnitHeadAssignment.create({
        data: { organizationId: A, orgUnitId, userId, kind: 'ACTING', reason: 'VACANCY', createdById: user['creator']!, validFrom } as never,
      });
    await acting(unit['SIB']!, user['actingNow']!, new Date(now - 24 * HOUR));
    await acting(unit['DEPT']!, user['actingFuture']!, new Date(now + 24 * HOUR));

    const mkTask = async (key: string, on: string, data: Record<string, unknown> = {}, assignee?: string) => {
      const t = await prisma.task.create({
        data: {
          organizationId: A,
          createdById: user['creator']!,
          sourceType: 'COMMITTEE',
          sourceId: committee[on]!,
          title: `Task ${key}`,
          status: 'PENDING',
          ...data,
        } as never,
      });
      if (assignee) await prisma.taskAssignee.create({ data: { taskId: t.id, userId: assignee, assignedById: user['creator']! } });
      task[key] = t.id;
      onCommittee[key] = on;
    };
    await mkTask('root', 'ROOT', {}, user['assignee']);
    await mkTask('dept', 'DEPT', {}, user['assignee']);
    await mkTask('ward', 'WARD', {}, user['assignee']);
    await mkTask('sib', 'SIB', {}, user['assignee']);
    await mkTask('unassigned', 'DEPT', { status: 'UNASSIGNED' });
    await mkTask('pool', 'WARD', { assignedOrgUnitId: unit['WARD'], assignedPositionId: staff }); // poolMember is in it
    await mkTask('emptyPool', 'SIB', { assignedOrgUnitId: unit['SIB'], assignedPositionId: staff }); // nobody is
    await mkTask('request', 'ROOT', { status: 'IN_PROGRESS' }, user['assignee']);
    await prisma.taskRequest.create({
      data: { organizationId: A, taskId: task['request']!, type: 'EXTENSION', requestedById: user['assignee']!, reason: 'More time', requestedDueAt: new Date(now + 72 * HOUR) } as never,
    });
    await mkTask('departed', 'ROOT', { createdById: user['departed'] }, user['assignee']);

    const corruptCommittee = await mkCommittee('X', B, unit['DEPT']!);
    corruptTask = (
      await prisma.task.create({
        data: { organizationId: A, createdById: user['creator']!, sourceType: 'COMMITTEE', sourceId: corruptCommittee, title: 'Corrupt', status: 'PENDING' } as never,
      })
    ).id;

    taskB = (
      await prisma.task.create({
        data: { organizationId: B, createdById: user['outsider']!, sourceType: 'COMMITTEE', sourceId: committeeB, title: 'Theirs', status: 'UNASSIGNED' } as never,
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const ALL = ['root', 'dept', 'ward', 'sib', 'unassigned', 'pool', 'emptyPool', 'request', 'departed'];
  const keysOf = (ids: string[]) => ids.map((id) => Object.keys(task).find((k) => task[k] === id) ?? `?${id}`).sort();

  async function admitted(viewer: TaskViewer, organizationId = A): Promise<string[]> {
    const ctx = await rule.contextFor(viewer, organizationId);
    const ids: string[] = [];
    for (const k of ALL) if (await rule.isVisible(ctx, task[k]!)) ids.push(task[k]!);
    return keysOf(ids);
  }

  async function listed(viewer: TaskViewer, dto: Record<string, unknown>): Promise<{ keys: string[]; total: number } | 'FORBIDDEN'> {
    try {
      const r = await list.list({ take: 50, ...dto }, A, viewer);
      expect(r.total).toBe(r.matching); // no filters: the total is the rows
      expect(r.items.length).toBe(r.total);
      return { keys: keysOf(r.items.map((i) => i.id)), total: r.total };
    } catch (e) {
      if (e instanceof ForbiddenException) return 'FORBIDDEN';
      throw e;
    }
  }

  const as = (key: string, permissions: string[]): TaskViewer => ({ id: user[key]!, permissions });

  /** [label, viewer, the exact tasks the rule admits]. */
  const viewers: [string, () => TaskViewer, string[]][] = [
    ['relationship only: an assignee, with the record visible', () => as('assignee', [SEE]), ['root', 'dept', 'ward', 'sib', 'request', 'departed']],
    ['relationship only: the same assignee with NO key at all (Q1)', () => as('assignee', []), ['root', 'dept', 'ward', 'sib', 'request', 'departed']],
    ['relationship only: the creator', () => as('creator', [SEE]), ALL.filter((k) => k !== 'departed')],
    ['relationship only: a pool member, while the task waits', () => as('poolMember', [SEE]), ['pool']],
    ['View all tasks on committees', () => as('viewAll', [SEE, VIEW_ALL]), ALL],
    ['View all tasks WITHOUT committees:view (rule 1)', () => as('viewAll', [VIEW_ALL]), []],
    ['a head of a parent unit: their unit and its sub-units', () => as('deptHead', [SEE]), ['dept', 'ward', 'unassigned', 'pool']],
    ['the same head WITHOUT committees:view (rule 1)', () => as('deptHead', []), []],
    ['an acting head in force', () => as('actingNow', [SEE]), ['sib', 'emptyPool']],
    ['an acting head before their period starts', () => as('actingFuture', [SEE]), []],
    ['a View unit tasks holder: their primary unit and below', () => as('unitViewer', [SEE, VIEW_UNIT]), ['ward', 'pool']],
    ['the same unit without View unit tasks', () => as('unitViewer', [SEE]), []],
    ['a Manage tasks holder: unowned, open request, departed creator', () => as('manager', [SEE, MANAGE]), ['departed', 'emptyPool', 'request', 'unassigned']],
    ['Manage tasks WITHOUT committees:view (rule 1)', () => as('manager', [MANAGE]), []],
    ['nobody', () => as('nobody', [SEE]), []],
  ];

  for (const [label, viewer, expected] of viewers) {
    describe(label, () => {
      it('the rule admits exactly these tasks', async () => {
        expect(await admitted(viewer())).toEqual([...expected].sort());
      });

      it('LIST = ADMIT: each committee\'s list is the admitted tasks on it, and its total its rows', async () => {
        const v = viewer();
        for (const c of ['ROOT', 'DEPT', 'WARD', 'SIB']) {
          const answer = await listed(v, { sourceType: 'COMMITTEE', sourceId: committee[c] });
          const wanted = expected.filter((k) => onCommittee[k] === c).sort();
          if (!v.permissions.includes(SEE)) {
            // The record comes first: without its view permission, a 403 before any task.
            expect(answer).toBe('FORBIDDEN');
          } else {
            expect(answer).toEqual({ keys: wanted, total: wanted.length });
          }
        }
      });

      it('each saved view lists only admitted tasks, and exactly the ones it is for; GET views agrees', async () => {
        const v = viewer();
        const views = await list.views(A, v);
        const all = await listed(v, { view: 'all' });
        const unitView = await listed(v, { view: 'unit' });
        const unassigned = await listed(v, { view: 'unassigned' });
        for (const answer of [all, unitView, unassigned]) {
          if (answer !== 'FORBIDDEN') for (const k of answer.keys) expect(expected).toContain(k);
        }
        expect(all === 'FORBIDDEN').toBe(views.all === null);
        expect(unitView === 'FORBIDDEN').toBe(views.unit === null);
        expect(unassigned === 'FORBIDDEN').toBe(views.unassigned === null);
        if (all !== 'FORBIDDEN') expect(all.keys).toEqual([...ALL].sort());
        if (unassigned !== 'FORBIDDEN') expect(unassigned.keys).toEqual(['emptyPool', 'unassigned']);
      });
    });
  }

  it('Unit tasks for the head: the department and the ward, with the units it reaches as a facet', async () => {
    const v = as('deptHead', [SEE]);
    const answer = await list.list({ view: 'unit' }, A, v);
    expect(keysOf(answer.items.map((i) => i.id))).toEqual(['dept', 'pool', 'unassigned', 'ward']);
    expect(answer.facets?.units.map((u) => u.nameEn).sort()).toEqual(['DEPT', 'WARD']);
    const views = await list.views(A, v);
    expect(views.unit).toEqual({ types: ['COMMITTEE'], units: [{ id: unit['DEPT'], nameEn: 'DEPT', nameAr: null, via: 'HEAD' }] });
    // The Unit filter narrows to one owning unit in scope; one outside it matches nothing.
    const ward = await list.list({ view: 'unit', unit: unit['WARD'] }, A, v);
    expect(keysOf(ward.items.map((i) => i.id))).toEqual(['pool', 'ward']);
    const sib = await list.list({ view: 'unit', unit: unit['SIB'] }, A, v);
    expect(sib.items).toEqual([]);
  });

  it('the panel says scope all where the viewer sees every task on the record, and own elsewhere', async () => {
    const head = as('deptHead', [SEE]);
    expect((await list.panel({ sourceType: 'COMMITTEE', sourceId: committee['WARD']! }, A, head)).scope).toBe('all');
    expect((await list.panel({ sourceType: 'COMMITTEE', sourceId: committee['ROOT']! }, A, head)).scope).toBe('own');
    expect((await list.panel({ sourceType: 'COMMITTEE', sourceId: committee['ROOT']! }, A, as('viewAll', [SEE, VIEW_ALL]))).scope).toBe('all');
  });

  it(`${TENANT_ISOLATION_GATE_STRING} — the task visibility rule: another organisation's tasks, units and committees`, async () => {
    for (const [, viewer] of viewers) {
      const v = viewer();
      const ctx = await rule.contextFor(v, A);
      expect(await rule.isVisible(ctx, taskB)).toBe(false);
      for (const view of ['all', 'unit', 'unassigned'] as const) {
        const answer = await listed(v, { view });
        if (answer !== 'FORBIDDEN') expect(answer.keys).not.toContain(`?${taskB}`);
      }
      // Their units are never in this organisation's scope.
      expect(ctx.unitScope.flatMap((s) => s.unitIds)).not.toContain(unit['BROOT']);
    }
    // Even holding every key, a viewer in A never sees B's task; B's own outsider is not admitted in A.
    const everything = as('viewAll', [SEE, VIEW_ALL, MANAGE, VIEW_UNIT]);
    expect(await rule.isVisible(await rule.contextFor(everything, A), taskB)).toBe(false);
    expect(await rule.isVisible(await rule.contextFor({ id: user['outsider']!, permissions: [SEE, VIEW_ALL] }, A), taskB)).toBe(false);
    // A task in A naming another organisation's committee reaches nobody by a
    // key: not a head's unit scope (though that committee claims the head's
    // unit), not View all, not Manage — its record is not this organisation's.
    for (const v of [as('deptHead', [SEE]), as('viewAll', [SEE, VIEW_ALL]), as('manager', [SEE, MANAGE])]) {
      expect(await rule.isVisible(await rule.contextFor(v, A), corruptTask)).toBe(false);
    }
    // Its creator still sees it: a relationship needs no record (Q1).
    expect(await rule.isVisible(await rule.contextFor(as('creator', []), A), corruptTask)).toBe(true);
    // …and in B, its own viewer with View all does see it.
    expect(await rule.isVisible(await rule.contextFor({ id: user['outsider']!, permissions: [SEE, VIEW_ALL] }, B), taskB)).toBe(true);
  });
});
