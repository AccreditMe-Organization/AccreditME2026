import { Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TaskStatus, TaskSourceType } from '../../../generated/prisma/client';
import { CreateTaskDto } from './dto/create-task.dto';
import { ReassignTaskDto } from './dto/reassign-task.dto';
import { AddTaskEvidenceDto } from './dto/add-task-evidence.dto';
import { ITask } from './interfaces/task.interface';
import { ITaskEvidence } from './interfaces/task-evidence.interface';

// Platform default SLA hours per priority — used when Organization.settings
// .taskSla is absent. Tenant admins override via Organization.settings.
const DEFAULT_TASK_SLA_HOURS: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 16,
  MEDIUM: 40,
  LOW: 80,
};
const FALLBACK_SLA_HOURS = 40;

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

  // Priority SLA from Organization.settings.taskSla (tenant-configurable),
  // falling back to platform defaults when absent. Never a module's own date
  // math — always through WorkingCalendarService.
  private async computeSlaDueAt(priority: string, organizationId: string): Promise<Date> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    const settings = org?.settings as { taskSla?: Record<string, number> } | null;
    const hours =
      settings?.taskSla?.[priority] ?? DEFAULT_TASK_SLA_HOURS[priority] ?? FALLBACK_SLA_HOURS;

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
