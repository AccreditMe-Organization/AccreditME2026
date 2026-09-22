// ACC-96 — everything the due control needs from the tenant's working calendar.
//
// Kept out of task-form because none of it is about a form: the presets, the
// out-of-hours warning and the zone suffix are all statements about the
// tenant's office hours, and the next screen that sets a due time needs the
// same ones.
//
// DEGRADES RATHER THAN BLOCKS. Until ACC-96 widened them, GET /working-calendar
// and /holidays required org:view, which a QUALITY_OFFICER does not hold. They
// are open now, but a fetch can still fail for ordinary reasons, and when it
// does the two calendar-derived presets and the warning are withheld while +1h
// and +2h keep working — those are arithmetic on the clock and need no
// calendar at all.

import { Injectable, computed, inject, signal } from '@angular/core';
import {
  PublicHolidayDto,
  WorkingCalendarDto,
  WorkingCalendarService,
} from '../../working-calendar/services/working-calendar.service';
import { FormatContext, FormatService } from '../../../core/formatting';
import { dayKey, HolidayMap } from '../../../shared/components/inline-calendar/inline-calendar.component';

export type PresetKey = 'plus1h' | 'plus2h' | 'endOfDay' | 'nextMorning';

export interface DuePreset {
  key: PresetKey;
  /** Translation key for the button. */
  labelKey: string;
  /** Interpolation params — `nextMorning` names its day when it is not tomorrow. */
  labelParams?: Record<string, string>;
  at: Date;
}

export type DueWarning =
  | { kind: 'none' }
  | { kind: 'past' }
  | { kind: 'nonWorkingDay'; weekday: string; resumesAt: Date }
  | { kind: 'outsideHours'; start: string; end: string; days: string; resumesAt: Date };

/** 09:00 unless the tenant's day starts later — see nextMorning() below. */
const MORNING_HOUR = 9;

@Injectable({ providedIn: 'root' })
export class DueDateService {
  private readonly calendarApi = inject(WorkingCalendarService);
  private readonly context = inject(FormatContext);
  private readonly format = inject(FormatService);

  private readonly calendar = signal<WorkingCalendarDto | null>(null);
  private readonly holidayRows = signal<PublicHolidayDto[]>([]);
  private readonly failed = signal(false);

  /** True once the calendar is known. Everything calendar-derived checks this. */
  readonly ready = computed(() => this.calendar() !== null);
  readonly unavailable = this.failed.asReadonly();

  readonly workingDays = computed<readonly number[] | null>(() => this.calendar()?.workingDays ?? null);

  readonly holidays = computed<HolidayMap>(() => {
    const map = new Map<string, string>();
    for (const row of this.holidayRows()) {
      // The row's date is a calendar day, not an instant. Reading it with the
      // Date constructor would shift it by the browser's offset — the very
      // defect Part B exists to fix — so the day is taken from the string.
      const day = row.date.slice(0, 10);
      map.set(day, row.nameEn);
      if (row.isRecurring) {
        // A recurring holiday repeats by month and day. Seed the years the
        // calendar can realistically show from a due-date field.
        const thisYear = new Date().getFullYear();
        for (const year of [thisYear - 1, thisYear, thisYear + 1, thisYear + 2]) {
          map.set(`${year}${day.slice(4)}`, row.nameEn);
        }
      }
    }
    return map;
  });

  load(): void {
    if (this.calendar()) return;
    this.calendarApi.getCalendar().subscribe({
      next: (cal) => {
        this.calendar.set(cal);
        this.failed.set(false);
      },
      error: () => this.failed.set(true),
    });
    this.calendarApi.getHolidays().subscribe({
      next: (rows) => this.holidayRows.set(rows),
      error: () => this.holidayRows.set([]),
    });
  }

  // ── The zone suffix ────────────────────────────────────────────────────

  /**
   * "+03" only when it would be TRUE for this reader.
   *
   * Artboard 12 draws the suffix as the organisation's zone, on the reasoning
   * that the SLA is computed there. That reasoning is sound and the suffix is
   * still wrong for anyone whose browser is elsewhere, because Part B is not
   * built: a picked wall-clock time is still read in the BROWSER's zone, so a
   * field labelled "+03" for a reader in Dubai would name a zone the value is
   * not in. Printing it anyway would turn a known storage defect into a
   * claim on screen.
   *
   * So: the tenant's offset when the two agree today, the browser's when they
   * do not — and in that second case the warning names the tenant zone in
   * words, where it is a statement about the SLA rather than about this value.
   */
  readonly zoneSuffix = computed(() => this.format.zoneOffset(this.effectiveZone()));

  /** True when the reader's clock is not the clock the SLA is counted in. */
  readonly zoneMismatch = computed(() => {
    const tenant = this.context.timeZone();
    return this.format.zoneOffset(tenant) !== this.format.zoneOffset(browserZone());
  });

  readonly tenantZone = computed(() => this.context.timeZone());

  private effectiveZone(): string {
    return this.zoneMismatch() ? browserZone() : this.context.timeZone();
  }

  // ── Presets ────────────────────────────────────────────────────────────

  /**
   * Always returns the two clock presets; adds the two calendar presets only
   * once the calendar is known.
   */
  presets(now: Date = new Date()): DuePreset[] {
    const list: DuePreset[] = [
      { key: 'plus1h', labelKey: 'task.due.preset.plus1h', at: addHours(now, 1) },
      { key: 'plus2h', labelKey: 'task.due.preset.plus2h', at: addHours(now, 2) },
    ];

    const cal = this.calendar();
    if (!cal) return list;

    list.push({ key: 'endOfDay', labelKey: 'task.due.preset.endOfDay', at: this.endOfWorkingDay(now, cal) });

    const morning = this.nextMorning(now, cal);
    list.push({
      key: 'nextMorning',
      // The label names the DAY whenever the next working day is not tomorrow,
      // because a button reading "Tomorrow 09:00" that sets Sunday is a lie.
      // On a Thursday evening of a Sun-Thu week, literal tomorrow is Friday.
      labelKey: morning.isTomorrow ? 'task.due.preset.tomorrow' : 'task.due.preset.nextDay',
      labelParams: morning.isTomorrow ? undefined : { day: this.format.weekday(morning.at, 'short') },
      at: morning.at,
    });

    return list;
  }

  /**
   * The end of today's working hours — or of the next working day's, when
   * today is not a working day or that moment has already passed.
   *
   * A preset that sets a time already gone would create a task overdue at
   * birth, which is worse than no preset.
   */
  private endOfWorkingDay(now: Date, cal: WorkingCalendarDto): Date {
    const end = atTime(now, cal.workingHoursEnd);
    if (this.isWorkingDay(now, cal) && end.getTime() > now.getTime()) return end;
    const next = this.nextWorkingDay(now, cal);
    return atTime(next, cal.workingHoursEnd);
  }

  /**
   * 09:00 on the next WORKING day — not literally tomorrow, which on a
   * Thursday would be a Friday nobody is in.
   *
   * Clamped to the tenant's own start when that is later than 09:00, so the
   * preset never sets a time that is itself out of hours and immediately warns.
   */
  private nextMorning(now: Date, cal: WorkingCalendarDto): { at: Date; isTomorrow: boolean } {
    const next = this.nextWorkingDay(now, cal);
    const start = parseHm(cal.workingHoursStart);
    const hour = Math.max(MORNING_HOUR, start.hour);
    const minute = hour === start.hour && start.hour > MORNING_HOUR ? start.minute : 0;

    const at = new Date(next);
    at.setHours(hour, minute, 0, 0);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { at, isTomorrow: sameDay(at, tomorrow) };
  }

  private nextWorkingDay(from: Date, cal: WorkingCalendarDto): Date {
    const cursor = new Date(from);
    for (let i = 0; i < 14; i++) {
      cursor.setDate(cursor.getDate() + 1);
      if (this.isWorkingDay(cursor, cal)) return cursor;
    }
    return cursor; // A calendar with no working days at all; the caller still gets a date.
  }

  /**
   * The tenant's configured end-of-working-hours ON that day — the time a date
   * gets when the user names a day and no time (Ahmad, 2026-09-22).
   *
   * DELIBERATELY NOT conditional on the day being a working one. A Friday or a
   * public holiday still takes the same configured end time, and the
   * out-of-hours warning then tells the user what they have chosen. The
   * alternative — silently rolling to the next working day — would change the
   * DAY the user just typed, which is the one thing they were explicit about.
   *
   * Null when the calendar is unreadable; the caller then leaves the parsed
   * time alone rather than inventing one.
   */
  endOfDayFor(day: Date): Date | null {
    const cal = this.calendar();
    return cal ? atTime(day, cal.workingHoursEnd) : null;
  }

  isWorkingDay(at: Date, cal = this.calendar()): boolean {
    if (!cal) return true;
    if (!cal.workingDays.includes(at.getDay())) return false;
    return !this.holidays().has(dayKey(at));
  }

  // ── The warning ────────────────────────────────────────────────────────

  /**
   * Artboard 12: out-of-hours is "allowed, warned, never blocked". A hospital
   * does not stop at 17:00, and a product that refuses to record a true due
   * time makes people round to 17:00 and corrupt the SLA data.
   *
   * A past time is the one case that is an error rather than a warning.
   */
  warningFor(at: Date | null, now: Date = new Date()): DueWarning {
    if (!at) return { kind: 'none' };
    if (at.getTime() < now.getTime()) return { kind: 'past' };

    const cal = this.calendar();
    if (!cal) return { kind: 'none' };

    const resumesAt = this.resumeAfter(at, cal);

    if (!this.isWorkingDay(at, cal)) {
      return { kind: 'nonWorkingDay', weekday: this.format.weekday(at), resumesAt };
    }

    const minutes = at.getHours() * 60 + at.getMinutes();
    const start = parseHm(cal.workingHoursStart);
    const end = parseHm(cal.workingHoursEnd);
    if (minutes < start.hour * 60 + start.minute || minutes > end.hour * 60 + end.minute) {
      return {
        kind: 'outsideHours',
        start: cal.workingHoursStart,
        end: cal.workingHoursEnd,
        days: this.workingDaysLabel(cal),
        resumesAt,
      };
    }

    return { kind: 'none' };
  }

  /**
   * When the SLA clock starts again after an out-of-hours due time.
   *
   * DELIBERATELY NOT the working-time arithmetic the drawing also shows
   * ("2h 30m of working time, not 1h 30m"). That number is elapsed working
   * time, which is WorkingCalendarService.calculateDeadline()'s job on the
   * backend; a second implementation here would be a second answer, and the
   * one on screen would be the one nobody tested against the SLA. The resume
   * point needs only the next working day's start, which this does have.
   */
  private resumeAfter(at: Date, cal: WorkingCalendarDto): Date {
    const sameDayStart = atTime(at, cal.workingHoursStart);
    if (this.isWorkingDay(at, cal) && at.getTime() < sameDayStart.getTime()) return sameDayStart;
    return atTime(this.nextWorkingDay(at, cal), cal.workingHoursStart);
  }

  private workingDaysLabel(cal: WorkingCalendarDto): string {
    const names = cal.workingDays
      .slice()
      .sort((a, b) => a - b)
      .map((d) => this.format.weekday(dayOfWeekSample(d), 'short'));
    if (names.length === 0) return '';
    // Contiguous runs read as a range: "Sun–Thu", not "Sun, Mon, Tue, Wed, Thu".
    const contiguous = cal.workingDays.every(
      (d, i, all) => i === 0 || d === [...all].sort((a, b) => a - b)[i - 1] + 1,
    );
    return contiguous && names.length > 2 ? `${names[0]}–${names[names.length - 1]}` : names.join(', ');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function addHours(from: Date, hours: number): Date {
  const at = new Date(from);
  at.setHours(at.getHours() + hours, at.getMinutes(), 0, 0);
  return at;
}

function parseHm(hm: string): { hour: number; minute: number } {
  const [h, m] = hm.split(':');
  return { hour: Number(h) || 0, minute: Number(m) || 0 };
}

function atTime(day: Date, hm: string): Date {
  const { hour, minute } = parseHm(hm);
  const at = new Date(day);
  at.setHours(hour, minute, 0, 0);
  return at;
}

function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** A date that falls on the given day of the week, for naming it. */
function dayOfWeekSample(dayOfWeek: number): Date {
  const at = new Date(2026, 8, 20); // a Sunday
  at.setDate(at.getDate() + dayOfWeek);
  return at;
}

