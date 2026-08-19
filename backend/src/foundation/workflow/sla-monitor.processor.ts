import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { WorkflowService } from './workflow.service';

interface EscalationRule {
  afterHours: number;
  notifyRoleId?: string;
  notifyUserId?: string;
}

// Repeatable BullMQ job — every 15 minutes, sweeps every tenant for
// WorkflowInstanceStage rows past their slaDueAt and flags them, then fires
// any escalationConfig rules whose threshold has elapsed. Per CLAUDE.md,
// "Escalation triggers only fire during working hours" — the sweep itself
// always runs on schedule, but individual escalations are deferred to a
// later run if the tenant is currently outside working hours.
@Injectable()
@Processor('sla-monitor')
export class SlaMonitorProcessor extends WorkerHost implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notificationService: NotificationService,
    private readonly orgPositionService: OrgPositionService,
    // Same module (WorkflowModule provides both) — no forwardRef needed.
    // ACC-28 Section 2.5.1: reuses WorkflowService's own
    // resolveUnassignedBlockingTransitions()/resolveUnreachableTriggerConditionTransitions()/
    // notifyTenantAdminsOfUnassignedStage() rather than duplicating that
    // resolution logic here.
    private readonly workflowService: WorkflowService,
    // ACC-40 Section 2.3 — automatic handover completion (Phase 5 commit 5)
    // reuses OrgUnitHeadService.completeHandoverAutomatically() rather than
    // duplicating that logic here, same precedent as workflowService above.
    private readonly orgUnitHeadService: OrgUnitHeadService,
    @InjectQueue('sla-monitor') private readonly slaMonitorQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    // Fixed jobId makes this idempotent across restarts/redeploys — BullMQ
    // silently accumulates duplicate repeatable jobs if the same pattern is
    // registered again without one.
    await this.slaMonitorQueue.add(
      'check-sla-breaches',
      {},
      { repeat: { every: 15 * 60 * 1000 }, jobId: 'sla-monitor-repeat' },
    );
  }

  async process(_job: Job): Promise<void> {
    const now = new Date();

    const breachedStages = await this.prisma.workflowInstanceStage.findMany({
      where: { exitedAt: null, slaDueAt: { lt: now }, slaBreached: false },
      include: { workflowInstance: true, stage: true },
    });

    for (const instanceStage of breachedStages) {
      const organizationId = instanceStage.workflowInstance.organizationId;
      const rules = (instanceStage.stage.escalationConfig as EscalationRule[] | null) ?? [];
      const newlyEscalatedIndexes: number[] = [];

      if (rules.length > 0 && instanceStage.slaDueAt) {
        const hoursSinceDue = DateTime.fromJSDate(now).diff(
          DateTime.fromJSDate(instanceStage.slaDueAt),
          'hours',
        ).hours;

        for (let i = 0; i < rules.length; i++) {
          if (instanceStage.escalatedRuleIndexes.includes(i)) continue;

          const rule = rules[i];
          if (!rule || hoursSinceDue < rule.afterHours) continue;

          if (!(await this.isWithinWorkingHours(organizationId))) continue;

          await this.fireEscalation(organizationId, instanceStage.id, i, rule);
          newlyEscalatedIndexes.push(i);
        }
      }

      await this.prisma.workflowInstanceStage.update({
        where: { id: instanceStage.id },
        data: {
          slaBreached: true,
          ...(newlyEscalatedIndexes.length > 0 && {
            escalatedRuleIndexes: [...instanceStage.escalatedRuleIndexes, ...newlyEscalatedIndexes],
          }),
        },
      });
    }

    await this.sweepOverdueTasks(now);
    await this.sweepUnassignedStages();
    await this.sweepExpiredActingOrgUnitAssignments(now);
    await this.sweepDueHandovers(now);
  }

  // ACC-40 Section 2.3 — the automatic half of "what closes the window:
  // recommend both, not a single mechanism" (the other being explicit
  // early completion via OrgUnitHeadService.completeHandoverNow()).
  // organizationId is read from each fetched OrgUnit row itself, not
  // filtered by a single tenant upfront — same cross-tenant one-pass
  // sweep shape as sweepOverdueTasks() above.
  private async sweepDueHandovers(now: Date): Promise<void> {
    const dueHandovers = await this.prisma.orgUnit.findMany({
      where: { pendingHeadUserId: { not: null }, headHandoverEffectiveDate: { lte: now } },
    });

    for (const orgUnit of dueHandovers) {
      await this.orgUnitHeadService.completeHandoverAutomatically(orgUnit, orgUnit.organizationId);
    }
  }

  // ACC-40 Section 2.7 — the simplest sweep step this file adds: unlike
  // sweepUnassignedStages()/sweepOverdueTasks() above, actingOrgUnitId
  // feeds nothing in Head derivation (2.1/2.2/2.5) or vacancy detection —
  // it's a pure scoping fact, so clearing it on expiry needs no follow-on
  // work (no refreshOrgUnitHeadVacancy() call, no escalation re-check).
  private async sweepExpiredActingOrgUnitAssignments(now: Date): Promise<void> {
    const expired = await this.prisma.user.findMany({
      where: { actingOrgUnitId: { not: null }, actingOrgUnitUntil: { lte: now } },
    });

    for (const user of expired) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { actingOrgUnitId: null, actingOrgUnitUntil: null },
      });

      // A nicety, not a required part of the core mechanism (plan Section 2.7).
      await this.notificationService.create(
        {
          userId: user.id,
          titleEn: 'Acting-unit assignment ended',
          bodyEn: 'Your acting assignment to another org unit has ended.',
        },
        user.organizationId,
      );
    }
  }

  // ACC-28 Section 2.5.1 — drift-after-entry re-check. The entry-time check
  // (WorkflowService.checkAndFlagUnassignedStage(), private, fires once when
  // a stage is entered) can't catch a pool becoming unreachable WHILE an
  // instance is already sitting in that stage (e.g. a Chairman removed
  // mid-review). Reuses this existing 15-minute sweep rather than a new
  // queue — same precedent as sweepOverdueTasks() above.
  private async sweepUnassignedStages(): Promise<void> {
    const openStages = await this.prisma.workflowInstanceStage.findMany({
      where: { exitedAt: null },
      include: { workflowInstance: true, stage: true },
    });

    for (const instanceStage of openStages) {
      const organizationId = instanceStage.workflowInstance.organizationId;
      const poolBlocking = await this.workflowService.resolveUnassignedBlockingTransitions(
        instanceStage.stage,
        instanceStage.workflowInstance,
        organizationId,
      );
      const triggerBlocking = await this.workflowService.resolveUnreachableTriggerConditionTransitions(
        instanceStage.stage,
        organizationId,
      );
      const blocking = [...poolBlocking, ...triggerBlocking];

      // wasUnassigned read from the row as fetched at the top of this sweep
      // pass, before anything here touches it — the precise condition that
      // prevents a duplicate notification when this sweep re-evaluates a
      // stage the entry-time check already flagged and notified about
      // minutes earlier (in that case wasUnassigned reads back true,
      // isNowUnassigned is also true, no state change, no re-notify).
      const wasUnassigned = instanceStage.isUnassigned;
      const isNowUnassigned = blocking.length > 0;
      if (wasUnassigned === isNowUnassigned) continue;

      await this.prisma.workflowInstanceStage.update({
        where: { id: instanceStage.id },
        data: { isUnassigned: isNowUnassigned, unassignedAt: isNowUnassigned ? new Date() : null },
      });

      // Only the false→true transition pages an admin — the symmetric
      // clear-on-recovery case (a new Chairman appointed) updates the row
      // silently, per plan Section 2.5.1.
      if (isNowUnassigned) {
        await this.workflowService.notifyTenantAdminsOfUnassignedStage(
          organizationId,
          instanceStage.workflowInstance,
          instanceStage.stage,
          blocking,
        );
      }
    }
  }

  // Task Management (Step 8) extension — reuses this existing 15-minute
  // repeatable job rather than registering a new queue, per CLAUDE.md's
  // Background Jobs list having exactly one SLA-sweep entry, not one per
  // entity type (see Step 8 plan, Section 3/Commit 7).
  private async sweepOverdueTasks(now: Date): Promise<void> {
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        dueAt: { lt: now },
        status: { notIn: ['COMPLETED', 'CANCELLED', 'OVERDUE', 'UNASSIGNED'] },
      },
      include: { assignees: { where: { removedAt: null } } },
    });

    for (const task of overdueTasks) {
      await this.prisma.task.update({
        where: { id: task.id },
        data: { status: 'OVERDUE', slaBreachedAt: now },
      });

      if (!task.escalationUserId || !task.escalationAfterHours || task.escalatedAt || !task.dueAt) {
        continue;
      }

      const hoursSinceDue = DateTime.fromJSDate(now).diff(DateTime.fromJSDate(task.dueAt), 'hours').hours;
      if (hoursSinceDue < task.escalationAfterHours) continue;

      if (!(await this.isWithinWorkingHours(task.organizationId))) continue;

      await this.fireTaskEscalation(task.organizationId, task.id, task.escalationUserId, task.assignees.map((a) => a.userId));
    }
  }

  private async fireTaskEscalation(
    organizationId: string,
    taskId: string,
    escalationUserId: string,
    assigneeIds: string[],
  ): Promise<void> {
    try {
      await this.orgPositionService.validateEscalationTarget(assigneeIds, escalationUserId, organizationId);
    } catch (err) {
      // Never silently escalate to an invalid target — log and skip.
      await this.auditLog.log({
        tenantId: organizationId,
        action: 'UPDATE',
        objectType: 'Task',
        objectId: taskId,
        metadata: {
          escalationSkipped: true,
          reason: err instanceof Error ? err.message : 'Invalid escalation target',
        },
      });
      return;
    }

    await this.notificationService.create(
      {
        userId: escalationUserId,
        titleEn: 'Task SLA breach escalation',
        bodyEn: `A task has breached its SLA and has been escalated to you.`,
        objectType: 'Task',
        objectId: taskId,
      },
      organizationId,
    );

    await this.prisma.task.update({ where: { id: taskId }, data: { escalatedAt: new Date() } });

    await this.auditLog.log({
      tenantId: organizationId,
      action: 'UPDATE',
      objectType: 'Task',
      objectId: taskId,
      metadata: { escalatedTo: escalationUserId },
    });
  }

  private async fireEscalation(
    organizationId: string,
    instanceStageId: string,
    ruleIndex: number,
    rule: EscalationRule,
  ): Promise<void> {
    const userIds: string[] = [];

    if (rule.notifyUserId) userIds.push(rule.notifyUserId);
    if (rule.notifyRoleId) {
      const userRoles = await this.prisma.userRole.findMany({
        where: { roleId: rule.notifyRoleId, user: { organizationId, status: 'ACTIVE' } },
      });
      userIds.push(...userRoles.map((ur) => ur.userId));
    }

    // TODO(event-bus): migrate to event emitter if/when NotificationService
    // moves to a pub/sub model (see Step 7 plan Section 8/12).
    for (const userId of new Set(userIds)) {
      await this.notificationService.create(
        {
          userId,
          titleEn: 'SLA breach escalation',
          bodyEn: `A workflow stage has breached its SLA and requires attention (escalation rule ${ruleIndex}).`,
        },
        organizationId,
      );
    }

    await this.auditLog.log({
      tenantId: organizationId,
      action: 'UPDATE',
      objectType: 'WorkflowInstanceStage',
      objectId: instanceStageId,
      metadata: { escalationRuleIndex: ruleIndex, notifiedUserCount: userIds.length },
    });
  }

  // No dedicated "is now within working hours" method exists on
  // WorkingCalendarService (only getOrCreate/listHolidays are public) — this
  // reimplements the same day/hour/holiday check calculateDeadline() uses
  // internally, against the tenant's own calendar config.
  private async isWithinWorkingHours(organizationId: string): Promise<boolean> {
    const calendar = await this.workingCalendar.getOrCreate(organizationId);
    const holidays = await this.workingCalendar.listHolidays(organizationId);
    const now = DateTime.now().setZone(calendar.timezone);

    if (!calendar.workingDays.includes(now.weekday % 7)) return false;

    const isHoliday = holidays.some((h) => {
      const hDate = DateTime.fromJSDate(h.date).setZone(calendar.timezone);
      if (h.isRecurring) return hDate.month === now.month && hDate.day === now.day;
      return hDate.month === now.month && hDate.day === now.day && hDate.year === now.year;
    });
    if (isHoliday) return false;

    const [startHour = 0, startMin = 0] = calendar.workingHoursStart.split(':').map(Number);
    const [endHour = 0, endMin = 0] = calendar.workingHoursEnd.split(':').map(Number);
    const nowMinutes = now.hour * 60 + now.minute;

    return nowMinutes >= startHour * 60 + startMin && nowMinutes < endHour * 60 + endMin;
  }
}
