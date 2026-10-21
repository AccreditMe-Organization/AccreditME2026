import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { TaskVisibilityService } from '../task-visibility.service';
import { taskKeyOf } from '../task-record-types';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { AssignmentViewer, TaskAssignmentService } from '../task-assignment.service';
import { IAssignableHolder } from '../interfaces/task-assignment.interface';
import {
  IPersonWorkload,
  IRecordRef,
  isOutOfOffice,
  isPastThreshold,
  loadRecordWorkload,
} from './task-workload';

/** The people lists, as the controller passes them. */
export interface HolderQuery {
  orgUnitId: string;
  positionId: string;
  taskId?: string;
  record?: IRecordRef | null;
}

export interface CommitteeMemberQuery {
  committeeId: string;
  roleValueId: string;
  taskId?: string;
  record?: IRecordRef | null;
}

/** One eligible person, with what the threshold and the model need. */
export interface IWorkloadPerson {
  holder: IAssignableHolder;
  workload: IPersonWorkload;
  outOfOffice: boolean;
}

/**
 * ACC-199 — the picker's people lists with each person's workload ON THE
 * RECORD, and the same counts for "✦ Suggest someone".
 *
 * WHO SEES COUNTS (Ahmad, 14 Oct, Q4): exactly whoever could already see the
 * record's task list — GET /tasks?sourceType=&sourceId= — which is tasks:view
 * AND ObjectVisibilityService on the record (ACC-101). That list shows every
 * task on the record, so a caller sees all of these counts or none. No new
 * permission. When the rule fails, or no record is named, the list is returned
 * with `workload: null` — never an error, because the picker itself answers to
 * different rules (tasks:create, or reassigning this task) and must keep
 * working.
 */
@Injectable()
export class TaskWorkloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assignment: TaskAssignmentService,
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly visibility: TaskVisibilityService,
  ) {}

  async listHolders(viewer: AssignmentViewer, organizationId: string, query: HolderQuery): Promise<IAssignableHolder[]> {
    const holders = await this.assignment.listHolders(viewer, organizationId, query.orgUnitId, query.positionId, query.taskId);
    return this.withWorkload(viewer, organizationId, holders, query.record ?? null, query.taskId);
  }

  async listCommitteeMembers(
    viewer: AssignmentViewer,
    organizationId: string,
    query: CommitteeMemberQuery,
  ): Promise<IAssignableHolder[]> {
    const members = await this.assignment.listCommitteeMembers(
      viewer,
      organizationId,
      query.committeeId,
      query.roleValueId,
      query.taskId,
    );
    return this.withWorkload(viewer, organizationId, members, query.record ?? null, query.taskId);
  }

  /**
   * Counts are of EVERY task on the record, so the viewer must see every task
   * on it (ACC-244): the record first (403 / 404), then View all tasks on its
   * type or unit scope over the record — the task visibility rule's
   * seesWholeRecord. Otherwise 403 naming View all tasks. Throws.
   */
  async assertMayCount(viewer: AssignmentViewer, organizationId: string, record: IRecordRef): Promise<void> {
    const refusal = () => new ForbiddenException(`Required permission: ${taskKeyOf(record.sourceType, 'VIEW_ALL') ?? 'View all tasks'}`);
    const ctx = await this.visibility.contextFor(viewer, organizationId);
    // With no way to see a whole record of this type — no View all tasks, no
    // unit scope on it — refuse before the record is read (ACC-101 clause a).
    // A viewer who cannot see the record type at all gets assertCanView's own
    // 403 instead, which also reads nothing.
    const mightSeeAll =
      ctx.viewAllTypes.includes(record.sourceType) || ctx.unitScope.some((s) => s.type === record.sourceType);
    if (ctx.recordTypes.includes(record.sourceType) && !mightSeeAll) throw refusal();
    await this.objectVisibility.assertCanView(record.sourceType, record.sourceId, organizationId, viewer.permissions);
    if (!(await this.visibility.seesWholeRecord(ctx, record.sourceType, record.sourceId))) throw refusal();
  }

  /** The same rule, as a yes or no, for the lists. Only the two refusals become "no". */
  private async mayCount(viewer: AssignmentViewer, organizationId: string, record: IRecordRef): Promise<boolean> {
    try {
      await this.assertMayCount(viewer, organizationId, record);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return false;
      throw error;
    }
  }

  private async withWorkload(
    viewer: AssignmentViewer,
    organizationId: string,
    holders: IAssignableHolder[],
    record: IRecordRef | null,
    excludeTaskId?: string,
  ): Promise<IAssignableHolder[]> {
    if (!record || holders.length === 0 || !(await this.mayCount(viewer, organizationId, record))) {
      return holders.map((h) => ({ ...h, workload: null }));
    }
    const people = await this.people(organizationId, holders, record, { excludeTaskId, withDueSoon: false });
    return people.map((person) => ({
      ...person.holder,
      workload: {
        openCount: person.workload.open,
        overdueCount: person.workload.overdue,
        canSuggest: canSuggestFor(person, people),
      },
    }));
  }

  /**
   * The eligible people with their counts on the record and whether they are
   * out of office now. The caller has already decided they may count.
   */
  async people(
    organizationId: string,
    holders: readonly IAssignableHolder[],
    record: IRecordRef,
    options: { excludeTaskId?: string; withDueSoon: boolean },
  ): Promise<IWorkloadPerson[]> {
    const ids = holders.map((h) => h.id);
    const now = new Date();
    const [counts, away] = await Promise.all([
      loadRecordWorkload(this.prisma, organizationId, record, ids, {
        now,
        dueSoonBefore: options.withDueSoon ? await this.dueSoonBefore(organizationId, now) : null,
        excludeTaskId: options.excludeTaskId,
      }),
      this.prisma.user.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true, outOfOfficeFrom: true, outOfOfficeTo: true },
      }),
    ]);
    const awayIds = new Set(away.filter((u) => isOutOfOffice(u, now)).map((u) => u.id));
    return holders.map((holder) => ({
      holder,
      workload: counts.get(holder.id)!,
      outOfOffice: awayIds.has(holder.id),
    }));
  }

  /** "Within the next 2 working days", by the tenant's calendar — never wall-clock arithmetic. */
  private async dueSoonBefore(organizationId: string, now: Date): Promise<Date> {
    const calendar = await this.workingCalendar.getOrCreate(organizationId);
    const hoursPerDay = workingHoursPerDay(calendar.workingHoursStart, calendar.workingHoursEnd);
    const deadline = await this.workingCalendar.calculateDeadline(DateTime.fromJSDate(now), 2 * hoursPerDay, organizationId);
    return deadline.toJSDate();
  }
}

/** Q3 / Q6 — past the threshold against the others who are not out of office. */
export function canSuggestFor(person: IWorkloadPerson, everyone: readonly IWorkloadPerson[]): boolean {
  const others = everyone.filter((p) => p !== person && !p.outOfOffice).map((p) => p.workload.open);
  return isPastThreshold(person.workload.open, others);
}

function workingHoursPerDay(start: string, end: string): number {
  const minutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(1, (minutes(end) - minutes(start)) / 60);
}
