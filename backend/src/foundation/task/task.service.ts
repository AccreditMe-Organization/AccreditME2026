import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { Prisma, TaskSourceType, TaskPriority, TaskAssignee } from '../../../generated/prisma/client';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { RejectTaskDto } from './dto/reject-task.dto';
import { AddTaskEvidenceDto } from './dto/add-task-evidence.dto';
import { GetMyTasksQueryDto } from './dto/get-my-tasks-query.dto';
import { ITask } from './interfaces/task.interface';
import { IMyTaskListItem, ITaskListItem } from './interfaces/task-list-item.interface';
import { ReleaseTaskDto } from './dto/release-task.dto';
import { ResolvedPlacement, TaskAssignmentService } from './task-assignment.service';
import {
  POOL_LABEL_INCLUDE,
  PoolLabelRelations,
  findEmptyPoolTasks,
  isPoolMember,
  poolLabel,
  poolTargetOf,
  poolsOfUser,
  resolvePoolMemberIds,
  toPoolColumns,
  toPoolView,
  waitingInPoolWhere,
} from './task-pool';
import { ITaskWithAssignees } from './interfaces/task-with-assignees.interface';
import { ITaskEvidence } from './interfaces/task-evidence.interface';

// The raw row plus every TaskAssignee row, removed ones included — what the
// active-assignee check reads. Not ITaskWithAssignees, which is a resolved
// view of ACTIVE assignees for list surfaces.
type TaskWithAssigneeRows = ITask & { assignees: TaskAssignee[] };

// The client inside this.prisma.$transaction(async (tx) => …). Read off
// PrismaService rather than named as Prisma.TransactionClient, because
// PrismaService is an EXTENDED client (the AuditLog append-only hooks) and its
// transaction client is that extension's type, not the base one.
type TaskTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

// "Open" — the same definition the ACC-65 stage gate and cancelForStage() use.
// REJECTED is open on purpose: the work is still owed, and a rejected
// mandatory task must keep holding its stage until the creator reassigns it.
const CLOSED_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

// ACC-167 — the pick-up clock is all-or-nothing: a task in its pool carries
// all three, a task out of it carries none.
const NO_POOL_CLOCK = { pooledAt: null, poolEscalateAt: null, poolEscalatedAt: null };

// A list row as Prisma returns it, split into the task, its evidence count and
// the pool it is in — the relations themselves never reach a response.
function splitListRow<T extends { _count: { evidence: number } } & PoolLabelRelations>(row: T) {
  const {
    _count,
    assignedOrgUnit,
    assignedPosition,
    assignedCommittee,
    assignedCommitteeRoleValue,
    ...task
  } = row;
  return {
    task,
    evidenceCount: _count.evidence,
    pool: toPoolView({ assignedOrgUnit, assignedPosition, assignedCommittee, assignedCommitteeRoleValue }),
  };
}

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly delegationLabels: DelegationLabelService,
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly assignment: TaskAssignmentService,
  ) {}

  // ACC-167 — a task goes to named people (assigneeUserIds, the engine's path
  // and every task before this ticket), or to a TARGET: a position in a unit
  // or a committee role, chosen through `assignTo`, which lands it with named
  // people or in a pool (TaskAssignmentService.resolvePlacement()). The engine
  // passes its own resolved placement for a POSITION_FIXED or committee-role
  // stage, because a stage's committee need not be the task's source.
  async create(
    dto: CreateTaskDto,
    organizationId: string,
    actorId: string,
    enginePlacement?: ResolvedPlacement,
  ): Promise<ITask> {
    if (dto.assignTo && dto.assigneeUserIds?.length) {
      throw new BadRequestException('Choose either who the task goes to or named people, not both');
    }
    const placement =
      enginePlacement ??
      (dto.assignTo
        ? await this.assignment.resolvePlacement(dto.assignTo, organizationId, {
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
          })
        : null);

    const priority = dto.priority ?? 'MEDIUM';
    const dueAt = dto.dueDate
      ? new Date(dto.dueDate)
      : await this.computeSlaDueAt(priority, organizationId);

    const eligibleAssigneeIds = await this.filterActiveUsers(
      placement ? placement.directUserIds : (dto.assigneeUserIds ?? []),
      organizationId,
    );
    // A pool is not "unassigned" even when nobody is in it right now: it
    // resolves at read time, and someone who joins the position sees it.
    const pooled = placement?.pooled ?? false;
    const isUnassigned = !pooled && eligibleAssigneeIds.length === 0;
    const poolClock = pooled ? await this.poolClock(priority, organizationId, new Date()) : NO_POOL_CLOCK;

    // ACC-40 Section 2.6.3 — stamped once, at the moment each TaskAssignee
    // row is created, from the caller-supplied per-assignee delegation map
    // (workflow-engine calls only; manual tasks:create callers never send
    // this, so every assignee there simply has no matching entry).
    const delegationByUserId = new Map(
      (dto.assigneeDelegations ?? []).map((d) => [d.userId, d]),
    );

    const task = await this.prisma.task.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description ?? null,
        sourceType: dto.sourceType,
        sourceId: dto.sourceId,
        sourceStageId: dto.sourceStageId ?? null,
        workflowInstanceId: dto.workflowInstanceId ?? null,
        meetingId: dto.meetingId ?? null,
        createdById: actorId,
        requiresEvidence: dto.requiresEvidence ?? false,
        priority,
        status: isUnassigned ? 'UNASSIGNED' : 'PENDING',
        dueAt,
        dueDateOverridden: !!dto.dueDate,
        ...toPoolColumns(placement?.target ?? null),
        ...poolClock,
        assignees: eligibleAssigneeIds.length === 0
          ? undefined
          : {
              create: eligibleAssigneeIds.map((userId) => {
                const delegation = delegationByUserId.get(userId);
                return {
                  userId,
                  assignedById: actorId,
                  delegationReason: delegation?.delegationReason ?? null,
                  delegationContextId: delegation?.delegationContextId ?? null,
                };
              }),
            },
      },
      include: { assignees: true },
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'Task',
      objectId: task.id,
      actorId,
      tenantId: organizationId,
      after: task as unknown as Record<string, unknown>,
    });

    // ACC-82 — an UNASSIGNED task no longer notifies every Tenant Admin. It is a
    // Setup health condition (TASK_WITHOUT_OWNER), listed until someone is
    // assigned (SYSTEM-REFERENCE §13.7). Assignees are still told: that is an
    // event, addressed to the person who has to act.
    for (const userId of eligibleAssigneeIds) {
      await this.notificationService.create(
        {
          userId,
          titleEn: 'New task assigned',
          bodyEn: `You have been assigned: "${task.title}"`,
          objectType: 'Task',
          objectId: task.id,
        },
        organizationId,
      );
    }
    // ACC-167 — a pool is told once, when the task enters it. A task created
    // for one chosen person sends only the assignment notice above.
    if (pooled) {
      await this.notifyPool(task.id, organizationId, { event: 'created', excludeUserId: actorId });
    }

    return task;
  }

  // "My Tasks" — every task where the calling user has an active
  // (removedAt: null) TaskAssignee row.
  //
  // ACC-163 — two filters, and they combine:
  //   status   PENDING also matches legacy OVERDUE rows. OVERDUE is no longer
  //            written (overdue is a flag now), but rows written before this
  //            shipped keep it until backfill-acc163-overdue-to-pending.ts
  //            runs, and every one of them is an Assigned task.
  //   overdue  an OPEN task whose dueAt has passed, by the server's clock —
  //            the same "open" the stage gate uses.
  async getMyTasks(
    userId: string,
    organizationId: string,
    options: GetMyTasksQueryDto = {},
  ): Promise<IMyTaskListItem[]> {
    const filters: Prisma.TaskWhereInput[] = [];
    if (options.status === 'PENDING') {
      filters.push({ status: { in: ['PENDING', 'OVERDUE'] } });
    } else if (options.status) {
      filters.push({ status: options.status });
    }
    if (options.overdue) {
      filters.push({ dueAt: { lt: new Date() }, status: { notIn: [...CLOSED_STATUSES] } });
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        organizationId,
        assignees: { some: { userId, removedAt: null } },
        AND: filters,
      },
      orderBy: { dueAt: 'asc' },
      include: {
        _count: { select: { evidence: true } },
        ...POOL_LABEL_INCLUDE,
        // ACC-167 — the caller's own row, to say whether it came from a pick.
        assignees: { where: { userId, removedAt: null }, select: { pickedAt: true } },
      },
    });
    return tasks.map(({ assignees, ...row }) => {
      const { task, evidenceCount, pool } = splitListRow(row);
      return { ...task, evidenceCount, pool, pickedByMe: assignees.some((a) => a.pickedAt !== null) };
    });
  }

  // ACC-167 (decision 7) — open pool tasks the caller could pick up: every
  // pool they are in RIGHT NOW (task-pool.ts), with nobody holding the task.
  // Self-scoped like my-tasks: the query is built from the caller's own
  // position, unit and committee roles, so it cannot reach anyone else's pool.
  //
  // Three indexed queries however many tasks exist: the caller's user row,
  // their committee memberships, and the tasks — matched on Task's
  // (organizationId, assignedOrgUnitId, assignedPositionId) and
  // (assignedCommitteeId, assignedCommitteeRoleValueId) indexes.
  async getAvailableToPick(userId: string, organizationId: string): Promise<ITaskListItem[]> {
    const pools = await poolsOfUser(this.prisma, userId, organizationId);
    if (pools.length === 0) return [];

    const rows = await this.prisma.task.findMany({
      where: { ...waitingInPoolWhere(organizationId), AND: [{ OR: pools }] },
      orderBy: { dueAt: 'asc' },
      include: { _count: { select: { evidence: true } }, ...POOL_LABEL_INCLUDE },
    });
    return rows.map((row) => {
      const { task, evidenceCount, pool } = splitListRow(row);
      return { ...task, evidenceCount, pool };
    });
  }

  // Module task lists — CLAUDE.md's "tasks filtered by sourceType + sourceId".
  // ACC-76 — returns assignees, unlike every other list query here.
  //
  // This is the module-task-list query: it backs an object's own detail page
  // ("what work does this committee have"), where the assignee is most of the
  // point. getMyTasks() needs no assignees (every row is the caller's own by
  // construction) and listUnassigned() has none by definition, so this stays
  // the only list that carries them rather than a shape change across all
  // three.
  //
  // ACC-101 — the caller must be able to see the SOURCE record, not merely hold
  // tasks:view. Checked before the tasks are read: a refused caller costs no
  // query, and the refusal cannot depend on what the list happens to contain.
  async getForSource(
    sourceType: TaskSourceType,
    sourceId: string,
    organizationId: string,
    viewerPermissions: readonly string[],
    // ACC-101 — for the delegation-label entitlement check: a person may always
    // be told who they are covering for.
    viewerId: string,
  ): Promise<ITaskWithAssignees[]> {
    await this.objectVisibility.assertCanView(
      sourceType,
      sourceId,
      organizationId,
      viewerPermissions,
    );

    const tasks = await this.prisma.task.findMany({
      where: { organizationId, sourceType, sourceId },
      orderBy: { createdAt: 'desc' },
      include: {
        assignees: {
          // Active assignees only. complete() stamps removedAt on everyone who
          // did NOT complete the task rather than deleting the row, so without
          // this filter a completed task would list everyone ever assigned as
          // though they still were.
          where: { removedAt: null },
          include: { user: { select: { id: true, name: true } } },
        },
        // ACC-163 — who rejected it, for the record's task list, and how much
        // evidence it holds, so Complete can be disabled before it is refused.
        rejectedBy: { select: { id: true, name: true } },
        _count: { select: { evidence: true } },
        // ACC-167 — the pool the task is in, so the record can say who it is
        // waiting for until somebody picks it up.
        ...POOL_LABEL_INCLUDE,
      },
    });

    // One resolve call for the whole page, not one per task — see
    // DelegationLabelService.resolveMany() on why that matters here.
    const allAssignees = tasks.flatMap((task) => task.assignees);
    const delegations = await this.delegationLabels.resolveMany(allAssignees, organizationId, {
      id: viewerId,
      permissions: viewerPermissions,
    });

    return tasks.map(({ assignees, ...row }) => {
      const { task, evidenceCount, pool } = splitListRow(row);
      return {
      ...task,
      evidenceCount,
      pool,
      assignees: assignees.map((assignee) => ({
        userId: assignee.userId,
        userName: assignee.user.name,
        delegation: this.delegationLabels.lookup(assignee, delegations),
      })),
      };
    });
  }

  // Tenant-wide — unassigned tasks have no assignees, so getMyTasks()
  // structurally can never surface them (ACC-34).
  //
  // ACC-167 — also lists open pool tasks whose pool nobody is in right now:
  // nobody can pick them up, so they are work with no actionable owner exactly
  // as an UNASSIGNED task is. Setup health's TASK_WITHOUT_OWNER lists the same
  // tasks and its Fix opens them here.
  async listUnassigned(organizationId: string): Promise<ITask[]> {
    const [unassigned, emptyPools] = await Promise.all([
      this.prisma.task.findMany({
        where: { organizationId, status: 'UNASSIGNED' },
        orderBy: { createdAt: 'desc' },
      }),
      findEmptyPoolTasks(this.prisma, organizationId),
    ]);
    if (emptyPools.length === 0) return unassigned;

    const stranded = await this.prisma.task.findMany({
      where: { organizationId, id: { in: emptyPools.map((t) => t.id) } },
      orderBy: { createdAt: 'desc' },
    });
    return [...unassigned, ...stranded];
  }

  async getById(id: string, organizationId: string): Promise<ITask> {
    const task = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: { assignees: true, evidence: true },
    });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  // ACC-101 — the HTTP-facing read. Same rule as getForSource(), one record
  // instead of a list.
  //
  // DELIBERATELY NOT FOLDED INTO getById(), for the reason UserService draws
  // the identical line (ACC-43): getById() is reused internally as a trusted
  // tenant-scoped lookup — addEvidence() calls it to validate ownership, and
  // the workflow engine reads tasks it created — and those call sites must
  // never acquire a viewer's permission check. A service acting on its own
  // behalf has no viewer.
  //
  // The order is the reverse of getForSource() of necessity: a task's parent is
  // only knowable once the task is read. That is also why this cannot be a
  // guard — a guard sees the request, not the record.
  //
  // A caller who cannot see the parent gets 403 whether or not the task exists;
  // a caller who can gets the ordinary 404.
  async getByIdForViewer(
    id: string,
    organizationId: string,
    viewerPermissions: readonly string[],
    viewerId: string,
  ): Promise<ITask> {
    const task = await this.getById(id, organizationId);
    await this.objectVisibility.assertCanViewOrNotFound(
      task.sourceType,
      task.sourceId,
      organizationId,
      viewerPermissions,
      'Task not found',
      viewerId,
    );
    return task;
  }

  // ANY-completes semantics: the first active assignee to call this finishes
  // it for everyone else — their TaskAssignee rows get removedAt stamped, but
  // are never deleted (permanent record of who was ever assigned).
  //
  // ACC-162 — a closed task is refused. Before, an assignee still attached to a
  // CANCELLED task could complete it, overwriting the cancellation, and an
  // already-COMPLETED task could be completed again, overwriting who finished
  // it and when.
  //
  // ACC-163 — a task that requires evidence is refused until it has some. The
  // order of refusals is fixed: not yours (404), then closed (409), then no
  // evidence (409), so a non-assignee learns nothing about the task.
  async complete(id: string, userId: string, organizationId: string): Promise<ITask> {
    const { existing, task } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOpenForActiveAssignee(tx, id, userId, organizationId, 'be completed');

      if (existing.requiresEvidence) {
        const evidenceCount = await tx.taskEvidence.count({ where: { taskId: id, organizationId } });
        if (evidenceCount === 0) {
          throw new ConflictException('Evidence is required before this task can be completed');
        }
      }

      const now = new Date();
      await tx.taskAssignee.updateMany({
        where: { taskId: id, removedAt: null, userId: { not: userId } },
        data: { removedAt: now },
      });

      const task = await tx.task.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: now, completedById: userId },
        include: { assignees: true },
      });
      return { existing, task };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: id,
      actorId: userId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { completedBy: userId },
    });

    return task;
  }

  // ACC-163 — an active assignee moves an Assigned task to In progress. A
  // legacy OVERDUE row is an Assigned task (OVERDUE was only ever written over
  // PENDING), so it may be started too.
  async start(id: string, userId: string, organizationId: string): Promise<ITask> {
    const { existing, task } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOpenForActiveAssignee(tx, id, userId, organizationId, 'be started');

      if (existing.status === 'IN_PROGRESS') {
        throw new ConflictException('This task is already in progress');
      }
      if (existing.status !== 'PENDING' && existing.status !== 'OVERDUE') {
        throw new ConflictException(`A ${existing.status.toLowerCase()} task cannot be started`);
      }

      const task = await tx.task.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      return { existing, task };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: id,
      actorId: userId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { event: 'started', startedBy: userId },
    });

    return task;
  }

  // ACC-163 — an active assignee hands the task back, with a reason (Q4).
  //
  // Only the caller leaves: their own TaskAssignee row is stamped. While
  // anyone else is still assigned the task stays open for them, unchanged.
  // When the caller was the LAST active assignee, the task becomes REJECTED,
  // carries the reason, and goes back to its creator — who, for a workflow
  // task, is the person who moved the record into the stage (Q3). The creator
  // acts on it by reassigning (reassign() clears the rejection).
  //
  // Every reject is audited, including one that leaves the task open: it is
  // still a person declining work they were given.
  async reject(
    id: string,
    dto: RejectTaskDto,
    userId: string,
    organizationId: string,
  ): Promise<ITask> {
    const { existing, task, lastAssigneeRejected } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOpenForActiveAssignee(tx, id, userId, organizationId, 'be rejected');
      if (
        existing.status !== 'PENDING' &&
        existing.status !== 'IN_PROGRESS' &&
        existing.status !== 'OVERDUE'
      ) {
        throw new ConflictException(`A ${existing.status.toLowerCase()} task cannot be rejected`);
      }

      const now = new Date();
      await tx.taskAssignee.updateMany({
        where: { taskId: id, userId, removedAt: null },
        data: { removedAt: now },
      });

      // Read from the LOCKED snapshot: no other assignee can have left or
      // joined since, so "nobody else remains" cannot be two people each
      // seeing the other still there.
      const othersRemain = existing.assignees.some((a) => a.userId !== userId && a.removedAt === null);
      if (othersRemain) {
        // The task itself is untouched; only the caller's assignment ended.
        const unchanged = await tx.task.findFirstOrThrow({ where: { id, organizationId } });
        return { existing, task: unchanged, lastAssigneeRejected: false };
      }

      const task = await tx.task.update({
        where: { id },
        data: { status: 'REJECTED', rejectedReason: dto.reason, rejectedAt: now, rejectedById: userId },
      });
      return { existing, task, lastAssigneeRejected: true };
    });

    await this.auditLog.log({
      action: 'REJECT',
      objectType: 'Task',
      objectId: id,
      actorId: userId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { reason: dto.reason, rejectedBy: userId, lastAssigneeRejected },
    });

    // After commit, never inside the transaction: the lock is held only for
    // the writes. A creator who rejected their own task is not told about it.
    if (lastAssigneeRejected && task.createdById !== userId) {
      await this.notifyCreatorOfRejection(task, userId, dto.reason, organizationId);
    }

    return task;
  }

  // ACC-68 — cancels every OPEN task belonging to one stage of one workflow
  // instance. Before this existed, `TaskStatus.CANCELLED` was an unreachable
  // enum value: declared in step-08 §5 (inherited from module-designs.md's own
  // Task Management data model), referenced in filters, and produced by
  // nothing. This is its only producer.
  //
  // Three decisions worth stating, because each is load-bearing and none is
  // obvious from the query alone:
  //
  // 1. "OPEN" MEANS THE SAME HERE AS IN THE ACC-65 GATE. Both use
  //    notIn ['COMPLETED', 'CANCELLED'] — deliberately identical. If the two
  //    ever disagreed, a task could be un-cancellable yet still blocking, or
  //    cancelled yet still counted. Keep them in step.
  //
  // 2. ASSIGNEES ARE DELIBERATELY LEFT ATTACHED. `complete()` clears
  //    `removedAt` on the other assignees; this does NOT, and must not.
  //    `getMyTasks()` filters on `assignees: { some: { removedAt: null } }`,
  //    so detaching them would make the task vanish from the assignee's list
  //    entirely. The decision (ACC-68) is the opposite: a cancelled task stays
  //    VISIBLE, badged CANCELLED with the Complete button hidden — the UI
  //    already does both — because silently disappearing is worse than visible
  //    history, and the status filter serves anyone who wants them gone.
  //
  // 3. ONE AUDIT ENTRY PER TASK, not one for the batch. The objectId of an
  //    audit row is a Task id; a single aggregate row could not name which
  //    tasks were cancelled. A task leaving someone's active work with no
  //    trail is exactly what a compliance product has to be able to explain.
  //
  // Returns the number of tasks cancelled so callers can log it.
  async cancelForStage(
    workflowInstanceId: string,
    sourceStageId: string,
    organizationId: string,
    actorId: string,
    reason: 'STAGE_EXIT' | 'INSTANCE_CANCELLED',
  ): Promise<number> {
    const open = await this.prisma.task.findMany({
      where: {
        organizationId,
        workflowInstanceId,
        sourceStageId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: { assignees: true },
    });
    if (open.length === 0) return 0;

    await this.prisma.task.updateMany({
      where: { id: { in: open.map((t) => t.id) }, organizationId },
      data: { status: 'CANCELLED' },
    });

    for (const before of open) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Task',
        objectId: before.id,
        actorId,
        tenantId: organizationId,
        before: before as unknown as Record<string, unknown>,
        after: { ...before, status: 'CANCELLED' } as unknown as Record<string, unknown>,
        metadata: { cancelledBy: actorId, reason, workflowInstanceId, sourceStageId },
      });
    }

    return open.length;
  }

  // ACC-68 — cancels every open task across EVERY stage of one instance, for
  // the force-cancel path. Separate from cancelForStage() rather than a
  // parameterised version of it: this one deliberately does not scope by
  // stage, and collapsing the two would make it easy to call the wrong one.
  async cancelForInstance(
    workflowInstanceId: string,
    organizationId: string,
    actorId: string,
  ): Promise<number> {
    const open = await this.prisma.task.findMany({
      where: {
        organizationId,
        workflowInstanceId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      include: { assignees: true },
    });
    if (open.length === 0) return 0;

    await this.prisma.task.updateMany({
      where: { id: { in: open.map((t) => t.id) }, organizationId },
      data: { status: 'CANCELLED' },
    });

    for (const before of open) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Task',
        objectId: before.id,
        actorId,
        tenantId: organizationId,
        before: before as unknown as Record<string, unknown>,
        after: { ...before, status: 'CANCELLED' } as unknown as Record<string, unknown>,
        metadata: { cancelledBy: actorId, reason: 'INSTANCE_CANCELLED', workflowInstanceId },
      });
    }

    return open.length;
  }

  // Pattern 2 — Manual Reassignment (Absence and Departure Management).
  //
  // ACC-163 — three changes:
  //
  // 1. WHO. A tasks:reassign holder, as before, OR the task's own creator — a
  //    rejected task comes back to its creator, and reassigning it is how they
  //    act (Q4). Because the second half is only knowable from the row, the
  //    check lives here rather than in @Permissions, and anyone else gets the
  //    same 404 as a task that does not exist (ACC-101 clause (b)).
  //
  // 2. NOT A CLOSED TASK. A COMPLETED or CANCELLED task is refused with 409.
  //    Before, reassigning one silently reopened it as PENDING.
  //
  // 3. A RETURNING ASSIGNEE REUSES THEIR ROW. TaskAssignee is unique on
  //    (taskId, userId) with no exemption for removed rows, so reassigning
  //    A → B → A used to fail on the unique constraint — and after a reject,
  //    reassigning back to the person who rejected is the common case. Their
  //    row is reactivated in place, as attachAssigneesToUnassignedStageTasks()
  //    already does; the audit row's `before` keeps the earlier state.
  //
  // KNOWN LIMITATION, left for the extension ticket (CF-05): the task keeps
  // its original dueAt, slaBreachedAt and escalation stamps, so a reassigned
  // task is often already overdue, and escalations that already fired do not
  // fire again for the new assignee.
  async reassign(
    id: string,
    dto: ReassignTaskDto,
    organizationId: string,
    actorId: string,
    actorPermissions: readonly string[],
  ): Promise<ITask> {
    // ACC-167 — exactly one way of saying who it goes to.
    if (!!dto.assignTo === !!dto.newAssigneeUserIds?.length) {
      throw new BadRequestException('Choose who the task goes to: a unit and position, or named people');
    }

    const { existing, task, eligibleAssigneeIds, pooled } = await this.prisma.$transaction(async (tx) => {
      await this.lockTaskRow(tx, id, organizationId);
      const existing = await tx.task.findFirst({
        where: { id, organizationId },
        include: { assignees: true },
      });
      const entitled =
        !!existing &&
        (actorPermissions.includes(TASKS_PERMISSIONS.REASSIGN) || existing.createdById === actorId);
      if (!existing || !entitled) {
        throw new NotFoundException('Task not found');
      }
      if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
        throw new ConflictException(`A ${existing.status.toLowerCase()} task cannot be reassigned`);
      }

      // ACC-167 — a target lands the task with named people or in a pool, and
      // the task remembers it either way; legacy named people clear it.
      const placement = dto.assignTo
        ? await this.assignment.resolvePlacement(
            dto.assignTo,
            organizationId,
            { sourceType: existing.sourceType, sourceId: existing.sourceId },
            tx,
          )
        : null;
      const eligibleAssigneeIds = await this.filterActiveUsers(
        placement ? placement.directUserIds : (dto.newAssigneeUserIds ?? []),
        organizationId,
        tx,
      );
      const pooled = placement?.pooled ?? false;

      const now = new Date();
      await tx.taskAssignee.updateMany({
        where: { taskId: id, removedAt: null },
        data: { removedAt: now },
      });

      for (const userId of eligibleAssigneeIds) {
        const previous = existing.assignees.find((a) => a.userId === userId);
        if (previous) {
          // A manual reassignment carries no delegation: a stamp left from an
          // engine assignment would label this person as covering for someone
          // they are not. Nor is it a pick (ACC-167).
          await tx.taskAssignee.update({
            where: { id: previous.id },
            data: {
              removedAt: null,
              assignedAt: now,
              assignedById: actorId,
              delegationReason: null,
              delegationContextId: null,
              pickedAt: null,
            },
          });
        } else {
          await tx.taskAssignee.create({ data: { taskId: id, userId, assignedById: actorId } });
        }
      }

      const task = await tx.task.update({
        where: { id },
        data: {
          status: pooled || eligibleAssigneeIds.length > 0 ? 'PENDING' : 'UNASSIGNED',
          rejectedReason: null,
          rejectedAt: null,
          rejectedById: null,
          ...toPoolColumns(placement?.target ?? null),
          ...(pooled ? await this.poolClock(existing.priority, organizationId, now) : NO_POOL_CLOCK),
        },
        include: { assignees: true },
      });
      return { existing, task, eligibleAssigneeIds, pooled };
    });

    await this.auditLog.log({
      action: 'DELEGATE',
      objectType: 'Task',
      objectId: id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { reason: dto.reason, newAssigneeUserIds: eligibleAssigneeIds, pooled },
    });

    for (const userId of eligibleAssigneeIds) {
      await this.notificationService.create(
        {
          userId,
          titleEn: 'Task reassigned to you',
          bodyEn: `"${task.title}" has been reassigned to you. Reason: ${dto.reason}`,
          objectType: 'Task',
          objectId: task.id,
        },
        organizationId,
      );
    }
    if (pooled) {
      await this.notifyPool(task.id, organizationId, { event: 'created', excludeUserId: actorId });
    }

    return task;
  }

  // ACC-167 (decision 4) — a current pool member takes the task: a TaskAssignee
  // row stamped pickedAt, after which it is theirs and leaves everyone else's
  // "available" list.
  //
  // THE ORDER OF REFUSALS IS THE POINT. Under the row lock: tenant, existence,
  // being a pool task and being in its pool come FIRST, and every one of them
  // is the identical 404 — so a non-member never learns whether the task
  // exists, is closed, or has already been picked. Only a member is then told
  // why they cannot have it (409): closed, rejected, or already picked up.
  async pick(id: string, userId: string, organizationId: string): Promise<ITask> {
    const { existing, task } = await this.prisma.$transaction(async (tx) => {
      await this.lockTaskRow(tx, id, organizationId);
      const existing = await tx.task.findFirst({
        where: { id, organizationId },
        include: { assignees: true },
      });
      const target = existing ? poolTargetOf(existing) : null;
      if (!existing || !target || !(await isPoolMember(tx, userId, target, organizationId))) {
        throw new NotFoundException('Task not found');
      }
      if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
        throw new ConflictException(`A ${existing.status.toLowerCase()} task cannot be picked up`);
      }
      if (existing.status === 'REJECTED') {
        throw new ConflictException('A rejected task cannot be picked up');
      }
      if (existing.assignees.some((a) => a.removedAt === null)) {
        throw new ConflictException('This task has already been picked up');
      }

      const now = new Date();
      // Picking up a task you released earlier reuses your row (A → B → A).
      const previous = existing.assignees.find((a) => a.userId === userId);
      if (previous) {
        await tx.taskAssignee.update({
          where: { id: previous.id },
          data: {
            removedAt: null,
            assignedAt: now,
            assignedById: userId,
            pickedAt: now,
            delegationReason: null,
            delegationContextId: null,
          },
        });
      } else {
        await tx.taskAssignee.create({ data: { taskId: id, userId, assignedById: userId, pickedAt: now } });
      }

      // UNASSIGNED here is a single-holder position's task picked up by a
      // holder who appeared later — the pool resolving at read time.
      const task = await tx.task.update({ where: { id }, data: { status: 'PENDING' } });
      return { existing, task };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: id,
      actorId: userId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { event: 'picked', pickedBy: userId },
    });
    return task;
  }

  // ACC-167 (decision 5, Q6) — whoever picked the task hands it back to its
  // pool, with a reason. Their row is stamped removedAt, exactly as reject()
  // stamps it — never deleted, so picking it up again reuses the row.
  //
  // Only a PICKED row may be released: a person the assigner chose directly
  // was given the task, not offered it, and rejects instead (409, safe to say
  // because the caller is an active assignee and so already entitled).
  async release(
    id: string,
    dto: ReleaseTaskDto,
    userId: string,
    organizationId: string,
  ): Promise<ITask> {
    const { existing, task, returnedToPool } = await this.prisma.$transaction(async (tx) => {
      const existing = await this.lockOpenForActiveAssignee(tx, id, userId, organizationId, 'be released');
      const mine = existing.assignees.find((a) => a.userId === userId && a.removedAt === null);
      if (!mine?.pickedAt || !poolTargetOf(existing)) {
        throw new ConflictException('Only a task picked up from a pool can be released');
      }

      const now = new Date();
      await tx.taskAssignee.update({ where: { id: mine.id }, data: { removedAt: now } });

      const othersRemain = existing.assignees.some((a) => a.userId !== userId && a.removedAt === null);
      if (othersRemain) {
        const unchanged = await tx.task.findFirstOrThrow({ where: { id, organizationId } });
        return { existing, task: unchanged, returnedToPool: false };
      }
      const task = await tx.task.update({
        where: { id },
        // ITask types enums as strings; this one was read from the enum column.
        data: {
          status: 'PENDING',
          ...(await this.poolClock(existing.priority as TaskPriority, organizationId, now)),
        },
      });
      return { existing, task, returnedToPool: true };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: id,
      actorId: userId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { event: 'released', releasedBy: userId, reason: dto.reason, returnedToPool },
    });
    // After commit, and never to the person who released it.
    if (returnedToPool) {
      await this.notifyPool(id, organizationId, { event: 'released', excludeUserId: userId, reason: dto.reason });
    }
    return task;
  }

  // Bulk version of reassign() — used by the user departure flow (Step 9,
  // UserService.deactivate()), the only assignable-work model that exists
  // today (see step-09 plan Section 1's Non-Goals — Committee/CAPA
  // reassignment on departure arrive with those modules in Steps 10/18).
  // Every task the departing user is still an active assignee on either
  // gets reassigned to toUserId (their actingUser, if one was set) or, if
  // toUserId is null/ineligible AND no other active assignee remains on that
  // task, gets flagged UNASSIGNED — same status Step 8 already uses for
  // role-vacancy fallback. Every change logged individually, same as reassign().
  async reassignAllForUser(
    fromUserId: string,
    toUserId: string | null,
    organizationId: string,
    actorId: string,
  ): Promise<{ reassignedCount: number; unassignedCount: number; returnedToPoolCount: number }> {
    const activeAssignments = await this.prisma.taskAssignee.findMany({
      where: { userId: fromUserId, removedAt: null, task: { organizationId } },
      include: { task: { include: { assignees: true } } },
    });

    const eligibleToUserIds = toUserId ? await this.filterActiveUsers([toUserId], organizationId) : [];
    const validToUserId = eligibleToUserIds[0] ?? null;

    let reassignedCount = 0;
    let unassignedCount = 0;
    let returnedToPoolCount = 0;

    for (const assignment of activeAssignments) {
      const task = assignment.task;
      const now = new Date();

      await this.prisma.taskAssignee.update({
        where: { id: assignment.id },
        data: { removedAt: now },
      });

      const remainingActiveOthers = task.assignees.filter(
        (a) => a.id !== assignment.id && a.removedAt === null,
      );

      // ACC-167 — a task with a pool goes back to its pool, whether the
      // departing person picked it up or was chosen for it directly: the pool
      // is still a valid owner, and the acting user may not hold the position.
      // Only an OPEN task — this loop also reaches closed tasks (ACC-165), and
      // returning one to its pool would reopen it. Creates no row for the
      // acting user, so it never reaches the duplicate-row create below that
      // ACC-165 owns.
      if (poolTargetOf(task) && task.status !== 'COMPLETED' && task.status !== 'CANCELLED') {
        if (remainingActiveOthers.length === 0) {
          await this.prisma.task.update({
            where: { id: task.id },
            data: { status: 'PENDING', ...(await this.poolClock(task.priority, organizationId, now)) },
          });
        }
        returnedToPoolCount += 1;
        await this.auditLog.log({
          action: 'DELEGATE',
          objectType: 'Task',
          objectId: task.id,
          actorId,
          tenantId: organizationId,
          metadata: { event: 'departure_returned_to_pool', fromUserId },
        });
        continue;
      }

      if (validToUserId) {
        await this.prisma.taskAssignee.create({
          data: { taskId: task.id, userId: validToUserId, assignedById: actorId },
        });
        if (task.status === 'UNASSIGNED') {
          await this.prisma.task.update({ where: { id: task.id }, data: { status: 'PENDING' } });
        }
        reassignedCount += 1;
      } else if (remainingActiveOthers.length === 0) {
        await this.prisma.task.update({ where: { id: task.id }, data: { status: 'UNASSIGNED' } });
        unassignedCount += 1;
      }

      await this.auditLog.log({
        action: 'DELEGATE',
        objectType: 'Task',
        objectId: task.id,
        actorId,
        tenantId: organizationId,
        metadata: { event: 'departure_reassignment', fromUserId, toUserId: validToUserId },
      });
    }

    if (validToUserId && reassignedCount > 0) {
      await this.notificationService.create(
        {
          userId: validToUserId,
          titleEn: 'Tasks reassigned to you',
          bodyEn: `${reassignedCount} task(s) have been reassigned to you following a colleague's departure.`,
          channel: 'IN_APP',
        },
        organizationId,
      );
    }

    return { reassignedCount, unassignedCount, returnedToPoolCount };
  }

  // ACC-51 — the recovery half of the unassigned-task lifecycle. Called only
  // by SlaMonitorProcessor.sweepUnassignedStages() when a stage's
  // isUnassigned flag clears (true → false): the org gap that left this
  // stage's assignee pool empty has been fixed, so the Task that CREATE_TASK
  // already wrote at stage-entry time — real, persisted, and completely inert
  // ever since — finally has someone who can genuinely act on it.
  //
  // Attaching assignees is not optional politeness here, it is the whole
  // point: complete() rejects any caller without an active TaskAssignee row,
  // and sweepOverdueTasks() excludes status UNASSIGNED outright, so a
  // notification alone would point someone at work they can neither complete
  // nor ever be reminded about again.
  //
  // Deliberately NOT reassign() — evaluated first, per this ticket's own
  // note, and rejected for five concrete reasons, none of them stylistic:
  //   1. ReassignTaskDto.reason is required, and is specifically a HUMAN
  //      documented reason (Absence/Departure Pattern 2's audit requirement,
  //      per that DTO's own comment) — a sweep would have to fabricate one.
  //   2. It hardcodes AuditAction 'DELEGATE'. Nothing is delegated here: this
  //      is the first-ever assignment of a task that never had an assignee,
  //      not a transfer of work between two people.
  //   3. It hardcodes "Task reassigned to you" — wrong for a recipient who
  //      was never assigned. create()'s own "New task assigned" wording is
  //      the correct precedent, reused verbatim below.
  //   4. It requires an actorId for both assignedById and its audit log. A
  //      sweep has no human actor — SlaMonitorProcessor's own audit logs omit
  //      actorId entirely (AuditLog.actorId is nullable; TaskAssignee
  //      .assignedById is not), so neither half could be satisfied honestly.
  //   5. Its leading updateMany({ removedAt: now }) is a no-op on a task with
  //      zero assignees, and actively harmful on a repeat recovery
  //      (block → recover → re-block → recover): it stamps removedAt and then
  //      re-creates the same (taskId, userId) pair, violating TaskAssignee's
  //      @@unique([taskId, userId]). That is a real, pre-existing latent bug
  //      in reassign() itself (reachable manually too: reassign A → B → A) —
  //      NOT fixed here, deliberately outside this ticket's scope, but not
  //      inherited either.
  //
  // Returns the number of tasks that genuinely transitioned out of
  // UNASSIGNED, so the caller can log/assert on real effect rather than on
  // "the method ran".
  //
  // ACC-52 — safe to call on every sweep, not only on a flag transition:
  // when nothing is orphaned the `tasks.length === 0` early return below
  // makes this a no-op with no writes and no notifications. That property is
  // what lets the caller drop its one-shot guard.
  async attachAssigneesToUnassignedStageTasks(
    workflowInstanceId: string,
    sourceStageId: string,
    resolvedAssigneeUserIds: string[],
    organizationId: string,
  ): Promise<number> {
    const eligibleAssigneeIds = await this.filterActiveUsers(resolvedAssigneeUserIds, organizationId);
    if (eligibleAssigneeIds.length === 0) return 0;

    // Scoped by organizationId alongside the instance/stage ids, per this
    // codebase's manual tenant-scoping discipline — never a bare lookup by
    // workflowInstanceId on the assumption the caller already scoped it.
    const tasks = await this.prisma.task.findMany({
      where: { organizationId, workflowInstanceId, sourceStageId, status: 'UNASSIGNED' },
      include: { assignees: true },
    });
    if (tasks.length === 0) return 0;

    let recoveredCount = 0;

    for (const task of tasks) {
      const now = new Date();

      // One transaction per task: a half-applied recovery (assignees attached
      // but status still UNASSIGNED) would be permanently self-perpetuating,
      // not self-healing — the stage's isUnassigned flag has already flipped
      // false by this point, so the sweep's recovery branch never fires for
      // it again and nothing would ever retry.
      await this.prisma.$transaction(async (tx) => {
        for (const userId of eligibleAssigneeIds) {
          const existing = task.assignees.find((a) => a.userId === userId);
          if (existing) {
            // Reactivate-in-place, matching ACC-32's CommitteeMember
            // precedent: TaskAssignee's @@unique([taskId, userId]) has no
            // partial exemption, so a returning assignee reuses their own row
            // rather than creating a second one. Reachable via a repeat
            // recovery, and via a task left UNASSIGNED by
            // reassignAllForUser() with removed rows still attached.
            if (existing.removedAt !== null) {
              await tx.taskAssignee.update({
                where: { id: existing.id },
                data: { removedAt: null, assignedAt: now },
              });
            }
            continue;
          }
          await tx.taskAssignee.create({
            data: {
              taskId: task.id,
              userId,
              // No human actor exists for a sweep-driven assignment, and
              // assignedById is a required FK. The task's own creator —
              // whoever triggered the transition that created it — is the
              // honest attribution: this assignment finishes what their
              // action started, once the org gap blocking it was fixed.
              assignedById: task.createdById,
            },
          });
        }

        await tx.task.update({ where: { id: task.id }, data: { status: 'PENDING' } });
      });

      recoveredCount += 1;

      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Task',
        objectId: task.id,
        // actorId deliberately omitted — system-driven sweep action, matching
        // every other SlaMonitorProcessor-originated audit entry.
        tenantId: organizationId,
        metadata: {
          event: 'unassigned_stage_recovery',
          workflowInstanceId,
          sourceStageId,
          attachedAssigneeIds: eligibleAssigneeIds,
        },
      });

      // Same per-assignee loop and wording as create()'s own assigned branch —
      // for these recipients this genuinely IS a new assignment, since the
      // pool was empty when the task was first created.
      for (const userId of eligibleAssigneeIds) {
        await this.notificationService.create(
          {
            userId,
            titleEn: 'New task assigned',
            bodyEn: `You have been assigned: "${task.title}"`,
            objectType: 'Task',
            objectId: task.id,
          },
          organizationId,
        );
      }
    }

    return recoveredCount;
  }

  // ACC-52 — the cheap pre-check that makes idempotent recovery affordable.
  // Recovery now runs on every sweep for every open, non-blocked stage
  // (rather than only on a one-time flag transition), so the caller needs a
  // way to answer "is there anything orphaned here at all?" WITHOUT paying
  // for assignee-pool resolution first — that resolution is the expensive
  // half (role/committee lookups, org-unit parent walks, then out-of-office
  // routing per resolved user), and on a healthy tenant the answer is almost
  // always "nothing to do".
  //
  // Deliberately a `count`, not a `findMany` — the caller only branches on
  // existence, and the rows themselves are re-read (with their assignees)
  // by attachAssigneesToUnassignedStageTasks() inside its own transaction
  // anyway. Reading them twice is correct rather than wasteful: a row read
  // here and acted on later would be a stale snapshot.
  async hasUnassignedStageTasks(
    workflowInstanceId: string,
    sourceStageId: string,
    organizationId: string,
  ): Promise<boolean> {
    const orphanCount = await this.prisma.task.count({
      where: { organizationId, workflowInstanceId, sourceStageId, status: 'UNASSIGNED' },
    });
    return orphanCount > 0;
  }

  // ACC-162 — evidence follows the assignee, exactly as completion does: only a
  // currently-active assignee may attach it, so the route carries no
  // permission. Before this, any holder of tasks:complete could attach evidence
  // to any task in the tenant, while the assignee themselves — usually
  // BASE_USER, which never held it — could not.
  //
  // A closed task is refused (see findOpenForActiveAssignee): evidence added
  // after the fact would rewrite the record of what proved the work was done.
  async addEvidence(
    taskId: string,
    dto: AddTaskEvidenceDto,
    organizationId: string,
    actorId: string,
  ): Promise<ITaskEvidence> {
    // ACC-163 — locked like the status changes, so evidence cannot land on a
    // task a colleague is completing at the same moment.
    //
    // Only the fields of the evidence's own type are written: a LINK carries
    // no reference and a reference carries no URL, whatever else was sent.
    const evidence = await this.prisma.$transaction(async (tx) => {
      await this.lockOpenForActiveAssignee(tx, taskId, actorId, organizationId, 'have evidence added');
      return tx.taskEvidence.create({
        data: {
          organizationId,
          taskId,
          type: dto.type,
          uploadedById: actorId,
          ...(dto.type === 'LINK'
            ? { url: dto.url ?? null, linkTitle: dto.linkTitle ?? null }
            : {
                refType: dto.refType ?? null,
                refId: dto.refId ?? null,
                // No functional module exists yet to resolve a real display
                // name from.
                refDisplay: dto.refId ?? null,
              }),
        },
      });
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TaskEvidence',
      objectId: evidence.id,
      actorId,
      tenantId: organizationId,
      after: evidence as unknown as Record<string, unknown>,
    });

    return evidence;
  }

  // The self-scoped rule complete() and addEvidence() share. One copy, so the
  // two actions cannot drift apart on who counts as an assignee.
  //
  // 1. The task must be in this tenant and the caller one of its CURRENTLY-
  //    active assignees (removedAt null) — someone completed past or
  //    reassigned away is not. Every failure here is the SAME 404, body and
  //    all: a missing task, another tenant's, one the caller was never on and
  //    one they were removed from are indistinguishable (ACC-101 clause (b)).
  //    This used to say "Task not found for this assignee" when the task
  //    existed, which told any caller with an id that it was real.
  //
  // 2. Only then is a closed task refused, with 409 — so a non-assignee never
  //    learns a task's status. COMPLETED and CANCELLED both refuse: ACC-68
  //    leaves a cancelled task's assignees attached, and the completer's own
  //    row is never stamped, so the assignee check alone admits both.
  //    `refusedAction` completes the sentence "A cancelled task cannot …".
  //
  // ACC-163 — it now runs INSIDE the caller's transaction and takes the row
  // lock first (lockTaskRow), so every check below reads the locked state.
  // Every assignee action — start, reject, complete, add evidence — comes
  // through here, and reassign() takes the same lock itself.
  private async lockOpenForActiveAssignee(
    tx: TaskTx,
    id: string,
    userId: string,
    organizationId: string,
    refusedAction: string,
  ): Promise<TaskWithAssigneeRows> {
    await this.lockTaskRow(tx, id, organizationId);
    const task = await tx.task.findFirst({
      where: { id, organizationId },
      include: { assignees: true },
    });
    const callerIsActiveAssignee = task?.assignees.some(
      (a) => a.userId === userId && a.removedAt === null,
    );
    if (!task || !callerIsActiveAssignee) {
      throw new NotFoundException('Task not found');
    }

    if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
      throw new ConflictException(`A ${task.status.toLowerCase()} task cannot ${refusedAction}`);
    }
    return task;
  }

  // ACC-163 — THE CODEBASE'S FIRST ROW LOCK, and why it exists.
  //
  // Every status change here is read-check-write: read the task and its
  // assignees, decide, write. Two of them interleaving produce states no single
  // one allows:
  //   - A completes while B rejects. B read the task while it was still open,
  //     so B's write turns a COMPLETED task into REJECTED.
  //   - The last two assignees reject together. Each reads the other as still
  //     assigned, so each leaves the task open — and it ends with nobody on it,
  //     not REJECTED, and nobody told.
  // SELECT … FOR UPDATE makes the second caller wait until the first commits,
  // then read what the first wrote. It is scoped by id AND organizationId, like
  // every query here, so it can never lock another tenant's row.
  //
  // Keep these transactions SHORT: only the reads and writes the decision
  // needs. Audit rows and notifications are written after commit, never while
  // the lock is held. A row that does not exist locks nothing, and the read
  // that follows returns the ordinary 404.
  private async lockTaskRow(tx: TaskTx, id: string, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
  }

  // ACC-163 — tells a rejected task's creator, naming the record the task
  // belongs to: the bell has no links, so the record's name is how they find
  // where to reassign it. English and Arabic both, as every new notification
  // should be.
  private async notifyCreatorOfRejection(
    task: ITask,
    rejectedById: string,
    reason: string,
    organizationId: string,
  ): Promise<void> {
    const rejecter = await this.prisma.user.findFirst({
      where: { id: rejectedById, organizationId },
      select: { name: true },
    });
    const name = rejecter?.name ?? '—';
    const record = await this.resolveSourceRecordLabel(task, organizationId);

    await this.notificationService.create(
      {
        userId: task.createdById,
        titleEn: 'Task rejected',
        titleAr: 'تم رفض مهمة',
        bodyEn: `${name} rejected "${task.title}" on ${record.en}. Reason: ${reason}`,
        bodyAr: `رفض ${name} المهمة "${task.title}" في ${record.ar}. السبب: ${reason}`,
        objectType: 'Task',
        objectId: task.id,
      },
      organizationId,
    );
  }

  // The record a task belongs to, as a phrase for a sentence. Committee is the
  // only module with records today, so it is the only one named; the others
  // read as their kind of record until their modules exist. A committee with
  // no Arabic name is named in English (ACC-160).
  private async resolveSourceRecordLabel(
    task: ITask,
    organizationId: string,
  ): Promise<{ en: string; ar: string }> {
    if (task.sourceType === 'COMMITTEE') {
      const committee = await this.prisma.committee.findFirst({
        where: { id: task.sourceId, organizationId },
        select: { nameEn: true, nameAr: true },
      });
      if (committee) {
        return {
          en: `the committee "${committee.nameEn}"`,
          ar: `اللجنة "${committee.nameAr ?? committee.nameEn}"`,
        };
      }
    }
    return {
      en: `a ${task.sourceType.toLowerCase().replace(/_/g, ' ')} record`,
      ar: 'السجل المرتبط بها',
    };
  }

  // ACC-167 (decision 6) — the pick-up clock, started whenever a task enters
  // its pool. poolEscalateAt is the priority's managerEscalationAfterHours
  // counted in WORKING hours through WorkingCalendarService — no module
  // computes its own dates — and stored, so the sweep compares one column.
  private async poolClock(
    priority: TaskPriority,
    organizationId: string,
    from: Date,
  ): Promise<{ pooledAt: Date; poolEscalateAt: Date; poolEscalatedAt: null }> {
    const slaConfig = await this.tenantService.getTaskSla(organizationId);
    const hours = slaConfig[priority].managerEscalationAfterHours;
    const at = await this.workingCalendar.calculateDeadline(DateTime.fromJSDate(from), hours, organizationId);
    return { pooledAt: from, poolEscalateAt: at.toJSDate(), poolEscalatedAt: null };
  }

  // ACC-167 — tells the CURRENT members of a task's pool, once: when the task
  // enters it and when it is handed back. Never the person who released it
  // (or who just created it). English and Arabic. Called after commit.
  private async notifyPool(
    taskId: string,
    organizationId: string,
    options: { event: 'created' | 'released'; excludeUserId: string | null; reason?: string },
  ): Promise<void> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, organizationId },
      include: POOL_LABEL_INCLUDE,
    });
    const target = task ? poolTargetOf(task) : null;
    const view = task ? toPoolView(task) : null;
    if (!task || !target || !view) return;

    const label = poolLabel(view);
    const members = (await resolvePoolMemberIds(this.prisma, target, organizationId)).filter(
      (id) => id !== options.excludeUserId,
    );
    for (const userId of members) {
      await this.notificationService.create(
        options.event === 'created'
          ? {
              userId,
              titleEn: 'New task to pick up',
              titleAr: 'مهمة جديدة متاحة للاستلام',
              bodyEn: `"${task.title}" is waiting for someone in ${label.en} to pick it up.`,
              bodyAr: `المهمة "${task.title}" بانتظار أن يستلمها أحد من ${label.ar}.`,
              objectType: 'Task',
              objectId: task.id,
            }
          : {
              userId,
              titleEn: 'Task handed back to pick up',
              titleAr: 'أُعيدت مهمة لتُستلم',
              bodyEn: `"${task.title}" was handed back to ${label.en}. Reason: ${options.reason ?? ''}`,
              bodyAr: `أُعيدت المهمة "${task.title}" إلى ${label.ar}. السبب: ${options.reason ?? ''}`,
              objectType: 'Task',
              objectId: task.id,
            },
        organizationId,
      );
    }
  }

  // Priority SLA from Organization.settings.taskSla (ACC-46 Section 2.7.c —
  // tenant-configurable, via TenantService.getTaskSla(), which itself falls
  // back to DEFAULT_TASK_SLA_SETTINGS when absent). Never a module's own
  // date math — always through WorkingCalendarService.
  private async computeSlaDueAt(priority: TaskPriority, organizationId: string): Promise<Date> {
    const slaConfig = await this.tenantService.getTaskSla(organizationId);
    const hours = slaConfig[priority].dueAfterHours;

    const deadline = await this.workingCalendar.calculateDeadline(DateTime.now(), hours, organizationId);
    return deadline.toJSDate();
  }

  // Excludes suspended/invited users from a resolved assignee list — an
  // inactive user should never end up as a task's sole assignee.
  //
  // `client` lets reassign() read inside its transaction; everyone else reads
  // through the ordinary client.
  private async filterActiveUsers(
    userIds: string[],
    organizationId: string,
    client: Pick<TaskTx, 'user'> = this.prisma,
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await client.user.findMany({
      where: { id: { in: userIds }, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }
}
