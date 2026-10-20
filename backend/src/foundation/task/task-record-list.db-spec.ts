/**
 * ACC-229 — a record's tasks, in order, against a REAL Postgres (npm run test:db).
 *
 * The order and the filters are SQL, so only a database can prove them: the
 * panel's five are the five most likely to need someone, Load more pages
 * through one stable order, a typed % is a percent sign and not a wildcard,
 * and another organisation's task on the same record id never appears. The
 * record check, the cover and mayManage are stubs; the statements and the
 * rows are real. Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskRecordListService } from './task-record-list.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const DAY = 24 * 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

describe('A record\'s tasks against a real database (ACC-229)', () => {
  const prisma = new PrismaService();
  // ACC-244 — the real task visibility rule; nobody covers anybody here.
  const service = new TaskRecordListService(
    prisma,
    { assertCanView: () => Promise.resolve() } as unknown as ObjectVisibilityService,
    { mayManage: () => Promise.resolve(false) } as unknown as TaskService,
    new TaskVisibilityService(prisma, { creatorsCoveredBy: () => Promise.resolve([]) } as unknown as TaskAuthorityService),
    { getEffectiveTimeZone: () => Promise.resolve('Asia/Riyadh') } as unknown as WorkingCalendarService,
  );

  let org = '';
  let viewer = '';
  const record = `rec-${randomUUID().slice(0, 8)}`;
  const id: Record<string, string> = {};
  const VIEW_ALL = { permissions: ['committees:view_all_tasks', 'committees:view'] };

  async function newOrg(): Promise<{ org: string; creator: string; viewer: string }> {
    const slug = `acc229-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    const c = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-c@example.test`, name: 'Creator' } });
    const v = await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-v@example.test`, name: 'Viewer Person' } });
    return { org: o.id, creator: c.id, viewer: v.id };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
    const a = await newOrg();
    org = a.org;
    viewer = a.viewer;
    const make = async (key: string, data: Record<string, unknown>, sourceType: 'COMMITTEE' | 'MEETING' = 'COMMITTEE') => {
      const t = await prisma.task.create({
        data: { organizationId: org, createdById: a.creator, sourceType, sourceId: record, title: `Task ${key}`, ...data },
      });
      id[key] = t.id;
    };
    await make('overdue', { status: 'PENDING', dueAt: at(-2 * DAY) });
    await make('tomorrow', { status: 'IN_PROGRESS', dueAt: at(DAY) });
    await make('later', { status: 'PENDING', dueAt: at(10 * DAY), title: 'Reach 50%_done of audits' });
    await make('undated', { status: 'PENDING', title: 'Collect 500 signatures' });
    await make('held', { status: 'ON_HOLD', dueAt: at(-5 * DAY), onHoldUntil: at(3 * DAY) });
    await make('doneRecently', { status: 'COMPLETED', dueAt: at(-DAY), completedAt: at(-60 * 60 * 1000) });
    await make('cancelled', { status: 'CANCELLED', cancelledAt: at(-3 * DAY) });
    await make('doneEarlier', { status: 'COMPLETED', completedAt: at(-2 * DAY) });
    // On a meeting with the SAME id: a different record.
    await make('meeting', { status: 'PENDING', dueAt: at(-9 * DAY) }, 'MEETING');
    // One the viewer CREATED and is not on (Q1's own list includes it).
    const mine = await prisma.task.create({
      data: { organizationId: org, createdById: viewer, sourceType: 'COMMITTEE', sourceId: record, title: 'Task created', status: 'PENDING', dueAt: at(20 * DAY) },
    });
    id['created'] = mine.id;

    // The viewer is on "tomorrow" now, and WAS on "later".
    await prisma.taskAssignee.create({ data: { taskId: id['tomorrow']!, userId: viewer, assignedById: a.creator } });
    await prisma.taskAssignee.create({ data: { taskId: id['later']!, userId: viewer, assignedById: a.creator, removedAt: at(-DAY) } });

    // Another organisation, the same record id and an overdue task: never seen from here.
    const b = await newOrg();
    const foreign = await prisma.task.create({
      data: { organizationId: b.org, createdById: b.creator, sourceType: 'COMMITTEE', sourceId: record, title: 'Foreign', dueAt: at(-30 * DAY) },
    });
    id['foreign'] = foreign.id;
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  const ORDER = ['overdue', 'tomorrow', 'later', 'created', 'undated', 'held', 'doneRecently', 'doneEarlier', 'cancelled'];
  const keysOf = (items: { id: string }[]) => items.map((i) => Object.keys(id).find((k) => id[k] === i.id));
  const onRecord = { sourceType: 'COMMITTEE' as const, sourceId: record };

  it('orders open by soonest due (overdue first, undated last), then on hold, then the most recently closed', async () => {
    const list = await service.list(onRecord, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(list.items)).toEqual(ORDER);
    expect(list.total).toBe(9);
    expect(list.matching).toBe(9);
  });

  it('the panel is the first five of that order, with the full total', async () => {
    const panel = await service.panel(onRecord, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(panel.rows)).toEqual(ORDER.slice(0, 5));
    expect(panel.total).toBe(9);
  });

  it('Load more pages through ONE order — no repeats, no gaps', async () => {
    const pages = [];
    for (let skip = 0; skip < 9; skip += 3) {
      pages.push(...(await service.list({ ...onRecord, take: 3, skip }, org, { id: viewer, ...VIEW_ALL })).items);
    }
    expect(keysOf(pages)).toEqual(ORDER);
  });

  it('finds a task\'s place under the current sort (the ?task= deep link)', async () => {
    const list = await service.list({ ...onRecord, take: 5, around: id['doneEarlier'] }, org, { id: viewer, ...VIEW_ALL });
    expect(list.aroundIndex).toBe(7);
  });

  it('should NOT return records belonging to a different tenant', async () => {
    const list = await service.list(onRecord, org, { id: viewer, ...VIEW_ALL });
    expect(list.items.map((i) => i.id)).not.toContain(id['foreign']);
    const everywhere = await service.list({}, org, { id: viewer, ...VIEW_ALL });
    expect(everywhere.items.map((i) => i.id)).not.toContain(id['foreign']);
  });

  it('without View all tasks, only the tasks the viewer is or was on, or created (the rule\'s relationships)', async () => {
    const list = await service.list(onRecord, org, { id: viewer, permissions: ['committees:view'] });
    expect(list.scope).toBe('own');
    // "tomorrow" they are on, "later" they were on, "created" they created.
    expect(keysOf(list.items)).toEqual(['tomorrow', 'later', 'created']);
    expect(list.total).toBe(3);
  });

  it('filters: overdue is a flag on open work, never on hold; Mine is the viewer now', async () => {
    const overdue = await service.list({ ...onRecord, overdue: true }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(overdue.items)).toEqual(['overdue']);
    expect(overdue.total).toBe(9);
    expect(overdue.matching).toBe(1);
    const mine = await service.list({ ...onRecord, mine: true }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(mine.items)).toEqual(['tomorrow']);
    const done = await service.list({ ...onRecord, status: ['COMPLETED'] }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(done.items)).toEqual(['doneRecently', 'doneEarlier']);
  });

  it('search: a typed % is a percent sign, and assignees are found by name', async () => {
    const pct = await service.list({ ...onRecord, q: '50%' }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(pct.items)).toEqual(['later']);
    const person = await service.list({ ...onRecord, q: 'viewer pers' }, org, { id: viewer, ...VIEW_ALL });
    // The viewer is an ACTIVE assignee only on "tomorrow".
    expect(keysOf(person.items)).toEqual(['tomorrow']);
  });

  it('due: undated, and later than the coming week', async () => {
    const none = await service.list({ ...onRecord, due: 'NONE' }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(none.items)).toEqual(['undated', 'doneEarlier', 'cancelled']);
    const later = await service.list({ ...onRecord, due: 'LATER' }, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(later.items)).toEqual(['later', 'created']);
  });

  it('every sort is total: reversing the title sort reverses the list exactly', async () => {
    const asc = await service.list({ ...onRecord, sort: 'title', dir: 'asc' }, org, { id: viewer, ...VIEW_ALL });
    const desc = await service.list({ ...onRecord, sort: 'title', dir: 'desc' }, org, { id: viewer, ...VIEW_ALL });
    expect(desc.items.map((i) => i.id)).toEqual([...asc.items.map((i) => i.id)].reverse());
  });

  it('All tasks lists the record types View all tasks is held on, and names each record', async () => {
    const committees = await service.list({}, org, { id: viewer, ...VIEW_ALL });
    expect(keysOf(committees.items)).not.toContain('meeting');
    expect(committees.total).toBe(9);
    expect(committees.view).toBe('all');
    expect(committees.facets?.recordTypes).toEqual(['COMMITTEE']);
    // A meeting has no task keys yet (ACC-244 §2.2): seeing meetings adds nothing.
    const withMeetings = await service.list({}, org, { id: viewer, permissions: [...VIEW_ALL.permissions, 'meetings:view'] });
    expect(keysOf(withMeetings.items)).not.toContain('meeting');
  });

  it('the filter options cover the whole scope', async () => {
    const list = await service.list(onRecord, org, { id: viewer, ...VIEW_ALL });
    expect(list.facets?.people).toEqual([{ id: viewer, name: 'Viewer Person' }]);
    const next = await service.list({ ...onRecord, skip: 5 }, org, { id: viewer, ...VIEW_ALL });
    expect(next.facets).toBeNull();
  });
});
