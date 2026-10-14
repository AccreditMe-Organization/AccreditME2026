import { buildBriefingGroups, countsDescription, greetingAt, notificationLink, todayIn, GROUP_CAP, TITLE_CAP, BriefingSources } from './briefing-groups';

const ZONE = 'Asia/Riyadh'; // UTC+3
const NOW = new Date('2026-10-13T06:00:00Z'); // 09:00 in Riyadh

const task = (id: string, dueAt: string | null, status = 'PENDING', title = `Task ${id}`) => ({ id, title, status, dueAt: dueAt ? new Date(dueAt) : null });
const empty: BriefingSources = { myTasks: [], pool: [], decisions: [], notifications: [] };

describe('buildBriefingGroups (ACC-198)', () => {
  it('nothing at all → no groups (a quiet day)', () => {
    expect(buildBriefingGroups(empty, ZONE, NOW)).toEqual([]);
  });

  it('overdue leads, then due today — in the tenant\'s day, closed and later tasks left out', () => {
    const groups = buildBriefingGroups(
      {
        ...empty,
        myTasks: [
          task('late', '2026-10-12T10:00:00Z'),
          task('today-pm', '2026-10-13T13:00:00Z'), // 16:00 Riyadh
          task('today-late-night', '2026-10-13T20:59:00Z'), // 23:59 Riyadh — still today there
          task('tomorrow', '2026-10-13T21:00:00Z'), // 00:00 Riyadh tomorrow
          task('done', '2026-10-12T10:00:00Z', 'COMPLETED'),
          task('cancelled', '2026-10-12T10:00:00Z', 'CANCELLED'),
          task('held', '2026-10-12T10:00:00Z', 'ON_HOLD'), // a held task is never overdue (ACC-173)
          task('no-date', null),
        ],
      },
      ZONE,
      NOW,
    );
    expect(groups.map((g) => g.kind)).toEqual(['overdue', 'dueToday']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['late']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['today-pm', 'today-late-night']);
    expect(groups.flatMap((g) => g.items.map((i) => i.key))).toEqual(['T1', 'T2', 'T3']);
  });

  it('a rejected task is still open work', () => {
    const groups = buildBriefingGroups({ ...empty, myTasks: [task('r', '2026-10-12T10:00:00Z', 'REJECTED')] }, ZONE, NOW);
    expect(groups[0]!.items[0]!.id).toBe('r');
  });

  it('every group is capped, and titles are cut', () => {
    const many = Array.from({ length: 30 }, (_, i) => task(`t${i}`, '2026-10-01T00:00:00Z', 'PENDING', 'x'.repeat(300)));
    const groups = buildBriefingGroups({ ...empty, myTasks: many, pool: many }, ZONE, NOW);
    expect(groups.find((g) => g.kind === 'overdue')!.items).toHaveLength(GROUP_CAP.overdue);
    expect(groups.find((g) => g.kind === 'pool')!.items).toHaveLength(GROUP_CAP.pool);
    expect(groups[0]!.items[0]!.title.length).toBe(TITLE_CAP);
  });

  it('decisions, pool and new notifications, with links our code chose', () => {
    const groups = buildBriefingGroups(
      {
        myTasks: [],
        pool: [task('p1', '2026-10-20T10:00:00Z')],
        decisions: [
          { id: 'req1', type: 'EXTENSION', requestedDueAt: new Date('2026-10-20T00:00:00Z'), holdUntil: null, task: { id: 'tk', title: 'Update audit tool' } },
          { id: 'req2', type: 'ON_HOLD', requestedDueAt: null, holdUntil: new Date('2026-10-25T00:00:00Z'), task: { id: 'tk2', title: 'Ward rota' } },
        ],
        notifications: [
          { id: 'n1', titleEn: 'Mentioned', titleAr: 'إشارة', objectType: 'COMMITTEE', objectId: 'c1', createdAt: new Date('2026-10-13T01:00:00Z') },
          { id: 'n2', titleEn: 'Old', titleAr: null, objectType: 'Task', objectId: 't9', createdAt: new Date('2026-10-11T01:00:00Z') }, // older than 24 h
          { id: 'n3', titleEn: 'Allocated', titleAr: null, objectType: 'Organization', objectId: 'org', createdAt: new Date('2026-10-13T02:00:00Z') },
        ],
      },
      ZONE,
      NOW,
    );
    expect(groups.map((g) => g.kind)).toEqual(['decision', 'pool', 'notification']);
    const [decision, pool, notes] = groups;
    expect(decision!.items.map((i) => [i.key, i.link, i.requestedFor])).toEqual([
      ['R1', { target: 'task', id: 'tk' }, '2026-10-20T00:00:00.000Z'],
      ['R2', { target: 'task', id: 'tk2' }, '2026-10-25T00:00:00.000Z'],
    ]);
    expect(pool!.items[0]).toEqual(expect.objectContaining({ key: 'P1', link: { target: 'task', id: 'p1' } }));
    expect(notes!.items.map((i) => [i.key, i.id, i.link])).toEqual([
      ['N1', 'n1', { target: 'committee', id: 'c1' }],
      ['N2', 'n3', null],
    ]);
  });

  it('the log description is counts only — no titles', () => {
    const groups = buildBriefingGroups({ ...empty, myTasks: [task('late', '2026-10-12T10:00:00Z', 'PENDING', 'SECRET-TITLE')] }, ZONE, NOW);
    const description = countsDescription(groups);
    expect(description).toBe('Home briefing · 1 overdue, 0 due today, 0 decisions, 0 pool, 0 notifications');
    expect(description).not.toContain('SECRET-TITLE');
  });
});

describe('the tenant\'s day and greeting (ACC-94 D3, D6)', () => {
  it('today is bounded in the tenant\'s zone', () => {
    const { start, end } = todayIn(ZONE, NOW);
    expect(start.toISOString()).toBe('2026-10-12T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-13T20:59:59.999Z');
  });

  it('greets by the hour there', () => {
    expect(greetingAt(ZONE, new Date('2026-10-13T06:00:00Z'))).toBe('morning'); // 09:00
    expect(greetingAt(ZONE, new Date('2026-10-13T11:00:00Z'))).toBe('afternoon'); // 14:00
    expect(greetingAt(ZONE, new Date('2026-10-13T16:00:00Z'))).toBe('evening'); // 19:00
  });
});

describe('notificationLink', () => {
  it('links only where a screen exists', () => {
    expect(notificationLink('Task', 't')).toEqual({ target: 'task', id: 't' });
    expect(notificationLink('TaskRequest', 'r')).toEqual({ target: 'request', id: 'r' });
    expect(notificationLink('COMMITTEE', 'c')).toEqual({ target: 'committee', id: 'c' });
    expect(notificationLink('Organization', 'o')).toBeNull();
    expect(notificationLink(null, null)).toBeNull();
  });
});
