import { FormControl } from '@angular/forms';
import { meetingStart, meetingTimeValidator, timeText, today } from './meeting-when';

// ACC-316 PR 6 — a meeting's start as Schedule and Reschedule take it: a day
// and an HH:mm time, both required, in the browser's zone.
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

  it('meetingStart puts the time on the day, and is null while either is missing or invalid', () => {
    const at = meetingStart(new Date(2027, 2, 18), '13:30')!;
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([2027, 2, 18, 13, 30, 0]);
    expect(meetingStart(null, '13:30')).toBeNull();
    expect(meetingStart(new Date(2027, 2, 18), '25:00')).toBeNull();
  });

  it('timeText and today', () => {
    expect(timeText(new Date(2027, 2, 18, 9, 5))).toBe('09:05');
    const t = today(new Date(2027, 2, 18, 15, 45, 12));
    expect([t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()]).toEqual([18, 0, 0, 0, 0]);
  });
});
