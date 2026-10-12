import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { TaskAssignee, TaskStatus } from '../../../generated/prisma/client';
import { ITask } from './interfaces/task.interface';
import { ITaskRequest, ITaskRequestForDecision } from './interfaces/task-request.interface';
import { ApproveTaskRequestDto, CreateTaskRequestDto, DeclineTaskRequestDto } from './dto/task-request.dto';
import { TaskAuthorityService } from './task-authority.service';
import { TaskSlaService, latest } from './task-sla.service';
import { aTaskThatIs } from './task-status-label';
import { HOLD_CLEARED, REQUESTABLE_STATUSES } from './task-request-lifecycle';
import { lockWorkflowInstance, moveStageDeadlineForTaskInTx } from './stage-deadline';

type TaskTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type TaskWithAssigneeRows = ITask & { assignees: TaskAssignee[] };

/** The longest hold a person may ask for, in calendar days from the request. */
export const MAX_HOLD_DAYS = 90;

export interface RequestViewer {
  id: string;
  permissions: readonly string[];
}

// An identical 404 for anyone not entitled, whatever the reason — ACC-101
// clause (b): the entitlement is only knowable from the row.
const NOT_FOUND = 'Task not found';

const REQUEST_STATUS_PHRASE: Record<string, string> = {
  APPROVED: 'approved',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
  CANCELLED: 'cancelled',
};

/**
 * ACC-173 — extension and on-hold requests, and the hold itself.
 *
 * WHO:
 *   ask        an active assignee of an Assigned or In-progress task
 *   withdraw   the person who asked
 *   decide     the creator, anyone acting for them (canActForCreator), or a
 *              tasks:reassign holder — never the person who asked
 *   resume     an active assignee, or anyone who may decide
 * Everyone else gets the identical 404, checked before any 409.
 *
 * Every status change takes the task's row lock (ACC-163) inside a short
 * transaction; audit rows and notifications are written after commit.
 *
 * ON HOLD pauses the SLA. ACC-174 changed WHEN: the SLA window moves at
 * APPROVAL — due date, SLA start and limit all move forward by the WORKING
 * time between the approval and the hold date (WorkingCalendarService; no
 * module computes its own dates). Resume, at onHoldUntil by the SLA monitor or
 * early by hand, shifts nothing: it restores the status and clears the hold.
 *
 * ACC-190 — the stage's own deadline (WorkflowInstanceStage.slaDueAt) now
 * follows a MANDATORY stage task: an approved extension or hold that moves its
 * due date past the open entry's deadline moves the deadline out to match
 * (stage-deadline.ts). An optional task, or a task with no stage entry, never
 * moves it.
 */
@Injectable()
export class TaskRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notificationService: NotificationService,
    private readonly authority: TaskAuthorityService,
    private readonly sla: TaskSlaService,
  ) {}

  // ── Ask ────────────────────────────────────────────────────────────────

  async create(taskId: string, dto: CreateTaskRequestDto, userId: string, organizationId: string): Promise<ITaskRequest> {
    // The other type's date is refused before anything is read: it says
    // nothing about the task.
    if (dto.type === 'EXTENSION' && dto.holdUntil) {
      throw new BadRequestException('A request for more time takes a new due date, not a hold date');
    }
    if (dto.type === 'ON_HOLD' && dto.requestedDueAt) {
      throw new BadRequestException('A hold request takes a hold date, not a new due date');
    }

    const now = new Date();
    const { task, request } = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId, organizationId);
      if (!task || !isActiveAssignee(task, userId)) throw new NotFoundException(NOT_FOUND);

      if (task.status === 'ON_HOLD') throw new ConflictException('This task is already on hold');
      if (!REQUESTABLE_STATUSES.includes(task.status)) {
        throw new ConflictException(`${aTaskThatIs(task.status)} cannot take a request`);
      }
      const open = await tx.taskRequest.findFirst({
        where: { organizationId, taskId, status: 'PENDING' },
        select: { id: true },
      });
      if (open) throw new ConflictException('This task already has a request waiting for a decision');

      let requestedDueAt: Date | null = null;
      let holdUntil: Date | null = null;
      if (dto.type === 'EXTENSION') {
        requestedDueAt = new Date(dto.requestedDueAt!);
        if (requestedDueAt <= now) throw new BadRequestException('The new due date must be in the future');
        if (task.dueAt && requestedDueAt <= task.dueAt) {
          throw new BadRequestException('The new due date must be after the current one');
        }
      } else {
        holdUntil = new Date(dto.holdUntil!);
        if (holdUntil <= now) throw new BadRequestException('The hold date must be in the future');
        const latest = DateTime.fromJSDate(now).plus({ days: MAX_HOLD_DAYS }).toJSDate();
        if (holdUntil > latest) {
          throw new BadRequestException(`A hold can last at most ${MAX_HOLD_DAYS} days`);
        }
      }

      const request = await tx.taskRequest.create({
        data: {
          organizationId,
          taskId,
          type: dto.type,
          requestedById: userId,
          reason: dto.reason,
          requestedDueAt,
          holdUntil,
        },
      });
      return { task, request };
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'TaskRequest',
      objectId: request.id,
      actorId: userId,
      tenantId: organizationId,
      after: request as unknown as Record<string, unknown>,
      metadata: { event: 'request_made', taskId, type: dto.type },
    });

    const requester = await this.userName(userId, organizationId);
    const recipients = await this.authority.decisionRecipients(task.createdById, userId, organizationId);
    for (const recipient of recipients) {
      await this.notificationService.create(
        {
          userId: recipient,
          ...(dto.type === 'EXTENSION'
            ? {
                titleEn: 'More time requested',
                titleAr: 'طلب وقت إضافي',
                bodyEn: `${requester} asks for more time on "${task.title}". Reason: ${dto.reason}`,
                bodyAr: `يطلب ${requester} وقتًا إضافيًا للمهمة "${task.title}". السبب: ${dto.reason}`,
              }
            : {
                titleEn: 'Hold requested',
                titleAr: 'طلب إيقاف مؤقت',
                bodyEn: `${requester} asks to put "${task.title}" on hold. Reason: ${dto.reason}`,
                bodyAr: `يطلب ${requester} إيقاف المهمة "${task.title}" مؤقتًا. السبب: ${dto.reason}`,
              }),
          objectType: 'Task',
          objectId: taskId,
        },
        organizationId,
      );
    }
    return request;
  }

  // ── Withdraw ───────────────────────────────────────────────────────────

  async withdraw(taskId: string, requestId: string, userId: string, organizationId: string): Promise<ITaskRequest> {
    const request = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId, organizationId);
      const existing = task ? await this.findRequest(tx, requestId, taskId, organizationId) : null;
      if (!task || !existing || existing.requestedById !== userId) throw new NotFoundException(NOT_FOUND);
      assertPending(existing.status);
      return tx.taskRequest.update({ where: { id: requestId }, data: { status: 'WITHDRAWN' } });
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'TaskRequest',
      objectId: requestId,
      actorId: userId,
      tenantId: organizationId,
      after: request as unknown as Record<string, unknown>,
      metadata: { event: 'request_withdrawn', taskId },
    });
    return request;
  }

  // ── Decide ─────────────────────────────────────────────────────────────

  async approve(
    taskId: string,
    requestId: string,
    dto: ApproveTaskRequestDto,
    viewer: RequestViewer,
    organizationId: string,
  ): Promise<ITaskRequest> {
    const now = new Date();
    const { before, task, request, heldHours, stageMove } = await this.prisma.$transaction(async (tx) => {
      // ACC-190 — approving may move the stage's deadline, so a stage task's
      // instance is locked BEFORE the task, the engine's own order.
      const link = await tx.task.findFirst({ where: { id: taskId, organizationId }, select: { workflowInstanceId: true } });
      if (link?.workflowInstanceId) await lockWorkflowInstance(tx, link.workflowInstanceId, organizationId);
      const { task, request: existing } = await this.lockForDecision(tx, taskId, requestId, viewer, organizationId);

      if (!REQUESTABLE_STATUSES.includes(task.status)) {
        throw new ConflictException(`${aTaskThatIs(task.status)} cannot take a request`);
      }

      let after;
      let heldHours = 0;
      if (existing.type === 'EXTENSION') {
        if (!existing.requestedDueAt || existing.requestedDueAt <= now) {
          throw new ConflictException('The requested due date has passed; decline and ask for a new one');
        }
        // ACC-174 (C5) — the creator may have moved the due date since the
        // request was made; asking for a date that is no longer later is moot.
        if (task.dueAt && existing.requestedDueAt <= task.dueAt) {
          throw new ConflictException(
            'The requested due date is no longer after the current one; decline and ask again',
          );
        }
        // As asked — no counter-proposal. The escalation stamps are cleared so
        // escalation can fire again against the new date. ACC-174 (C3): the
        // limit rises to the approved date and never falls — a request never
        // takes time away — and slaExtendedTo keeps that date, so a later
        // priority change cannot drop the limit below it.
        const limitAt = await this.sla.limitOf(task, organizationId);
        after = await tx.task.update({
          where: { id: taskId },
          data: {
            dueAt: existing.requestedDueAt,
            dueDateOverridden: true,
            slaStartAt: this.sla.startOf(task),
            slaLimitAt: latest(limitAt, existing.requestedDueAt),
            slaExtendedTo: latest(existing.requestedDueAt, task.slaExtendedTo),
            slaBreachedAt: null,
            managerEscalatedAt: null,
            headEscalatedAt: null,
          },
        });
      } else {
        if (!existing.holdUntil || existing.holdUntil <= now) {
          throw new ConflictException('The requested hold date has passed; decline and ask for a new one');
        }
        // ACC-174 — THE SLA WINDOW MOVES AT APPROVAL, to start when the hold
        // ends: the SLA start BECOMES the hold's end date, and the due date,
        // limit and any approved extension move forward by the working hours
        // between now and the hold date. Resume then shifts nothing, so
        // resuming early keeps the dates set here. Zero working hours (a hold
        // that ends before the next working hour) moves those three not at all
        // — calculateDeadline() would normalise the date (ACC-175).
        //
        // The start is SET, not shifted (Ahmad, 6 Oct): shifting it went
        // through calculateDeadline(), which first moves a start outside
        // working hours to the next opening, so a task created after hours
        // landed somewhere other than where its hold ended.
        heldHours = await this.workingCalendar.workingHoursBetween(
          DateTime.fromJSDate(now),
          DateTime.fromJSDate(existing.holdUntil),
          organizationId,
        );
        const shift = (d: Date | null) => (d ? this.sla.shift(d, heldHours, organizationId) : Promise.resolve(null));
        const dueAt = await shift(task.dueAt);
        const slaStartAt = existing.holdUntil;
        const slaLimitAt = await this.sla.shift(await this.sla.limitOf(task, organizationId), heldHours, organizationId);
        const slaExtendedTo = await shift(task.slaExtendedTo);
        after = await tx.task.update({
          where: { id: taskId },
          data: {
            status: 'ON_HOLD',
            // A legacy OVERDUE row is an Assigned task (ACC-163).
            heldFromStatus: task.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PENDING',
            heldAt: now,
            onHoldUntil: existing.holdUntil,
            dueAt,
            slaStartAt,
            slaLimitAt,
            slaExtendedTo,
            // A due date moved past now re-arms escalation; one still past keeps
            // its stamps, so a breach is not escalated twice.
            ...(heldHours > 0 && dueAt && dueAt > now
              ? { slaBreachedAt: null, managerEscalatedAt: null, headEscalatedAt: null }
              : {}),
          },
        });
      }

      // ACC-190 — a mandatory stage task's new due date past its stage's
      // deadline moves the deadline out (extension and hold alike).
      const stageMove = await moveStageDeadlineForTaskInTx(tx, after, organizationId, now);

      const request = await tx.taskRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', decidedById: viewer.id, decidedAt: now, decisionNote: dto.note || null },
      });
      return { before: task, task: after, request, heldHours, stageMove };
    });

    if (stageMove) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'WorkflowInstanceStage',
        objectId: stageMove.workflowInstanceStageId,
        actorId: viewer.id,
        tenantId: organizationId,
        before: { slaDueAt: stageMove.from },
        after: { slaDueAt: stageMove.to },
        metadata: { event: 'stage_deadline_extended', taskId, requestId, requestType: request.type },
      });
    }

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'TaskRequest',
      objectId: requestId,
      actorId: viewer.id,
      tenantId: organizationId,
      after: request as unknown as Record<string, unknown>,
      metadata: { event: 'request_approved', taskId, type: request.type },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: taskId,
      actorId: viewer.id,
      tenantId: organizationId,
      before: before as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata:
        request.type === 'EXTENSION'
          ? { event: 'due_date_extended', requestId, dueAtBefore: before.dueAt, dueAtAfter: task.dueAt }
          : {
              event: 'hold_started',
              requestId,
              onHoldUntil: task.onHoldUntil,
              heldWorkingHours: heldHours,
              dueAtBefore: before.dueAt,
              dueAtAfter: task.dueAt,
            },
    });

    await this.notificationService.create(
      {
        userId: request.requestedById,
        ...(request.type === 'EXTENSION'
          ? {
              titleEn: 'More time approved',
              titleAr: 'تمت الموافقة على الوقت الإضافي',
              bodyEn: `Your request for more time on "${task.title}" was approved.`,
              bodyAr: `تمت الموافقة على طلبك وقتًا إضافيًا للمهمة "${task.title}".`,
            }
          : {
              titleEn: 'Hold approved',
              titleAr: 'تمت الموافقة على الإيقاف المؤقت',
              bodyEn: `"${task.title}" is on hold, as you asked.`,
              bodyAr: `المهمة "${task.title}" متوقفة مؤقتًا كما طلبت.`,
            }),
        objectType: 'Task',
        objectId: taskId,
      },
      organizationId,
    );
    return request;
  }

  async decline(
    taskId: string,
    requestId: string,
    dto: DeclineTaskRequestDto,
    viewer: RequestViewer,
    organizationId: string,
  ): Promise<ITaskRequest> {
    const { task, request } = await this.prisma.$transaction(async (tx) => {
      const { task } = await this.lockForDecision(tx, taskId, requestId, viewer, organizationId);
      const request = await tx.taskRequest.update({
        where: { id: requestId },
        data: { status: 'DECLINED', decidedById: viewer.id, decidedAt: new Date(), decisionNote: dto.note },
      });
      return { task, request };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'TaskRequest',
      objectId: requestId,
      actorId: viewer.id,
      tenantId: organizationId,
      after: request as unknown as Record<string, unknown>,
      metadata: { event: 'request_declined', taskId, type: request.type, note: dto.note },
    });

    await this.notificationService.create(
      {
        userId: request.requestedById,
        titleEn: 'Request declined',
        titleAr: 'تم رفض طلبك',
        bodyEn: `Your request on "${task.title}" was declined: ${dto.note}`,
        bodyAr: `تم رفض طلبك بشأن المهمة "${task.title}": ${dto.note}`,
        objectType: 'Task',
        objectId: taskId,
      },
      organizationId,
    );
    return request;
  }

  // ── Resume ─────────────────────────────────────────────────────────────

  /** "Resume now" — by an active assignee, or by anyone who may decide. */
  async resume(taskId: string, viewer: RequestViewer, organizationId: string): Promise<ITask> {
    const { before, task } = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId, organizationId);
      const entitled =
        !!task &&
        (isActiveAssignee(task, viewer.id) ||
          viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN) ||
          (await this.authority.canActForCreator(task.createdById, viewer.id, organizationId, tx)));
      if (!task || !entitled) throw new NotFoundException(NOT_FOUND);
      if (task.status !== 'ON_HOLD') throw new ConflictException('This task is not on hold');
      return this.endHold(tx, task);
    });
    await this.afterResume(before, task, organizationId, viewer.id);
    return task;
  }

  /**
   * The SLA monitor's resume, at onHoldUntil. Returns false when the task is
   * no longer a due hold — resumed by hand, reassigned or closed since the
   * sweep read it — so a hold resumes once.
   */
  async resumeDueHold(taskId: string, organizationId: string, now: Date = new Date()): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      const task = await this.lockTask(tx, taskId, organizationId);
      if (!task || task.status !== 'ON_HOLD' || !task.onHoldUntil || task.onHoldUntil > now) return null;
      return this.endHold(tx, task);
    });
    if (!result) return false;
    await this.afterResume(result.before, result.task, organizationId, undefined);
    return true;
  }

  // ── The decider inbox ──────────────────────────────────────────────────

  /**
   * "Waiting for your decision": pending requests on tasks the viewer created
   * or currently acts for — and, for a tasks:reassign holder, on tasks whose
   * creator is no longer ACTIVE. Never the viewer's own requests.
   */
  async awaitingDecision(viewer: RequestViewer, organizationId: string): Promise<ITaskRequestForDecision[]> {
    const covered = await this.authority.creatorsCoveredBy(viewer.id, organizationId);
    const creators = [viewer.id, ...covered];
    const rows = await this.prisma.taskRequest.findMany({
      where: {
        organizationId,
        status: 'PENDING',
        requestedById: { not: viewer.id },
        OR: [
          { task: { createdById: { in: creators } } },
          ...(viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN)
            ? [{ task: { createdBy: { status: { not: 'ACTIVE' as const } } } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
      include: {
        requestedBy: { select: { name: true } },
        task: {
          select: { id: true, title: true, sourceType: true, sourceId: true, status: true, priority: true, dueAt: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      requestedDueAt: r.requestedDueAt,
      holdUntil: r.holdUntil,
      requestedById: r.requestedById,
      requestedByName: r.requestedBy.name,
      reason: r.reason,
      createdAt: r.createdAt,
      task: r.task,
    }));
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private async lockTask(tx: TaskTx, id: string, organizationId: string): Promise<TaskWithAssigneeRows | null> {
    await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    return tx.task.findFirst({ where: { id, organizationId }, include: { assignees: true } });
  }

  private findRequest(tx: TaskTx, requestId: string, taskId: string, organizationId: string) {
    return tx.taskRequest.findFirst({ where: { id: requestId, taskId, organizationId } });
  }

  // Under the lock: the identical 404 for a missing task or request, or a
  // caller who may not decide; then 403 for deciding your own request (the
  // asker already knows the task); then 409 for a request no longer pending.
  private async lockForDecision(
    tx: TaskTx,
    taskId: string,
    requestId: string,
    viewer: RequestViewer,
    organizationId: string,
  ) {
    const task = await this.lockTask(tx, taskId, organizationId);
    const request = task ? await this.findRequest(tx, requestId, taskId, organizationId) : null;
    const entitled =
      !!task &&
      !!request &&
      (viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN) ||
        (await this.authority.canActForCreator(task.createdById, viewer.id, organizationId, tx)));
    if (!task || !request || !entitled) throw new NotFoundException(NOT_FOUND);
    if (request.requestedById === viewer.id) {
      throw new ForbiddenException('You cannot decide your own request');
    }
    assertPending(request.status);
    return { task, request };
  }

  // ACC-174 — resuming SHIFTS NOTHING. The SLA window was moved when the hold
  // was approved, to start when the hold ends; resume only restores the status
  // and clears the hold. Resuming early therefore keeps the later dates.
  private async endHold(tx: TaskTx, task: TaskWithAssigneeRows) {
    const updated = await tx.task.update({
      where: { id: task.id },
      data: {
        status: (task.heldFromStatus as TaskStatus | null) ?? 'PENDING',
        ...HOLD_CLEARED,
      },
    });
    return { before: task, task: updated };
  }

  private async afterResume(
    before: TaskWithAssigneeRows,
    task: ITask,
    organizationId: string,
    actorId: string | undefined,
  ): Promise<void> {
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'Task',
      objectId: task.id,
      ...(actorId ? { actorId } : {}),
      tenantId: organizationId,
      before: before as unknown as Record<string, unknown>,
      after: task as unknown as Record<string, unknown>,
      metadata: {
        event: 'resumed',
        automatic: !actorId,
        early: !!before.onHoldUntil && new Date() < before.onHoldUntil,
      },
    });

    // The assignee and the creator — never the person who pressed Resume now.
    const recipients = new Set([
      ...before.assignees.filter((a) => a.removedAt === null).map((a) => a.userId),
      task.createdById,
    ]);
    if (actorId) recipients.delete(actorId);
    for (const userId of recipients) {
      await this.notificationService.create(
        {
          userId,
          titleEn: 'Task resumed',
          titleAr: 'استُؤنفت المهمة',
          bodyEn: `"${task.title}" is no longer on hold.`,
          bodyAr: `لم تعد المهمة "${task.title}" متوقفة مؤقتًا.`,
          objectType: 'Task',
          objectId: task.id,
        },
        organizationId,
      );
    }
  }

  private async userName(userId: string, organizationId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId }, select: { name: true } });
    return user?.name ?? '—';
  }
}

function isActiveAssignee(task: TaskWithAssigneeRows, userId: string): boolean {
  return task.assignees.some((a) => a.userId === userId && a.removedAt === null);
}

function assertPending(status: string): void {
  if (status !== 'PENDING') {
    throw new ConflictException(`This request has already been ${REQUEST_STATUS_PHRASE[status] ?? 'decided'}`);
  }
}
