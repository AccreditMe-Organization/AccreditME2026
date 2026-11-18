/**
 * ACC-216 (plan step-216 §5.3, Option A) — A PERSON'S TASKS ARE THE VIEWER'S OWN
 * RULE, FILTERED TO THE PERSON, against a REAL Postgres (npm run test:db).
 *
 * For five kinds of viewer, the person scope (`GET /tasks/record-list?person=`)
 * must list EXACTLY the tasks the person is an ACTIVE assignee on that the
 * viewer's task page admits — checked row by row against
 * TaskAdmissionService.load(), the page's own admission. So nobody gains access:
 * every listed task opens, and every task that opens is listed.
 *
 * The rule, the headship and the pools are the real ones on real rows; only the
 * committee record check is a stub. Fails, never skips, without a local
 * database, and refuses any database that is not on this machine (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { TaskAdmissionService } from './task-admission.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

describe("A person's tasks: the viewer's own rule, filtered to the person (ACC-216)", () => {
  const prisma = new PrismaService();
  const authority = new TaskAuthorityService(prisma);
  const tasks = { mayManage: TaskService.prototype.mayManage.bind({ prisma, authority }) } as unknown as TaskService;
  const records = { assertCanView: () => Promise.resolve(), canView: () => Promise.resolve(true) } as unknown as ObjectVisibilityService;
  const rule = new TaskVisibilityService(prisma, authority);
  const calendar = { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService;
  const admission = new TaskAdmissionService(prisma, records, tasks, rule);
  const list = new TaskRecordListService(prisma, records, tasks, rule, calendar);

  let org = '';
  let otherOrg = '';
  const people = { person: '', viewAll: '', head: '', related: '', member: '', gone: '' };
  /** ACC-86 — a task a deactivated person still holds a current row on. */
  let leftover = '';
  /** Every task the person is ON (an active assignee), in this organisation. */
  const onTasks: string[] = [];

  beforeAll(async () => {
    await prisma.onModuleInit();
    const slug = `acc216t-${randomUUID().slice(0, 8)}`;
    org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    otherOrg = (await prisma.organization.create({ data: { name: `${slug}-b`, slug: `${slug}-b`, country: 'SA' } })).id;

    // Two units: the head's (Medicine, with a sub-unit) and another (Surgery).
    const medicine = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Medicine', code: `M${slug.slice(-4)}` } });
    const ward = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Ward', code: `W${slug.slice(-4)}`, parentId: medicine.id } });
    const surgery = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Surgery', code: `S${slug.slice(-4)}` } });
    const headPosition = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Head', grade: 9, isUnitHeadPosition: true } });
    const nurse = await prisma.orgPosition.create({ data: { organizationId: org, nameEn: 'Nurse', grade: 3 } });
    const committee = async (orgUnitId: string, o = org) =>
      (await prisma.committee.create({ data: { organizationId: o, nameEn: `C-${randomUUID().slice(0, 6)}`, typeValueId: 'type', orgUnitId } })).id;
    const wardCommittee = await committee(ward.id);
    const surgeryCommittee = await committee(surgery.id);

    const user = async (key: string, extra: Record<string, unknown> = {}, o = org) =>
      (await prisma.user.create({ data: { organizationId: o, email: `${slug}-${key}@example.test`, name: key, status: 'ACTIVE', ...extra } })).id;
    people.person = await user('person');
    people.viewAll = await user('view-all');
    people.head = await user('head', { positionId: headPosition.id, primaryOrgUnitId: medicine.id });
    people.related = await user('related');
    people.member = await user('member', { positionId: nurse.id, primaryOrgUnitId: ward.id });
    // Deactivated, with a row left current (a departure that stopped partway).
    people.gone = await user('gone', { status: 'INACTIVE' });

    const task = async (sourceId: string, data: Record<string, unknown>, assignees: Array<{ userId: string; removedAt?: Date; pickedAt?: Date }>, o = org) => {
      const t = await prisma.task.create({
        data: { organizationId: o, createdById: people.viewAll, sourceType: 'COMMITTEE', sourceId, title: 'T', status: 'PENDING', ...data },
      });
      for (const a of assignees) await prisma.taskAssignee.create({ data: { taskId: t.id, assignedById: people.viewAll, ...a } });
      return t.id;
    };

    // The person is ON these (active assignee rows):
    onTasks.push(await task(wardCommittee, {}, [{ userId: people.person }])); // on the head's sub-unit
    onTasks.push(await task(surgeryCommittee, {}, [{ userId: people.person }])); // outside the head's units
    onTasks.push(await task(surgeryCommittee, { createdById: people.related }, [{ userId: people.person }])); // the related viewer created it
    onTasks.push(await task(wardCommittee, { status: 'IN_PROGRESS' }, [{ userId: people.person }, { userId: people.member }])); // shared with the pool member
    onTasks.push(
      await task(wardCommittee, { status: 'IN_PROGRESS', assignedOrgUnitId: ward.id, assignedPositionId: nurse.id }, [
        { userId: people.person, pickedAt: new Date() },
      ]),
    ); // a pool task the person picked
    onTasks.push(await task(surgeryCommittee, { status: 'COMPLETED', completedAt: new Date() }, [{ userId: people.person }])); // closed, still theirs

    leftover = await task(surgeryCommittee, {}, [{ userId: people.gone }]);

    // NOT on these: removed from one, never on the other, and another
    // organisation's task carrying the person's id.
    await task(wardCommittee, {}, [{ userId: people.person, removedAt: new Date() }]);
    await task(surgeryCommittee, {}, [{ userId: people.member }]);
    const foreignUnit = await prisma.orgUnit.create({ data: { organizationId: otherOrg, nameEn: 'Elsewhere', code: `E${slug.slice(-4)}` } });
    const foreignCommittee = await committee(foreignUnit.id, otherOrg);
    const foreignCreator = await user('foreign', {}, otherOrg);
    const foreign = await prisma.task.create({
      data: { organizationId: otherOrg, createdById: foreignCreator, sourceType: 'COMMITTEE', sourceId: foreignCommittee, title: 'T', status: 'PENDING' },
    });
    await prisma.taskAssignee.create({ data: { taskId: foreign.id, assignedById: foreignCreator, userId: people.person } });
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  /** The tasks the person is on that the viewer's own task page admits. */
  async function admitted(v: TaskViewer): Promise<string[]> {
    const open: string[] = [];
    for (const id of onTasks) if (await admission.load(id, org, v, 'spec')) open.push(id);
    return open.sort();
  }

  const viewers: [string, () => TaskViewer, (all: string[]) => void][] = [
    [
      'View all tasks (committees), with users:view',
      () => ({ id: people.viewAll, permissions: ['users:view', 'committees:view', 'committees:view_all_tasks'] }),
      (ids) => expect(ids).toHaveLength(6),
    ],
    [
      "the head of Medicine (unit scope, sub-units included), with users:view",
      () => ({ id: people.head, permissions: ['users:view', 'committees:view'] }),
      // The three on the Ward committee (the head's sub-unit), not Surgery's.
      (ids) => expect(ids).toHaveLength(3),
    ],
    [
      'users:view and no task key: only what they are related to',
      () => ({ id: people.related, permissions: ['users:view', 'committees:view'] }),
      (ids) => expect(ids).toHaveLength(1), // the one they created
    ],
    [
      'the person themself, with no permission at all',
      () => ({ id: people.person, permissions: [] }),
      (ids) => expect(ids).toHaveLength(6),
    ],
    [
      'a pool member, with users:view',
      () => ({ id: people.member, permissions: ['users:view', 'committees:view'] }),
      // Only the task they share (the picked pool task no longer waits in their pool).
      (ids) => expect(ids).toHaveLength(1),
    ],
  ];

  for (const [who, viewer, sized] of viewers) {
    it(`${who}: exactly the person's tasks their own task page admits`, async () => {
      const v = viewer();
      const expected = await admitted(v);
      sized(expected); // non-vacuity: the case is the shape it claims
      const page = await list.list({ person: people.person, take: 50 }, org, v);
      expect(page.view).toBe('person');
      expect(page.items.map((r) => r.id).sort()).toEqual(expected);
      expect(page.total).toBe(expected.length);
      // And the panel's first five come from the same scope.
      const panel = await list.panel({ person: people.person }, org, v);
      expect(panel.total).toBe(expected.length);
      expect(panel.canCreate).toBe(false);
      for (const row of panel.rows) expect(expected).toContain(row.id);
    });
  }

  // ACC-86 — "on a task" is a current row AND an ACTIVE person (task-pool.ts). Someone
  // deactivated is on nothing, so their record lists no task, even to View all.
  it('a deactivated person with a leftover current row: no tasks, even for View all', async () => {
    const row = await prisma.taskAssignee.findFirst({ where: { taskId: leftover, userId: people.gone, removedAt: null } });
    expect(row).not.toBeNull(); // non-vacuity: the leftover current row exists
    const v = { id: people.viewAll, permissions: ['users:view', 'committees:view', 'committees:view_all_tasks'] };
    // Non-vacuity: View all may open the task itself, so an empty list is the person rule.
    expect(await admission.load(leftover, org, v, 'spec')).not.toBeNull();
    const page = await list.list({ person: people.gone, take: 50 }, org, v);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect((await list.panel({ person: people.gone }, org, v)).total).toBe(0);
  });

  it('should NOT return records belonging to a different tenant: another organisation\'s task carrying the person\'s id is never listed', async () => {
    const page = await list.list({ person: people.person, take: 50 }, org, { id: people.person, permissions: [] });
    const foreign = await prisma.task.findMany({ where: { organizationId: otherOrg }, select: { id: true } });
    expect(foreign.length).toBeGreaterThan(0); // non-vacuity
    for (const f of foreign) expect(page.items.map((r) => r.id)).not.toContain(f.id);
    expect(page.total).toBe(onTasks.length);
  });

  it("should NOT return records belonging to a different tenant: another organisation's committee task never reaches a View all holder", async () => {
    const v = { id: people.viewAll, permissions: ['users:view', 'committees:view', 'committees:view_all_tasks'] };
    const page = await list.list({ person: people.person, take: 50 }, org, v);
    const foreign = await prisma.task.findMany({ where: { organizationId: otherOrg, sourceType: 'COMMITTEE' }, select: { id: true } });
    expect(foreign.length).toBeGreaterThan(0); // non-vacuity
    for (const f of foreign) expect(page.items.map((r) => r.id)).not.toContain(f.id);
    expect(page.total).toBe(onTasks.length);
  });
});
