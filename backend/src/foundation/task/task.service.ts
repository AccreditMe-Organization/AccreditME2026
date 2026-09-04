import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { TaskStatus, TaskSourceType, TaskPriority } from '../../../generated/prisma/client';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { AddTaskEvidenceDto } from './dto/add-task-evidence.dto';
import { ITask } from './interfaces/task.interface';
import { ITaskEvidence } from './interfaces/task-evidence.interface';

interface GetTasksOptions {
  status?: TaskStatus;
}

@Injectable()
export class TaskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notificationService: NotificationService,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
  ) {}

  async create(dto: CreateTaskDto, organizationId: string, actorId: string): Promise<ITask> {
    const dueAt = dto.dueDate
      ? new Date(dto.dueDate)
      : await this.computeSlaDueAt(dto.priority ?? 'MEDIUM', organizationId);

    const eligibleAssigneeIds = await this.filterActiveUsers(dto.assigneeUserIds, organizationId);
    const isUnassigned = eligibleAssigneeIds.length === 0;

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
        priority: dto.priority ?? 'MEDIUM',
        status: isUnassigned ? 'UNASSIGNED' : 'PENDING',
        dueAt,
        dueDateOverridden: !!dto.dueDate,
        assignees: isUnassigned
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

    if (isUnassigned) {
      await this.notifyTenantAdmins(
        organizationId,
        'Task created with no eligible assignee',
        `"${task.title}" has no eligible assignee and needs to be assigned manually.`,
        task,
      );
    } else {
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

    return task;
  }

  // "My Tasks" — every task where the calling user has an active
  // (removedAt: null) TaskAssignee row.
  async getMyTasks(
    userId: string,
    organizationId: string,
    options: GetTasksOptions = {},
  ): Promise<ITask[]> {
    return this.prisma.task.findMany({
      where: {
        organizationId,
        ...(options.status ? { status: options.status } : {}),
        assignees: { some: { userId, removedAt: null } },
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  // Module task lists — CLAUDE.md's "tasks filtered by sourceType + sourceId".
  async getForSource(sourceType: TaskSourceType, sourceId: string, organizationId: string): Promise<ITask[]> {
    return this.prisma.task.findMany({
      where: { organizationId, sourceType, sourceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Tenant-wide — unassigned tasks have no assignees, so getMyTasks()
  // structurally can never surface them (ACC-34).
  async listUnassigned(organizationId: string): Promise<ITask[]> {
    return this.prisma.task.findMany({
      where: { organizationId, status: 'UNASSIGNED' },
      orderBy: { createdAt: 'desc' },
    });
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

  // ANY-completes semantics: the first active assignee to call this finishes
  // it for everyone else — their TaskAssignee rows get removedAt stamped, but
  // are never deleted (permanent record of who was ever assigned).
  async complete(id: string, userId: string, organizationId: string): Promise<ITask> {
    const existing = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: { assignees: true },
    });
    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const callerIsActiveAssignee = existing.assignees.some(
      (a) => a.userId === userId && a.removedAt === null,
    );
    if (!callerIsActiveAssignee) {
      throw new NotFoundException('Task not found for this assignee');
    }

    const now = new Date();
    await this.prisma.taskAssignee.updateMany({
      where: { taskId: id, removedAt: null, userId: { not: userId } },
      data: { removedAt: now },
    });

    const task = await this.prisma.task.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: now, completedById: userId },
      include: { assignees: true },
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

  // Pattern 2 — Manual Reassignment (Absence and Departure Management).
  async reassign(
    id: string,
    dto: ReassignTaskDto,
    organizationId: string,
    actorId: string,
  ): Promise<ITask> {
    const existing = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: { assignees: true },
    });
    if (!existing) {
      throw new NotFoundException('Task not found');
    }

    const now = new Date();
    await this.prisma.taskAssignee.updateMany({
      where: { taskId: id, removedAt: null },
      data: { removedAt: now },
    });

    const eligibleAssigneeIds = await this.filterActiveUsers(dto.newAssigneeUserIds, organizationId);

    const task = await this.prisma.task.update({
      where: { id },
      data: {
        status: eligibleAssigneeIds.length === 0 ? 'UNASSIGNED' : 'PENDING',
        assignees: {
          create: eligibleAssigneeIds.map((userId) => ({ userId, assignedById: actorId })),
        },
      },
      include: { assignees: true },
    });

    await this.auditLog.log({
      action: 'DELEGATE',
      objectType: 'Task',
      objectId: id,
      actorId,
      tenantId: organizationId,
      before: existing as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: { reason: dto.reason, newAssigneeUserIds: eligibleAssigneeIds },
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
  ): Promise<{ reassignedCount: number; unassignedCount: number }> {
    const activeAssignments = await this.prisma.taskAssignee.findMany({
      where: { userId: fromUserId, removedAt: null, task: { organizationId } },
      include: { task: { include: { assignees: true } } },
    });

    const eligibleToUserIds = toUserId ? await this.filterActiveUsers([toUserId], organizationId) : [];
    const validToUserId = eligibleToUserIds[0] ?? null;

    let reassignedCount = 0;
    let unassignedCount = 0;

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

    return { reassignedCount, unassignedCount };
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

  async addEvidence(
    taskId: string,
    dto: AddTaskEvidenceDto,
    organizationId: string,
    actorId: string,
  ): Promise<ITaskEvidence> {
    await this.getById(taskId, organizationId); // validates tenant ownership

    let refDisplay: string | null = null;
    if (dto.type === 'INTERNAL_REFERENCE' && dto.refId) {
      refDisplay = dto.refId; // no functional module exists yet to resolve a real display name from
    }

    const evidence = await this.prisma.taskEvidence.create({
      data: {
        organizationId,
        taskId,
        type: dto.type,
        content: dto.content ?? null,
        s3Key: dto.s3Key ?? null,
        fileName: dto.fileName ?? null,
        fileSize: dto.fileSize ?? null,
        mimeType: dto.mimeType ?? null,
        url: dto.url ?? null,
        linkTitle: dto.linkTitle ?? null,
        refType: dto.refType ?? null,
        refId: dto.refId ?? null,
        refDisplay,
        uploadedById: actorId,
      },
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
  private async filterActiveUsers(userIds: string[], organizationId: string): Promise<string[]> {
    if (userIds.length === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, organizationId, status: 'ACTIVE' },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  private async notifyTenantAdmins(
    organizationId: string,
    titleEn: string,
    bodyEn: string,
    task: { id: string },
  ): Promise<void> {
    const adminRole = await this.prisma.role.findFirst({
      where: { organizationId, key: 'TENANT_ADMIN' },
    });
    if (!adminRole) return;

    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
    });

    for (const userRole of userRoles) {
      await this.notificationService.create(
        {
          userId: userRole.userId,
          titleEn,
          bodyEn,
          objectType: 'Task',
          objectId: task.id,
        },
        organizationId,
      );
    }
  }
}
