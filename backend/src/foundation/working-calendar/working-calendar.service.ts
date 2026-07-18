import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';
import { UpdateWorkingCalendarDto } from './dto/update-working-calendar.dto';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';

const GCC_DEFAULT = {
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4] as number[],
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
};

@Injectable()
export class WorkingCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getOrCreate(organizationId: string): Promise<IWorkingCalendar> {
    const existing = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (existing) return this.toInterface(existing);

    const created = await this.prisma.workingCalendar.create({
      data: { organizationId, ...GCC_DEFAULT },
    });
    return this.toInterface(created);
  }

  async update(
    organizationId: string,
    dto: UpdateWorkingCalendarDto,
    actorId: string,
  ): Promise<IWorkingCalendar> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (!calendar) throw new NotFoundException('Working calendar not found');

    if (dto.timezone !== undefined) {
      if (!IANAZone.isValidZone(dto.timezone)) {
        throw new BadRequestException(`Invalid timezone: ${dto.timezone}`);
      }
    }

    if (dto.workingHoursStart !== undefined && dto.workingHoursEnd !== undefined) {
      if (dto.workingHoursStart >= dto.workingHoursEnd) {
        throw new BadRequestException('workingHoursEnd must be after workingHoursStart');
      }
    }

    const workingDays = dto.workingDays
      ? [...new Set(dto.workingDays)].sort()
      : undefined;

    const updated = await this.prisma.workingCalendar.update({
      where: { organizationId },
      data: {
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(workingDays !== undefined && { workingDays }),
        ...(dto.workingHoursStart !== undefined && { workingHoursStart: dto.workingHoursStart }),
        ...(dto.workingHoursEnd !== undefined && { workingHoursEnd: dto.workingHoursEnd }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkingCalendar',
      objectId: updated.id,
      before: this.toInterface(calendar) as unknown as Record<string, unknown>,
      after: this.toInterface(updated) as unknown as Record<string, unknown>,
    });

    return this.toInterface(updated);
  }

  async addHoliday(
    organizationId: string,
    dto: CreatePublicHolidayDto,
    actorId: string,
  ): Promise<IPublicHoliday> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (!calendar) throw new NotFoundException('Working calendar not found');

    const holiday = await this.prisma.publicHoliday.create({
      data: {
        workingCalendarId: calendar.id,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr ?? null,
        date: new Date(dto.date),
        isRecurring: dto.isRecurring ?? false,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'PublicHoliday',
      objectId: holiday.id,
      after: holiday,
    });

    return this.holidayToInterface(holiday);
  }

  async removeHoliday(
    holidayId: string,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (!calendar) throw new NotFoundException('Working calendar not found');

    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { id: holidayId, workingCalendarId: calendar.id },
    });
    if (!holiday) throw new NotFoundException('Holiday not found');

    await this.prisma.publicHoliday.delete({ where: { id: holidayId } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'PublicHoliday',
      objectId: holidayId,
      before: holiday,
    });
  }

  async listHolidays(organizationId: string, year?: number): Promise<IPublicHoliday[]> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (!calendar) return [];

    const holidays = await this.prisma.publicHoliday.findMany({
      where: { workingCalendarId: calendar.id },
      orderBy: { date: 'asc' },
    });

    if (year === undefined) return holidays.map((h) => this.holidayToInterface(h));

    return holidays
      .filter((h) => {
        if (h.isRecurring) return true;
        return new Date(h.date).getFullYear() === year;
      })
      .map((h) => this.holidayToInterface(h));
  }

  // THE CRITICAL METHOD — used by every module that needs SLA/due dates.
  // Returns the DateTime that is `workingHours` working hours after `start`.
  // O(days) algorithm: accounts for remaining hours in the current working day first,
  // then advances day-by-day, dropping to minute precision only on the final partial day.
  // workingHours = 0 is valid: returns the next working period start (normalizes the input).
  async calculateDeadline(
    start: DateTime,
    workingHours: number,
    organizationId: string,
  ): Promise<DateTime> {
    const calendar = await this.getOrCreate(organizationId);
    const holidays = await this.listHolidays(organizationId);

    const [startHour, startMin] = this.parseHHmm(calendar.workingHoursStart);
    const [endHour, endMin] = this.parseHHmm(calendar.workingHoursEnd);
    const workingHoursPerDay = (endHour * 60 + endMin - (startHour * 60 + startMin)) / 60;

    // Normalize: advance to next valid working period if start is outside one
    let current: DateTime = start.setZone(calendar.timezone);
    current = this.nextWorkingStart(current, calendar, holidays, startHour, startMin, endHour, endMin);

    // Hours remaining in the current working day from `current`
    const todayEnd = current.startOf('day').set({ hour: endHour, minute: endMin }) as DateTime;
    const remainingInToday = todayEnd.diff(current, 'hours').hours;

    let remainingHours = workingHours;

    // Fits entirely within today's remaining working hours
    if (remainingHours <= remainingInToday) {
      return current.plus({ hours: remainingHours }).toUTC();
    }

    // Use up today, then advance to the next working day
    remainingHours -= remainingInToday;
    current = this.nextWorkingDayStart(current, calendar, holidays, startHour, startMin);

    // Subtract full working days until less than one day remains
    while (remainingHours > workingHoursPerDay) {
      remainingHours -= workingHoursPerDay;
      current = this.nextWorkingDayStart(current, calendar, holidays, startHour, startMin);
    }

    return current.plus({ hours: remainingHours }).toUTC();
  }

  private isWorkingDay(
    dt: DateTime,
    calendar: IWorkingCalendar,
    holidays: IPublicHoliday[],
  ): boolean {
    // Luxon weekday: 1=Mon…7=Sun. Modulo 7 maps Sunday (7) → 0, matching our 0=Sun convention.
    if (!calendar.workingDays.includes(dt.weekday % 7)) return false;

    const month = dt.month;
    const day = dt.day;
    const year = dt.year;

    return !holidays.some((h) => {
      const hDate = DateTime.fromJSDate(h.date).setZone(calendar.timezone);
      if (h.isRecurring) return hDate.month === month && hDate.day === day;
      return hDate.month === month && hDate.day === day && hDate.year === year;
    });
  }

  private nextWorkingStart(
    dt: DateTime,
    calendar: IWorkingCalendar,
    holidays: IPublicHoliday[],
    startHour: number,
    startMin: number,
    endHour: number,
    endMin: number,
  ): DateTime {
    const todayStart = dt.startOf('day').set({ hour: startHour, minute: startMin }) as DateTime;
    const todayEnd = dt.startOf('day').set({ hour: endHour, minute: endMin }) as DateTime;

    if (this.isWorkingDay(dt, calendar, holidays) && dt >= todayStart && dt < todayEnd) {
      return dt;
    }

    let candidate = dt.plus({ days: 1 }).startOf('day') as DateTime;
    while (!this.isWorkingDay(candidate, calendar, holidays)) {
      candidate = candidate.plus({ days: 1 }) as DateTime;
    }
    return candidate.set({ hour: startHour, minute: startMin }) as DateTime;
  }

  // Always advances to the START of the next working day — never returns the current day.
  private nextWorkingDayStart(
    current: DateTime,
    calendar: IWorkingCalendar,
    holidays: IPublicHoliday[],
    startHour: number,
    startMin: number,
  ): DateTime {
    let candidate = current.plus({ days: 1 }).startOf('day') as DateTime;
    while (!this.isWorkingDay(candidate, calendar, holidays)) {
      candidate = candidate.plus({ days: 1 }) as DateTime;
    }
    return candidate.set({ hour: startHour, minute: startMin }) as DateTime;
  }

  private parseHHmm(value: string): [number, number] {
    const [h, m] = value.split(':');
    return [parseInt(h ?? '0', 10), parseInt(m ?? '0', 10)];
  }

  private toInterface(record: {
    id: string;
    organizationId: string;
    timezone: string;
    workingDays: number[];
    workingHoursStart: string;
    workingHoursEnd: string;
    createdAt: Date;
    updatedAt: Date;
  }): IWorkingCalendar {
    return {
      id: record.id,
      organizationId: record.organizationId,
      timezone: record.timezone,
      workingDays: record.workingDays,
      workingHoursStart: record.workingHoursStart,
      workingHoursEnd: record.workingHoursEnd,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private holidayToInterface(record: {
    id: string;
    workingCalendarId: string;
    nameEn: string;
    nameAr: string | null;
    date: Date;
    isRecurring: boolean;
    createdAt: Date;
  }): IPublicHoliday {
    return {
      id: record.id,
      workingCalendarId: record.workingCalendarId,
      nameEn: record.nameEn,
      nameAr: record.nameAr,
      date: record.date,
      isRecurring: record.isRecurring,
      createdAt: record.createdAt,
    };
  }
}
