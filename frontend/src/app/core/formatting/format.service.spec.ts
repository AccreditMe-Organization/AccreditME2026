import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { EMPTY_VALUE, FormatService } from './format.service';
import { TestFormatContext } from './format-context';
import { provideFormatTesting } from './testing';

// ACC-94 — the display formatting layer (backend/Plans/step-94-formatting-layer.md).
// Every expectation is a literal string a reader would see, in both languages.

const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/;

describe('FormatService (ACC-94)', () => {
  let format: FormatService;
  let context: TestFormatContext;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { format: { lessThanMinute: 'less than a minute' } });
    translate.setTranslation('ar', { format: { lessThanMinute: 'أقل من دقيقة' } });
    translate.use('en');
    format = TestBed.inject(FormatService);
    context = TestBed.inject(TestFormatContext);
  });

  const inArabic = () => translate.use('ar');

  describe('date and dateTime — one unambiguous format each', () => {
    const at = '2026-09-15T11:05:00Z'; // 14:05 in Riyadh

    it('writes the month as a word, day first, with the year, in English', () => {
      expect(format.date(at)).toBe('15 Sep 2026');
      expect(format.dateTime(at)).toBe('15 Sep 2026, 14:05');
    });

    it('does the same in Arabic, with the Arabic comma', () => {
      inArabic();
      expect(format.date(at)).toBe('15 سبتمبر 2026');
      expect(format.dateTime(at)).toBe('15 سبتمبر 2026، 14:05');
    });

    it('uses 24-hour time, including after midnight and in the afternoon', () => {
      expect(format.dateTime('2026-09-15T21:30:00Z')).toBe('16 Sep 2026, 00:30');
      expect(format.dateTime('2026-09-15T13:59:00Z')).toBe('15 Sep 2026, 16:59');
    });
  });

  describe('time zone — the tenant\'s, never the browser\'s', () => {
    // 21:30 UTC is already the next day in Riyadh. This machine's browser is in
    // Riyadh and CI's is in UTC, so New York is the zone neither can match by
    // coincidence.
    const instant = '2026-09-15T21:30:00Z';

    it('renders the same instant on the day it falls in the tenant zone', () => {
      context.zone.set('Asia/Riyadh');
      expect(format.dateTime(instant)).toBe('16 Sep 2026, 00:30');
      context.zone.set('America/New_York');
      expect(format.dateTime(instant)).toBe('15 Sep 2026, 17:30');
      context.zone.set('UTC');
      expect(format.dateTime(instant)).toBe('15 Sep 2026, 21:30');
    });
  });

  describe('the empty value — owned by the layer', () => {
    it('renders — for a missing value, in every format', () => {
      for (const missing of [null, undefined, '']) {
        expect(format.date(missing)).toBe(EMPTY_VALUE);
        expect(format.dateTime(missing)).toBe(EMPTY_VALUE);
        expect(format.relative(missing)).toBe(EMPTY_VALUE);
        expect(format.elapsed(missing)).toBe(EMPTY_VALUE);
      }
      expect(format.duration(null)).toBe(EMPTY_VALUE);
      expect(format.number(undefined)).toBe(EMPTY_VALUE);
    });

    it('renders — for an unparseable value, never the raw string', () => {
      expect(format.date('2026-13-45')).toBe(EMPTY_VALUE);
      expect(format.dateTime('not a date')).toBe(EMPTY_VALUE);
      expect(format.number(Number.NaN)).toBe(EMPTY_VALUE);
    });
  });

  describe('digits — Latin in both languages', () => {
    it('never emits Arabic-Indic digits in Arabic, although ar-SA defaults to them', () => {
      // The platform fact that makes the pin necessary, asserted so a reader
      // sees why the spec below is not vacuous.
      expect(new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh' }).format(new Date('2026-09-15T12:00:00Z'))).toMatch(
        ARABIC_INDIC_DIGITS,
      );

      inArabic();
      context.hijri.set(true);
      const outputs = [
        format.date('2026-09-15T11:05:00Z'),
        format.dateTime('2026-09-15T11:05:00Z'),
        format.relative('2026-09-12T11:05:00Z', new Date('2026-09-15T11:05:00Z')),
        format.duration(5 * 60 * 60 * 1000),
        format.number(1234567),
      ];
      for (const output of outputs) {
        expect(output).not.toMatch(ARABIC_INDIC_DIGITS);
        expect(output).toMatch(/[0-9]/);
      }
    });
  });

  describe('relative — how long ago, with correct plurals', () => {
    const now = new Date('2026-09-15T12:00:00Z');
    const ago = (ms: number) => new Date(now.getTime() - ms);
    const MIN = 60_000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;

    it('uses minutes under an hour, hours under 48 hours, then whole days', () => {
      expect(format.relative(ago(30_000), now)).toBe('now');
      expect(format.relative(ago(5 * MIN), now)).toBe('5 minutes ago');
      expect(format.relative(ago(1 * HOUR), now)).toBe('1 hour ago');
      expect(format.relative(ago(47 * HOUR + 59 * MIN), now)).toBe('47 hours ago');
      expect(format.relative(ago(48 * HOUR), now)).toBe('2 days ago');
      expect(format.relative(new Date(now.getTime() + 3 * DAY), now)).toBe('in 3 days');
    });

    it('takes the correct Arabic plural form for each count', () => {
      inArabic();
      expect(format.relative(ago(2 * DAY), now)).toBe('قبل يومين');
      expect(format.relative(ago(3 * DAY), now)).toBe('قبل 3 أيام');
      expect(format.relative(ago(7 * DAY), now)).toBe('قبل 7 أيام');
      expect(format.relative(ago(11 * DAY), now)).toBe('قبل 11 يومًا');
      expect(format.relative(ago(100 * DAY), now)).toBe('قبل 100 يوم');
      expect(format.relative(ago(10_000), now)).toBe('الآن');
    });
  });

  describe('duration and elapsed — no span ever reads "0 days"', () => {
    const MIN = 60_000;
    const HOUR = 60 * MIN;

    it('reads a task 5 hours late as 5 hours, and a few seconds as less than a minute', () => {
      expect(format.duration(5 * HOUR + 40 * MIN)).toBe('5 hours');
      expect(format.duration(20_000)).toBe('less than a minute');
      expect(format.elapsed('2026-09-15T07:00:00Z', '2026-09-15T12:30:00Z')).toBe('5 hours');
      expect(format.elapsed('2026-09-08T12:00:00Z', '2026-09-15T12:00:00Z')).toBe('7 days');
    });

    it('pluralises in Arabic, including the dual', () => {
      inArabic();
      expect(format.duration(1 * HOUR)).toBe('ساعة');
      expect(format.duration(2 * HOUR)).toBe('ساعتان');
      expect(format.duration(5 * HOUR)).toBe('5 ساعات');
      expect(format.duration(7 * 24 * HOUR)).toBe('7 أيام');
      expect(format.duration(11 * 24 * HOUR)).toBe('11 يومًا');
      expect(format.duration(30_000)).toBe('أقل من دقيقة');
    });
  });

  describe('Hijri (D4) — display only, Hijri first, Gregorian in brackets', () => {
    beforeEach(() => context.hijri.set(true));

    it('shows the Umm al-Qura date first and the Gregorian date after it', () => {
      expect(format.date('2026-09-15T21:30:00Z')).toBe('5 Rabiʻ II 1448 AH (16 Sep 2026)');
      expect(format.dateTime('2026-09-15T21:30:00Z')).toBe('5 Rabiʻ II 1448 AH, 00:30 (16 Sep 2026)');
      inArabic();
      expect(format.date('2026-09-15T21:30:00Z')).toBe('5 ربيع الآخر 1448 هـ (16 سبتمبر 2026)');
    });

    // Reference: Umm al-Qura calendar tables (R.H. van Gent, Utrecht University,
    // webspace.science.uu.nl/~gent0113/islam/ummalqura_principal.htm), checked
    // 2026-09-15. Month starts are where a calendar implementation goes wrong.
    const UMM_AL_QURA: [string, string][] = [
      ['2025-06-26', '1 Muharram 1447 AH'],
      ['2025-09-04', '12 Rabiʻ I 1447 AH'],
      ['2026-02-18', '1 Ramadan 1447 AH'],
      ['2026-03-20', '1 Shawwal 1447 AH'],
      ['2026-05-27', '10 Dhuʻl-Hijjah 1447 AH'],
      ['2026-06-16', '1 Muharram 1448 AH'],
      ['2026-08-25', '12 Rabiʻ I 1448 AH'],
      ['2027-02-08', '1 Ramadan 1448 AH'],
      ['2027-03-09', '1 Shawwal 1448 AH'],
      ['2027-05-16', '10 Dhuʻl-Hijjah 1448 AH'],
    ];

    it('matches the published Umm al-Qura dates across two years', () => {
      for (const [gregorian, hijri] of UMM_AL_QURA) {
        expect(format.date(`${gregorian}T12:00:00Z`)).toContain(hijri);
      }
    });

    it('turns the month at the boundary, not a day either side', () => {
      expect(format.date('2026-02-17T12:00:00Z')).not.toContain('Ramadan');
      expect(format.date('2026-02-18T12:00:00Z')).toContain('1 Ramadan 1447');
    });

    it('does not apply to relative times or durations', () => {
      expect(format.duration(3 * 60 * 60 * 1000)).toBe('3 hours');
    });
  });

  describe('number and zone label', () => {
    it('groups digits and keeps them Latin in both languages', () => {
      expect(format.number(1234567)).toBe('1,234,567');
      inArabic();
      expect(format.number(1234567)).not.toMatch(ARABIC_INDIC_DIGITS);
    });

    it("names the zone dates are shown in, so nobody guesses whose clock it is", () => {
      context.zone.set('Asia/Riyadh');
      expect(format.zoneLabel()).toBe('Asia/Riyadh (GMT+3)');
    });
  });

  // Condition 1 of the plan's approval: ACC-55's rule — a label built inside a
  // computed() must re-evaluate on a language switch. FormatService reads its
  // context signals on every call, so it does, and so does a zone or calendar
  // change. Each of these fails if a method stops reading the context.
  describe('signal-aware — usable inside computed()', () => {
    const at = '2026-09-15T21:30:00Z';

    it('re-evaluates a computed() on a language switch', () => {
      const label = computed(() => format.dateTime(at));
      expect(label()).toBe('16 Sep 2026, 00:30');
      inArabic();
      expect(label()).toBe('16 سبتمبر 2026، 00:30');
    });

    it('re-evaluates a computed() when the tenant zone or the calendar changes', () => {
      const label = computed(() => format.date(at));
      expect(label()).toBe('16 Sep 2026');
      context.zone.set('America/New_York');
      expect(label()).toBe('15 Sep 2026');
      context.hijri.set(true);
      expect(label()).toBe('4 Rabiʻ II 1448 AH (15 Sep 2026)');
    });

    it('re-evaluates relative, duration, elapsed and number too, including one that started empty', () => {
      const now = new Date('2026-09-15T12:00:00Z');
      const relative = computed(() => format.relative('2026-09-12T12:00:00Z', now));
      const duration = computed(() => format.duration(3 * 60 * 60 * 1000));
      const empty = computed(() => format.elapsed(null));
      const number = computed(() => format.number(5));
      expect([relative(), duration(), empty(), number()]).toEqual(['3 days ago', '3 hours', EMPTY_VALUE, '5']);
      inArabic();
      expect([relative(), duration(), number()]).toEqual(['قبل 3 أيام', '3 ساعات', '5']);
      expect(empty()).toBe(EMPTY_VALUE);
    });
  });
});
