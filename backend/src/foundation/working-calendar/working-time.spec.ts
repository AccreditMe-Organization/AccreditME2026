import { DateTime } from 'luxon';
import {
  GCC_DEFAULT_CALENDAR,
  LoadedCalendar,
  deadlineWith,
  hoursBetweenWith,
  hoursPerDayOf,
  isWorkingMomentWith,
  readWorkingHoursPerDay,
} from './working-time';
import { IPublicHoliday } from './interfaces/public-holiday.interface';

// ACC-313 — the pure working-time helpers the SLA sweep reuses with a calendar
// loaded once. WorkingCalendarService.calculateDeadline() and
// workingHoursBetween() are these functions (their own specs stay unchanged and
// green); these cases pin the helpers directly.

const GCC: LoadedCalendar = { calendar: GCC_DEFAULT_CALENDAR, holidays: [] };
const riyadh = (iso: string) => DateTime.fromISO(iso, { zone: 'Asia/Riyadh' });

describe('working time (ACC-313)', () => {
  it('a working day is end − start: 8 for the GCC default, 8.5 for 07:00–15:30', () => {
    expect(hoursPerDayOf(GCC_DEFAULT_CALENDAR)).toBe(8);
    expect(hoursPerDayOf({ workingHoursStart: '07:00', workingHoursEnd: '15:30' })).toBe(8.5);
  });

  it('reads the working day without creating a calendar row, and an organisation with none reads the default', async () => {
    const findUnique = jest.fn().mockResolvedValueOnce({ workingHoursStart: '07:00', workingHoursEnd: '15:30' }).mockResolvedValueOnce(null);
    const prisma = { workingCalendar: { findUnique, create: jest.fn() } };

    await expect(readWorkingHoursPerDay(prisma as never, 'org-a')).resolves.toBe(8.5);
    await expect(readWorkingHoursPerDay(prisma as never, 'org-b')).resolves.toBe(8);

    expect(findUnique).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      select: { workingHoursStart: true, workingHoursEnd: true },
    });
    expect(prisma.workingCalendar.create).not.toHaveBeenCalled();
  });

  describe('a working moment', () => {
    it.each([
      ['Sunday 08:00, the opening', '2026-11-15T08:00', true],
      ['Thursday 15:59', '2026-11-19T15:59', true],
      ['Thursday 16:00, the close', '2026-11-19T16:00', false],
      ['Sunday 07:59, before opening', '2026-11-15T07:59', false],
      ['Friday 10:00, the weekend', '2026-11-20T10:00', false],
    ])('%s → %s', (_case, at, expected) => {
      expect(isWorkingMomentWith(GCC, riyadh(at))).toBe(expected);
    });

    it('is read in the calendar’s zone, whatever zone the instant carries', () => {
      // 05:30 UTC is 08:30 in Riyadh.
      expect(isWorkingMomentWith(GCC, DateTime.fromISO('2026-11-15T05:30Z'))).toBe(true);
    });

    it('a holiday is not a working moment', () => {
      // ACC-318 — stored as the app stores it: the date ("2026-11-16") at midnight UTC.
      const holiday = { date: new Date('2026-11-16T00:00:00Z'), isRecurring: false } as IPublicHoliday;
      expect(isWorkingMomentWith({ ...GCC, holidays: [holiday] }, riyadh('2026-11-16T10:00'))).toBe(false);
    });
  });

  describe('deadlines and working hours', () => {
    it('Thursday 14:00 + 4 working hours is Sunday 10:00, across the weekend', () => {
      const due = deadlineWith(GCC, riyadh('2026-11-19T14:00'), 4);
      expect(due.toISO()).toBe(riyadh('2026-11-22T10:00').toUTC().toISO());
    });

    it('an overdue task from Thursday 14:00 to Sunday 10:00 is 4 working hours late, not 68', () => {
      expect(hoursBetweenWith(GCC, riyadh('2026-11-19T14:00'), riyadh('2026-11-22T10:00'))).toBe(4);
    });

    it('the two are inverses over a holiday as well', () => {
      const holiday = { date: new Date('2026-11-22T00:00:00Z'), isRecurring: false } as IPublicHoliday;
      const loaded = { ...GCC, holidays: [holiday] };
      const start = riyadh('2026-11-19T14:00');
      const due = deadlineWith(loaded, start, 4);
      // Sunday is the holiday, so the fourth hour lands on Monday.
      expect(due.toISO()).toBe(riyadh('2026-11-23T10:00').toUTC().toISO());
      expect(hoursBetweenWith(loaded, start, due)).toBe(4);
    });

    it('nothing is counted for an interval that ends before it starts', () => {
      expect(hoursBetweenWith(GCC, riyadh('2026-11-22T10:00'), riyadh('2026-11-19T14:00'))).toBe(0);
    });
  });

  // ACC-318 — a holiday is a calendar day, stored as that date at midnight UTC
  // (the screen sends "YYYY-MM-DD"), and read as that date in every zone.
  describe('a holiday is its calendar day in every zone (ACC-318)', () => {
    const everyDay = { workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '08:00', workingHoursEnd: '16:00' };
    const christmas = { date: new Date('2026-12-25T00:00:00Z'), isRecurring: false } as IPublicHoliday;
    const at = (zone: string, iso: string) => DateTime.fromISO(iso, { zone });

    it.each(['America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Asia/Riyadh', 'Asia/Tokyo'])(
      '%s: 25 December is the holiday, and 24 December is a working day',
      (zone) => {
        const loaded: LoadedCalendar = { calendar: { timezone: zone, ...everyDay }, holidays: [christmas] };
        expect(isWorkingMomentWith(loaded, at(zone, '2026-12-25T10:00'))).toBe(false);
        expect(isWorkingMomentWith(loaded, at(zone, '2026-12-24T10:00'))).toBe(true);
        expect(isWorkingMomentWith(loaded, at(zone, '2026-12-26T10:00'))).toBe(true);
      },
    );

    it('a recurring holiday falls on its date every year, west of UTC too', () => {
      const recurring = { date: new Date('2024-12-25T00:00:00Z'), isRecurring: true } as IPublicHoliday;
      const loaded: LoadedCalendar = { calendar: { timezone: 'America/New_York', ...everyDay }, holidays: [recurring] };
      expect(isWorkingMomentWith(loaded, at('America/New_York', '2026-12-25T10:00'))).toBe(false);
      expect(isWorkingMomentWith(loaded, at('America/New_York', '2026-12-24T10:00'))).toBe(true);
    });

    it('a deadline steps over the holiday on its own day, in New York', () => {
      const loaded: LoadedCalendar = { calendar: { timezone: 'America/New_York', ...everyDay }, holidays: [christmas] };
      // Thursday 24 Dec 14:00 + 4h: 2h on the 24th, the 25th is the holiday, 2h on the 26th.
      expect(deadlineWith(loaded, at('America/New_York', '2026-12-24T14:00'), 4).toISO()).toBe(
        at('America/New_York', '2026-12-26T10:00').toUTC().toISO(),
      );
    });
  });

  // ACC-319 — a day the clocks change inside the working window has one hour
  // fewer or more. Both functions count each day's REAL hours, so they agree,
  // and a deadline never lands after the window closes.
  describe('a day the clocks change (ACC-319)', () => {
    const london: LoadedCalendar = {
      calendar: { timezone: 'Europe/London', workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '00:00', workingHoursEnd: '08:00' },
      holidays: [],
    };
    const ldn = (iso: string) => DateTime.fromISO(iso, { zone: 'Europe/London' });

    it('29 March 2026 (clocks forward at 01:00) has 7 working hours, 25 October 2026 (back at 02:00) has 9', () => {
      expect(hoursBetweenWith(london, ldn('2026-03-29T00:00'), ldn('2026-03-30T00:00'))).toBe(7);
      expect(hoursBetweenWith(london, ldn('2026-10-25T00:00'), ldn('2026-10-26T00:00'))).toBe(9);
    });

    it('29 March: 8 hours from the opening run past the 7-hour day into Monday, never after Sunday’s close', () => {
      const due = deadlineWith(london, ldn('2026-03-29T00:00'), 8);
      expect(due.toISO()).toBe(ldn('2026-03-30T01:00').toUTC().toISO());
      expect(hoursBetweenWith(london, ldn('2026-03-29T00:00'), due)).toBe(8);
    });

    it('28–29 March: two days from Saturday’s opening are 8 + 7 + 1, landing Monday 01:00', () => {
      const due = deadlineWith(london, ldn('2026-03-28T00:00'), 16);
      expect(due.toISO()).toBe(ldn('2026-03-30T01:00').toUTC().toISO());
      expect(hoursBetweenWith(london, ldn('2026-03-28T00:00'), due)).toBe(16);
    });

    it('24–25 October: 17 hours from Saturday’s opening fill the 9-hour Sunday exactly, ending at its close', () => {
      const due = deadlineWith(london, ldn('2026-10-24T00:00'), 17);
      expect(due.toISO()).toBe(ldn('2026-10-25T08:00').toUTC().toISO());
      expect(hoursBetweenWith(london, ldn('2026-10-24T00:00'), due)).toBe(17);
    });

    it.each([1, 7, 8, 9, 15, 16, 17, 24, 40])('round trip over both changes: %i hours there and back', (hours) => {
      for (const from of ['2026-03-27T03:00', '2026-03-29T00:30', '2026-10-23T05:00', '2026-10-25T01:30']) {
        const due = deadlineWith(london, ldn(from), hours);
        expect({ from, hours, back: hoursBetweenWith(london, ldn(from), due) }).toEqual({ from, hours, back: hours });
        // Never after the close of the day it lands on.
        const local = due.setZone('Europe/London');
        expect(local.hour * 60 + local.minute).toBeLessThanOrEqual(8 * 60);
      }
    });

    it('Riyadh is unchanged: a week of 8-hour days, Thursday 14:00 + 20h is Tuesday 10:00', () => {
      expect(deadlineWith(GCC, riyadh('2026-11-19T14:00'), 20).toISO()).toBe(riyadh('2026-11-24T10:00').toUTC().toISO());
    });
  });
});
