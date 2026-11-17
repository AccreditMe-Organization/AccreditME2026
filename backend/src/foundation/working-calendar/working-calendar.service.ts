import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IWorkingCalendarChange } from './interfaces/working-calendar-change.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';
import { UpdateWorkingCalendarDto } from './dto/update-working-calendar.dto';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import {
  GCC_DEFAULT_CALENDAR,
  LoadedCalendar,
  deadlineWith,
  hoursBetweenWith,
  readWorkingHoursPerDay,
} from './working-time';

const GCC_DEFAULT = { ...GCC_DEFAULT_CALENDAR, workingDays: [...GCC_DEFAULT_CALENDAR.workingDays] };

@Injectable()
export class WorkingCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Who changed the working calendar, when, and what it was before.
   *
   * ACC-120 slice 1. A READ over rows that already existed: every calendar
   * update in this service writes an AuditLog entry with `actorId`, `before`
   * and `after`, and the table is indexed on `(objectType, objectId)` — so this
   * query is already covered by an index rather than needing one.
   *
   * SCOPED BY organizationId AND objectId TOGETHER, in one `where`. The
   * calendar id alone would be enough to find the row, which is exactly why it
   * is not enough to ask with: the rule is that a tenant-scoped read names its
   * tenant in the same clause, so a wrong or guessed id cannot reach another
   * tenant's history.
   *
   * BOUNDED, NOT PAGINATED. `take` caps it at the most recent changes, because
   * a settings page's history answers "what changed lately" and an unbounded
   * read of an append-only table grows without limit. Paging it would be a
   * design decision about a surface that is not drawn yet, so the cap is
   * stated here instead of a page size being invented.
   */
  async getChangeHistory(
    organizationId: string,
    limit = 20,
  ): Promise<IWorkingCalendarChange[]> {
    const calendar = await this.getOrCreate(organizationId);

    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        objectType: 'WorkingCalendar',
        objectId: calendar.id,
      },
      select: {
        id: true,
        createdAt: true,
        before: true,
        after: true,
        actor: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      changedAt: row.createdAt,
      // `?? null` rather than a fallback string: a missing actor is the
      // caller's to word, and it is genuinely missing rather than unknown.
      actorName: row.actor?.name ?? null,
      before: row.before,
      after: row.after,
    }));
  }

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

  // ACC-94 (D3) — the tenant's time zone for display. It must be the zone the
  // SLA engine computes due dates in, so "due" on screen and "due" in the
  // engine cannot disagree: the calendar row's zone, or the GCC default that
  // getOrCreate() would store. Read-only on purpose — GET /auth/me calls this,
  // and a read must not create a calendar row. WorkingCalendar.timezone is the
  // organisation's ONLY time zone (ACC-97): Organization.timezone is retired,
  // read and written by nothing, and its column is dropped in a later step.
  async getEffectiveTimeZone(organizationId: string): Promise<string> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
      select: { timezone: true },
    });
    return calendar?.timezone ?? GCC_DEFAULT.timezone;
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

  async updateHoliday(
    holidayId: string,
    organizationId: string,
    dto: UpdatePublicHolidayDto,
    actorId: string,
  ): Promise<IPublicHoliday> {
    const calendar = await this.prisma.workingCalendar.findUnique({
      where: { organizationId },
    });
    if (!calendar) throw new NotFoundException('Working calendar not found');

    const holiday = await this.prisma.publicHoliday.findFirst({
      where: { id: holidayId, workingCalendarId: calendar.id },
    });
    if (!holiday) throw new NotFoundException('Holiday not found');

    const updated = await this.prisma.publicHoliday.update({
      where: { id: holidayId },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.date !== undefined && { date: new Date(dto.date) }),
        ...(dto.isRecurring !== undefined && { isRecurring: dto.isRecurring }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'PublicHoliday',
      objectId: updated.id,
      before: holiday,
      after: updated,
    });

    return this.holidayToInterface(updated);
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

  /**
   * ACC-313 — the calendar and its holidays, loaded once, for the pure
   * working-time helpers (working-time.ts). The SLA sweep calls this once per
   * organisation per pass and reuses it for every task.
   */
  async loadCalendar(organizationId: string): Promise<LoadedCalendar> {
    const calendar = await this.getOrCreate(organizationId);
    const holidays = await this.listHolidays(organizationId);
    return { calendar, holidays };
  }

  /** ACC-313 — working hours in one working day (end − start), read without creating a row. */
  workingHoursPerDay(organizationId: string): Promise<number> {
    return readWorkingHoursPerDay(this.prisma, organizationId);
  }

  /** Pure: `workingHours` working hours after `start`, on a calendar already loaded. */
  deadlineWith(loaded: LoadedCalendar, start: DateTime, workingHours: number): DateTime {
    return deadlineWith(loaded, start, workingHours);
  }

  /** Pure: the working hours in [from, to), on a calendar already loaded. */
  hoursBetweenWith(loaded: LoadedCalendar, from: DateTime, to: DateTime): number {
    return hoursBetweenWith(loaded, from, to);
  }

  // THE CRITICAL METHOD — used by every module that needs SLA/due dates.
  // Returns the DateTime that is `workingHours` working hours after `start`.
  // O(days) algorithm: accounts for remaining hours in the current working day first,
  // then advances day-by-day, dropping to minute precision only on the final partial day.
  // workingHours = 0 is valid: returns the next working moment (normalizes the input) —
  // `start` itself inside working hours, today's opening before it on a working day
  // (ACC-175), else the next working day's opening.
  // A start before opening on a working day counts that day's full working hours
  // (ACC-175), so this stays the inverse of workingHoursBetween().
  // ACC-313 — the arithmetic is deadlineWith() (working-time.ts), shared with the sweep.
  async calculateDeadline(
    start: DateTime,
    workingHours: number,
    organizationId: string,
  ): Promise<DateTime> {
    return deadlineWith(await this.loadCalendar(organizationId), start, workingHours);
  }

  // ACC-173 — the WORKING hours between two instants: how much of the
  // tenant's working time (working days, working hours, minus holidays, in the
  // calendar's own zone) falls inside [from, to). The inverse of
  // calculateDeadline(): a task held from `from` to `to` resumes with its due
  // date moved forward by exactly this many working hours.
  //
  // Holds are capped at 90 days, so the loop is short. A `to` at or before
  // `from` is zero, and reads nothing. ACC-313 — the arithmetic is
  // hoursBetweenWith() (working-time.ts), shared with the sweep.
  async workingHoursBetween(from: DateTime, to: DateTime, organizationId: string): Promise<number> {
    if (to <= from) return 0;
    return hoursBetweenWith(await this.loadCalendar(organizationId), from, to);
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
