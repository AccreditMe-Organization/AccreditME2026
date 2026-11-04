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
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { isWorkflowMade, workflowMadeSql } from './task-visibility';
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
  /** ACC-120 slice 3 — tasks covering all 8 combinations of the three workflow columns. */
  const combos: string[] = [];

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
    // ACC-244 — key-based access needs the record to be this organisation's,
    // so the tasks' committee is real.
    const owner = await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q${record.slice(-4)}`.toUpperCase() } });
    await prisma.committee.create({ data: { id: record, organizationId: org, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: owner.id } });
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
    // ACC-120 slice 3 — two cross-organisation rows that name THIS viewer: an
    // assignee row on B's task, and a B task the viewer is recorded as creating.
    await prisma.taskAssignee.create({ data: { taskId: foreign.id, userId: viewer, assignedById: b.creator } });
    const foreignCreated = await prisma.task.create({
      data: { organizationId: b.org, createdById: viewer, sourceType: 'COMMITTEE', sourceId: record, title: 'Foreign created', status: 'PENDING' },
    });
    id['foreignCreated'] = foreignCreated.id;

    // ACC-120 slice 3 — the 8 combinations of workflowInstanceStageId,
    // workflowInstanceId and sourceStageId being null or set, on a record id
    // no committee has (so no other count here sees them).
    const template = await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Combo', objectType: 'COMMITTEE' } });
    const stage = await prisma.workflowStage.create({ data: { workflowTemplateId: template.id, nameEn: 'Step', order: 1 } as never });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: `combo-${record}` } as never,
    });
    const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id } as never });
    for (let bits = 0; bits < 8; bits++) {
      const t = await prisma.task.create({
        data: {
          organizationId: org,
          createdById: a.creator,
          sourceType: 'COMMITTEE',
          sourceId: `combo-${record}`,
          title: `Combo ${bits}`,
          status: 'PENDING',
          workflowInstanceStageId: bits & 1 ? entry.id : null,
          workflowInstanceId: bits & 2 ? instance.id : null,
          sourceStageId: bits & 4 ? stage.id : null,
        } as never,
      });
      combos.push(t.id);
    }
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

  // ACC-120 slice 3 — the viewer's own views.
  it('My tasks lists exactly what getMyTasks() lists: the tasks the viewer is an active assignee on', async () => {
    const mine = await service.list({ view: 'mine' }, org, { id: viewer, permissions: [] });
    const expected = await prisma.task.findMany({
      where: { organizationId: org, assignees: { some: { userId: viewer, removedAt: null } } },
      select: { id: true },
    });
    // Non-vacuity: the viewer is on one task here.
    expect(expected.length).toBe(1);
    expect(mine.items.map((i) => i.id).sort()).toEqual(expected.map((t) => t.id).sort());
    expect(mine.view).toBe('mine');
  });

  itEnforcesTenantIsolation('record-list mine/created', async () => {
    const mine = await service.list({ view: 'mine' }, org, { id: viewer, permissions: [] });
    const created = await service.list({ view: 'created' }, org, { id: viewer, permissions: [] });
    // Non-vacuity: each view does list this organisation's own row.
    expect(keysOf(mine.items)).toEqual(['tomorrow']);
    expect(keysOf(created.items)).toEqual(['created']);
    for (const list of [mine, created]) {
      expect(list.items.map((i) => i.id)).not.toContain(id['foreign']);
      expect(list.items.map((i) => i.id)).not.toContain(id['foreignCreated']);
    }
  });

  it('workflowMadeSql() and isWorkflowMade() agree on all 8 combinations of the workflow columns', async () => {
    const sqlIds = await prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT t.id FROM "Task" t WHERE t."organizationId" = ${org} AND t.id IN (${Prisma.join(combos)}) AND ${workflowMadeSql()}`,
    );
    const rows = await prisma.task.findMany({
      where: { organizationId: org, id: { in: combos } },
      select: { id: true, workflowInstanceStageId: true, workflowInstanceId: true, sourceStageId: true },
    });
    const jsIds = rows.filter((r) => isWorkflowMade(r)).map((r) => r.id);
    // Non-vacuity: all 8 rows exist, and 7 of them (every one with a column set) are workflow-made.
    expect(rows.length).toBe(8);
    expect(jsIds.length).toBe(7);
    expect(sqlIds.map((r) => r.id).sort()).toEqual(jsIds.sort());
    expect(jsIds).not.toContain(combos[0]);
  });

  it('the filter options cover the whole scope', async () => {
    const list = await service.list(onRecord, org, { id: viewer, ...VIEW_ALL });
    expect(list.facets?.people).toEqual([{ id: viewer, name: 'Viewer Person' }]);
    const next = await service.list({ ...onRecord, skip: 5 }, org, { id: viewer, ...VIEW_ALL });
    expect(next.facets).toBeNull();
  });

  // ACC-120 slice 3 — the status chips' counts, record names and the search by
  // record name, on organisations of their own (C, and D pointing at C's
  // committee), so nothing above changes.
  describe('status counts, record names and search by record (ACC-120 slice 3)', () => {
    let orgC = '';
    let orgD = '';
    let creatorC = '';
    let viewerC = '';
    let assigneeC = '';
    let creatorD = '';
    const committeeC = `cq-${randomUUID().slice(0, 8)}`;
    const ids: Record<string, string> = {};
    let taskD = '';
    const VIEW_ALL_C = ['committees:view_all_tasks', 'committees:view'];
    const STATUSES = ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;

    beforeAll(async () => {
      const c = await newOrg();
      orgC = c.org;
      creatorC = c.creator;
      viewerC = c.viewer;
      assigneeC = (await prisma.user.create({ data: { organizationId: orgC, email: `${committeeC}-a@example.test`, name: 'Assignee Person' } })).id;
      const unitC = await prisma.orgUnit.create({ data: { organizationId: orgC, nameEn: 'Quality', code: `C${committeeC.slice(-4)}`.toUpperCase() } });
      await prisma.committee.create({
        data: { id: committeeC, organizationId: orgC, nameEn: 'Quality Committee', nameAr: 'لجنة الجودة', typeValueId: 'type', orgUnitId: unitC.id },
      });
      const make = async (key: string, data: Record<string, unknown>) => {
        const t = await prisma.task.create({
          data: { organizationId: orgC, createdById: creatorC, sourceType: 'COMMITTEE', sourceId: committeeC, title: `Step ${key}`, ...data } as never,
        });
        ids[key] = t.id;
      };
      await make('unassigned', { status: 'UNASSIGNED' });
      await make('pending1', { status: 'PENDING' });
      await make('pending2', { status: 'PENDING' });
      // A row stored before ACC-163's backfill: counted as Assigned.
      await make('legacyOverdue', { status: 'OVERDUE', dueAt: at(-3 * DAY) });
      await make('inProgress', { status: 'IN_PROGRESS' });
      await make('onHold', { status: 'ON_HOLD', onHoldUntil: at(4 * DAY) });
      await make('rejected', { status: 'REJECTED', rejectedReason: 'Not my unit', rejectedById: creatorC, rejectedAt: at(-DAY) });
      await make('completed', { status: 'COMPLETED', completedAt: at(-DAY) });
      await make('cancelled', { status: 'CANCELLED', cancelledAt: at(-DAY) });
      await prisma.taskAssignee.create({ data: { taskId: ids['pending1']!, userId: assigneeC, assignedById: creatorC } });

      // Organisation D: a task naming C's committee id.
      const d = await newOrg();
      orgD = d.org;
      creatorD = d.creator;
      taskD = (
        await prisma.task.create({
          data: { organizationId: orgD, createdById: creatorD, sourceType: 'COMMITTEE', sourceId: committeeC, title: 'Their task', status: 'PENDING' },
        })
      ).id;
    });

    const all = (dto: Record<string, unknown> = {}) => service.list({ view: 'all', ...dto }, orgC, { id: viewerC, permissions: VIEW_ALL_C });

    it('each status count equals the list filtered by that status', async () => {
      const counts = (await all()).facets!.statusCounts;
      for (const st of STATUSES) {
        const filtered = await all({ status: [st] });
        // The status is in the compared value, so a failure names it.
        expect([st, counts[st]]).toEqual([st, filtered.matching]);
      }
      // Non-vacuity: every task is counted, the legacy row among the Assigned.
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(9);
      expect(counts.PENDING).toBe(3);
    });

    it('the counts do not move with the search or the status filter', async () => {
      const base = (await all()).facets!.statusCounts;
      const narrowed = await all({ q: 'zzz-nothing', status: ['COMPLETED'] });
      expect(narrowed.matching).toBe(0); // non-vacuity: the filters did narrow
      expect(narrowed.facets!.statusCounts).toEqual(base);
    });

    it("finds the organisation's tasks by their committee's name, organisation-wide", async () => {
      const found = await all({ q: 'Quality Comm' });
      // No title says "Quality": the record's name is what matched.
      expect(found.matching).toBe(9);
      expect(found.items.every((i) => !i.title.includes('Quality'))).toBe(true);
      expect(found.items[0]!.record).toEqual({ type: 'COMMITTEE', id: committeeC, nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' });
    });

    it('a rejected row carries who rejected it', async () => {
      const list = await all({ status: ['REJECTED'] });
      expect(list.items.map((i) => i.id)).toEqual([ids['rejected']]);
      expect(list.items[0]!.rejectedBy).toEqual({ id: creatorC, name: 'Creator' });
    });

    // THE NAME GATE: on My tasks, which needs no key, the record's name — and a
    // search by it — reach only a viewer who may see the record's type.
    it('My tasks without committees:view: no name on the row, and a search by that name does not match it', async () => {
      const mine = await service.list({ view: 'mine' }, orgC, { id: assigneeC, permissions: [] });
      expect(mine.items.map((i) => i.id)).toEqual([ids['pending1']]);
      expect(mine.items[0]!.record).toEqual({ type: 'COMMITTEE', id: committeeC, nameEn: null, nameAr: null });
      const searched = await service.list({ view: 'mine', q: 'Quality Committee' }, orgC, { id: assigneeC, permissions: [] });
      expect(searched.items).toEqual([]);
    });

    it('…and the same viewer WITH committees:view sees the name, and the search matches', async () => {
      const seer = { id: assigneeC, permissions: ['committees:view'] };
      const mine = await service.list({ view: 'mine' }, orgC, seer);
      expect(mine.items[0]!.record).toEqual({ type: 'COMMITTEE', id: committeeC, nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' });
      const searched = await service.list({ view: 'mine', q: 'Quality Committee' }, orgC, seer);
      expect(searched.items.map((i) => i.id)).toEqual([ids['pending1']]);
    });

    itEnforcesTenantIsolation("record-list search by record name: another organisation's committee name never matches, and never names a row", async () => {
      const theirs = { id: creatorD, permissions: ['committees:view'] };
      // Non-vacuity: D's own task is on its Created by me list…
      const created = await service.list({ view: 'created' }, orgD, theirs);
      expect(created.items.map((i) => i.id)).toEqual([taskD]);
      // …with no name: the committee it points at is C's.
      expect(created.items[0]!.record).toEqual({ type: 'COMMITTEE', id: committeeC, nameEn: null, nameAr: null });
      // Searching for C's committee name from D finds nothing.
      const searched = await service.list({ view: 'created', q: 'Quality Committee' }, orgD, theirs);
      expect(searched.items).toEqual([]);
      // And C's own search never returns D's task.
      const fromC = await all({ q: 'Quality Committee' });
      expect(fromC.items.map((i) => i.id)).not.toContain(taskD);
    });
  });

});
