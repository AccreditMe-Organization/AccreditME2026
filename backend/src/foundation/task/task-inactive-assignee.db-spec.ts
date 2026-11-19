/**
 * ACC-315 — the task page and the list rows read ACC-86's one rule for "someone
 * is on it" (CURRENT_ACTIVE_ASSIGNEE), against a REAL Postgres (npm run test:db).
 *
 * A pool task whose only current row is held by someone no longer ACTIVE has
 * nobody on it: it waits for its pool, and offers Pick up on its page and on its
 * row, as POST /pick accepts. The same task held by an ACTIVE person offers
 * none (non-vacuity). The list's name search, Assignee filter and Assignee
 * options leave out the inactive person too. The status filter is a database
 * condition, so only a database proves it.
 * Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { TaskPageService } from './task-page.service';
import { TaskAdmissionService } from './task-admission.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe('A task held only by someone no longer ACTIVE has nobody on it, on the page and in the list (ACC-315)', () => {
  const prisma = new PrismaService();
  const authority = new TaskAuthorityService(prisma);
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const visibility = { assertCanView: () => Promise.resolve() } as unknown as ObjectVisibilityService;
  const rule = new TaskVisibilityService(prisma, authority);
  const labels = { resolveMany: () => Promise.resolve(new Map()), lookup: () => null } as unknown as DelegationLabelService;
  const calendar = { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService;
  const page = new TaskPageService(prisma, labels, new TaskAdmissionService(prisma, visibility, tasks, rule));
  const list = new TaskRecordListService(prisma, visibility, tasks, rule, calendar);

  let org = '';
  const record = `rec-${randomUUID().slice(0, 8)}`;
  const ids = { creator: '', member: '', left: '', busy: '', heldByLeft: '', heldByBusy: '' };
  const LEFT_NAME = `Departed ${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc315-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Facilities', code: `F${slug.slice(-4)}` } });
    await prisma.committee.create({ data: { id: record, organizationId: org, nameEn: 'Facilities Committee', typeValueId: 'type', orgUnitId: unit.id } });
    const position = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Engineer', grade: 3 } });
    const user = async (key: string, extra: Record<string, unknown> = {}) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...extra } })).id;
    const inPool = { positionId: position.id, primaryOrgUnitId: unit.id };
    ids.creator = await user('creator');
    ids.member = await user('member', inPool);
    ids.busy = await user('busy', inPool);
    // Left the organisation partway: still holding a current row, no longer ACTIVE.
    ids.left = await user(LEFT_NAME, { ...inPool, status: 'INACTIVE' });

    const poolTask = async (holder: string) => {
      const t = await prisma.task.create({
        data: {
          organizationId: org,
          createdById: ids.creator,
          sourceType: 'COMMITTEE',
          sourceId: record,
          title: `Held by ${holder === ids.left ? 'the departed' : 'busy'}`,
          status: 'PENDING',
          assignedOrgUnitId: unit.id,
          assignedPositionId: position.id,
        },
      });
      await prisma.taskAssignee.create({ data: { taskId: t.id, userId: holder, assignedById: ids.creator, pickedAt: new Date() } });
      return t.id;
    };
    ids.heldByLeft = await poolTask(ids.left);
    ids.heldByBusy = await poolTask(ids.busy);
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const member = (): TaskViewer => ({ id: ids.member, permissions: ['committees:view', 'committees:view_all_tasks'] });

  it('its page offers Pick up to a pool member; held by an ACTIVE person, it does not', async () => {
    const left = await page.view(ids.heldByLeft, org, member());
    expect(left.actions.pickUp).toBe(true);
    expect(left.poolMemberCount).not.toBeNull(); // waiting in its pool
    const busy = await page.view(ids.heldByBusy, org, member());
    expect(busy.actions.pickUp).toBe(false);
    expect(busy.poolMemberCount).toBeNull();
  });

  it('its row says the same: waiting in its pool, with Pick up', async () => {
    const rows = (await list.list({ sourceType: 'COMMITTEE', sourceId: record }, org, member())).items;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.size).toBe(2); // non-vacuity: both tasks are listed
    expect([byId.get(ids.heldByLeft)!.waitingInPool, byId.get(ids.heldByLeft)!.actions.pickUp]).toEqual([true, true]);
    expect([byId.get(ids.heldByBusy)!.waitingInPool, byId.get(ids.heldByBusy)!.actions.pickUp]).toEqual([false, false]);
  });

  it('the search by name, the Assignee filter and its options leave out the person no longer ACTIVE', async () => {
    const scope = { sourceType: 'COMMITTEE' as const, sourceId: record };
    expect((await list.list({ ...scope, q: LEFT_NAME }, org, member())).items).toEqual([]);
    expect((await list.list({ ...scope, assignee: ids.left }, org, member())).items).toEqual([]);
    // Non-vacuity: the ACTIVE holder is found both ways.
    expect((await list.list({ ...scope, q: 'busy' }, org, member())).items.map((r) => r.id)).toEqual([ids.heldByBusy]);
    expect((await list.list({ ...scope, assignee: ids.busy }, org, member())).items.map((r) => r.id)).toEqual([ids.heldByBusy]);
    const people = (await list.list(scope, org, member())).facets!.people.map((p) => p.id);
    expect(people).toEqual([ids.busy]);
  });
});
