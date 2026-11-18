import { DateTime } from 'luxon';
import type { PrismaService } from '../../prisma/prisma.service';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';

/**
 * ACC-313 — working time, computed from a calendar already loaded. The SLA
 * sweep loads each organisation's calendar ONCE per pass and asks these as
 * often as it needs, so a pass costs two reads per organisation however many
 * tasks it looks at. WorkingCalendarService.calculateDeadline() and
 * workingHoursBetween() are these same functions over a calendar they load
 * themselves, so there is one rule, not two.
 */

/** The calendar fields working time depends on. */
export type WorkingCalendarShape = Pick<
  IWorkingCalendar,
  'timezone' | 'workingDays' | 'workingHoursStart' | 'workingHoursEnd'
>;

export interface LoadedCalendar {
  calendar: WorkingCalendarShape;
  holidays: IPublicHoliday[];
}

/** The calendar an organisation gets until it saves its own. */
export const GCC_DEFAULT_CALENDAR: WorkingCalendarShape = {
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4],
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
};

function parseHHmm(value: string): [number, number] {
  const [h, m] = value.split(':');
  return [parseInt(h ?? '0', 10), parseInt(m ?? '0', 10)];
}

/** The working hours in one working day: end − start (8 for the GCC default). */
export function hoursPerDayOf(calendar: Pick<WorkingCalendarShape, 'workingHoursStart' | 'workingHoursEnd'>): number {
  const [startHour, startMin] = parseHHmm(calendar.workingHoursStart);
  const [endHour, endMin] = parseHHmm(calendar.workingHoursEnd);
  return (endHour * 60 + endMin - (startHour * 60 + startMin)) / 60;
}

/**
 * The organisation's working hours per day, read WITHOUT creating a calendar
 * row: an organisation with none reads the default getOrCreate() would store.
 * A read must not write (getEffectiveTimeZone()'s rule).
 */
export async function readWorkingHoursPerDay(
  prisma: Pick<PrismaService, 'workingCalendar'>,
  organizationId: string,
): Promise<number> {
  const row = await prisma.workingCalendar.findUnique({
    where: { organizationId },
    select: { workingHoursStart: true, workingHoursEnd: true },
  });
  return hoursPerDayOf(row ?? GCC_DEFAULT_CALENDAR);
}

function isWorkingDay(dt: DateTime, { calendar, holidays }: LoadedCalendar): boolean {
  // Luxon weekday: 1=Mon…7=Sun. Modulo 7 maps Sunday (7) → 0, matching our 0=Sun convention.
  if (!calendar.workingDays.includes(dt.weekday % 7)) return false;
  return !holidays.some((h) => {
    // ACC-318 — a holiday is a CALENDAR DAY, stored as midnight UTC of that
    // date. Its day is read in UTC, never in the organisation's zone: in a zone
    // behind UTC, midnight UTC is the evening before, so 25 December would fall
    // on the 24th. `dt` is already the organisation's local day.
    const hDate = DateTime.fromJSDate(h.date, { zone: 'utc' });
    if (h.isRecurring) return hDate.month === dt.month && hDate.day === dt.day;
    return hDate.month === dt.month && hDate.day === dt.day && hDate.year === dt.year;
  });
}

/**
 * ACC-319 — a day's working window as two real instants in the calendar's
 * zone. The difference between them is that day's REAL working hours: one
 * fewer, or one more, on a day the clocks change inside the window. Both the
 * deadline and the hours-between maths read a day through this, so they agree.
 */
function windowOf(day: DateTime, calendar: WorkingCalendarShape): { open: DateTime; close: DateTime } {
  const [startHour, startMin] = parseHHmm(calendar.workingHoursStart);
  const [endHour, endMin] = parseHHmm(calendar.workingHoursEnd);
  const midnight = day.startOf('day');
  return { open: midnight.set({ hour: startHour, minute: startMin }), close: midnight.set({ hour: endHour, minute: endMin }) };
}

function nextWorkingStart(dt: DateTime, loaded: LoadedCalendar): DateTime {
  const [startHour, startMin] = parseHHmm(loaded.calendar.workingHoursStart);
  const [endHour, endMin] = parseHHmm(loaded.calendar.workingHoursEnd);
  const todayStart = dt.startOf('day').set({ hour: startHour, minute: startMin });
  const todayEnd = dt.startOf('day').set({ hour: endHour, minute: endMin });

  if (isWorkingDay(dt, loaded)) {
    // ACC-175 — before opening, the whole working day is still ahead: the
    // clock starts at today's opening, not the next working day's.
    if (dt < todayStart) return todayStart;
    if (dt < todayEnd) return dt;
  }
  return nextWorkingDayStart(dt, loaded);
}

// Always advances to the START of the next working day — never returns the current day.
function nextWorkingDayStart(current: DateTime, loaded: LoadedCalendar): DateTime {
  const [startHour, startMin] = parseHHmm(loaded.calendar.workingHoursStart);
  let candidate = current.plus({ days: 1 }).startOf('day');
  while (!isWorkingDay(candidate, loaded)) {
    candidate = candidate.plus({ days: 1 });
  }
  return candidate.set({ hour: startHour, minute: startMin });
}

/**
 * The instant `workingHours` working hours after `start`. workingHours = 0 is
 * the next working moment: `start` itself inside working hours, today's
 * opening before it on a working day (ACC-175), else the next working day's
 * opening. The inverse of hoursBetweenWith().
 */
export function deadlineWith(loaded: LoadedCalendar, start: DateTime, workingHours: number): DateTime {
  // Normalize: advance to next valid working period if start is outside one
  let current = nextWorkingStart(start.setZone(loaded.calendar.timezone), loaded);
  let remainingHours = workingHours;

  // ACC-319 — each day gives what is REALLY left of its window (elapsed time,
  // so a day the clocks change gives one hour fewer or more), never a fixed
  // end − start. The remainder lands inside the day that holds it.
  for (;;) {
    const availableToday = windowOf(current, loaded.calendar).close.diff(current, 'hours').hours;
    if (remainingHours <= availableToday) return current.plus({ hours: remainingHours }).toUTC();
    remainingHours -= availableToday;
    current = nextWorkingDayStart(current, loaded);
  }
}

/**
 * The WORKING hours in [from, to): how much of the organisation's working time
 * (working days, working hours, minus holidays, in the calendar's own zone)
 * falls inside it. Zero when `to` is at or before `from`. Day by day, summing
 * each working day's overlap with the interval.
 */
export function hoursBetweenWith(loaded: LoadedCalendar, from: DateTime, to: DateTime): number {
  if (to <= from) return 0;
  const { calendar } = loaded;

  const start = from.setZone(calendar.timezone);
  const end = to.setZone(calendar.timezone);

  let total = 0;
  for (let day = start.startOf('day'); day < end; day = day.plus({ days: 1 })) {
    if (!isWorkingDay(day, loaded)) continue;
    // ACC-319 — the same window deadlineWith() reads, so the two agree.
    const { open, close } = windowOf(day, calendar);
    const overlapStart = open > start ? open : start;
    const overlapEnd = close < end ? close : end;
    if (overlapEnd > overlapStart) {
      total += overlapEnd.diff(overlapStart, 'hours').hours;
    }
  }
  return total;
}

/** Whether `at` falls inside working hours on a working day, in the calendar's zone. */
export function isWorkingMomentWith(loaded: LoadedCalendar, at: DateTime): boolean {
  const local = at.setZone(loaded.calendar.timezone);
  if (!isWorkingDay(local, loaded)) return false;
  const [startHour, startMin] = parseHHmm(loaded.calendar.workingHoursStart);
  const [endHour, endMin] = parseHHmm(loaded.calendar.workingHoursEnd);
  const minutes = local.hour * 60 + local.minute;
  return minutes >= startHour * 60 + startMin && minutes < endHour * 60 + endMin;
}
