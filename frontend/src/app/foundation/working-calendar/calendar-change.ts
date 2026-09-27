import { weekDayLabelKeys } from './week-days';

/**
 * What changed in one recorded working-calendar edit — ACC-120 slice 1.
 *
 * Template 5's reset note says the change history records "your name and the
 * previous values", so a history that lists only date and actor is the one thing
 * the design says this is NOT. CLAUDE.md already records the same complaint
 * against workflow stage config: history that cannot say what was configured is
 * close to useless.
 *
 * ## The audited shape is small and fixed, whatever the column type says
 *
 * `AuditLog.before` / `.after` are `Json?`, which makes this look like a diff
 * over arbitrary data. It is not. Both sides are written by
 * `WorkingCalendarService.toInterface()`, so the shape is exactly
 * `IWorkingCalendar`, and only FOUR of its fields are mutable:
 * `timezone`, `workingDays`, `workingHoursStart`, `workingHoursEnd`. Untyped in
 * the column, fully known at the point it is read.
 *
 * ## THE WHITELIST IS LOAD-BEARING, not tidiness
 *
 * `toInterface()` writes the WHOLE interface, including `updatedAt` — which
 * changes on every single edit by definition. A diff over all keys would report
 * "updatedAt changed" on every row and bury the one field the reader cares
 * about, while `id`, `organizationId` and `createdAt` can never differ at all.
 * So the four fields are named, and anything else is ignored on purpose.
 *
 * Verified against the data before this was written: there are ZERO
 * `WorkingCalendar` audit rows today (the one calendar on dev has never been
 * edited), so there is no older `before`/`after` shape in the table to reconcile
 * — the risk that made this look expensive does not exist. `AuditLog` itself is
 * healthy: 294 rows across twelve object types.
 */
export interface CalendarFieldChange {
  /** Which field, as a translation key — chrome, so it follows the UI language. */
  readonly labelKey: string;
  /**
   * The value before and after, already rendered.
   *
   * `dayKeys` carries translation keys for a day set, because a component must
   * translate those itself; `text` is a value that is the same in any language
   * (a time of day, an IANA zone). Exactly one of the two is set, which is what
   * lets a template render both kinds without asking what a field is.
   */
  readonly from: ChangeValue;
  readonly to: ChangeValue;
}

export type ChangeValue =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'dayKeys'; readonly dayKeys: readonly string[] };

/** The four mutable fields, with the label each is shown under. */
const AUDITED_FIELDS = [
  { key: 'timezone', labelKey: 'workingCalendar.timezone' },
  { key: 'workingDays', labelKey: 'workingCalendar.workingDays' },
  { key: 'workingHoursStart', labelKey: 'workingCalendar.workingHoursStart' },
  { key: 'workingHoursEnd', labelKey: 'workingCalendar.workingHoursEnd' },
] as const;

/**
 * The fields that differ between two recorded states, in a fixed order.
 *
 * Fixed order — the order above, not the order the keys happen to appear in the
 * JSON — so two rows describing the same kind of edit read the same way.
 *
 * A field missing from one side is reported as a change only if the other side
 * has it. That is not defensive padding: `before` on the very first edit of a
 * calendar created before this field existed would legitimately lack it, and
 * showing "not set → Asia/Riyadh" is the truth in that case.
 */
export function diffCalendarChange(before: unknown, after: unknown): CalendarFieldChange[] {
  const a = asRecord(before);
  const b = asRecord(after);
  if (!a && !b) return [];

  const changes: CalendarFieldChange[] = [];
  for (const field of AUDITED_FIELDS) {
    const from = a?.[field.key];
    const to = b?.[field.key];
    if (sameValue(from, to)) continue;
    changes.push({
      labelKey: field.labelKey,
      from: renderValue(field.key, from),
      to: renderValue(field.key, to),
    });
  }
  return changes;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Whether two recorded values are the same.
 *
 * `workingDays` is a SET expressed as an array, so `[4, 0]` and `[0, 4]` are the
 * same working week — comparing them as arrays would report a change where a
 * user only reordered checkboxes.
 */
function sameValue(from: unknown, to: unknown): boolean {
  if (Array.isArray(from) && Array.isArray(to)) {
    const s = (xs: unknown[]): string => [...xs].sort().join(',');
    return s(from) === s(to);
  }
  return from === to;
}

function renderValue(key: string, value: unknown): ChangeValue {
  if (value === undefined || value === null) return { kind: 'text', text: '' };
  if (key === 'workingDays' && Array.isArray(value)) {
    return { kind: 'dayKeys', dayKeys: weekDayLabelKeys(value as number[]) };
  }
  return { kind: 'text', text: String(value) };
}
