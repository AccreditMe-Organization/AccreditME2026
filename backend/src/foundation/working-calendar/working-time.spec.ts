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
      const holiday = { date: new Date('2026-11-16T00:00:00+03:00'), isRecurring: false } as IPublicHoliday;
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
      const holiday = { date: new Date('2026-11-22T00:00:00+03:00'), isRecurring: false } as IPublicHoliday;
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
});
