/**
 * ACC-316 PR 6 — a meeting's start as the Schedule and Reschedule dialogs take
 * it: a day picked on the calendar and an HH:mm time, in the browser's zone,
 * sent as an instant (New task's convention, ACC-96 Part A). Plain functions.
 */

import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

/** The instant for this day and time, or null while either is incomplete or invalid. */
export function meetingStart(day: Date | null, time: string): Date | null {
  const m = TIME.exec(time.trim());
  if (!day || !m) return null;
  const at = new Date(day);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return at;
}

/** "13:00" for a Date, in the browser's zone. */
export function timeText(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Today at midnight, the earliest day the calendar offers. */
export function today(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}
