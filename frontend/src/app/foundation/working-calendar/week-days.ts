/**
 * The week, as the working calendar numbers it — ACC-120 slice 1.
 *
 * `0 = Sunday … 6 = Saturday`, matching `WorkingCalendar.workingDays` and
 * `Date.getDay()`, so no arithmetic is needed to cross between them.
 *
 * Lifted out of `calendar-config.component.ts`, where it was a local const, when
 * the change history needed the same names to say "Working days: Sun, Mon, Tue,
 * Wed, Thu became Sun, Mon, Tue, Wed". Two copies of a day-name map is how the
 * settings page and its own history end up disagreeing about what day 5 is
 * called.
 *
 * NOT built from `Intl` here, deliberately. A weekday NAME for a real date goes
 * through `FormatService.weekday()`, which reads the tenant's time zone and the
 * UI language — that is the right mechanism for "what day is 23 Sep". These are
 * something else: labels for a fixed set of seven indices that are a
 * configuration value, not an instant. They are translation keys because they
 * are chrome, and they already exist in both files.
 */
export interface WeekDay {
  /** 0 = Sunday … 6 = Saturday. */
  readonly value: number;
  readonly labelKey: string;
}

export const WEEK_DAYS: readonly WeekDay[] = [
  { value: 0, labelKey: 'workingCalendar.daySun' },
  { value: 1, labelKey: 'workingCalendar.dayMon' },
  { value: 2, labelKey: 'workingCalendar.dayTue' },
  { value: 3, labelKey: 'workingCalendar.dayWed' },
  { value: 4, labelKey: 'workingCalendar.dayThu' },
  { value: 5, labelKey: 'workingCalendar.dayFri' },
  { value: 6, labelKey: 'workingCalendar.daySat' },
];

/**
 * The translation keys for a set of day indices, in week order.
 *
 * Week order, not the order the array arrived in: `workingDays` is a set, and
 * `[4, 0, 1]` and `[0, 1, 4]` are the same working week. Rendering them in
 * arrival order would make an unchanged configuration look changed.
 *
 * An index outside 0–6 is dropped rather than rendered as itself. It cannot
 * occur through the UI, and a history row is the wrong place to surface data
 * corruption as a stray number.
 */
export function weekDayLabelKeys(days: readonly number[]): string[] {
  return WEEK_DAYS.filter((d) => days.includes(d.value)).map((d) => d.labelKey);
}
