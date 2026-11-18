import { ITaskSlaTier, TaskSlaPriority } from '../../../tenant/services/tenant.service';

/**
 * What changed in one saved task SLA change — ACC-313.
 *
 * The audit row's `before` / `after` are the SECTION's fields for all four
 * priorities (TaskSlaPolicyService), so a row lists only the values that
 * differ. The shape is fixed, whatever the column type says: priorities and
 * fields are named here, and anything else in the JSON is ignored on purpose.
 */
export const TASK_SLA_PRIORITIES: readonly TaskSlaPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export type TaskSlaField = keyof ITaskSlaTier;
export const TASK_SLA_FIELDS: readonly TaskSlaField[] = [
  'dueAfterHours',
  'managerEscalationAfterHours',
  'headEscalationAfterHours',
];

export interface TaskSlaFieldChange {
  readonly priority: TaskSlaPriority;
  readonly field: TaskSlaField;
  /** null: the side did not hold this field (it was not part of the save). */
  readonly from: number | null;
  readonly to: number | null;
}

function valueAt(side: unknown, priority: TaskSlaPriority, field: TaskSlaField): number | null {
  const tier = (side as Record<string, unknown> | null)?.[priority];
  const value = (tier as Record<string, unknown> | null | undefined)?.[field];
  return typeof value === 'number' ? value : null;
}

/** The values that differ between `before` and `after`, priority by priority. */
export function diffTaskSlaChange(before: unknown, after: unknown): TaskSlaFieldChange[] {
  const changes: TaskSlaFieldChange[] = [];
  for (const priority of TASK_SLA_PRIORITIES) {
    for (const field of TASK_SLA_FIELDS) {
      const from = valueAt(before, priority, field);
      const to = valueAt(after, priority, field);
      if (from === null && to === null) continue;
      if (from !== to) changes.push({ priority, field, from, to });
    }
  }
  return changes;
}
