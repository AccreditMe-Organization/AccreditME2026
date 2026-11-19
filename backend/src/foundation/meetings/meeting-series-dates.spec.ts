import { patternDays, seriesTitle, SERIES_MAX_MEETINGS } from './meeting-series-dates';

/** ACC-316 PR 5 — a series' pattern days and titles (plan §3.2), as plain rules. */
describe('meeting-series-dates', () => {
  const LIMIT = '2027-11-19';

  it('weekly on a weekday starts on the first such day on or after the first date', () => {
    const r = patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-19', count: 3 }, LIMIT);
    // 19 Nov 2026 is a Thursday: the first Monday is the 23rd.
    expect(r).toEqual({ ok: true, days: ['2026-11-23', '2026-11-30', '2026-12-07'] });
  });

  it('every two weeks steps fourteen days', () => {
    const r = patternDays({ every: 'WEEK_2', onKind: 'WEEKDAY', weekday: 4, firstDate: '2026-11-19', count: 3 }, LIMIT);
    expect(r).toEqual({ ok: true, days: ['2026-11-19', '2026-12-03', '2026-12-17'] });
  });

  it("monthly on the 31st falls on a shorter month's last day", () => {
    const r = patternDays({ every: 'MONTH_1', onKind: 'DAY_OF_MONTH', dayOfMonth: 31, firstDate: '2027-01-01', count: 3 }, LIMIT);
    expect(r).toEqual({ ok: true, days: ['2027-01-31', '2027-02-28', '2027-03-31'] });
  });

  it("monthly on the last Thursday; a first date past this month's skips it", () => {
    const r = patternDays({ every: 'MONTH_1', onKind: 'ORDINAL_WEEKDAY', ordinal: 'LAST', weekday: 4, firstDate: '2026-11-27', count: 2 }, LIMIT);
    expect(r).toEqual({ ok: true, days: ['2026-12-31', '2027-01-28'] });
  });

  it('every three months on the second Monday', () => {
    const r = patternDays({ every: 'MONTH_3', onKind: 'ORDINAL_WEEKDAY', ordinal: 'SECOND', weekday: 1, firstDate: '2026-12-01', endsOn: '2027-06-30' }, LIMIT);
    expect(r).toEqual({ ok: true, days: ['2026-12-14', '2027-03-08', '2027-06-14'] });
  });

  it('refuses a pattern that does not fit its repeat, and an end that is neither or both', () => {
    // A weekday given as well doesn't make a day of the month weekly.
    expect(patternDays({ every: 'WEEK_1', onKind: 'DAY_OF_MONTH', dayOfMonth: 3, weekday: 1, firstDate: '2026-11-19', count: 2 }, LIMIT)).toMatchObject({ ok: false, code: 'MEETING_SERIES_PATTERN_INVALID' });
    expect(patternDays({ every: 'MONTH_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-19', count: 2 }, LIMIT)).toMatchObject({ ok: false, code: 'MEETING_SERIES_PATTERN_INVALID' });
    expect(patternDays({ every: 'MONTH_1', onKind: 'ORDINAL_WEEKDAY', weekday: 1, firstDate: '2026-11-19', count: 2 }, LIMIT)).toMatchObject({ ok: false, field: 'ordinal' });
    expect(patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-19' }, LIMIT)).toMatchObject({ ok: false, code: 'MEETING_SERIES_END_REQUIRED' });
    expect(patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-19', count: 2, endsOn: '2026-12-31' }, LIMIT)).toMatchObject({ ok: false, code: 'MEETING_SERIES_END_REQUIRED' });
  });

  it('refuses an end past twelve months, by date or by count, under that field', () => {
    expect(patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-19', endsOn: '2027-11-20' }, LIMIT)).toEqual({
      ok: false,
      code: 'MEETING_SERIES_TOO_LONG',
      field: 'endsOn',
      limit: LIMIT,
    });
    expect(patternDays({ every: 'MONTH_1', onKind: 'DAY_OF_MONTH', dayOfMonth: 1, firstDate: '2026-12-01', count: 13 }, LIMIT)).toMatchObject({ ok: false, field: 'count' });
  });

  it('weekly for twelve months is at most 53 meetings, both ends included', () => {
    const r = patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 4, firstDate: '2026-11-19', endsOn: LIMIT }, LIMIT);
    expect(r.ok && r.days.length).toBe(SERIES_MAX_MEETINGS);
  });

  it('an end before the first day makes nothing, refused', () => {
    expect(patternDays({ every: 'WEEK_1', onKind: 'WEEKDAY', weekday: 1, firstDate: '2026-11-24', endsOn: '2026-11-25' }, LIMIT)).toMatchObject({ ok: false, code: 'MEETING_SERIES_EMPTY' });
  });

  it("titles: monthly by the pattern's month (a moved one keeps it), weekly by the day it is held, in the organisation's language", () => {
    expect(seriesTitle('IPC', 'MONTH_1', '2026-10-31', '2026-11-01', 'en')).toBe('IPC · October 2026');
    expect(seriesTitle('IPC', 'WEEK_1', '2026-10-23', '2026-10-25', 'en')).toBe('IPC · 25 Oct 2026');
    expect(seriesTitle('مكافحة العدوى', 'MONTH_1', '2026-10-31', '2026-11-01', 'ar')).toBe('مكافحة العدوى · أكتوبر 2026');
  });
});
