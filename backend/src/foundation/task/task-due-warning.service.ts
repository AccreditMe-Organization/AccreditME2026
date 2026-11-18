import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, TaskStatus } from '../../../generated/prisma/client';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { deadlineWith, hoursPerDayOf, isWorkingMomentWith } from '../working-calendar/working-time';
import { NotificationService } from '../notification/notification.service';
import {
  DEFAULT_TASK_SLA_SETTINGS,
  taskSlaFromSettings,
  taskSlaNoticesFromSettings,
  warnHours,
  warningFitsLimit,
} from '../tenant/task-sla-settings';
import { CURRENT_ACTIVE_ASSIGNEE, PoolTarget, poolKey, poolTargetOf, resolvePoolMembersBatch } from './task-pool';
import { peopleDateIn } from './task-sla.service';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Open and held by someone, or waiting in a pool: ON_HOLD, closed, UNASSIGNED and REJECTED are left out. */
export const DUE_WARNING_STATUSES: TaskStatus[] = ['PENDING', 'IN_PROGRESS'];

/** The source the reminders' audit row names. */
export const DUE_WARNING_SOURCE = 'task-due-warning';

interface WarningCandidate {
  id: string;
  title: string;
  dueAt: Date | null;
  assignedOrgUnitId: string | null;
  assignedPositionId: string | null;
  assignedCommitteeId: string | null;
  assignedCommitteeRoleValueId: string | null;
  /** Only the rows that put someone on the task (CURRENT_ACTIVE_ASSIGNEE). */
  assignees: { userId: string }[];
}

/**
 * ACC-313 PR 4 — "Warn before due": a reminder, in the app only (Q3), once per
 * due time, to the people on a task whose due time is inside its priority's
 * warning window.
 *
 * RUN BY THE SLA MONITOR, every 15 minutes, as its own isolated step
 * (sweepDueWarnings), so it runs only where the queue workers do (ACC-92). It
 * never runs on a request.
 *
 * AT MOST ONCE PER DUE TIME. Task.dueWarnedAt is set by ONE conditional write,
 * `… AND "dueWarnedAt" IS NULL RETURNING id`, so two workers claim each task
 * once. The claim commits before any notice is written. A failed notice is
 * logged with the ids and not retried: a missed reminder is better than two.
 * The stamp is cleared where the due time stops being the one reminded about
 * (DUE_WARNING_CLEARED, plan §3.3).
 *
 * WHO IS TOLD. "Someone is on it" is ACC-86's one definition,
 * CURRENT_ACTIVE_ASSIGNEE (a current row held by an ACTIVE user). A task
 * someone is on: those people, never their acting users (ACC-271 PR 4's rule).
 * A task with a pool and nobody on it (a current row held by someone no longer
 * ACTIVE counts as nobody): the pool's members, by the pool's own rule,
 * resolved in one batch. Whoever picks it up afterwards gets no second reminder
 * (Q5). A task with no pool and nobody on it is not picked and not claimed.
 */
@Injectable()
export class TaskDueWarningService {
  private readonly logger = new Logger(TaskDueWarningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notifications: NotificationService,
  ) {}

  /** One pass, across every organisation with any warning on. */
  async sweep(now: Date): Promise<void> {
    // One read: the organisations with at least one priority not Off.
    const organisations = await this.prisma.$queryRaw<
      { id: string; taskSla: Prisma.JsonValue; taskSlaNotices: Prisma.JsonValue }[]
    >`
      SELECT id, settings->'taskSla' AS "taskSla", settings->'taskSlaNotices' AS "taskSlaNotices"
      FROM "Organization"
      WHERE jsonb_typeof(settings->'taskSlaNotices'->'warnBeforeDue') = 'object'
        AND EXISTS (
          SELECT 1 FROM jsonb_each_text(settings->'taskSlaNotices'->'warnBeforeDue') AS w
          WHERE w.value <> 'OFF'
        )`;

    // Each organisation on its own, so one that fails does not keep the others'
    // reminders from going. The step still fails, so the failure is visible.
    const failed: string[] = [];
    for (const org of organisations) {
      try {
        await this.sweepOrganization(org.id, { taskSla: org.taskSla, taskSlaNotices: org.taskSlaNotices }, now);
      } catch (err) {
        failed.push(org.id);
        this.logger.error(
          `Due-soon reminders failed for organisation ${org.id}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
    if (failed.length > 0) {
      throw new Error(`Due-soon reminders failed for ${failed.length} organisation(s): ${failed.join(', ')}`);
    }
  }

  private async sweepOrganization(organizationId: string, settings: unknown, now: Date): Promise<void> {
    const loaded = await this.workingCalendar.loadCalendar(organizationId);
    const at = DateTime.fromJSDate(now);
    // Nobody is reminded outside working hours: a task due at 09:00 Sunday with
    // a 1h warning is told at 08:00 Sunday, never at 02:00.
    if (!isWorkingMomentWith(loaded, at)) return;

    const notices = taskSlaNoticesFromSettings(settings);
    const tiers = taskSlaFromSettings(settings);
    const hoursPerDay = hoursPerDayOf(loaded.calendar);
    const windows: Prisma.TaskWhereInput[] = [];
    for (const priority of PRIORITIES) {
      const warning = notices.warnBeforeDue[priority];
      const limitHours = tiers[priority]?.dueAfterHours ?? DEFAULT_TASK_SLA_SETTINGS[priority].dueAfterHours;
      // Off, or no longer shorter than the limit (a calendar change can do that
      // to "1 working day"): treated as Off (§3.1).
      if (warning === 'OFF' || !warningFitsLimit(warning, limitHours, hoursPerDay)) continue;
      const threshold = deadlineWith(loaded, at, warnHours(warning, hoursPerDay)).toJSDate();
      windows.push({ priority, dueAt: { gt: now, lte: threshold } });
    }
    if (windows.length === 0) return;

    const candidates: WarningCandidate[] = await this.prisma.task.findMany({
      where: {
        organizationId,
        dueWarnedAt: null,
        status: { in: DUE_WARNING_STATUSES },
        AND: [
          { OR: windows },
          // Held by someone (ACC-86's one definition: a current row held by an
          // ACTIVE user), or waiting in a pool: someone to tell. A task with no
          // pool and nobody ACTIVE on it is not picked, so it is not claimed and
          // a later holder can still be reminded.
          {
            OR: [
              { assignees: { some: CURRENT_ACTIVE_ASSIGNEE } },
              { assignedPositionId: { not: null } },
              { assignedCommitteeId: { not: null } },
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        assignedOrgUnitId: true,
        assignedPositionId: true,
        assignedCommitteeId: true,
        assignedCommitteeRoleValueId: true,
        assignees: { where: CURRENT_ACTIVE_ASSIGNEE, select: { userId: true } },
      },
    });
    if (candidates.length === 0) return;

    // The claim: each task once, even with two workers. It commits here, before
    // any notice is written.
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Task" SET "dueWarnedAt" = ${now}
      WHERE "organizationId" = ${organizationId}
        AND id = ANY(${candidates.map((c) => c.id)}::text[])
        AND "dueWarnedAt" IS NULL
      RETURNING id`;
    const claimedIds = new Set(claimed.map((c) => c.id));
    const tasks = candidates.filter((c) => claimedIds.has(c.id));
    if (tasks.length === 0) return;

    try {
      await this.notify(organizationId, tasks, loaded.calendar.timezone);
    } catch (err) {
      this.logger.error(
        `Due-soon reminders were claimed but not sent for organisation ${organizationId}, tasks ${tasks.map((t) => t.id).join(', ')}: ` +
          `${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  private async notify(organizationId: string, tasks: WarningCandidate[], zone: string): Promise<void> {
    const waiting = new Map<string, PoolTarget>();
    for (const task of tasks) {
      const target = task.assignees.length === 0 ? poolTargetOf(task) : null;
      if (target) waiting.set(task.id, target);
    }
    const pools: Map<string, string[]> =
      waiting.size > 0 ? await resolvePoolMembersBatch(this.prisma, [...waiting.values()], organizationId) : new Map();

    const rows = tasks.flatMap((task) => {
      const pool = waiting.get(task.id);
      const recipients = pool
        ? (pools.get(poolKey(pool)) ?? [])
        : task.assignees.map((a) => a.userId);
      const due = peopleDateIn(task.dueAt as Date, zone);
      return [...new Set(recipients)].map((userId) => ({
        userId,
        titleEn: 'Task due soon',
        titleAr: 'اقترب موعد استحقاق مهمة',
        bodyEn: `"${task.title}" is due ${due.en}.`,
        bodyAr: `يحين موعد استحقاق المهمة "${task.title}" في ${due.ar}.`,
        objectType: 'Task',
        objectId: task.id,
      }));
    });
    await this.notifications.createInAppMany(rows, organizationId, DUE_WARNING_SOURCE);
  }
}
