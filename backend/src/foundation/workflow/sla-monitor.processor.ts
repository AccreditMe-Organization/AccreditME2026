import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

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

    // NotificationService doesn't exist yet (Step 7) — create the Notification
    // row directly, same stubbing approach WorkflowService already uses for
    // its own SEND_NOTIFICATION action.
    for (const userId of new Set(userIds)) {
      await this.prisma.notification.create({
        data: {
          organizationId,
          userId,
          titleEn: 'SLA breach escalation',
          bodyEn: `A workflow stage has breached its SLA and requires attention (escalation rule ${ruleIndex}).`,
        },
      });
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
