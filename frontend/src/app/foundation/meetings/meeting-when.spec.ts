import { TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideTranslateService } from '@ngx-translate/core';
import { FormatService } from '../../core/formatting';
import { TestFormatContext } from '../../core/formatting/format-context';
import { provideFormatTesting } from '../../core/formatting/testing';
import { dayInstant, meetingDay, meetingStart, meetingTimeText, meetingTimeValidator, meetingToday } from './meeting-when';

// ACC-316 PR 6 — a meeting's start as Schedule and Reschedule take it: a day
// and an HH:mm time, both required, read on the TENANT's wall clock.
describe('meeting-when (ACC-316 PR 6)', () => {
  describe('meetingTimeValidator', () => {
    const check = (day: Date | null, value: string) => new FormControl(value, meetingTimeValidator(() => day)).errors;
    const day = new Date(2027, 2, 18);

    it('a time with no day is required, so the field says "Choose a date and a time"', () => {
      expect(check(null, '13:30')).toEqual({ required: true });
    });

    it('a day with no time is required too', () => {
      expect(check(day, '')).toEqual({ required: true });
      expect(check(day, '   ')).toEqual({ required: true });
    });

    it('a day and an HH:mm time pass', () => {
      expect(check(day, '13:30')).toBeNull();
      expect(check(day, '00:00')).toBeNull();
      expect(check(day, '23:59')).toBeNull();
    });

    it('a time that is not HH:mm is the time error', () => {
      for (const value of ['24:00', '13:60', '9:30', '13_30', '__:__']) {
        expect(check(day, value)).withContext(value).toEqual({ time: true });
      }
    });

    it('reads the day when it validates, so picking one later clears the error', () => {
      let picked: Date | null = null;
      const control = new FormControl('13:30', meetingTimeValidator(() => picked));
      expect(control.errors).toEqual({ required: true });
      picked = day;
      control.updateValueAndValidity();
      expect(control.errors).toBeNull();
    });
  });

  // The browser's zone and the tenant's differ here, on purpose: 10:00 typed
  // must be 10:00 in the TENANT's zone, the zone every display uses.
  describe("the tenant's wall clock, whatever the browser's zone", () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tenant = browser === 'America/New_York' ? 'Asia/Tokyo' : 'America/New_York';
    let format: FormatService;

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
      TestBed.inject(TestFormatContext).zone.set(tenant);
      format = TestBed.inject(FormatService);
    });

    it('10:00 typed on 18 Mar 2027 is 10:00 on 18 Mar 2027 in the tenant zone', () => {
      const at = meetingStart(new Date(2027, 2, 18), '10:00', format)!;
      expect(format.timeOfDay(at)).toBe('10:00');
      expect(format.wallClock(at)).toEqual({ year: 2027, month: 3, day: 18, hour: 10, minute: 0 });
      // Non-vacuity: the browser's own 10:00 that day is a different instant.
      expect(at.getTime()).not.toBe(new Date(2027, 2, 18, 10, 0).getTime());
    });

    it('a meeting reads back on the same day and time it was typed (Reschedule fills them in)', () => {
      const at = meetingStart(new Date(2027, 9, 31), '23:30', format)!;
      const day = meetingDay(at, format);
      expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2027, 9, 31]);
      expect(meetingTimeText(at, format)).toBe('23:30');
      expect(meetingStart(day, meetingTimeText(at, format), format)!.getTime()).toBe(at.getTime());
    });

    it('across a clock change (New York, 14 Mar 2027), each side keeps its wall time', () => {
      TestBed.inject(TestFormatContext).zone.set('America/New_York');
      const before = meetingStart(new Date(2027, 2, 13), '09:00', format)!;
      const after = meetingStart(new Date(2027, 2, 15), '09:00', format)!;
      expect(before.toISOString()).toBe('2027-03-13T14:00:00.000Z');
      expect(after.toISOString()).toBe('2027-03-15T13:00:00.000Z');
    });

    it("a picked day is shown as that day, and today is the tenant's", () => {
      expect(format.wallClock(dayInstant(new Date(2027, 2, 18), format))).toEqual({ year: 2027, month: 3, day: 18, hour: 12, minute: 0 });
      // 03:00 UTC on 18 Mar is still 17 Mar in New York.
      TestBed.inject(TestFormatContext).zone.set('America/New_York');
      const today = meetingToday(format, new Date('2027-03-18T03:00:00Z'));
      expect([today.getFullYear(), today.getMonth(), today.getDate()]).toEqual([2027, 2, 17]);
    });

    it('is null while the day or the time is missing or invalid', () => {
      expect(meetingStart(null, '13:30', format)).toBeNull();
      expect(meetingStart(new Date(2027, 2, 18), '25:00', format)).toBeNull();
    });
  });
});
