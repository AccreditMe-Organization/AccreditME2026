import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { FormatService } from '../../core/formatting';

/**
 * ACC-316 PR 6 — a meeting's start as Schedule and Reschedule take it: a day
 * picked on the calendar and an HH:mm time, read on the TENANT's wall clock
 * (FormatService's zone, the one every display of the meeting uses), so 10:00
 * typed is 10:00 shown, whatever the browser's zone. The calendar works in
 * plain days: a picked day is a browser-local Date whose year, month and date
 * ARE the day, never an instant. Plain functions.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

type Zone = Pick<FormatService, 'wallClock' | 'instantAt'>;

/**
 * The Starts field's one rule, on its time control: `required` until a day is
 * picked AND a time typed ("Choose a date and a time."), then `time` while the
 * time is not HH:mm. The day lives outside the form (the calendar swaps the
 * body), so picking one calls updateValueAndValidity() on the control.
 */
export function meetingTimeValidator(day: () => Date | null): ValidatorFn {
  return (c: AbstractControl): ValidationErrors | null => {
    const value = typeof c.value === 'string' ? c.value.trim() : '';
    if (!value || !day()) return { required: true };
    return TIME.test(value) ? null : { time: true };
  };
}

/** The instant this day and time name in the tenant's zone, or null while either is incomplete or invalid. */
export function meetingStart(day: Date | null, time: string, zone: Zone): Date | null {
  const m = TIME.exec(time.trim());
  if (!day || !m) return null;
  return zone.instantAt({ year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate(), hour: Number(m[1]), minute: Number(m[2]) });
}

/** Noon of this day in the tenant's zone: the instant to format when SHOWING a picked day, so it reads as that day. */
export function dayInstant(day: Date, zone: Zone): Date {
  return zone.instantAt({ year: day.getFullYear(), month: day.getMonth() + 1, day: day.getDate(), hour: 12, minute: 0 });
}

/** The tenant's day of this instant, as the calendar's plain day. */
export function meetingDay(at: Date | string, zone: Zone): Date {
  const w = zone.wallClock(at)!;
  return new Date(w.year, w.month - 1, w.day);
}

/** "13:00": the instant's time on the tenant's wall clock. */
export function meetingTimeText(at: Date | string, zone: Zone): string {
  const w = zone.wallClock(at)!;
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`;
}

/** Today in the tenant's zone, the earliest day the calendar offers. */
export function meetingToday(zone: Zone, now: Date = new Date()): Date {
  return meetingDay(now, zone);
}
