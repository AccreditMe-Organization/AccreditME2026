import { Inject, Injectable, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { OrgUnitHeadService } from '../organization/org-unit-head.service';
import { OrganizationService } from '../organization/organization.service';
import { TenantService } from '../tenant/tenant.service';
import { WorkflowService } from './workflow.service';
import {
  Task as PrismaTask,
  TaskAssignee as PrismaTaskAssignee,
} from '../../../generated/prisma/client';

// ACC-40 Section 2.5.1 — the 2-day interval between periodic
// "still fully unresolved" reminders, named so it's easy to find/adjust.
const HEAD_VACANCY_REMINDER_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;

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
    // ACC-40 Section 2.5.1 — sweepOrgUnitVacancies() reuses
    // OrganizationService.resolveActingHeadForOrgUnit()/
    // notifyTenantAdminsOfOrgUnitVacancy() rather than duplicating that
    // resolution/notification logic here, same precedent as workflowService
    // above.
    private readonly organizationService: OrganizationService,
    // ACC-46 Section 2.7.e — needed for the real tier-based escalation
    // firing logic (Commit 4): each sweep reads the tenant's own
    // Organization.settings.taskSla thresholds fresh, never a stale cached
    // value. Same forwardRef precedent as TaskService's own edge (Commit
    // 2a) — TenantModule is already forwardRef()-imported into this module
    // (above), this is just the provider-level injection to match.
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
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
    await this.sweepOrgUnitVacancies(now);
    await this.sweepVacantHeadRoleMappings();
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

  // ACC-40 Section 2.5.1 — drift-after-entry re-check, same shape as
  // sweepUnassignedStages() above: refreshOrgUnitHeadVacancy()'s entry-time
  // check only re-runs the escalation walk when the UNIT'S OWN direct
  // holder count changes, so it can't catch an ancestor's coverage
  // disappearing while THIS unit's own vacancy state never changes (e.g. a
  // parent unit's Acting Head is cleared while a grandchild sits vacant the
  // whole time). Only considers units already isHeadVacant: true — a unit
  // that currently has its own direct holder is never fully-unresolved by
  // definition, so re-walking it here would be wasted work.
  private async sweepOrgUnitVacancies(now: Date): Promise<void> {
    const vacantUnits = await this.prisma.orgUnit.findMany({ where: { isHeadVacant: true } });

    for (const orgUnit of vacantUnits) {
      const pool = await this.organizationService.resolveActingHeadForOrgUnit(orgUnit.id, orgUnit.organizationId);
      const isNowFullyUnresolved = pool.length === 0;

      // wasFullyUnresolved read from the row as fetched at the top of this
      // sweep pass — the precise condition that prevents a duplicate
      // notification when this sweep re-evaluates a unit the entry-time
      // check already flagged and notified about minutes earlier.
      const wasFullyUnresolved = orgUnit.isHeadFullyUnresolved;

      if (wasFullyUnresolved === isNowFullyUnresolved) {
        // No transition — still fully unresolved is the only case where
        // there's more to do: check the 2-day reminder cadence.
        if (isNowFullyUnresolved) {
          await this.maybeSendVacancyReminder(orgUnit, now);
        }
        continue;
      }

      if (!isNowFullyUnresolved) {
        // Recovered — an ancestor now covers this unit (e.g. its Acting
        // Head was just (re)assigned). Silent, same convention as
        // sweepUnassignedStages()'s own clear-on-recovery case.
        await this.prisma.orgUnit.update({
          where: { id: orgUnit.id },
          data: { isHeadFullyUnresolved: false, headFullyUnresolvedLastRemindedAt: null },
        });
        continue;
      }

      // Newly fully unresolved (sweep-discovered, not caught at entry time)
      // — notify immediately, same first-notification wording as
      // refreshOrgUnitHeadVacancy()'s own entry-time transition.
      await this.prisma.orgUnit.update({
        where: { id: orgUnit.id },
        data: { isHeadFullyUnresolved: true, headFullyUnresolvedLastRemindedAt: now },
      });
      await this.organizationService.notifyTenantAdminsOfOrgUnitVacancy(
        orgUnit.organizationId,
        orgUnit,
        false,
      );
    }
  }

  private async maybeSendVacancyReminder(
    orgUnit: { id: string; organizationId: string; nameEn: string; headVacantSince: Date | null; headFullyUnresolvedLastRemindedAt: Date | null },
    now: Date,
  ): Promise<void> {
    const lastReminded = orgUnit.headFullyUnresolvedLastRemindedAt;
    if (lastReminded && now.getTime() - lastReminded.getTime() < HEAD_VACANCY_REMINDER_INTERVAL_MS) {
      return;
    }

    await this.prisma.orgUnit.update({
      where: { id: orgUnit.id },
      data: { headFullyUnresolvedLastRemindedAt: now },
    });
    await this.organizationService.notifyTenantAdminsOfOrgUnitVacancy(orgUnit.organizationId, orgUnit, true);
  }

  // ACC-43 — wires OrgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings()
  // (2.9e) into this existing sweep. That method existed and was unit-tested
  // since ACC-40 Phase 12 but was never called from anywhere in the running
  // app — found during ACC-43's live verification pass. Reuses the existing
  // method rather than duplicating its query/notification logic, same
  // precedent as sweepDueHandovers()/sweepOrgUnitVacancies() above. Two
  // lightweight distinct-organizationId queries up front, rather than
  // calling the (no-op-if-nothing-to-report) method once per tenant
  // regardless — avoids paying its full query cost for every tenant with
  // nothing to report, every 15 minutes.
  private async sweepVacantHeadRoleMappings(): Promise<void> {
    const vacantUnitOrgs = await this.prisma.orgUnit.findMany({
      where: { isHeadVacant: true },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });
    const unmappedPositionOrgs = await this.prisma.orgPosition.findMany({
      where: { isUnitHeadPosition: true, roleId: null },
      select: { organizationId: true },
      distinct: ['organizationId'],
    });

    const organizationIds = new Set([
      ...vacantUnitOrgs.map((u) => u.organizationId),
      ...unmappedPositionOrgs.map((p) => p.organizationId),
    ]);

    for (const organizationId of organizationIds) {
      await this.orgPositionService.notifyTenantAdminsOfVacantHeadRoleMappings(organizationId);
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
  //
  // ACC-46 Section 2.7.e, Commit 4 — the real, finished redesign. Fixes
  // Finding 2 directly: 'OVERDUE' is no longer excluded from this query, so
  // an overdue task remains eligible for re-evaluation on every subsequent
  // sweep until both escalation tiers have fired, instead of being
  // evaluated exactly once (at the moment it first goes overdue, before
  // enough hours could plausibly have elapsed) and then permanently
  // skipped forever after — the structural bug that meant escalation could
  // never fire for any task, under any configuration, under the old code.
  //
  // Resolution happens fresh at firing time, every sweep, never precomputed
  // or stored on the Task row — a Manager could change between task
  // creation and the task actually going overdue, and the resolved target
  // must reflect reality at the moment of firing, not a stale snapshot.
  //
  // Each tier strictly waits for its own configured threshold — no
  // fall-through to the Head tier just because the Manager tier had
  // nothing to resolve for this particular task (the `else if` below only
  // considers the Head tier once the Manager tier has actually fired).
  private async sweepOverdueTasks(now: Date): Promise<void> {
    const overdueTasks = await this.prisma.task.findMany({
      where: {
        dueAt: { lt: now },
        status: { notIn: ['COMPLETED', 'CANCELLED', 'UNASSIGNED'] }, // 'OVERDUE' no longer excluded — Finding 2's fix
      },
      include: { assignees: { where: { removedAt: null } } },
    });

    for (const task of overdueTasks) {
      if (task.status !== 'OVERDUE') {
        await this.prisma.task.update({
          where: { id: task.id },
          data: { status: 'OVERDUE', slaBreachedAt: now },
        });
      }

      const slaConfig = await this.tenantService.getTaskSla(task.organizationId);
      const tier = slaConfig[task.priority];
      const hoursSinceDue = DateTime.fromJSDate(now).diff(
        DateTime.fromJSDate(task.dueAt!),
        'hours',
      ).hours;

      if (!task.managerEscalatedAt && hoursSinceDue >= tier.managerEscalationAfterHours) {
        if (await this.isWithinWorkingHours(task.organizationId)) {
          await this.fireTaskEscalation(task, 'MANAGER');
        }
      } else if (
        task.managerEscalatedAt &&
        !task.headEscalatedAt &&
        hoursSinceDue >= tier.managerEscalationAfterHours + tier.headEscalationAfterHours
      ) {
        if (await this.isWithinWorkingHours(task.organizationId)) {
          await this.fireTaskEscalation(task, 'HEAD');
        }
      }
    }
  }

  // ACC-46 Section 2.7.e — replaces the old task.escalationUserId-driven
  // firing logic entirely (removed in Commit 1 alongside the schema fields
  // it read). Fully automatic resolution via Commit 3's resolver methods —
  // no human picks a target anywhere in this flow (2.7.b) — notifying
  // EVERY resolved target (PD#8), not just one.
  private async fireTaskEscalation(
    task: PrismaTask & { assignees: PrismaTaskAssignee[] },
    tier: 'MANAGER' | 'HEAD',
  ): Promise<void> {
    const assigneeIds = task.assignees.map((a) => a.userId);
    const targets =
      tier === 'MANAGER'
        ? await this.orgPositionService.resolveManagerEscalationTargets(assigneeIds, task.organizationId)
        : await this.orgPositionService.resolveHeadEscalationTargets(assigneeIds, task.organizationId);

    if (targets.length === 0) {
      // Skipped, not thrown — a task with no resolvable Manager/Head (e.g.
      // an assignee with no managerId set, or an org unit with neither a
      // direct Head holder nor an Acting Head) is a real, unremarkable
      // state, not an error condition. Audit-logged so it's visible, not
      // silent.
      await this.auditLog.log({
        tenantId: task.organizationId,
        action: 'UPDATE',
        objectType: 'Task',
        objectId: task.id,
        metadata: {
          escalationSkipped: true,
          tier,
          reason: `No ${tier === 'MANAGER' ? 'manager' : 'unit Head'} resolvable for any of this task's assignees`,
        },
      });
      return;
    }

    for (const targetUserId of targets) {
      await this.notificationService.create(
        {
          userId: targetUserId,
          titleEn: 'Task SLA breach escalation',
          bodyEn: 'A task has breached its SLA and has been escalated to you.',
          objectType: 'Task',
          objectId: task.id,
        },
        task.organizationId,
      );
    }

    // One timestamp write per tier regardless of how many people were
    // notified — managerEscalatedAt/headEscalatedAt record "has this tier
    // already fired," not "who received it"; escalatedTo in the audit
    // log's metadata carries the full list for that.
    await this.prisma.task.update({
      where: { id: task.id },
      data: tier === 'MANAGER' ? { managerEscalatedAt: new Date() } : { headEscalatedAt: new Date() },
    });
    await this.auditLog.log({
      tenantId: task.organizationId,
      action: 'UPDATE',
      objectType: 'Task',
      objectId: task.id,
      metadata: { escalatedTo: targets, tier },
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
