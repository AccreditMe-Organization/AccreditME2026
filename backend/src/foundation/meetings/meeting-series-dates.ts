import { DateTime } from 'luxon';

/**
 * ACC-316 PR 5 — a series' dates (plan step-316 §3.2), as plain functions:
 * the pattern's days, in Gregorian, on yyyy-MM-dd days; the titles. Moving a
 * day off a weekend, a holiday or a day the owner already meets is the
 * series service's, through WorkingCalendarService (the one home of working
 * days).
 */

export type SeriesEvery = 'WEEK_1' | 'WEEK_2' | 'MONTH_1' | 'MONTH_3' | 'MONTH_6' | 'MONTH_12';
export type SeriesOn = 'WEEKDAY' | 'DAY_OF_MONTH' | 'ORDINAL_WEEKDAY';
export type SeriesOrdinal = 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH' | 'LAST';

export interface SeriesPattern {
  every: SeriesEvery;
  onKind: SeriesOn;
  /** 1–7, Monday first (Luxon). */
  weekday?: number | null;
  dayOfMonth?: number | null;
  ordinal?: SeriesOrdinal | null;
  /** yyyy-MM-dd: the series starts on or after it. */
  firstDate: string;
  endsOn?: string | null;
  count?: number | null;
}

/** The most meetings a series makes: weekly for twelve months, both ends included. */
export const SERIES_MAX_MEETINGS = 53;

export type PatternProblem = 'MEETING_SERIES_PATTERN_INVALID' | 'MEETING_SERIES_END_REQUIRED' | 'MEETING_SERIES_TOO_LONG' | 'MEETING_SERIES_EMPTY';

export type PatternResult = { ok: true; days: string[] } | { ok: false; code: PatternProblem; field: string; limit?: string };

const day = (iso: string) => DateTime.fromISO(iso, { zone: 'UTC' });
const iso = (d: DateTime) => d.toISODate()!;
const ORDINAL_INDEX: Record<SeriesOrdinal, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, LAST: -1 };

/** The `n`th (or last) `weekday` of a month. */
function ordinalWeekday(monthStart: DateTime, weekday: number, ordinal: SeriesOrdinal): DateTime {
  const n = ORDINAL_INDEX[ordinal];
  if (n === -1) {
    const last = monthStart.endOf('month').startOf('day');
    return last.minus({ days: (last.weekday - weekday + 7) % 7 });
  }
  const first = monthStart.plus({ days: (weekday - monthStart.weekday + 7) % 7 });
  return first.plus({ weeks: n - 1 });
}

/**
 * The pattern's days, before any move: at most `limit` (yyyy-MM-dd, twelve
 * months ahead) and SERIES_MAX_MEETINGS. Refused, naming the field the
 * schedule form shows it under:
 *   PATTERN_INVALID  a weekly series on a day of the month or an ordinal, a
 *                    monthly one on a bare weekday, or a value missing;
 *   END_REQUIRED     exactly one of an end date and a count;
 *   TOO_LONG         the end date, or the count's last day, past the limit;
 *   EMPTY            no day at all (an end before the first one).
 */
export function patternDays(p: SeriesPattern, limit: string): PatternResult {
  const weekly = p.every === 'WEEK_1' || p.every === 'WEEK_2';
  const weekdayOk = p.weekday != null && p.weekday >= 1 && p.weekday <= 7;
  if (weekly && (p.onKind !== 'WEEKDAY' || !weekdayOk)) return { ok: false, code: 'MEETING_SERIES_PATTERN_INVALID', field: 'onKind' };
  if (!weekly && p.onKind === 'WEEKDAY') return { ok: false, code: 'MEETING_SERIES_PATTERN_INVALID', field: 'onKind' };
  if (p.onKind === 'DAY_OF_MONTH' && !(p.dayOfMonth != null && p.dayOfMonth >= 1 && p.dayOfMonth <= 31)) {
    return { ok: false, code: 'MEETING_SERIES_PATTERN_INVALID', field: 'dayOfMonth' };
  }
  if (p.onKind === 'ORDINAL_WEEKDAY' && (!p.ordinal || !weekdayOk)) return { ok: false, code: 'MEETING_SERIES_PATTERN_INVALID', field: 'ordinal' };
  if ((p.endsOn == null) === (p.count == null)) return { ok: false, code: 'MEETING_SERIES_END_REQUIRED', field: 'endsOn' };
  if (p.endsOn && p.endsOn > limit) return { ok: false, code: 'MEETING_SERIES_TOO_LONG', field: 'endsOn', limit };
  if (p.count != null && (p.count < 1 || p.count > SERIES_MAX_MEETINGS)) return { ok: false, code: 'MEETING_SERIES_TOO_LONG', field: 'count', limit };

  const first = day(p.firstDate);
  const months = weekly ? 0 : Number(p.every.slice('MONTH_'.length));
  const out: string[] = [];
  const wanted = p.count ?? SERIES_MAX_MEETINGS + 1;
  for (let k = 0; out.length < wanted && k < 400; k++) {
    let d: DateTime;
    if (weekly) {
      const start = first.plus({ days: (p.weekday! - first.weekday + 7) % 7 });
      d = start.plus({ weeks: k * (p.every === 'WEEK_2' ? 2 : 1) });
    } else {
      const month = first.startOf('month').plus({ months: k * months });
      d =
        p.onKind === 'DAY_OF_MONTH'
          ? month.set({ day: Math.min(p.dayOfMonth!, month.daysInMonth!) }) // a missing day falls on the month's last
          : ordinalWeekday(month, p.weekday!, p.ordinal!);
      if (d < first) continue;
    }
    const at = iso(d);
    if (p.endsOn && at > p.endsOn) break;
    if (at > limit) {
      // A count that runs past the limit is refused; an end date never gets here.
      return { ok: false, code: 'MEETING_SERIES_TOO_LONG', field: 'count', limit };
    }
    out.push(at);
  }
  if (out.length > SERIES_MAX_MEETINGS) return { ok: false, code: 'MEETING_SERIES_TOO_LONG', field: 'endsOn', limit };
  if (out.length === 0) return { ok: false, code: 'MEETING_SERIES_EMPTY', field: 'endsOn' };
  return { ok: true, days: out };
}

/**
 * A meeting's title in the series (plan §3.2, R4-1), in the organisation's
 * language: "subject · October 2026" for monthly and longer, from the
 * PATTERN's month (a moved meeting keeps it); "subject · 22 Oct 2026" for
 * weekly, from the day it is held. Latin digits.
 */
export function seriesTitle(subject: string, every: SeriesEvery, patternDay: string, heldOn: string, language: string): string {
  const ar = language === 'ar';
  const at = (d: string) => (ar ? day(d).reconfigure({ locale: 'ar', numberingSystem: 'latn' }) : day(d).setLocale('en-GB'));
  const suffix = every === 'WEEK_1' || every === 'WEEK_2' ? at(heldOn).toFormat(ar ? 'd LLLL yyyy' : 'd LLL yyyy') : at(patternDay).toFormat('LLLL yyyy');
  return `${subject} · ${suffix}`;
}
