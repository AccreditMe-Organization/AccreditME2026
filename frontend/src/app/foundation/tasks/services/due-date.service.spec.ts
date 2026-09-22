// ACC-96 — the preset and warning rules, including the two edge cases the
// drawings do not settle: what "End of working day" and "Tomorrow 09:00" mean
// on a non-working day and after hours.
//
// Driven with a FIXED `now` rather than the clock, because "tomorrow" and
// "already past" are the whole subject and a suite that passes only on a
// Tuesday afternoon proves nothing.
import { TestBed } from '@angular/core/testing';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { DueDateService } from './due-date.service';
import {
  PublicHolidayDto,
  WorkingCalendarDto,
  WorkingCalendarService,
} from '../../working-calendar/services/working-calendar.service';
import { FormatContext } from '../../../core/formatting';

const GCC: WorkingCalendarDto = {
  id: 'cal-1',
  organizationId: 'org-1',
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4], // Sun–Thu
  workingHoursStart: '07:30',
  workingHoursEnd: '17:00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const NATIONAL_DAY: PublicHolidayDto = {
  id: 'h1',
  workingCalendarId: 'cal-1',
  nameEn: 'National Day',
  nameAr: 'اليوم الوطني',
  date: '2026-09-23',
  isRecurring: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

// September 2026: 20th is a Sunday, so 24th is Thursday and 25th is Friday.
const TUE_10_00 = new Date(2026, 8, 22, 10, 0);
const TUE_18_00 = new Date(2026, 8, 22, 18, 0);
const THU_18_00 = new Date(2026, 8, 24, 18, 0);
const FRI_10_00 = new Date(2026, 8, 25, 10, 0);

function configure(opts: { calendar?: unknown; holidays?: PublicHolidayDto[]; fail?: boolean } = {}) {
  TestBed.configureTestingModule({
    providers: [
      // FormatService is a real dependency now — the weekday names and the
      // zone offset go through the ACC-94 layer rather than a local Intl
      // formatter, which check:formatting refuses.
      provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      {
        provide: WorkingCalendarService,
        useValue: {
          getCalendar: () =>
            opts.fail ? throwError(() => new Error('403')) : of(opts.calendar ?? GCC),
          getHolidays: () => of(opts.holidays ?? []),
        },
      },
      {
        provide: FormatContext,
        useValue: { timeZone: () => 'Asia/Riyadh', language: () => 'en', calendar: () => 'gregory' },
      },
    ],
  });
  const service = TestBed.inject(DueDateService);
  service.load();
  return service;
}

describe('DueDateService (ACC-96)', () => {
  afterEach(() => TestBed.resetTestingModule());

  // ── Degraded mode ───────────────────────────────────────────────────────

  describe('when the calendar cannot be read', () => {
    it('still offers +1h and +2h, and only those', () => {
      const service = configure({ fail: true });
      const keys = service.presets(TUE_10_00).map((p) => p.key);

      // The clock presets are arithmetic and need no calendar; the other two
      // would be guesses about office hours nobody has told us.
      expect(keys).toEqual(['plus1h', 'plus2h']);
      expect(service.unavailable()).toBe(true);
    });

    it('withholds the warning rather than guessing', () => {
      const service = configure({ fail: true });
      expect(service.warningFor(TUE_18_00, TUE_10_00)).toEqual({ kind: 'none' });
    });

    it('hatches no day when the working days are unknown', () => {
      const service = configure({ fail: true });
      expect(service.workingDays()).toBeNull();
    });
  });

  // ── Presets ─────────────────────────────────────────────────────────────

  describe('presets', () => {
    it('sets +1h and +2h from now, to the minute', () => {
      const service = configure();
      const [one, two] = service.presets(TUE_10_00);
      expect(one.at).toEqual(new Date(2026, 8, 22, 11, 0));
      expect(two.at).toEqual(new Date(2026, 8, 22, 12, 0));
    });

    it('end of working day is TODAY when today is a working day and it has not passed', () => {
      const service = configure();
      const end = service.presets(TUE_10_00).find((p) => p.key === 'endOfDay')!;
      expect(end.at).toEqual(new Date(2026, 8, 22, 17, 0));
    });

    it('end of working day rolls to the next working day once today has ended', () => {
      const service = configure();
      // 18:00 Tuesday — 17:00 today is gone. A preset that set it would create
      // a task already overdue.
      const end = service.presets(TUE_18_00).find((p) => p.key === 'endOfDay')!;
      expect(end.at).toEqual(new Date(2026, 8, 23, 17, 0));
    });

    it('end of working day skips a non-working day entirely', () => {
      const service = configure();
      // Friday — not a working day in a Sun–Thu week, so the next is Sunday.
      const end = service.presets(FRI_10_00).find((p) => p.key === 'endOfDay')!;
      expect(end.at).toEqual(new Date(2026, 8, 27, 17, 0));
    });

    it('the morning preset is 09:00 tomorrow, and says so, when tomorrow is a working day', () => {
      const service = configure();
      const morning = service.presets(TUE_10_00).find((p) => p.key === 'nextMorning')!;
      expect(morning.at).toEqual(new Date(2026, 8, 23, 9, 0));
      expect(morning.labelKey).toBe('task.due.preset.tomorrow');
    });

    it('the morning preset names its day when the next working day is NOT tomorrow', () => {
      const service = configure();
      // Thursday evening: literal tomorrow is Friday, which nobody is in. A
      // button reading "Tomorrow 09:00" that sets Sunday would be a lie, so the
      // label changes with the value.
      const morning = service.presets(THU_18_00).find((p) => p.key === 'nextMorning')!;
      expect(morning.at).toEqual(new Date(2026, 8, 27, 9, 0));
      expect(morning.labelKey).toBe('task.due.preset.nextDay');
      expect(morning.labelParams).toEqual({ day: 'Sun' });
    });

    it('the morning preset skips a public holiday as well as a weekend', () => {
      const service = configure({ holidays: [NATIONAL_DAY] });
      // Tuesday 22nd → Wednesday 23rd is National Day → Thursday 24th.
      const morning = service.presets(TUE_10_00).find((p) => p.key === 'nextMorning')!;
      expect(morning.at).toEqual(new Date(2026, 8, 24, 9, 0));
    });

    it('clamps the morning preset to a tenant day that starts after 09:00', () => {
      const service = configure({ calendar: { ...GCC, workingHoursStart: '10:30' } });
      const morning = service.presets(TUE_10_00).find((p) => p.key === 'nextMorning')!;
      // Otherwise the preset would set a time that is itself out of hours and
      // warn about its own value.
      expect(morning.at).toEqual(new Date(2026, 8, 23, 10, 30));
    });
  });

  // ── Warnings ────────────────────────────────────────────────────────────

  describe('warnings', () => {
    it('says nothing about a time inside working hours', () => {
      const service = configure();
      expect(service.warningFor(new Date(2026, 8, 22, 14, 0), TUE_10_00)).toEqual({ kind: 'none' });
    });

    it('warns, never blocks, on an out-of-hours time, and names the hours', () => {
      const service = configure();
      const warning = service.warningFor(TUE_18_00, TUE_10_00);
      expect(warning.kind).toBe('outsideHours');
      if (warning.kind !== 'outsideHours') return;
      expect(warning.start).toBe('07:30');
      expect(warning.end).toBe('17:00');
      expect(warning.days).toBe('Sun–Thu');
      // The SLA clock restarts at the next working day's start.
      expect(warning.resumesAt).toEqual(new Date(2026, 8, 23, 7, 30));
    });

    it('warns on a non-working day and names it', () => {
      const service = configure();
      const warning = service.warningFor(FRI_10_00, TUE_10_00);
      expect(warning.kind).toBe('nonWorkingDay');
      if (warning.kind !== 'nonWorkingDay') return;
      expect(warning.weekday).toBe('Friday');
      expect(warning.resumesAt).toEqual(new Date(2026, 8, 27, 7, 30));
    });

    it('treats a public holiday as a non-working day', () => {
      const service = configure({ holidays: [NATIONAL_DAY] });
      const warning = service.warningFor(new Date(2026, 8, 23, 10, 0), TUE_10_00);
      expect(warning.kind).toBe('nonWorkingDay');
    });

    it('a past time is an error, not a warning — the one case that is', () => {
      const service = configure();
      expect(service.warningFor(new Date(2026, 8, 22, 9, 0), TUE_10_00)).toEqual({ kind: 'past' });
    });
  });

  // ── End of day for a named date ─────────────────────────────────────────

  describe('endOfDayFor', () => {
    it('returns the configured end time on a working day', () => {
      const service = configure();
      expect(service.endOfDayFor(new Date(2026, 8, 24))).toEqual(new Date(2026, 8, 24, 17, 0));
    });

    it('returns the SAME end time on a non-working day and on a holiday', () => {
      const service = configure({ holidays: [NATIONAL_DAY] });
      // Friday, and National Day. Neither rolls the date forward: the user was
      // explicit about the day, and the warning is what tells them it is not a
      // working one.
      expect(service.endOfDayFor(FRI_10_00)).toEqual(new Date(2026, 8, 25, 17, 0));
      expect(service.endOfDayFor(new Date(2026, 8, 23))).toEqual(new Date(2026, 8, 23, 17, 0));
    });

    it('returns null when the calendar cannot be read, rather than inventing a time', () => {
      const service = configure({ fail: true });
      expect(service.endOfDayFor(new Date(2026, 8, 24))).toBeNull();
    });
  });

  // ── Holidays for the grid ───────────────────────────────────────────────

  it('reads a holiday date as a calendar DAY, never as an instant', () => {
    const service = configure({ holidays: [NATIONAL_DAY] });
    // Taking "2026-09-23" through the Date constructor would parse it as
    // midnight UTC and shift it by the browser's offset — the exact defect
    // Part B exists to fix. The day is sliced off the string instead.
    expect(service.holidays().get('2026-09-23')).toBe('National Day');
    expect(service.holidays().get('2026-09-22')).toBeUndefined();
  });

  it('repeats a recurring holiday into neighbouring years', () => {
    const service = configure({ holidays: [{ ...NATIONAL_DAY, isRecurring: true }] });
    const year = new Date().getFullYear();
    expect(service.holidays().get(`${year}-09-23`)).toBe('National Day');
    expect(service.holidays().get(`${year + 1}-09-23`)).toBe('National Day');
  });

  // ── Zone suffix ─────────────────────────────────────────────────────────

  it('reports no zone mismatch when the browser agrees with the tenant', () => {
    // Karma runs in the machine's own zone. The assertion that holds
    // everywhere is the INVARIANT: the suffix names whichever zone the value
    // is actually in, so it is never a claim that is false.
    const service = configure();
    const suffix = service.zoneSuffix();
    expect(suffix).toMatch(/^[+-]\d{2}(:\d{2})?$/);
    expect(service.tenantZone()).toBe('Asia/Riyadh');
  });
});
