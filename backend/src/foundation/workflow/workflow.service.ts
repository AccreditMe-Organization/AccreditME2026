import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import {
  WorkflowInstance as PrismaWorkflowInstance,
  WorkflowInstanceStage as PrismaWorkflowInstanceStage,
  WorkflowStage as PrismaWorkflowStage,
  WorkflowTransition as PrismaWorkflowTransition,
  WorkflowApproval as PrismaWorkflowApproval,
  WorkflowObjectType,
} from '../../../generated/prisma/client';
import { IWorkflowInstance, IWorkflowApproval } from './interfaces/workflow-instance.interface';
import { TriggerTransitionDto } from './dto/trigger-transition.dto';
import { SubmitApprovalDto } from './dto/submit-approval.dto';

// This is THE WorkflowService CLAUDE.md refers to in "Route ALL state
// transitions through WorkflowService" — every future functional module calls
// these methods, never manages its own status field.
//
// NOTE on multi-approver routing: WorkflowTransition.isApprovalPath marks
// which outgoing transition of a stage represents the "advance" outcome vs
// a "return/reject" outcome. This exists specifically because a stage can
// have more than one outgoing transition (e.g. an "Approve" path and a
// "Reject" path both landing on higher-order stages), so stage order alone
// cannot distinguish them.
//
// NOTE on SEQUENTIAL/COMMITTEE: none of the 8 seeded workflows currently use
// SEQUENTIAL or COMMITTEE approvalMode (only SINGLE and PARALLEL+ALL are
// exercised by real seed data) — the logic below implements them per the
// plan's Business Rules, but is unverified against real seed data until a
// functional module actually configures one.
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly workingCalendar: WorkingCalendarService,
    @InjectQueue('workflow-actions') private readonly workflowActionsQueue: Queue,
  ) {}

  // ── Instance lifecycle ───────────────────────────────────────────────────────

  async startInstance(
    objectType: string,
    objectId: string,
    organizationId: string,
    actorId: string,
    templateId?: string,
  ): Promise<IWorkflowInstance> {
    const template = templateId
      ? await this.prisma.workflowTemplate.findFirst({ where: { id: templateId, organizationId } })
      : await this.prisma.workflowTemplate.findFirst({
          where: { organizationId, objectType: objectType as WorkflowObjectType, isDefault: true, isActive: true },
        });
    if (!template) {
      throw new NotFoundException('No active workflow template found for this object type');
    }

    const initialStage = await this.prisma.workflowStage.findFirst({
      where: { workflowTemplateId: template.id, isInitial: true },
    });
    if (!initialStage) {
      throw new NotFoundException('Workflow template has no initial stage configured');
    }

    const instance = await this.prisma.workflowInstance.create({
      data: {
        organizationId,
        workflowTemplateId: template.id,
        objectType: template.objectType,
        objectId,
        status: 'IN_PROGRESS',
        currentStageId: initialStage.id,
      },
    });

    const slaDueAt = await this.computeSlaDueAt(initialStage, organizationId);

    await this.prisma.workflowInstanceStage.create({
      data: { workflowInstanceId: instance.id, stageId: initialStage.id, slaDueAt, actorId },
    });

    // No WorkflowTransitionAction fires on stage entry (actions fire on
    // transitions, per the seed data design) — so the initial stage's
    // assignee is notified directly here, the one place nothing else would.
    await this.resolveAndNotifyInitialAssignee(initialStage, instance, organizationId);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      after: { objectType: instance.objectType, objectId: instance.objectId, currentStageId: initialStage.id },
    });

    return this.mapInstance(instance);
  }

  async getInstanceById(id: string, organizationId: string): Promise<IWorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id, organizationId } });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    return this.mapInstance(instance);
  }

  // Plural, and returns every instance ever created for this object — one
  // object can accumulate multiple instances over time (e.g. a document's
  // periodic review cycles each start a fresh WorkflowInstance).
  async getInstancesByObject(
    objectType: string,
    objectId: string,
    organizationId: string,
  ): Promise<IWorkflowInstance[]> {
    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId, objectType: objectType as WorkflowObjectType, objectId },
      orderBy: { createdAt: 'desc' },
    });
    return instances.map((i) => this.mapInstance(i));
  }

  // Administrative force-cancel — bypasses requiredPermission/triggerCondition/
  // validatorConfig entirely and sets status = CANCELLED regardless of the
  // current stage or the transition graph. Distinct from a modeled "Cancel"
  // transition (MEETING/INCIDENT already have one), which goes through the
  // normal triggerTransition() path.
  async cancelInstance(
    id: string,
    organizationId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id, organizationId } });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    if (instance.status === 'CANCELLED' || instance.status === 'COMPLETED') {
      throw new ConflictException(
        `Cannot cancel an instance that is already ${instance.status.toLowerCase()}`,
      );
    }

    await this.prisma.workflowInstanceStage.updateMany({
      where: { workflowInstanceId: id, exitedAt: null },
      data: { exitedAt: new Date(), outcome: 'SKIPPED' },
    });

    await this.prisma.workflowInstance.update({ where: { id }, data: { status: 'CANCELLED' } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowInstance',
      objectId: id,
      before: { status: instance.status },
      after: { status: 'CANCELLED' },
      metadata: { reason },
    });
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  async triggerTransition(
    instanceId: string,
    dto: TriggerTransitionDto,
    organizationId: string,
    actorId: string,
    userPermissions: string[],
  ): Promise<IWorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organizationId },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (!instance.currentStageId) {
      throw new ConflictException('Workflow instance has no current stage');
    }

    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: dto.transitionId, fromStageId: instance.currentStageId },
    });
    if (!transition) {
      throw new NotFoundException("This transition is not available from the instance's current stage");
    }

    if (transition.requiredPermission && !userPermissions.includes(transition.requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${transition.requiredPermission}`);
    }

    if (transition.triggerCondition === 'SYSTEM_AUTOMATIC') {
      throw new ForbiddenException('This transition can only be fired by a system process');
    }
    if (transition.triggerCondition === 'SPECIFIC_USER' && transition.triggerUserId !== actorId) {
      throw new ForbiddenException('Only the specifically configured user may trigger this transition');
    }
    if (transition.triggerCondition === 'ROLE_BASED' && transition.triggerRoleId) {
      const holdsRole = await this.prisma.userRole.findFirst({
        where: { userId: actorId, roleId: transition.triggerRoleId },
      });
      if (!holdsRole) {
        throw new ForbiddenException('You do not hold the role required to trigger this transition');
      }
    }

    const fromStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.fromStageId } });
    if (!fromStage) throw new NotFoundException('Current stage not found');

    const currentInstanceStage = await this.prisma.workflowInstanceStage.findFirst({
      where: { workflowInstanceId: instanceId, stageId: fromStage.id, exitedAt: null },
    });
    if (!currentInstanceStage) {
      throw new ConflictException('No active stage entry found for this instance');
    }

    await this.checkValidatorConfig(transition, currentInstanceStage);

    if (fromStage.approvalMode === 'SINGLE') {
      return this.performTransition(
        instance,
        currentInstanceStage,
        transition,
        organizationId,
        actorId,
        dto.comment,
        'APPROVED',
      );
    }

    // Multi-approver stage: naming a specific transitionId is itself the vote
    // — isApprovalPath maps it to APPROVED (advance) or RETURNED (send back).
    const decision = transition.isApprovalPath ? 'APPROVED' : 'RETURNED';

    await this.prisma.workflowApproval.upsert({
      where: {
        workflowInstanceStageId_approverId: {
          workflowInstanceStageId: currentInstanceStage.id,
          approverId: actorId,
        },
      },
      update: { decision, comment: dto.comment ?? null, decidedAt: new Date() },
      create: {
        workflowInstanceStageId: currentInstanceStage.id,
        approverId: actorId,
        decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
      },
    });

    if (!transition.isApprovalPath) {
      // Any single non-approval-path vote fires immediately — no threshold
      // required to send something back (matches SEQUENTIAL's "a RETURNED
      // decision immediately halts the chain" business rule, applied
      // consistently across all multi-approver modes).
      return this.performTransition(
        instance,
        currentInstanceStage,
        transition,
        organizationId,
        actorId,
        dto.comment,
        'REJECTED',
      );
    }

    const satisfied = await this.isApprovalThresholdMet(fromStage, currentInstanceStage, organizationId);
    if (!satisfied) {
      // Threshold not yet met — approval recorded, instance unchanged.
      return this.mapInstance(instance);
    }

    return this.performTransition(
      instance,
      currentInstanceStage,
      transition,
      organizationId,
      actorId,
      dto.comment,
      'APPROVED',
    );
  }

  async submitApproval(
    instanceStageId: string,
    dto: SubmitApprovalDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowApproval> {
    const instanceStage = await this.prisma.workflowInstanceStage.findFirst({
      where: { id: instanceStageId, workflowInstance: { organizationId } },
    });
    if (!instanceStage) throw new NotFoundException('Workflow instance stage not found');
    if (instanceStage.exitedAt) {
      throw new ConflictException(
        'This stage has already been exited — approval can no longer be recorded',
      );
    }

    const approval = await this.prisma.workflowApproval.upsert({
      where: {
        workflowInstanceStageId_approverId: { workflowInstanceStageId: instanceStageId, approverId: actorId },
      },
      update: { decision: dto.decision, comment: dto.comment ?? null, decidedAt: new Date() },
      create: {
        workflowInstanceStageId: instanceStageId,
        approverId: actorId,
        decision: dto.decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowApproval',
      objectId: approval.id,
      after: { decision: approval.decision },
    });

    const stage = await this.prisma.workflowStage.findFirst({ where: { id: instanceStage.stageId } });
    if (stage) {
      await this.maybeAdvanceAfterApproval(stage, instanceStage, organizationId, actorId, dto);
    }

    return this.mapApproval(approval);
  }

  // ── Internal: shared advance logic ───────────────────────────────────────────

  private async maybeAdvanceAfterApproval(
    stage: PrismaWorkflowStage,
    instanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    actorId: string,
    dto: SubmitApprovalDto,
  ): Promise<void> {
    // ABSTAINED never auto-routes — per module-designs.md, majority-abstained
    // requires Quality Officer escalation, not automatic advancement.
    if (dto.decision === 'ABSTAINED') return;

    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceStage.workflowInstanceId },
    });
    if (!instance) return;

    const isApprovalDecision = dto.decision === 'APPROVED' || dto.decision === 'APPROVED_WITH_COMMENTS';

    if (!isApprovalDecision) {
      const returnTransition = await this.prisma.workflowTransition.findFirst({
        where: { fromStageId: stage.id, isApprovalPath: false },
      });
      if (!returnTransition) {
        throw new ConflictException('No return-path transition is configured for this stage');
      }
      await this.performTransition(
        instance,
        instanceStage,
        returnTransition,
        organizationId,
        actorId,
        dto.comment,
        'REJECTED',
      );
      return;
    }

    const satisfied = await this.isApprovalThresholdMet(stage, instanceStage, organizationId);
    if (!satisfied) return;

    const approveTransition = await this.prisma.workflowTransition.findFirst({
      where: { fromStageId: stage.id, isApprovalPath: true },
    });
    if (!approveTransition) {
      throw new ConflictException('No approval-path transition is configured for this stage');
    }
    await this.performTransition(
      instance,
      instanceStage,
      approveTransition,
      organizationId,
      actorId,
      dto.comment,
      'APPROVED',
    );
  }

  private async isApprovalThresholdMet(
    fromStage: PrismaWorkflowStage,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
  ): Promise<boolean> {
    const approvals = await this.prisma.workflowApproval.findMany({
      where: { workflowInstanceStageId: currentInstanceStage.id },
    });
    const approvedCount = approvals.filter(
      (a) => a.decision === 'APPROVED' || a.decision === 'APPROVED_WITH_COMMENTS',
    ).length;

    if (fromStage.approvalMode === 'COMMITTEE') {
      if (!fromStage.committeeId) return approvedCount > 0;
      const committee = await this.prisma.committee.findUnique({ where: { id: fromStage.committeeId } });
      if (!committee || approvals.length < committee.quorum) return false;
      return approvedCount > approvals.length / 2;
    }

    const pool = await this.resolveApproverPool(fromStage, organizationId);
    const poolSize = pool.length || Math.max(approvals.length, 1);
    // SEQUENTIAL has no dedicated ordered-roster mechanism in the current
    // schema — treated as PARALLEL+ALL until a real sequence concept exists.
    const threshold = fromStage.approvalMode === 'SEQUENTIAL' ? 'ALL' : (fromStage.parallelThreshold ?? 'ALL');

    if (threshold === 'ALL') return approvedCount >= poolSize;
    if (threshold === 'ANY') return approvedCount >= 1;
    return approvedCount > poolSize / 2; // MAJORITY
  }

  private async performTransition(
    instance: PrismaWorkflowInstance,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    transition: PrismaWorkflowTransition,
    organizationId: string,
    actorId: string,
    comment: string | undefined,
    outcome: 'APPROVED' | 'REJECTED' | 'SKIPPED',
  ): Promise<IWorkflowInstance> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) throw new NotFoundException('Target stage not found');

    await this.prisma.workflowInstanceStage.update({
      where: { id: currentInstanceStage.id },
      data: { exitedAt: new Date(), outcome, ...(comment !== undefined && { comment }) },
    });

    const slaDueAt = await this.computeSlaDueAt(toStage, organizationId);

    await this.prisma.workflowInstanceStage.create({
      data: { workflowInstanceId: instance.id, stageId: toStage.id, slaDueAt, actorId },
    });

    const updatedInstance = await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: {
        currentStageId: toStage.id,
        status: toStage.isFinal ? 'COMPLETED' : 'IN_PROGRESS',
      },
    });

    await this.fireTransitionActions(transition, updatedInstance, organizationId, actorId);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      before: { currentStageId: instance.currentStageId },
      after: { currentStageId: toStage.id, status: updatedInstance.status },
    });

    return this.mapInstance(updatedInstance);
  }

  // ── Internal: transition actions ─────────────────────────────────────────────

  private async fireTransitionActions(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    const actions = await this.prisma.workflowTransitionAction.findMany({
      where: { workflowTransitionId: transition.id },
      orderBy: { order: 'asc' },
    });

    for (const action of actions) {
      // LOG_AUDIT always fires — isEnabled is ignored for this type, per CLAUDE.md.
      if (!action.isEnabled && action.actionType !== 'LOG_AUDIT') continue;

      if (action.actionType === 'WEBHOOK') {
        // Fired async via BullMQ — the WorkflowActionProcessor (Commit 6)
        // writes the WorkflowActionLog row once the attempt resolves, not here.
        await this.workflowActionsQueue.add('fire-webhook', {
          workflowTransitionActionId: action.id,
          workflowInstanceId: instance.id,
          organizationId,
          payload: {
            objectType: instance.objectType,
            objectId: instance.objectId,
            fromStageId: transition.fromStageId,
            toStageId: transition.toStageId,
            actorId,
            occurredAt: new Date().toISOString(),
          },
        });
        continue;
      }

      let responseSummary: string;
      switch (action.actionType) {
        case 'CREATE_TASK':
          responseSummary = await this.executeCreateTask(transition, instance, organizationId, actorId);
          break;
        case 'SEND_NOTIFICATION':
          responseSummary = await this.executeSendNotification(transition, instance, organizationId);
          break;
        case 'GENERATE_PDF':
          // Stubbed — real PDF generation depends on Step 17's LibreOffice pipeline.
          responseSummary = 'Stubbed — PDF generation deferred to Step 17';
          break;
        case 'LOCK_DOCUMENT':
          // Stubbed — no Document model exists yet to lock.
          responseSummary = 'Stubbed — document locking deferred to Step 17';
          break;
        default:
          responseSummary = 'Audit entry recorded';
      }

      await this.prisma.workflowActionLog.create({
        data: {
          organizationId,
          workflowTransitionActionId: action.id,
          workflowInstanceId: instance.id,
          actionType: action.actionType,
          status: 'SUCCESS',
          responseSummary,
        },
      });
    }
  }

  private async executeCreateTask(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
    actorId: string,
  ): Promise<string> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) return 'Skipped — target stage not found';

    const assigneeIds = await this.resolveAssignee(toStage, instance, organizationId);
    const primaryAssignee = assigneeIds[0];
    if (!primaryAssignee) return 'Skipped — no assignee resolved';

    const dueAt = await this.computeSlaDueAt(toStage, organizationId);

    await this.prisma.task.create({
      data: {
        organizationId,
        title: `${transition.labelEn} — ${instance.objectType}`,
        objectType: instance.objectType,
        objectId: instance.objectId,
        workflowInstanceId: instance.id,
        assigneeId: primaryAssignee,
        createdById: actorId,
        dueAt,
      },
    });

    return `Task created for ${primaryAssignee}`;
  }

  private async executeSendNotification(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) return 'Skipped — target stage not found';

    const assigneeIds = await this.resolveAssignee(toStage, instance, organizationId);
    for (const userId of assigneeIds) {
      await this.prisma.notification.create({
        data: {
          organizationId,
          userId,
          titleEn: transition.labelEn,
          bodyEn: `${instance.objectType} moved to ${toStage.nameEn}`,
          objectType: instance.objectType,
          objectId: instance.objectId,
        },
      });
    }
    return `Notified ${assigneeIds.length} user(s)`;
  }

  private async resolveAndNotifyInitialAssignee(
    initialStage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<void> {
    const assigneeIds = await this.resolveAssignee(initialStage, instance, organizationId);
    for (const userId of assigneeIds) {
      await this.prisma.notification.create({
        data: {
          organizationId,
          userId,
          titleEn: 'New workflow assignment',
          bodyEn: `You have been assigned to ${initialStage.nameEn}`,
          objectType: instance.objectType,
          objectId: instance.objectId,
        },
      });
    }
  }

  // ── Internal: validator config ───────────────────────────────────────────────

  private async checkValidatorConfig(
    transition: PrismaWorkflowTransition,
    currentInstanceStage: PrismaWorkflowInstanceStage,
  ): Promise<void> {
    const config = transition.validatorConfig as { minApprovals?: number } | null;
    // requiredFields/minAttachments/allPreviousStageTasksComplete need a
    // caller-supplied object snapshot that TriggerTransitionDto does not
    // carry — left unenforced until a functional module needs them (see
    // Section 8 of the Step 6 plan). minApprovals is self-contained (checked
    // against our own WorkflowApproval rows) so it's enforced here.
    if (!config?.minApprovals) return;

    const approvedCount = await this.prisma.workflowApproval.count({
      where: {
        workflowInstanceStageId: currentInstanceStage.id,
        decision: { in: ['APPROVED', 'APPROVED_WITH_COMMENTS'] },
      },
    });
    if (approvedCount < config.minApprovals) {
      throw new ConflictException(
        `At least ${config.minApprovals} approval(s) required before this transition can fire`,
      );
    }
  }

  // ── Internal: assignee resolution ────────────────────────────────────────────

  // Resolves a stage's configured assigneeStrategy to concrete User.id(s) —
  // used for CREATE_TASK/SEND_NOTIFICATION targeting. Always returns an array
  // (empty if nothing could be resolved); callers needing a single assignee
  // take the first element.
  private async resolveAssignee(
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string[]> {
    switch (stage.assigneeStrategy) {
      case 'SPECIFIC_USER':
        return stage.assigneeUserId ? [stage.assigneeUserId] : [];

      case 'ROLE':
      case 'ROUND_ROBIN': {
        if (!stage.assigneeRoleId) return [];
        const userRoles = await this.prisma.userRole.findMany({
          where: { roleId: stage.assigneeRoleId, user: { organizationId, status: 'ACTIVE' } },
        });
        const userIds = userRoles.map((ur) => ur.userId);
        if (userIds.length === 0) return [];
        // ROUND_ROBIN's "least-recently-assigned" tie-breaking needs an
        // assignment-history mechanism that doesn't exist yet — falls back
        // to the same "first active holder" resolution as ROLE, per the
        // plan's own documented limitation (Step 9 will refine this).
        return stage.approvalMode === 'SINGLE' ? [userIds[0] as string] : userIds;
      }

      case 'ORG_UNIT_HEAD':
        // Stubbed — resolving the workflow object's own org unit requires the
        // calling functional module to supply an orgUnitId, and no module
        // calls startInstance()/triggerTransition() yet. Documented
        // limitation, not an oversight — see Step 6 plan, Business Rules.
        throw new Error(
          'ORG_UNIT_HEAD assignee resolution requires an orgUnitId from the calling module — not yet supported',
        );

      case 'SELF': {
        const firstStage = await this.prisma.workflowInstanceStage.findFirst({
          where: { workflowInstanceId: instance.id },
          orderBy: { enteredAt: 'asc' },
        });
        return firstStage?.actorId ? [firstStage.actorId] : [];
      }

      case 'COMMITTEE': {
        if (!stage.committeeId) return [];
        const members = await this.prisma.committeeMember.findMany({
          where: { committeeId: stage.committeeId, leftAt: null },
        });
        return members.map((m) => m.userId);
      }

      default:
        return [];
    }
  }

  // Sizes the eligible-approver pool for PARALLEL/SEQUENTIAL threshold checks
  // — deliberately separate from resolveAssignee() above, which needs the
  // full instance (for SELF) and isn't meaningful for pool-sizing purposes.
  private async resolveApproverPool(
    stage: PrismaWorkflowStage,
    organizationId: string,
  ): Promise<string[]> {
    if (stage.assigneeStrategy === 'COMMITTEE') {
      if (!stage.committeeId) return [];
      const members = await this.prisma.committeeMember.findMany({
        where: { committeeId: stage.committeeId, leftAt: null },
      });
      return members.map((m) => m.userId);
    }
    if (stage.assigneeStrategy === 'ROLE' && stage.assigneeRoleId) {
      const userRoles = await this.prisma.userRole.findMany({
        where: { roleId: stage.assigneeRoleId, user: { organizationId, status: 'ACTIVE' } },
      });
      return userRoles.map((ur) => ur.userId);
    }
    // Any other assigneeStrategy on a multi-approver stage is a seed/config
    // error — there is no well-defined pool to size a threshold against.
    return [];
  }

  private async computeSlaDueAt(
    stage: PrismaWorkflowStage,
    organizationId: string,
  ): Promise<Date | null> {
    if (!stage.slaWorkingHours) return null;
    const deadline = await this.workingCalendar.calculateDeadline(
      DateTime.now(),
      stage.slaWorkingHours,
      organizationId,
    );
    return deadline.toJSDate();
  }

  // ── Internal mappers ─────────────────────────────────────────────────────────

  private mapInstance(instance: PrismaWorkflowInstance): IWorkflowInstance {
    return {
      id: instance.id,
      organizationId: instance.organizationId,
      workflowTemplateId: instance.workflowTemplateId,
      objectType: instance.objectType,
      objectId: instance.objectId,
      status: instance.status,
      currentStageId: instance.currentStageId,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    };
  }

  private mapApproval(approval: PrismaWorkflowApproval): IWorkflowApproval {
    return {
      id: approval.id,
      workflowInstanceStageId: approval.workflowInstanceStageId,
      approverId: approval.approverId,
      decision: approval.decision,
      comment: approval.comment,
      decidedAt: approval.decidedAt,
      createdAt: approval.createdAt,
    };
  }
}
