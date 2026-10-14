/**
 * ACC-229 — A ROW'S ACTIONS AND THE TASK PAGE'S ARE THE SAME, against a REAL
 * Postgres (npm run test:db).
 *
 * Both call taskActionsFor(); what could drift is the FACTS each gathers. The
 * page asks one task at a time (isPoolMember, canActForCreator, its own
 * stillInStep); the list gathers them once per page (poolsOfUser,
 * creatorsCoveredBy, a batched stillInStep). This spec gives both services the
 * same tasks and the same viewers — a creator, a direct assignee, a pool
 * member, and a reader holding tasks:view and tasks:reassign — and requires
 * every row's actions to equal that task's page. The authority and pool rules
 * are the real ones on real rows; only the record check is a stub.
 * Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskPageService } from './task-page.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);
const DAY = 86_400_000;

describe('A row\'s actions equal its task page\'s (ACC-229)', () => {
  const prisma = new PrismaService();
  const authority = new TaskAuthorityService(prisma);
  // The real mayManage, on the real authority — the one rule both services call.
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const visibility = {
    assertCanView: () => Promise.resolve(),
    viewableTypes: () => ['COMMITTEE'],
  } as unknown as ObjectVisibilityService;
  const labels = { resolveMany: () => Promise.resolve(new Map()), lookup: () => null } as unknown as DelegationLabelService;
  const calendar = { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService;
  const page = new TaskPageService(prisma, visibility, labels, tasks, authority);
  const list = new TaskRecordListService(prisma, visibility, tasks, authority, calendar);

  let org = '';
  const record = `rec-${randomUUID().slice(0, 8)}`;
  const people: Record<'creator' | 'assignee' | 'member' | 'reader', string> = { creator: '', assignee: '', member: '', reader: '' };

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc229a-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Facilities', code: `F${slug.slice(-4)}` } });
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Engineer', grade: 3 } });
    const user = async (key: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...extra } })).id;
    people.creator = await user('creator');
    people.assignee = await user('assignee');
    people.member = await user('member', { positionId: position.id, primaryOrgUnitId: unit.id });
    people.reader = await user('reader');

    const task = async (data: Record<string, unknown>, assignee?: { userId: string; pickedAt?: Date; removedAt?: Date }) => {
      const t = await prisma.task.create({
        data: { organizationId: org, createdById: people.creator, sourceType: 'COMMITTEE', sourceId: record, title: 'T', ...data },
      });
      if (assignee) await prisma.taskAssignee.create({ data: { taskId: t.id, assignedById: people.creator, ...assignee } });
      return t.id;
    };
    const pool = { assignedOrgUnitId: unit.id, assignedPositionId: position.id };
    await task({ status: 'PENDING', dueAt: new Date(Date.now() - DAY) }, { userId: people.assignee });
    await task({ status: 'IN_PROGRESS', requiresEvidence: true }, { userId: people.assignee });
    await task({ status: 'PENDING', ...pool });
    await task({ status: 'IN_PROGRESS', ...pool }, { userId: people.member, pickedAt: new Date() });
    await task({ status: 'ON_HOLD', onHoldUntil: new Date(Date.now() + 3 * DAY), heldAt: new Date() }, { userId: people.assignee });
    await task({ status: 'COMPLETED', completedAt: new Date() }, { userId: people.assignee });
    await task({ status: 'CANCELLED', cancelledAt: new Date() });
    await task({ status: 'REJECTED', rejectedReason: 'Not mine' }, { userId: people.member, removedAt: new Date() });
    const asked = await task({ status: 'PENDING' }, { userId: people.assignee });
    await prisma.taskRequest.create({
      data: { organizationId: org, taskId: asked, type: 'EXTENSION', requestedById: people.assignee, reason: 'Lab', requestedDueAt: new Date(Date.now() + 5 * DAY) },
    });
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const viewers: [string, () => TaskViewer][] = [
    ['the creator (tasks:view)', () => ({ id: people.creator, permissions: ['committees:view', 'tasks:view'] })],
    ['a direct assignee (no task permissions)', () => ({ id: people.assignee, permissions: ['committees:view'] })],
    ['a pool member (no task permissions)', () => ({ id: people.member, permissions: ['committees:view'] })],
    // With tasks:view the task still WAITING in their pool is listed too, so Pick
    // up depends on the list knowing they are in it.
    ['a pool member with tasks:view', () => ({ id: people.member, permissions: ['committees:view', 'tasks:view'] })],
    ['a reader with tasks:view and tasks:reassign', () => ({ id: people.reader, permissions: ['committees:view', 'tasks:view', 'tasks:reassign'] })],
  ];

  for (const [who, viewer] of viewers) {
    it(`${who}: every row's actions equal the task page's`, async () => {
      const v = viewer();
      const rows = (await list.list({ sourceType: 'COMMITTEE', sourceId: record }, org, v)).items;
      expect(rows.length).toBeGreaterThan(0); // non-vacuity: there is something to compare
      if (v.id === people.member && v.permissions.includes('tasks:view')) {
        expect(rows.some((r) => r.actions.pickUp)).toBe(true); // the waiting pool task offers Pick up
      }
      for (const row of rows) {
        const view = await page.view(row.id, org, v);
        expect({ id: row.id, actions: row.actions }).toEqual({ id: row.id, actions: view.actions });
      }
    });
  }

  it('the reader sees every task, the others only their own (Q1), and each row admits its viewer to the page', async () => {
    const all = await list.list({ sourceType: 'COMMITTEE', sourceId: record }, org, viewers[4]![1]());
    expect(all.scope).toBe('all');
    expect(all.total).toBe(9);
    const own = await list.list({ sourceType: 'COMMITTEE', sourceId: record }, org, viewers[2]![1]());
    expect(own.scope).toBe('own');
    // The pool member was on two tasks (one picked, one later left).
    expect(own.total).toBe(2);
  });

  // Q1 (Ahmad, 14 Oct): the own variant is the tasks the viewer is or was ON,
  // and the tasks they CREATED — every one a task the page admits them to. A
  // creator on none of them still sees them all, with the actions the page
  // gives a manager.
  it("without tasks:view, a creator sees the tasks they created, with the page's actions (Q1)", async () => {
    const v = { id: people.creator, permissions: ['committees:view'] };
    const own = await list.list({ sourceType: 'COMMITTEE', sourceId: record }, org, v);
    expect(own.scope).toBe('own');
    expect(own.total).toBe(9);
    for (const row of own.items) {
      const view = await page.view(row.id, org, v);
      expect({ id: row.id, actions: row.actions }).toEqual({ id: row.id, actions: view.actions });
    }
  });
});
