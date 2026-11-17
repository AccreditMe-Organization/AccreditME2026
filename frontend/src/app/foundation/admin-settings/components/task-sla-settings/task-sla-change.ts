import { ITaskSlaTier, TaskSlaPriority } from '../../../tenant/services/tenant.service';
import { isWarnBeforeDue } from './task-sla-warning';

/**
 * What changed in one saved task SLA change — ACC-313.
 *
 * The audit row's `before` / `after` take one of three shapes
 * (TaskSlaPolicyService), and a row lists only the values that differ:
 *   - a section save: each priority's section fields, the escalation save's
 *     carrying `warnBeforeDue` beside its hours (PR 4);
 *   - the due-date switch: `{ notifyOnDueChange }` (PR 3);
 *   - a reset: `{ tiers, notices }`, the whole policy before and the defaults
 *     after (PR 3).
 * The shape is fixed, whatever the column type says: priorities and fields are
 * named here, and anything else in the JSON is ignored on purpose.
 */
export const TASK_SLA_PRIORITIES: readonly TaskSlaPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export type TaskSlaField = keyof ITaskSlaTier | 'warnBeforeDue';
export const TASK_SLA_FIELDS: readonly TaskSlaField[] = [
  'dueAfterHours',
  'warnBeforeDue',
  'managerEscalationAfterHours',
  'headEscalationAfterHours',
];

export type TaskSlaValue = number | string | boolean;

export interface TaskSlaFieldChange {
  /** null for a setting of the whole policy (the due-date switch). */
  readonly priority: TaskSlaPriority | null;
  readonly field: TaskSlaField | 'notifyOnDueChange';
  /** null: the side did not hold this field (it was not part of the save). */
  readonly from: TaskSlaValue | null;
  readonly to: TaskSlaValue | null;
}

type Side = Record<string, unknown> | null;

function asObject(value: unknown): Side {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * One side as per-priority values plus the switch. A reset's side is
 * `{ tiers, notices }`: its tiers give the hours, its notices each priority's
 * warning and the switch.
 */
function normalise(side: unknown): { priorities: Side; notify: unknown } {
  const obj = asObject(side);
  if (!obj) return { priorities: null, notify: undefined };
  const tiers = asObject(obj['tiers']);
  if (!tiers) return { priorities: obj, notify: obj['notifyOnDueChange'] };
  const notices = asObject(obj['notices']);
  const warnings = asObject(notices?.['warnBeforeDue']);
  const priorities: Record<string, unknown> = {};
  for (const p of TASK_SLA_PRIORITIES) {
    priorities[p] = { ...(asObject(tiers[p]) ?? {}), ...(warnings && p in warnings ? { warnBeforeDue: warnings[p] } : {}) };
  }
  return { priorities, notify: notices?.['notifyOnDueChange'] };
}

/** A field's value, of that field's own type: hours are numbers, a warning one of its options. */
function valueAt(side: Side, priority: TaskSlaPriority, field: TaskSlaField): TaskSlaValue | null {
  const value = asObject(side?.[priority])?.[field];
  if (field === 'warnBeforeDue') return isWarnBeforeDue(value) ? value : null;
  return typeof value === 'number' ? value : null;
}

/** The values that differ between `before` and `after`: the switch first, then priority by priority. */
export function diffTaskSlaChange(before: unknown, after: unknown): TaskSlaFieldChange[] {
  const from = normalise(before);
  const to = normalise(after);
  const changes: TaskSlaFieldChange[] = [];

  const notifyFrom = typeof from.notify === 'boolean' ? from.notify : null;
  const notifyTo = typeof to.notify === 'boolean' ? to.notify : null;
  if ((notifyFrom !== null || notifyTo !== null) && notifyFrom !== notifyTo) {
    changes.push({ priority: null, field: 'notifyOnDueChange', from: notifyFrom, to: notifyTo });
  }

  for (const priority of TASK_SLA_PRIORITIES) {
    for (const field of TASK_SLA_FIELDS) {
      const a = valueAt(from.priorities, priority, field);
      const b = valueAt(to.priorities, priority, field);
      if (a === null && b === null) continue;
      if (a !== b) changes.push({ priority, field, from: a, to: b });
    }
  }
  return changes;
}

/**
 * CC-324 / CC-325 — the unit a saved change's ESCALATION hours were counted in.
 *
 * Escalation counts working hours since ACC-313 PR 4; before that it counted
 * clock hours, and an old row keeps its own unit ("8 clock hours"). The audit
 * row records no unit, so the row's own shape says which:
 *   - an escalation save that carries `warnBeforeDue` was written by PR 4's
 *     code (the only writer of it, and this screen always sends it): working;
 *   - a reset is only offered by this screen, which ships after PR 4: working;
 *   - any other row (an escalation save without warnings, the old whole-policy
 *     save): clock.
 * Limits were always working hours and are not asked about here.
 */
export function escalationHoursUnit(change: { kind: string; before: unknown; after: unknown }): 'working' | 'clock' {
  if (change.kind === 'reset') return 'working';
  if (change.kind !== 'escalation') return 'clock';
  const carriesWarning = (side: unknown) =>
    TASK_SLA_PRIORITIES.some((p) => {
      const tier = asObject(asObject(side)?.[p]);
      return !!tier && 'warnBeforeDue' in tier;
    });
  return carriesWarning(change.before) || carriesWarning(change.after) ? 'working' : 'clock';
}
