import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { PICKABLE_STATUSES, isPoolMember, poolTargetOf } from './task-pool';
import { OPEN_REQUEST_INCLUDE } from './task-request-lifecycle';

/**
 * ACC-231 — WHO MAY OPEN A TASK, AND EVERYTHING IN IT. One rule, read by the
 * task page (ACC-228) and by every path to the task's files: the evidence list,
 * download, the in-app viewer and both AI summary routes. Moved here from
 * TaskPageService unchanged; there is no second copy anywhere.
 *
 * The union of what the app already shows each person somewhere (ACC-228 Q4,
 * Ahmad 14 Oct), and nothing more:
 *   (a) anyone ever on it — an assignee now or before
 *   (b) whoever may manage it — TaskService.mayManage(), the one copy of that rule
 *   (c) a member of its pool while it waits to be picked up
 *   (d) whoever may decide its open request, while one is open
 *   (e) tasks:view AND the record it is about (ACC-101)
 * Access follows the task's state (Ahmad, 16 Oct): a pool member is out once
 * the task is picked up, a decider once the request is decided.
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
    private readonly authority: TaskAuthorityService,
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
   * Q4's union, cheapest checks first. Null means refused; the caller turns it
   * into the identical 404. The facts it gathers are the ones the page's
   * actions need too, so nothing is asked twice.
   */
  async admit(task: AdmissionRow, viewer: TaskViewer, organizationId: string, route = 'task page'): Promise<TaskAdmission | null> {
    const recordVisible = await this.canSeeRecord(task.sourceType, task.sourceId, organizationId, viewer);
    const mayManage = await this.tasks.mayManage(task, viewer, organizationId);
    const mayDecide =
      viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN) ||
      (await this.authority.canActForCreator(task.createdById, viewer.id, organizationId));
    const target = poolTargetOf(task);
    const inPool = !!target && (await isPoolMember(this.prisma, viewer.id, target, organizationId));

    const everOnIt = task.assignees.some((a) => a.userId === viewer.id); // (a)
    const waiting =
      !task.assignees.some((a) => a.removedAt === null) && (PICKABLE_STATUSES as readonly string[]).includes(task.status);
    const decider = task.requests.length > 0 && mayDecide; // (d)
    const allowed =
      everOnIt ||
      mayManage || // (b)
      (inPool && waiting) || // (c)
      decider ||
      (viewer.permissions.includes(TASKS_PERMISSIONS.VIEW) && recordVisible); // (e)

    if (!allowed) {
      // The response conceals this; the log must not (ACC-101's reasoning).
      this.logger.warn(
        `Task refusal (${route}): viewer ${viewer.id} in org ${organizationId} was refused task ${task.id}; answered "Task not found".`,
      );
      return null;
    }
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
