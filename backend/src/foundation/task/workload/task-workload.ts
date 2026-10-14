import type { TaskSourceType } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

/**
 * ACC-199 — a person's workload ON ONE RECORD, and the rule for when the
 * picker offers "✦ Suggest someone". Plain functions, so the counts on the
 * picker and the counts the model receives cannot be computed two ways.
 *
 * RECORD-ONLY (Ahmad, 14 Oct, Q4). The counts are the open tasks on the record
 * the dialog was opened from — the committee or meeting — never a person's
 * whole load: the assigner may not be able to see the rest. Whether the caller
 * may see them at all is TaskWorkloadService's decision, made before this runs.
 *
 * "Open" is ACC-65's (anything but COMPLETED and CANCELLED), on an ACTIVE
 * assignee row; ON_HOLD is open. "Overdue" is ACC-163/173's: open, not on hold,
 * due before now. A pool task nobody has picked up has no active row, so it
 * counts for nobody.
 */

/** The record the dialog was opened from. */
export interface IRecordRef {
  sourceType: TaskSourceType;
  sourceId: string;
}

export interface IPersonWorkload {
  open: number;
  overdue: number;
  /** Due within the next 2 working days (the tenant's calendar), not on hold. The model's only. */
  dueSoon: number;
  /** HIGH or CRITICAL. The model's only. */
  urgent: number;
  onHold: number;
}

const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;
const URGENT_PRIORITIES = new Set(['HIGH', 'CRITICAL']);

export function emptyWorkload(): IPersonWorkload {
  return { open: 0, overdue: 0, dueSoon: 0, urgent: 0, onHold: 0 };
}

/**
 * One read for every listed person: their active assignee rows on the
 * record's open tasks. TaskAssignee has no organizationId, so the tenant scope
 * goes through the task — `task: { organizationId }` is what keeps another
 * organisation's rows out, and its spec is named for the isolation gate.
 */
export async function loadRecordWorkload(
  prisma: Pick<PrismaService, 'taskAssignee'>,
  organizationId: string,
  record: IRecordRef,
  userIds: readonly string[],
  options: { now: Date; dueSoonBefore?: Date | null; excludeTaskId?: string },
): Promise<Map<string, IPersonWorkload>> {
  const result = new Map<string, IPersonWorkload>(userIds.map((id) => [id, emptyWorkload()]));
  if (userIds.length === 0) return result;

  const rows = await prisma.taskAssignee.findMany({
    where: {
      userId: { in: [...userIds] },
      removedAt: null,
      task: {
        organizationId,
        sourceType: record.sourceType,
        sourceId: record.sourceId,
        status: { notIn: [...CLOSED_STATUSES] },
        // Reassign: the task being reassigned does not make its holder look busier.
        ...(options.excludeTaskId ? { id: { not: options.excludeTaskId } } : {}),
      },
    },
    select: { userId: true, task: { select: { status: true, dueAt: true, priority: true } } },
  });

  const now = options.now.getTime();
  const soon = options.dueSoonBefore?.getTime() ?? null;
  for (const { userId, task } of rows) {
    const w = result.get(userId);
    if (!w) continue;
    w.open++;
    if (task.status === 'ON_HOLD') {
      w.onHold++;
    } else if (task.dueAt) {
      const due = task.dueAt.getTime();
      if (due < now) w.overdue++;
      else if (soon !== null && due <= soon) w.dueSoon++;
    }
    if (URGENT_PRIORITIES.has(task.priority)) w.urgent++;
  }
  return result;
}

/**
 * Q3 — "✦ Suggest someone" is offered when the chosen person has 50% more open
 * tasks than the least-loaded other eligible person AND at least 3 more. The
 * drawn rule alone fires at 1 against 0; the floor stops that. No others, no
 * offer.
 */
export const THRESHOLD = { ratio: 1.5, minDifference: 3 } as const;

export function isPastThreshold(chosenOpen: number, othersOpen: readonly number[]): boolean {
  if (othersOpen.length === 0) return false;
  const least = Math.min(...othersOpen);
  return chosenOpen >= THRESHOLD.ratio * least && chosenOpen - least >= THRESHOLD.minDifference;
}

/** Q6 — out of office NOW: both dates set and now inside them (ACC-173's reading). */
export function isOutOfOffice(user: { outOfOfficeFrom: Date | null; outOfOfficeTo: Date | null }, now: Date): boolean {
  if (!user.outOfOfficeFrom || !user.outOfOfficeTo) return false;
  const t = now.getTime();
  return user.outOfOfficeFrom.getTime() <= t && t <= user.outOfOfficeTo.getTime();
}
