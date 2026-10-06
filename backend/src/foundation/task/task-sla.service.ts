import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { taskSlaFromSettings } from '../tenant/task-sla-settings';
import { TaskPriority } from '../../../generated/prisma/client';

export const TASK_PRIORITY_ORDER: readonly TaskPriority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// The fields the SLA limit is read from. createdAt stands in for slaStartAt on
// a row from before ACC-174 until the backfill fills it.
export interface TaskSlaFields {
  priority: TaskPriority | string;
  createdAt: Date;
  dueAt: Date | null;
  slaStartAt: Date | null;
  slaLimitAt: Date | null;
  slaExtendedTo: Date | null;
}

export interface SlaWindow {
  dueAt: Date;
  limitAt: Date;
}

// A date as a person reads it, in each language. Server-built text bypasses the
// frontend's formatting layer (ACC-95), so this follows its style by hand:
// day, month as a word, year, 24-hour time, Latin digits in both languages.
export interface PeopleDate {
  en: string;
  ar: string;
}

const PRIORITY_WORDS: Record<string, PeopleDate> = {
  CRITICAL: { en: 'Critical', ar: 'حرجة' },
  HIGH: { en: 'High', ar: 'عالية' },
  MEDIUM: { en: 'Medium', ar: 'متوسطة' },
  LOW: { en: 'Low', ar: 'منخفضة' },
};

export function priorityWords(priority: string): PeopleDate {
  return PRIORITY_WORDS[priority] ?? { en: priority, ar: priority };
}

/**
 * ACC-174 — THE SLA LIMIT, in one place.
 *
 * Every task has a limit: its priority's SLA (Organization.settings.taskSla,
 * dueAfterHours, counted in WORKING hours through WorkingCalendarService) from
 * its SLA start. A due date a PERSON sets may be at or before the limit, never
 * after it. The only ways past it:
 *   - an approved request for more time (ACC-173), which raises the limit to
 *     the approved date — never lowers it — and records that date in
 *     slaExtendedTo, so a later priority change cannot drop below it;
 *   - a stage's own SLA on an engine-created task (temporary, until stage task
 *     definitions, CF-07), recorded the same way.
 *
 * The default due date IS the limit: a task nobody dated is due exactly when
 * its SLA runs out.
 *
 * A row from before ACC-174 has no slaStartAt / slaLimitAt until
 * backfill-acc174-task-sla-limit.ts runs. Until then initialLimit() computes
 * the value the backfill would write, so running the backfill changes nothing
 * a person sees.
 */
@Injectable()
export class TaskSlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workingCalendar: WorkingCalendarService,
  ) {}

  async dueAfterHours(priority: TaskPriority | string, organizationId: string): Promise<number> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { settings: true },
    });
    return taskSlaFromSettings(org?.settings)[priority as TaskPriority].dueAfterHours;
  }

  /** The priority SLA counted from `start`: the default due date, and the limit. */
  async windowFrom(start: Date, priority: TaskPriority | string, organizationId: string): Promise<Date> {
    const hours = await this.dueAfterHours(priority, organizationId);
    return this.shift(start, hours, organizationId);
  }

  /** `date` moved forward by `hours` WORKING hours. Zero moves nothing (ACC-175). */
  async shift(date: Date, hours: number, organizationId: string): Promise<Date> {
    if (hours <= 0) return date;
    const at = await this.workingCalendar.calculateDeadline(DateTime.fromJSDate(date), hours, organizationId);
    return at.toJSDate();
  }

  /** The SLA start: slaStartAt, or createdAt on a row the backfill has not reached. */
  startOf(task: TaskSlaFields): Date {
    return task.slaStartAt ?? task.createdAt;
  }

  /** The limit in force: slaLimitAt, or what the backfill would write. */
  async limitOf(task: TaskSlaFields, organizationId: string): Promise<Date> {
    return task.slaLimitAt ?? this.initialLimit(task, organizationId);
  }

  /**
   * What a row from before ACC-174 gets: the priority SLA from its start, raised
   * to its current due date and any approved extension, so no existing task
   * starts out over its limit. The backfill writes exactly this.
   */
  async initialLimit(task: TaskSlaFields, organizationId: string): Promise<Date> {
    const computed = await this.windowFrom(this.startOf(task), task.priority, organizationId);
    return latest(computed, task.dueAt, task.slaExtendedTo);
  }

  /**
   * The window a priority gives this task, from its own SLA start — what a
   * priority change writes. The limit never drops below an approved extension.
   */
  async windowForPriority(task: TaskSlaFields, priority: TaskPriority | string, organizationId: string): Promise<SlaWindow> {
    const dueAt = await this.windowFrom(this.startOf(task), priority, organizationId);
    return { dueAt, limitAt: latest(dueAt, task.slaExtendedTo) };
  }

  /** Both windows for every priority, for a picker to stop at. */
  async preview(
    start: Date,
    organizationId: string,
    floor: Date | null = null,
  ): Promise<Record<string, SlaWindow>> {
    const result: Record<string, SlaWindow> = {};
    for (const priority of TASK_PRIORITY_ORDER) {
      const dueAt = await this.windowFrom(start, priority, organizationId);
      result[priority] = { dueAt, limitAt: latest(dueAt, floor) };
    }
    return result;
  }

  /**
   * A due date a PERSON sends: in the future, and at or before the limit. A due
   * date recomputed from the SLA is never checked here — it may be in the past
   * (ACC-174, C4).
   */
  async assertPersonDueDate(
    dueAt: Date,
    limitAt: Date,
    priority: TaskPriority | string,
    organizationId: string,
    now: Date = new Date(),
  ): Promise<void> {
    if (dueAt <= now) throw new BadRequestException('The due date must be in the future');
    if (dueAt > limitAt) {
      const date = await this.forPeople(limitAt, organizationId);
      throw new BadRequestException(
        `The due date can't be later than ${date.en}, the SLA limit for ${priorityWords(priority).en} priority`,
      );
    }
  }

  /** A date in the tenant's time zone, in English and Arabic, for server text. */
  async forPeople(date: Date, organizationId: string): Promise<PeopleDate> {
    const zone = await this.workingCalendar.getEffectiveTimeZone(organizationId);
    const at = DateTime.fromJSDate(date).setZone(zone);
    return {
      en: at.setLocale('en-GB').toFormat('d LLL yyyy, HH:mm'),
      ar: at.reconfigure({ locale: 'ar', numberingSystem: 'latn' }).toFormat('d LLLL yyyy، HH:mm'),
    };
  }
}

/** The latest of the dates given, ignoring nulls. The first is required. */
export function latest(first: Date, ...rest: (Date | null | undefined)[]): Date {
  return rest.reduce<Date>((max, d) => (d && d > max ? d : max), first);
}
