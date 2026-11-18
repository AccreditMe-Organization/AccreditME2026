import { BadRequestException } from '@nestjs/common';
import { WorkingCalendarService } from './working-calendar.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { IWorkingCalendar } from './interfaces/working-calendar.interface';
import type { IPublicHoliday } from './interfaces/public-holiday.interface';

/**
 * ACC-316 PR 3a — working DAYS: nextWorkingDay() and addWorkingDays(), for a
 * meeting series' weekend and holiday moves and the minutes review's date.
 * Days are ISO dates in the calendar's own zone; the calendar is real, its
 * reads are stubbed.
 */

const ORG = 'org-riyadh';
const CALENDAR = {
  id: 'cal',
  organizationId: ORG,
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4], // Sun–Thu
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
} as unknown as IWorkingCalendar;

// November 2026: Thu 19, Fri 20, Sat 21, Sun 22, Mon 23, Tue 24.
const holiday = (date: string, isRecurring = false) =>
  ({ id: date, workingCalendarId: 'cal', nameEn: 'Holiday', nameAr: null, date: new Date(`${date}T00:00:00.000Z`), isRecurring }) as unknown as IPublicHoliday;

function service(holidays: IPublicHoliday[] = [], calendar: IWorkingCalendar = CALENDAR): WorkingCalendarService {
  const s = new WorkingCalendarService({} as PrismaService, {} as AuditLogService);
  // The calendar is read once, read-only (loadCalendar(), ACC-313).
  jest.spyOn(s, 'loadCalendar').mockResolvedValue({ calendar, holidays });
  return s;
}

describe('WorkingCalendarService working days (ACC-316)', () => {
  describe('nextWorkingDay', () => {
    it('keeps a working day as it is', async () => {
      await expect(service().nextWorkingDay('2026-11-19', ORG)).resolves.toBe('2026-11-19');
    });

    it('moves a weekend day to the next working day', async () => {
      await expect(service().nextWorkingDay('2026-11-20', ORG)).resolves.toBe('2026-11-22');
      await expect(service().nextWorkingDay('2026-11-21', ORG)).resolves.toBe('2026-11-22');
    });

    it('moves over a holiday, and over a weekend and a holiday together', async () => {
      await expect(service([holiday('2026-11-22')]).nextWorkingDay('2026-11-20', ORG)).resolves.toBe('2026-11-23');
      // A recurring holiday holds in any year.
      await expect(service([holiday('2025-11-23', true)]).nextWorkingDay('2026-11-23', ORG)).resolves.toBe('2026-11-24');
    });
  });

  describe('addWorkingDays', () => {
    it('counts working days after the day, never the day itself', async () => {
      // Thu 19 + 1 → Sun 22 (Fri and Sat are the weekend).
      await expect(service().addWorkingDays('2026-11-19', 1, ORG)).resolves.toBe('2026-11-22');
      // Five working days after Thu 19: Sun 22, Mon 23, Tue 24, Wed 25, Thu 26.
      await expect(service().addWorkingDays('2026-11-19', 5, ORG)).resolves.toBe('2026-11-26');
    });

    it('skips holidays', async () => {
      await expect(service([holiday('2026-11-23')]).addWorkingDays('2026-11-19', 5, ORG)).resolves.toBe('2026-11-29');
    });

    it('refuses a count below 1', async () => {
      await expect(service().addWorkingDays('2026-11-19', 0, ORG)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('refuses a day that is not a yyyy-MM-dd date', async () => {
    await expect(service().nextWorkingDay('19/11/2026', ORG)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses, rather than loops, on a calendar with no working day', async () => {
    const none = { ...CALENDAR, workingDays: [] } as unknown as IWorkingCalendar;
    await expect(service([], none).nextWorkingDay('2026-11-19', ORG)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service([], none).addWorkingDays('2026-11-19', 1, ORG)).rejects.toBeInstanceOf(BadRequestException);
  });
});
