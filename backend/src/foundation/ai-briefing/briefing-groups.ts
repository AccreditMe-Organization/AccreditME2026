import { DateTime } from 'luxon';

/**
 * ACC-198 — the briefing's groups, items, dates and links, built by OUR code
 * from the caller's own work. The model never writes any of this: it only
 * sees the items under their keys (T1, R1, P1, N1) and may pick up to three
 * of those keys (D13).
 */

export type BriefingGroupKind = 'overdue' | 'dueToday' | 'decision' | 'pool' | 'notification';
export type BriefingItemType = 'TASK' | 'TASK_REQUEST' | 'NOTIFICATION';
/** Where an item links to — mapped to a route by the frontend's one function. */
export type BriefingLinkTarget = 'task' | 'request' | 'committee';

export interface IBriefingItem {
  /** The key the model saw (T1, R2, P1, N3). Unique within one briefing. */
  key: string;
  type: BriefingItemType;
  id: string;
  /** The record's own text, as stored. */
  title: string;
  /** A notification's Arabic title, when it has one. */
  titleAr?: string | null;
  dueAt?: string | null;
  /** TASK_REQUEST: EXTENSION or ON_HOLD, and the date asked for. */
  requestType?: string;
  requestedFor?: string | null;
  /** NOTIFICATION: when it arrived. */
  createdAt?: string;
  link: { target: BriefingLinkTarget; id: string } | null;
}

export interface IBriefingGroup {
  kind: BriefingGroupKind;
  items: IBriefingItem[];
}

/** The drawing's order: overdue leads, then due today, decisions, pool, new. */
export const GROUP_ORDER: readonly BriefingGroupKind[] = ['overdue', 'dueToday', 'decision', 'pool', 'notification'];
export const GROUP_CAP: Readonly<Record<BriefingGroupKind, number>> = { overdue: 10, dueToday: 10, decision: 10, pool: 5, notification: 10 };
export const TITLE_CAP = 120;
export const NOTIFICATION_WINDOW_HOURS = 24;

const CLOSED = new Set(['COMPLETED', 'CANCELLED']);

export interface BriefingTask {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
}
export interface BriefingRequest {
  id: string;
  type: string;
  requestedDueAt: Date | null;
  holdUntil: Date | null;
  task: { id: string; title: string };
}
export interface BriefingNotification {
  id: string;
  titleEn: string;
  titleAr: string | null;
  objectType: string | null;
  objectId: string | null;
  createdAt: Date;
}

export interface BriefingSources {
  myTasks: readonly BriefingTask[];
  pool: readonly BriefingTask[];
  decisions: readonly BriefingRequest[];
  notifications: readonly BriefingNotification[];
}

const cap = (text: string): string => (text.length > TITLE_CAP ? `${text.slice(0, TITLE_CAP - 1)}…` : text);
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** Today's bounds in the tenant's zone (ACC-94 D3) — never the server's or the browser's. */
export function todayIn(zone: string, now: Date): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(now).setZone(zone);
  return { start: local.startOf('day').toJSDate(), end: local.endOf('day').toJSDate() };
}

/** A notification links to its record only where a screen exists for it. */
export function notificationLink(objectType: string | null, objectId: string | null): IBriefingItem['link'] {
  if (!objectType || !objectId) return null;
  if (objectType === 'Task') return { target: 'task', id: objectId };
  if (objectType === 'TaskRequest') return { target: 'request', id: objectId };
  if (objectType === 'COMMITTEE') return { target: 'committee', id: objectId };
  return null;
}

/**
 * The groups, capped, in the drawing's order; empty groups dropped. Keys run
 * per letter (T for my tasks, R for requests, P for pool, N for
 * notifications), so the model never sees a record id.
 */
export function buildBriefingGroups(sources: BriefingSources, zone: string, now: Date): IBriefingGroup[] {
  const { start, end } = todayIn(zone, now);
  let t = 0;
  let r = 0;
  let p = 0;
  let n = 0;

  const open = sources.myTasks.filter((task) => !CLOSED.has(task.status));
  const isOverdue = (task: BriefingTask) => task.status !== 'ON_HOLD' && !!task.dueAt && task.dueAt.getTime() < now.getTime();
  const byDue = (a: BriefingTask, b: BriefingTask) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0);

  const taskItem = (task: BriefingTask, key: string): IBriefingItem => ({
    key,
    type: 'TASK',
    id: task.id,
    title: cap(task.title),
    dueAt: iso(task.dueAt),
    link: { target: 'task', id: task.id },
  });

  const overdue = open.filter(isOverdue).sort(byDue).slice(0, GROUP_CAP.overdue).map((task) => taskItem(task, `T${++t}`));
  const dueToday = open
    .filter((task) => !isOverdue(task) && !!task.dueAt && task.dueAt.getTime() >= start.getTime() && task.dueAt.getTime() <= end.getTime())
    .sort(byDue)
    .slice(0, GROUP_CAP.dueToday)
    .map((task) => taskItem(task, `T${++t}`));

  const decision = sources.decisions.slice(0, GROUP_CAP.decision).map(
    (req): IBriefingItem => ({
      key: `R${++r}`,
      type: 'TASK_REQUEST',
      id: req.id,
      title: cap(req.task.title),
      requestType: req.type,
      requestedFor: iso(req.type === 'ON_HOLD' ? req.holdUntil : req.requestedDueAt),
      link: { target: 'request', id: req.id },
    }),
  );

  const pool = sources.pool
    .filter((task) => !CLOSED.has(task.status))
    .sort(byDue)
    .slice(0, GROUP_CAP.pool)
    .map((task): IBriefingItem => ({ ...taskItem(task, `P${++p}`) }));

  const since = now.getTime() - NOTIFICATION_WINDOW_HOURS * 3_600_000;
  const notification = sources.notifications
    .filter((note) => note.createdAt.getTime() >= since)
    .slice(0, GROUP_CAP.notification)
    .map(
      (note): IBriefingItem => ({
        key: `N${++n}`,
        type: 'NOTIFICATION',
        id: note.id,
        title: cap(note.titleEn),
        titleAr: note.titleAr ? cap(note.titleAr) : null,
        createdAt: note.createdAt.toISOString(),
        link: notificationLink(note.objectType, note.objectId),
      }),
    );

  const all: Record<BriefingGroupKind, IBriefingItem[]> = { overdue, dueToday, decision, pool, notification };
  return GROUP_ORDER.map((kind) => ({ kind, items: all[kind] })).filter((g) => g.items.length > 0);
}

export function briefingItems(groups: readonly IBriefingGroup[]): Map<string, IBriefingItem> {
  return new Map(groups.flatMap((g) => g.items.map((i) => [i.key, i] as const)));
}

/** Counts only — the AI log's description (ACC-194 D5: no text). */
export function countsDescription(groups: readonly IBriefingGroup[]): string {
  const count = (kind: BriefingGroupKind) => groups.find((g) => g.kind === kind)?.items.length ?? 0;
  return `Home briefing · ${count('overdue')} overdue, ${count('dueToday')} due today, ${count('decision')} decisions, ${count('pool')} pool, ${count('notification')} notifications`;
}

/** The greeting by the time of day in the tenant's zone (D6). */
export function greetingAt(zone: string, now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = DateTime.fromJSDate(now).setZone(zone).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
