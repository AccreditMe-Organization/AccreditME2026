import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TaskService, TaskViewer } from './task.service';
import { poolTargetOf } from './task-pool';
import { OPEN_REQUEST_INCLUDE } from './task-request-lifecycle';
import { holdsTaskKey } from './task-record-types';
import { TaskVisibilityService } from './task-visibility.service';

/**
 * ACC-231 — WHO MAY OPEN A TASK, AND EVERYTHING IN IT. One rule, read by the
 * task page (ACC-228) and by every path to the task's files: the evidence list,
 * download, the in-app viewer and both AI summary routes. Moved here from
 * TaskPageService unchanged; there is no second copy anywhere.
 *
 * ACC-244 — WHETHER is now THE task visibility rule, asked for this one row:
 * taskVisibleSql() (task-visibility.ts), the very condition every list, panel
 * and count filters on, so the page and a list cannot disagree. In words:
 * a relationship (the creator or whoever acts for them, anyone ever on it, a
 * pool member while it waits), with no permission and no record check; or,
 * with the record visible, View all tasks on its type, Manage tasks on its type
 * (an open request, a departed creator, no actionable owner), or unit scope.
 * Access follows the task's state (Ahmad, 16 Oct): a pool member is out once
 * the task is picked up, a Manage holder once the request is decided.
 *
 * This service then gathers the facts the page's actions need: mayManage
 * (TaskService.mayManage(), the one copy), mayDecide, inPool, recordVisible.
 *
 * Everyone else — and every other organisation, whose task the scoped read
 * never finds — gets the identical 404 from the caller, and a log line here,
 * because the response conceals it (ACC-101 clause b).
 */
export interface TaskAdmission {
  mayManage: boolean;
  mayDecide: boolean;
  inPool: boolean;
  recordVisible: boolean;
}

/** The task fields admit() reads. A caller reading more includes these too. */
export interface AdmissionRow {
  id: string;
  sourceType: string;
  sourceId: string;
  status: string;
  createdById: string;
  createdBy: { status: string };
  assignees: { userId: string; removedAt: Date | null }[];
  requests: { requestedById: string }[];
  assignedOrgUnitId: string | null;
  assignedPositionId: string | null;
  assignedCommitteeId: string | null;
  assignedCommitteeRoleValueId: string | null;
}

export const ADMISSION_INCLUDE = {
  assignees: true,
  ...OPEN_REQUEST_INCLUDE,
  createdBy: { select: { status: true } },
} as const;

@Injectable()
export class TaskAdmissionService {
  private readonly logger = new Logger(TaskAdmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly tasks: TaskService,
    private readonly visibility: TaskVisibilityService,
  ) {}

  /**
   * The task, read `{ id, organizationId }` with what admit() needs, and the
   * viewer admitted — or null for a missing task, another organisation's, or a
   * refusal, which the caller turns into one identical 404.
   */
  async load(
    taskId: string,
    organizationId: string,
    viewer: TaskViewer,
    route: string,
  ): Promise<{ task: NonNullable<Awaited<ReturnType<TaskAdmissionService['read']>>>; access: TaskAdmission } | null> {
    const task = await this.read(taskId, organizationId);
    if (!task) return null;
    const access = await this.admit(task, viewer, organizationId, route);
    return access ? { task, access } : null;
  }

  private read(taskId: string, organizationId: string) {
    return this.prisma.task.findFirst({ where: { id: taskId, organizationId }, include: ADMISSION_INCLUDE });
  }

  /**
   * The rule, for this task. Null means refused; the caller turns it into the
   * identical 404. Then the facts the page's actions need, read once.
   */
  async admit(task: AdmissionRow, viewer: TaskViewer, organizationId: string, route = 'task page'): Promise<TaskAdmission | null> {
    const ctx = await this.visibility.contextFor(viewer, organizationId);
    const allowed = await this.visibility.isVisible(ctx, task.id);

    if (!allowed) {
      // The response conceals this; the log must not (ACC-101's reasoning).
      this.logger.warn(
        `Task refusal (${route}): viewer ${viewer.id} in org ${organizationId} was refused task ${task.id}; answered "Task not found".`,
      );
      return null;
    }
    const covered = new Set(ctx.coveredCreatorIds);
    const mayManage = await this.tasks.mayManage(task, viewer, organizationId, { covered });
    // Deciding a request: whoever acts for the creator, or Manage tasks on the type.
    const mayDecide = covered.has(task.createdById) || holdsTaskKey(viewer.permissions, task.sourceType, 'MANAGE');
    const target = poolTargetOf(task);
    const inPool =
      !!target &&
      ctx.pools.some((p) =>
        p.kind === 'POSITION' && target.kind === 'POSITION'
          ? p.orgUnitId === target.orgUnitId && p.positionId === target.positionId
          : p.kind === 'COMMITTEE_ROLE' && target.kind === 'COMMITTEE_ROLE' && p.committeeId === target.committeeId && p.roleValueId === target.roleValueId,
      );
    const recordVisible = await this.canSeeRecord(task.sourceType, task.sourceId, organizationId, viewer);
    return { mayManage, mayDecide, inPool, recordVisible };
  }

  private async canSeeRecord(type: string, id: string, organizationId: string, viewer: TaskViewer): Promise<boolean> {
    try {
      await this.objectVisibility.assertCanView(type, id, organizationId, viewer.permissions);
      return true;
    } catch {
      return false;
    }
  }
}
