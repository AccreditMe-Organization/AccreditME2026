import type { TranslateService } from '@ngx-translate/core';
import type { FormatService } from '../../core/formatting';
import type { MeetingSeriesDto, MeetingSeriesEvery, MeetingSeriesOnKind, MeetingSeriesOrdinal, MeetingSeriesPattern } from './services/meeting.service';

/**
 * ACC-316 PR 8b — HOW A SERIES' PATTERN READS, in ONE place: the meeting
 * header's series line and the whole-series view now, and Schedule's step 2
 * (Repeat, PR 8a) from the same mapping, never a second copy.
 *
 *   the mapping  every value the server stores (SERIES_EVERY, SERIES_ON,
 *                SERIES_ORDINAL in the backend's meeting.dto.ts) and each
 *                weekday (1 Monday … 7 Sunday, as Luxon numbers them), each
 *                with the key it reads by: Repeat's choices are these lists;
 *   the pattern  "Every month, the 4th Thursday" (seriesPattern);
 *   the line     the header's "… · 4 of 12", or after End series "Every month
 *                · ended after 4 of 12" (P239, Q11: one key pair,
 *                meeting.series.ended, so a different answer is a one-line change).
 *
 * Words are translations and numbers go through the format layer (Latin
 * digits, ACC-94); nothing here computes a date or a neighbour.
 */
export const SERIES_EVERY: readonly MeetingSeriesEvery[] = ['WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12'];
export const SERIES_ON_KINDS: readonly MeetingSeriesOnKind[] = ['WEEKDAY', 'DAY_OF_MONTH', 'ORDINAL_WEEKDAY'];
export const SERIES_ORDINALS: readonly MeetingSeriesOrdinal[] = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST'];
export const SERIES_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

type Words = Pick<TranslateService, 'instant'>;
type Numbers = Pick<FormatService, 'number'>;

/** "Every month" (Every's own label in Repeat, and the first half of every pattern). */
export function seriesEvery(every: MeetingSeriesEvery, t: Words): string {
  return t.instant(`meeting.series.every.${every}`) as string;
}

/** "Thursday": a weekday by its number. */
export function seriesWeekday(weekday: number, t: Words): string {
  return t.instant(`meeting.series.weekday.${weekday}`) as string;
}

/** "4th", "last": an ordinal's word. */
export function seriesOrdinal(ordinal: MeetingSeriesOrdinal, t: Words): string {
  return t.instant(`meeting.series.ordinal.${ordinal}`) as string;
}

/**
 * "Every month, the 4th Thursday", "Every week on Monday", "Every month on day
 * 31": how often, and on which day. A pattern missing the day its kind needs
 * reads as how often alone.
 */
export function seriesPattern(p: MeetingSeriesPattern, t: Words, format: Numbers): string {
  const every = seriesEvery(p.every, t);
  const { kind, weekday, dayOfMonth, ordinal } = p.on;
  if (kind === 'WEEKDAY' && weekday) return t.instant('meeting.series.on.WEEKDAY', { every, weekday: seriesWeekday(weekday, t) }) as string;
  if (kind === 'DAY_OF_MONTH' && dayOfMonth) return t.instant('meeting.series.on.DAY_OF_MONTH', { every, day: format.number(dayOfMonth) }) as string;
  if (kind === 'ORDINAL_WEEKDAY' && weekday && ordinal) {
    return t.instant('meeting.series.on.ORDINAL_WEEKDAY', { every, which: seriesOrdinal(ordinal, t), weekday: seriesWeekday(weekday, t) }) as string;
  }
  return every;
}

/**
 * The meeting header's series line: "Every month, the 4th Thursday · 4 of 12"
 * while the series runs; after End series, where it stopped (Q11).
 */
export function seriesLine(s: Pick<MeetingSeriesDto, 'every' | 'on' | 'index' | 'total' | 'ended' | 'endedAfter'>, t: Words, format: Numbers): string {
  if (s.ended) return seriesEndedLine(s, t, format);
  return t.instant('meeting.series.line', { pattern: seriesPattern(s, t, format), n: format.number(s.index), total: format.number(s.total) }) as string;
}

/** The whole-series view's line: the pattern while the series runs; where it stopped once ended. */
export function seriesSummary(s: Pick<MeetingSeriesDto, 'every' | 'on' | 'total' | 'ended' | 'endedAfter'>, t: Words, format: Numbers): string {
  return s.ended ? seriesEndedLine(s, t, format) : seriesPattern(s, t, format);
}

/** "Every month · ended after 4 of 12" (Q11). */
function seriesEndedLine(s: Pick<MeetingSeriesDto, 'every' | 'total' | 'endedAfter'>, t: Words, format: Numbers): string {
  return t.instant('meeting.series.ended', { every: seriesEvery(s.every, t), n: format.number(s.endedAfter ?? 0), total: format.number(s.total) }) as string;
}
