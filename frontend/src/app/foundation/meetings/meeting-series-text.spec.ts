import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { FormatService } from '../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { aSeries } from './meeting-fixtures.testing';
import { COMMITTEE_MEETING_FREQUENCIES } from '../committees/services/committee.service';
import { SERIES_EVERY, SERIES_EVERY_FROM_FREQUENCY, SERIES_ORDINALS, SERIES_WEEKDAYS, seriesEveryChoice, seriesEveryFromFrequency, seriesLine, seriesPattern, seriesSummary } from './meeting-series-text';

// ACC-316 PR 8b — a series' readback, worded in ONE place: every value the
// server stores reads in both languages, the header's line says where the
// meeting sits, and an ended series says where it stopped (Q11), with Latin
// digits (ACC-94).
describe('meeting-series-text (ACC-316 PR 8b)', () => {
  let t: TranslateService;
  let format: FormatService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    t = TestBed.inject(TranslateService);
    format = TestBed.inject(FormatService);
  });

  const use = (language: 'en' | 'ar') => t.use(language);

  it('the header\'s line: "Every month, the 4th Thursday · 4 of 12", and in Arabic', () => {
    use('en');
    expect(seriesLine(aSeries(), t, format)).toBe('Every month, the 4th Thursday · 4 of 12');
    use('ar');
    expect(seriesLine(aSeries(), t, format)).toBe('كل شهر، الخميس الرابع · 4 من 12');
  });

  it('each kind of day: a weekday, a day of the month, the last weekday', () => {
    use('en');
    expect(seriesPattern(aSeries({ every: 'WEEK_2', on: { kind: 'WEEKDAY', weekday: 1, dayOfMonth: null, ordinal: null } }), t, format)).toBe('Every 2 weeks on Monday');
    expect(seriesPattern(aSeries({ on: { kind: 'DAY_OF_MONTH', weekday: null, dayOfMonth: 31, ordinal: null } }), t, format)).toBe('Every month on day 31');
    expect(seriesPattern(aSeries({ every: 'MONTH_3', on: { kind: 'ORDINAL_WEEKDAY', weekday: 4, dayOfMonth: null, ordinal: 'LAST' } }), t, format)).toBe('Every 3 months, the last Thursday');
    use('ar');
    expect(seriesPattern(aSeries({ every: 'WEEK_2', on: { kind: 'WEEKDAY', weekday: 1, dayOfMonth: null, ordinal: null } }), t, format)).toBe('كل أسبوعين يوم الاثنين');
    expect(seriesPattern(aSeries({ on: { kind: 'DAY_OF_MONTH', weekday: null, dayOfMonth: 31, ordinal: null } }), t, format)).toBe('كل شهر في اليوم 31');
    expect(seriesPattern(aSeries({ every: 'MONTH_3', on: { kind: 'ORDINAL_WEEKDAY', weekday: 4, dayOfMonth: null, ordinal: 'LAST' } }), t, format)).toBe('كل 3 أشهر، الخميس الأخير');
  });

  it('a pattern missing the day its kind needs reads as how often alone', () => {
    use('en');
    expect(seriesPattern(aSeries({ on: { kind: 'ORDINAL_WEEKDAY', weekday: null, dayOfMonth: null, ordinal: 'FIRST' } }), t, format)).toBe('Every month');
  });

  it('every value the server stores has words in both languages (the mapping Repeat will read)', () => {
    for (const language of ['en', 'ar'] as const) {
      use(language);
      const words = [
        ...SERIES_EVERY.map((e) => `meeting.series.every.${e}`),
        ...SERIES_ORDINALS.map((o) => `meeting.series.ordinal.${o}`),
        ...SERIES_WEEKDAYS.map((d) => `meeting.series.weekday.${d}`),
      ];
      // Non-vacuity: the lists are the server's, not empty.
      expect(words.length).toBe(6 + 5 + 7);
      for (const key of words) expect([language, key, t.instant(key) !== key]).toEqual([language, key, true]);
      const said = words.map((k) => t.instant(k) as string);
      expect(new Set(said).size).withContext(`${language}: every value reads differently`).toBe(said.length);
    }
  });

  it('after End series: "Every month · ended after 4 of 12" (Q11), in both languages, on the header and the series view', () => {
    const ended = aSeries({ index: 2, ended: true, endedAfter: 4 });
    use('en');
    expect(seriesLine(ended, t, format)).toBe('Every month · ended after 4 of 12');
    expect(seriesSummary(ended, t, format)).toBe('Every month · ended after 4 of 12');
    use('ar');
    expect(seriesLine(ended, t, format)).toBe('كل شهر · انتهت بعد 4 من 12');
  });

  // PR 8a (P236, Q6) — where Every starts: the ONE mapping from a committee's frequency.
  it("Every starts from the committee's frequency; As needed, and a unit, start on Doesn't repeat", () => {
    expect(Object.keys(SERIES_EVERY_FROM_FREQUENCY).sort()).withContext('every frequency is mapped').toEqual([...COMMITTEE_MEETING_FREQUENCIES].sort());
    expect(COMMITTEE_MEETING_FREQUENCIES.map((f) => [f, seriesEveryFromFrequency(f)])).toEqual([
      ['WEEKLY', 'WEEK_1'],
      ['MONTHLY', 'MONTH_1'],
      ['QUARTERLY', 'MONTH_3'],
      ['BIANNUAL', 'MONTH_6'],
      ['ANNUAL', 'MONTH_12'],
      ['AS_NEEDED', null],
    ]);
    expect(seriesEveryFromFrequency(null)).toBeNull();
  });

  it("Every's choices read in both languages, each one differently", () => {
    for (const language of ['en', 'ar'] as const) {
      use(language);
      const said = SERIES_EVERY.map((e) => seriesEveryChoice(e, t));
      expect(said.every((w) => !w.startsWith('meeting.'))).withContext(language).toBeTrue();
      expect(new Set(said).size).toBe(SERIES_EVERY.length);
    }
    use('en');
    expect(seriesEveryChoice('MONTH_3', t)).toBe('3 months');
  });

  it('the series view, while the series runs: its pattern alone', () => {
    use('en');
    expect(seriesSummary(aSeries(), t, format)).toBe('Every month, the 4th Thursday');
  });
});
