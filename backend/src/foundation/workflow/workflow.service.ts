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
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TaskService } from '../task/task.service';
import { RoleService } from '../roles/role.service';
import { OrganizationService } from '../organization/organization.service';
import {
  WorkflowInstance as PrismaWorkflowInstance,
  WorkflowInstanceStage as PrismaWorkflowInstanceStage,
  WorkflowStage as PrismaWorkflowStage,
  WorkflowTransition as PrismaWorkflowTransition,
  WorkflowApproval as PrismaWorkflowApproval,
  WorkflowObjectType,
  TaskSourceType,
} from '../../../generated/prisma/client';
import { IWorkflowInstance, IWorkflowApproval } from './interfaces/workflow-instance.interface';
import { ValidatorConfig } from './interfaces/workflow-transition.interface';
import { IWorkflowStageHistory } from './interfaces/workflow-stage-history.interface';
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
    private readonly delegationLabels: DelegationLabelService,
    private readonly workingCalendar: WorkingCalendarService,
    private readonly notificationService: NotificationService,
    private readonly taskService: TaskService,
    private readonly roleService: RoleService,
    // ACC-40 Section 2.5/2.6.2 — resolveAssigneeRaw()'s and
    // resolveApproverPool()'s new ORG_UNIT_HEAD cases call
    // OrganizationService.resolveActingHeadForOrgUnit() rather than
    // duplicating that resolution logic here, same "domain service owns
    // the query, WorkflowService calls into it" placement the plan's own
    // 2.5 section confirms.
    private readonly organizationService: OrganizationService,
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

    const initialInstanceStage = await this.prisma.workflowInstanceStage.create({
      data: { workflowInstanceId: instance.id, stageId: initialStage.id, slaDueAt, actorId },
    });

    // No WorkflowTransitionAction fires on stage entry (actions fire on
    // transitions, per the seed data design) — so the initial stage's
    // assignee is notified directly here, the one place nothing else would.
    await this.resolveAndNotifyInitialAssignee(initialStage, instance, organizationId);

    // ACC-28 Section 2.5 — flag + notify Tenant Admins if this stage has an
    // outgoing ASSIGNEE_POOL transition nobody in the resolved pool could
    // ever fire (e.g. a vacant Chairman seat).
    await this.checkAndFlagUnassignedStage(initialStage, initialInstanceStage.id, instance, organizationId);

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

  // ACC-76 — the real path an object took through its workflow.
  //
  // Returns BOTH views — see IWorkflowStageHistory for why neither substitutes
  // for the other. `stages` is the sequence (every template stage, in order,
  // each carrying how many times it was entered); `visits` is the chronology
  // (what actually happened, repeats preserved). A record that went
  // Formation -> Terms Review -> Formation -> Terms Review appears in the
  // first as two stages with visitCount 2, and in the second as four rows.
  async getStageHistory(
    instanceId: string,
    organizationId: string,
  ): Promise<IWorkflowStageHistory> {
    // Scoped by id AND organizationId together, per CLAUDE.md's query shape —
    // also the only way to learn which template to diff the visits against.
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organizationId },
      select: { id: true, workflowTemplateId: true },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    const [visitRows, stages] = await Promise.all([
      // WorkflowInstanceStage has NO organizationId of its own — tenancy is
      // transitive through workflowInstance (SYSTEM-REFERENCE §8.3). Scoped
      // relationally here as well as via the check above: belt and braces on
      // a query that returns actor names.
      this.prisma.workflowInstanceStage.findMany({
        where: { workflowInstanceId: instance.id, workflowInstance: { organizationId } },
        orderBy: { enteredAt: 'asc' },
        include: { stage: { select: { id: true, nameEn: true, nameAr: true } } },
      }),
      this.prisma.workflowStage.findMany({
        where: { workflowTemplateId: instance.workflowTemplateId },
        orderBy: { order: 'asc' },
        select: { id: true, nameEn: true, nameAr: true, order: true },
      }),
    ]);

    // Two batched lookups for the whole history rather than per-row: actor
    // names, and ACC-40's delegation stamp resolved by the same service the
    // task list uses.
    const actorIds = [...new Set(visitRows.map((v) => v.actorId).filter((id): id is string => !!id))];
    const [actors, delegations] = await Promise.all([
      actorIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: actorIds }, organizationId },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      this.delegationLabels.resolveMany(visitRows, organizationId),
    ]);
    const actorNameById = new Map(actors.map((a) => [a.id, a.name]));

    // Visit counts per stage, and which stage holds the OPEN visit. Both are
    // derived from the visit rows rather than from currentStageId, which
    // cannot distinguish two visits to the same stage.
    const visitCountByStageId = new Map<string, number>();
    for (const visit of visitRows) {
      visitCountByStageId.set(visit.stageId, (visitCountByStageId.get(visit.stageId) ?? 0) + 1);
    }
    const openVisit = visitRows.find((v) => v.exitedAt === null);

    return {
      instanceId: instance.id,
      stages: stages.map((stage) => ({
        ...stage,
        visitCount: visitCountByStageId.get(stage.id) ?? 0,
        isCurrent: openVisit?.stageId === stage.id,
      })),
      visits: visitRows.map((visit) => ({
        // The instance-stage row id, not the stage id — the stage id repeats
        // across visits and would collide as a list key.
        id: visit.id,
        stageId: visit.stageId,
        stageNameEn: visit.stage.nameEn,
        stageNameAr: visit.stage.nameAr,
        enteredAt: visit.enteredAt,
        exitedAt: visit.exitedAt,
        outcome: visit.outcome,
        actorId: visit.actorId,
        actorName: visit.actorId ? (actorNameById.get(visit.actorId) ?? null) : null,
        comment: visit.comment,
        isUnassigned: visit.isUnassigned,
        delegation: this.delegationLabels.lookup(visit, delegations),
      })),
    };
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

    // ACC-68 — the same orphaning bug as the stage-exit path, one level up.
    // This method closed every open stage and flipped the instance to
    // CANCELLED but never touched tasks, so force-cancelling a workflow left
    // every one of its tasks open — the same defect with a wider blast radius,
    // since it abandons the whole instance rather than one stage.
    //
    // Uses cancelForInstance(), not cancelForStage(): this path is not leaving
    // one stage, it is abandoning all of them, including tasks belonging to
    // stages exited earlier that were somehow still open.
    await this.taskService.cancelForInstance(id, organizationId, actorId);

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

    // ASSIGNEE_POOL (ACC-28) — placed after fromStage resolves, unlike the
    // three triggerCondition checks above, because resolveAssignee()
    // needs the full stage row, not just its id. Reuses the existing
    // assignee-resolution machinery rather than a new authorization
    // primitive — see backend/Plans/step-28-resource-scoped-roles.md
    // Section 2.2. Uses resolveAssignee() (OOO-aware), not the raw
    // resolveAssigneeRaw() — fixed per ACC-40 Section 2.6.1: an
    // out-of-office holder's acting user must be able to trigger this
    // transition too, same as they'd receive the task/notification for it.
    if (transition.triggerCondition === 'ASSIGNEE_POOL') {
      const pool = await this.resolveAssignee(fromStage, instance, organizationId);
      if (!pool.includes(actorId)) {
        throw new ForbiddenException('You are not in the resolved assignee pool for this stage');
      }
    }

    const currentInstanceStage = await this.prisma.workflowInstanceStage.findFirst({
      where: { workflowInstanceId: instanceId, stageId: fromStage.id, exitedAt: null },
    });
    if (!currentInstanceStage) {
      throw new ConflictException('No active stage entry found for this instance');
    }

    await this.checkValidatorConfig(transition, currentInstanceStage, organizationId);

    if (fromStage.approvalMode === 'SINGLE') {
      return this.performTransition(
        instance,
        currentInstanceStage,
        transition,
        organizationId,
        actorId,
        dto.comment,
        'APPROVED',
        fromStage,
      );
    }

    // Multi-approver stage: naming a specific transitionId is itself the vote
    // — isApprovalPath maps it to APPROVED (advance) or RETURNED (send back).
    const decision = transition.isApprovalPath ? 'APPROVED' : 'RETURNED';

    // ACC-40 Section 2.6.3 — stamped on both branches (create AND update)
    // so a re-vote by the same actor always reflects their CURRENT
    // delegation status, never a stale first-vote snapshot.
    const delegationStamp = await this.resolveDelegationStamp(actorId, fromStage, instance, organizationId);

    await this.prisma.workflowApproval.upsert({
      where: {
        workflowInstanceStageId_approverId: {
          workflowInstanceStageId: currentInstanceStage.id,
          approverId: actorId,
        },
      },
      update: {
        decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
        delegationReason: delegationStamp?.delegationReason ?? null,
        delegationContextId: delegationStamp?.delegationContextId ?? null,
      },
      create: {
        workflowInstanceStageId: currentInstanceStage.id,
        approverId: actorId,
        decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
        delegationReason: delegationStamp?.delegationReason ?? null,
        delegationContextId: delegationStamp?.delegationContextId ?? null,
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
        fromStage,
      );
    }

    const satisfied = await this.isApprovalThresholdMet(fromStage, currentInstanceStage, organizationId, instance);
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
      fromStage,
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

    const stage = await this.prisma.workflowStage.findFirst({ where: { id: instanceStage.stageId } });
    if (!stage) throw new NotFoundException('Workflow stage not found');

    // ACC-40 Section 2.6.2 — resolveApproverPool()'s ORG_UNIT_HEAD case
    // needs the calling object's orgUnitId, read off the instance (see
    // that case's own comment) — this method only had instanceStage in
    // scope until now, so a real fetch is required here (unlike
    // triggerTransition(), which already has instance loaded).
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceStage.workflowInstanceId },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    // Mirrors triggerTransition()'s ASSIGNEE_POOL check (pool.includes(actorId))
    // — reuses resolveApproverPool(), the same pool-resolution isApprovalThresholdMet()
    // already trusts for this exact stage, rather than inventing a new
    // authorization primitive. Only enforced when the pool resolves to
    // something concrete (COMMITTEE/ROLE/ORG_UNIT_HEAD strategies — the only
    // three resolveApproverPool() understands) — an unresolvable strategy on
    // a multi-approver stage is a pre-existing, separately-tracked
    // config-error case (see resolveApproverPool()'s own comment), not one
    // this check newly blocks.
    const approverPool = await this.resolveApproverPool(stage, organizationId, instance);
    if (approverPool.length > 0 && !approverPool.includes(actorId)) {
      throw new ForbiddenException('You are not an eligible approver for this stage');
    }

    // ACC-40 Section 2.6.3 — stamped on both branches, same reasoning as
    // triggerTransition()'s own upsert: a re-submitted approval always
    // reflects the actor's CURRENT delegation status.
    const delegationStamp = await this.resolveDelegationStamp(actorId, stage, instance, organizationId);

    const approval = await this.prisma.workflowApproval.upsert({
      where: {
        workflowInstanceStageId_approverId: { workflowInstanceStageId: instanceStageId, approverId: actorId },
      },
      update: {
        decision: dto.decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
        delegationReason: delegationStamp?.delegationReason ?? null,
        delegationContextId: delegationStamp?.delegationContextId ?? null,
      },
      create: {
        workflowInstanceStageId: instanceStageId,
        approverId: actorId,
        decision: dto.decision,
        comment: dto.comment ?? null,
        decidedAt: new Date(),
        delegationReason: delegationStamp?.delegationReason ?? null,
        delegationContextId: delegationStamp?.delegationContextId ?? null,
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

    await this.maybeAdvanceAfterApproval(stage, instanceStage, organizationId, actorId, dto, instance);

    return this.mapApproval(approval);
  }

  // ── Internal: shared advance logic ───────────────────────────────────────────

  private async maybeAdvanceAfterApproval(
    stage: PrismaWorkflowStage,
    instanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    actorId: string,
    dto: SubmitApprovalDto,
    // ACC-40 Section 2.6.2 — caller-supplied now (submitApproval() already
    // fetches this for resolveApproverPool()'s ORG_UNIT_HEAD case), rather
    // than this method re-fetching the same row a second time in the same
    // request.
    instance: PrismaWorkflowInstance,
  ): Promise<void> {
    // ABSTAINED never auto-routes — per module-designs.md, majority-abstained
    // requires Quality Officer escalation, not automatic advancement.
    if (dto.decision === 'ABSTAINED') return;

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
        stage,
      );
      return;
    }

    const satisfied = await this.isApprovalThresholdMet(stage, instanceStage, organizationId, instance);
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
      stage,
    );
  }

  private async isApprovalThresholdMet(
    fromStage: PrismaWorkflowStage,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    instance: PrismaWorkflowInstance,
  ): Promise<boolean> {
    const approvals = await this.prisma.workflowApproval.findMany({
      where: { workflowInstanceStageId: currentInstanceStage.id },
    });
    const approvedCount = approvals.filter(
      (a) => a.decision === 'APPROVED' || a.decision === 'APPROVED_WITH_COMMENTS',
    ).length;

    if (fromStage.approvalMode === 'COMMITTEE') {
      if (!fromStage.committeeId) return approvedCount > 0;
      // Org-scoped read (ACC-22, closing the ACC-17 deferred gap) — a
      // committeeId that somehow referenced another tenant's Committee row
      // must never resolve here, defense-in-depth alongside the write-time
      // validation in workflow-template.service.ts's addStage/updateStage.
      const committee = await this.prisma.committee.findFirst({
        where: { id: fromStage.committeeId, organizationId },
      });
      if (!committee || approvals.length < committee.quorumCount) return false;
      return approvedCount > approvals.length / 2;
    }

    const pool = await this.resolveApproverPool(fromStage, organizationId, instance);
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
    // ACC-40 Section 2.6.3 — the stage actorId was resolved eligible
    // against (not toStage) — every caller already has this in scope
    // (triggerTransition()'s own fromStage local, or
    // maybeAdvanceAfterApproval()'s own stage parameter), so it's threaded
    // through rather than re-derived here.
    fromStage: PrismaWorkflowStage,
  ): Promise<IWorkflowInstance> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) throw new NotFoundException('Target stage not found');

    await this.prisma.workflowInstanceStage.update({
      where: { id: currentInstanceStage.id },
      data: { exitedAt: new Date(), outcome, ...(comment !== undefined && { comment }) },
    });

    // ACC-68 — the stage has just been left, so its open tasks are now work
    // the object has moved away from. Cancel them.
    //
    // DIRECTION-AGNOSTIC, deliberately. Stage `order` was considered as a way
    // to tell a backward transition from a forward one and rejected: order is
    // display-only by design, and real lifecycles are not linear enough for it
    // to be reliable. Direction turns out not to matter — on a GATED forward
    // transition the task is already COMPLETED (that is what the ACC-65 gate
    // just enforced), so there is nothing open to cancel; on an UNGATED one
    // the object has moved on regardless. The bug this fixes was found on
    // exactly that second case: Terms Review → Formation via "Revise Terms",
    // which left a PENDING task assigned to someone, gating nothing.
    //
    // Without this, re-entering the stage stacks a second CREATE_TASK on top
    // of the first, so both must be completed to make one gated advancement —
    // and every further round trip adds another.
    //
    // Runs BEFORE fireTransitionActions() below, which is what creates the
    // NEXT stage's task. That ordering also makes a self-transition behave:
    // the old task is cancelled first, then the new one is created, rather
    // than the new one being cancelled by its own transition.
    await this.taskService.cancelForStage(
      instance.id,
      currentInstanceStage.stageId,
      organizationId,
      actorId,
      'STAGE_EXIT',
    );

    const slaDueAt = await this.computeSlaDueAt(toStage, organizationId);
    const delegationStamp = await this.resolveDelegationStamp(actorId, fromStage, instance, organizationId);

    const newInstanceStage = await this.prisma.workflowInstanceStage.create({
      data: {
        workflowInstanceId: instance.id,
        stageId: toStage.id,
        slaDueAt,
        actorId,
        delegationReason: delegationStamp?.delegationReason ?? null,
        delegationContextId: delegationStamp?.delegationContextId ?? null,
      },
    });

    // ACC-28 Section 2.5 — same check as startInstance(), for the stage this
    // transition just landed on.
    await this.checkAndFlagUnassignedStage(toStage, newInstanceStage.id, instance, organizationId);

    const updatedInstance = await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: {
        currentStageId: toStage.id,
        status: toStage.isFinal ? 'COMPLETED' : 'IN_PROGRESS',
      },
    });

    const unassignedTaskWarnings = await this.fireTransitionActions(
      transition,
      updatedInstance,
      organizationId,
      actorId,
    );

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      before: { currentStageId: instance.currentStageId },
      after: { currentStageId: toStage.id, status: updatedInstance.status },
    });

    return this.mapInstance(updatedInstance, unassignedTaskWarnings);
  }

  // ── Internal: transition actions ─────────────────────────────────────────────

  // Returns one warning message per CREATE_TASK action that resolved zero
  // eligible assignees — [] when nothing warrants a warning, never null, so
  // callers never need a null-check. Threaded through performTransition()
  // into the actor-facing IWorkflowInstance.unassignedTaskWarnings (ACC-34)
  // — array-shaped deliberately: WorkflowTransitionAction rows are
  // tenant-editable, and nothing prevents a tenant from configuring more
  // than one CREATE_TASK action on a single transition (unexercised by any
  // seeded transition today, confirmed by inspection of workflow.seed.ts,
  // but not guaranteed to stay that way).
  private async fireTransitionActions(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
    actorId: string,
  ): Promise<string[]> {
    const actions = await this.prisma.workflowTransitionAction.findMany({
      where: { workflowTransitionId: transition.id },
      orderBy: { order: 'asc' },
    });

    const unassignedTaskWarnings: string[] = [];

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
      let status: 'SUCCESS' | 'SUCCESS_UNASSIGNED' = 'SUCCESS';
      switch (action.actionType) {
        case 'CREATE_TASK': {
          const result = await this.executeCreateTask(transition, instance, organizationId, actorId);
          responseSummary = result.responseSummary;
          if (result.isUnassigned) {
            status = 'SUCCESS_UNASSIGNED';
            unassignedTaskWarnings.push(result.responseSummary);
          }
          break;
        }
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
          status,
          responseSummary,
        },
      });
    }

    return unassignedTaskWarnings;
  }

  // Resolves a human-readable label for "which object does this instance
  // represent" — COMMITTEE resolves the real committee name via
  // instance.objectId (always populated, unlike stage.committeeId which is
  // a different, frequently-unset field used for COMMITTEE-assigneeStrategy
  // pool resolution). Other object types fall back to the generic
  // objectType string until those modules exist to resolve against —
  // matches the precedent already established for every other partial-
  // resolution case in this codebase (ACC-34).
  private async resolveObjectSubjectLabel(
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string> {
    if (instance.objectType === 'COMMITTEE') {
      const committee = await this.prisma.committee.findFirst({
        where: { id: instance.objectId, organizationId },
        select: { nameEn: true },
      });
      if (committee) return committee.nameEn;
    }
    return instance.objectType;
  }

  // ACC-34 — isUnassigned distinguishes "task genuinely created but with no
  // eligible assignee" from every other outcome (including the early
  // "Skipped" returns below, where no Task row was ever created at all) —
  // callers use it both to pick WorkflowActionLogStatus and to decide
  // whether this action's responseSummary belongs in the actor-facing
  // warnings array.
  private async executeCreateTask(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
    actorId: string,
  ): Promise<{ responseSummary: string; isUnassigned: boolean }> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) return { responseSummary: 'Skipped — target stage not found', isUnassigned: false };

    // Every current WorkflowObjectType now has a TaskSourceType mapping
    // (see mapObjectTypeToTaskSourceType below) — the null-fallback here
    // only matters for a future WorkflowObjectType addition (e.g.
    // ACCREDITATION_ROUND, GAP — see CLAUDE.md's Additions Schedule) that
    // hasn't been wired into the mapping yet, skipped gracefully rather
    // than writing an invalid enum value to the database.
    const sourceType = this.mapObjectTypeToTaskSourceType(instance.objectType);
    if (!sourceType) {
      return {
        responseSummary: `Skipped — no TaskSourceType mapping for ${instance.objectType}`,
        isUnassigned: false,
      };
    }

    // Full resolved assigneeIds array passed through — fixes the original
    // bug where only assigneeIds[0] was ever used, silently dropping every
    // other assignee for PARALLEL/COMMITTEE stages.
    const assigneeIds = await this.resolveAssignee(toStage, instance, organizationId);
    const subjectLabel = await this.resolveObjectSubjectLabel(instance, organizationId);

    // ACC-40 Section 2.6.3 — computed once, per assignee, at exactly the
    // moment resolveAssignee() (already OOO-aware) has full, fresh
    // knowledge of why each resolved user was included — the exact moment
    // the plan calls for, not re-derived later at Task.complete() time.
    // Only delegated assignees get an entry; a direct, undelegated
    // assignee simply has none.
    const assigneeDelegations = (
      await Promise.all(
        assigneeIds.map(async (userId) => {
          const stamp = await this.resolveDelegationStamp(userId, toStage, instance, organizationId);
          return stamp ? { userId, ...stamp } : null;
        }),
      )
    ).filter((d): d is NonNullable<typeof d> => d !== null);

    // ACC-46 Section 2.7.f — reuses this same private computeSlaDueAt(),
    // the exact computation already feeding WorkflowInstanceStage.slaDueAt,
    // rather than duplicating the WorkingCalendarService.calculateDeadline()
    // call a second time. Returns null when toStage.slaWorkingHours is
    // unset, so dueDate stays undefined and the task falls through to
    // TaskService's own existing priority-based default — zero behavior
    // change for any stage that hasn't configured an SLA.
    const dueAt = await this.computeSlaDueAt(toStage, organizationId);

    const task = await this.taskService.create(
      {
        title: `${transition.labelEn} — ${subjectLabel}`,
        sourceType,
        sourceId: instance.objectId,
        sourceStageId: toStage.id,
        workflowInstanceId: instance.id,
        assigneeUserIds: assigneeIds,
        assigneeDelegations,
        priority: 'MEDIUM', // TODO(future step): derive from source object urgency, not a fixed default
        dueDate: dueAt?.toISOString(),
      },
      organizationId,
      actorId,
    );

    return assigneeIds.length > 0
      ? { responseSummary: `Task created for ${assigneeIds.length} assignee(s)`, isUnassigned: false }
      : { responseSummary: `Task created as ${task.status} — no eligible assignee`, isUnassigned: true };
  }

  // WorkflowObjectType → TaskSourceType. DOCUMENT_REQUEST/CHANGE_REQUEST map
  // to DOCUMENT (both are document-lifecycle processes). The default branch
  // exists for a future WorkflowObjectType addition landing ahead of its own
  // TaskSourceType mapping — callers must skip task creation gracefully
  // rather than write an invalid enum value to the database.
  private mapObjectTypeToTaskSourceType(objectType: WorkflowObjectType): TaskSourceType | null {
    switch (objectType) {
      case 'DOCUMENT':
      case 'DOCUMENT_REQUEST':
      case 'CHANGE_REQUEST':
        return 'DOCUMENT';
      case 'INCIDENT':
        return 'INCIDENT';
      case 'AUDIT':
        return 'AUDIT';
      case 'CORRECTIVE_ACTION':
        return 'CORRECTIVE_ACTION';
      case 'MEETING':
        return 'MEETING';
      case 'COMMITTEE':
        return 'COMMITTEE';
      default:
        return null;
    }
  }

  private async executeSendNotification(
    transition: PrismaWorkflowTransition,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) return 'Skipped — target stage not found';

    const assigneeIds = await this.resolveAssignee(toStage, instance, organizationId);
    // TODO(event-bus): migrate to event emitter if/when NotificationService
    // moves to a pub/sub model (see Step 7 plan Section 8/12).
    for (const userId of assigneeIds) {
      await this.notificationService.create(
        {
          userId,
          titleEn: transition.labelEn,
          bodyEn: `${instance.objectType} moved to ${toStage.nameEn}`,
          objectType: instance.objectType,
          objectId: instance.objectId,
        },
        organizationId,
      );
    }
    return `Notified ${assigneeIds.length} user(s)`;
  }

  private async resolveAndNotifyInitialAssignee(
    initialStage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<void> {
    const assigneeIds = await this.resolveAssignee(initialStage, instance, organizationId);
    // TODO(event-bus): migrate to event emitter if/when NotificationService
    // moves to a pub/sub model (see Step 7 plan Section 8/12).
    for (const userId of assigneeIds) {
      await this.notificationService.create(
        {
          userId,
          titleEn: 'New workflow assignment',
          bodyEn: `You have been assigned to ${initialStage.nameEn}`,
          objectType: instance.objectType,
          objectId: instance.objectId,
        },
        organizationId,
      );
    }
  }

  // ── Internal: validator config ───────────────────────────────────────────────

  private async checkValidatorConfig(
    transition: PrismaWorkflowTransition,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
  ): Promise<void> {
    const config = transition.validatorConfig as ValidatorConfig | null;
    if (!config) return;

    // requiredFields/minAttachments remain unenforced: both describe the
    // BUSINESS OBJECT (a document's title, its attachments), which this
    // engine never sees, so both genuinely need the caller-supplied object
    // snapshot TriggerTransitionDto does not carry. Still correctly deferred.
    //
    // The two checks below need no snapshot — each is answerable from data
    // the engine already owns. allPreviousStageTasksComplete was previously
    // grouped with the snapshot-dependent two and deferred by association;
    // that reason never applied to it (ACC-65, SYSTEM-REFERENCE.md §2.10).
    if (config.minApprovals) {
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

    if (config.allPreviousStageTasksComplete) {
      await this.assertStageTasksComplete(currentInstanceStage, organizationId);
    }
  }

  // ACC-65 — blocks a transition while the stage being LEFT still has
  // outstanding tasks. The missing half of the workflow/task seam: without
  // it a user completes a task and separately presses a transition, with
  // nothing connecting the two and nothing stopping them advancing with the
  // task still open.
  //
  // Three scoping decisions, each made deliberately rather than falling out
  // of the where clause:
  //
  // 1. WHICH STAGE. Task.sourceStageId holds the stage a task was created
  //    FOR, which executeCreateTask() sets to the transition's DESTINATION
  //    (`sourceStageId: toStage.id`). So the tasks belonging to the stage we
  //    are now leaving are those stamped with currentInstanceStage.stageId.
  //    The field name says "source" while holding a destination — that is
  //    pre-existing and not changed here, but it is why this reads the
  //    from-stage and not transition.toStageId.
  //
  // 2. WHICH STATUSES COUNT AS OUTSTANDING. COMPLETED is done. CANCELLED is
  //    void — a cancelled task must not block, so the naive
  //    `{ not: 'COMPLETED' }` would be wrong. Everything else blocks,
  //    INCLUDING UNASSIGNED, and that is the deliberate part:
  //
  //      sweepOverdueTasks() uses notIn ['COMPLETED','CANCELLED','UNASSIGNED']
  //      because nobody can be nagged about a task with no assignee. This
  //      check deliberately DIFFERS by one value. An unassigned task is real
  //      work that definitely is not done; letting it pass would fail open in
  //      exactly the case the gate exists for. The resulting block is
  //      recoverable by design and by three separate existing paths —
  //      TaskService.reassign() flips UNASSIGNED to PENDING, ACC-34's
  //      Unassigned Tasks view surfaces them under tasks:manage, and
  //      ACC-51/52's sweep re-resolves and assigns them automatically. It is
  //      a stall with an exit, not a deadlock.
  //
  // 3. WHETHER MANUAL TASKS COUNT. They do. CreateTaskDto accepts
  //    sourceStageId and workflowInstanceId, so a user with tasks:create can
  //    attach a task to this stage, and it will block. That is intended: the
  //    question this gate answers is "is this stage's work done", not "is
  //    this stage's ENGINE-GENERATED work done". Excluding manual tasks would
  //    need a provenance field that does not exist, and would silently ignore
  //    work a Quality Manager deliberately attached to the stage.
  private async assertStageTasksComplete(
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
  ): Promise<void> {
    const outstanding = await this.prisma.task.findMany({
      where: {
        organizationId,
        // Both, not just the stage: without workflowInstanceId a task from a
        // DIFFERENT object sitting at the same template stage would block
        // this instance — an intermittent bug that would be painful to trace.
        workflowInstanceId: currentInstanceStage.workflowInstanceId,
        sourceStageId: currentInstanceStage.stageId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { title: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    if (outstanding.length === 0) return;

    // Names what is outstanding rather than throwing a generic conflict —
    // the actor's next action is to go and complete those specific tasks,
    // and "a task is incomplete" does not tell them which.
    const summary = outstanding.map((t) => `"${t.title}" (${t.status})`).join(', ');
    throw new ConflictException(
      `This stage has ${outstanding.length} incomplete task(s) that must be completed before ` +
        `this transition can fire: ${summary}`,
    );
  }

  // ── Internal: assignee resolution ────────────────────────────────────────────

  // Resolves a stage's configured assigneeStrategy to concrete User.id(s) —
  // used for CREATE_TASK/SEND_NOTIFICATION targeting. Always returns an array
  // (empty if nothing could be resolved); callers needing a single assignee
  // take the first element.
  // Public shape unchanged — resolves the raw strategy result, then applies
  // out-of-office routing (Absence and Departure Management, Pattern 1)
  // before returning. Affects every caller uniformly (CREATE_TASK,
  // SEND_NOTIFICATION, initial-assignee notification) since out-of-office
  // substitution should apply to assignee resolution generally, not just
  // to tasks.
  private async resolveAssignee(
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string[]> {
    const rawUserIds = await this.resolveAssigneeRaw(stage, instance, organizationId);
    return this.applyOutOfOfficeRouting(rawUserIds, organizationId);
  }

  // ACC-51 — public accessor over the private resolveAssignee() above, for
  // SlaMonitorProcessor's unassigned-stage RECOVERY branch: once a stage's
  // isUnassigned flag clears, the sweep needs the concrete pool that just
  // became resolvable, to attach to the still-UNASSIGNED Task.
  // Same precedent as resolveUnassignedBlockingTransitions() being public
  // specifically so that processor can reuse this file's resolution logic
  // rather than duplicating it. Deliberately a thin pass-through, not a
  // second implementation — OOO routing included, exactly as every other
  // consumer of the pool gets it.
  //
  // Yes, this re-resolves a pool resolveUnassignedBlockingTransitions()
  // already resolved moments earlier in the same sweep pass. Accepted: it
  // runs only on the rare recovery branch of a 15-minute job, and threading
  // the pool back out through a method whose whole contract is "return the
  // blocking transitions" would muddy that contract for a micro-optimization
  // nothing has measured a need for.
  async resolveAssigneeForStage(
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string[]> {
    return this.resolveAssignee(stage, instance, organizationId);
  }

  private async resolveAssigneeRaw(
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

      case 'ORG_UNIT_HEAD': {
        // ACC-40 Section 2.5 — real resolver wiring, but still degrades to
        // an empty pool for every REAL caller today: no workflow-driven
        // object (Committee, Meeting) has its own orgUnitId field yet
        // (confirmed prerequisite gap, Section 2.5's own checklist note) —
        // a real, separate schema addition on whichever functional module
        // first consumes this strategy, not made by this ticket. Reads
        // instance.orgUnitId defensively (a property the real
        // WorkflowInstance Prisma model does not carry — no schema change
        // here), so this is exactly as safe as the previous unconditional
        // stub for every existing tenant/workflow, while being real,
        // tested wiring for whichever module supplies the field next.
        // TODO(ACC-40): once a real orgUnitId column is added to a
        // consuming object's schema, REPLACE this cast with a properly-typed
        // field reference (e.g. instance.orgUnitId directly, once the
        // Prisma-generated WorkflowInstance type actually carries it) —
        // don't just leave the cast in place and trust it keeps compiling.
        const orgUnitId = (instance as { orgUnitId?: string | null }).orgUnitId;
        if (!orgUnitId) return [];
        return this.organizationService.resolveActingHeadForOrgUnit(orgUnitId, organizationId);
      }

      case 'SELF': {
        const firstStage = await this.prisma.workflowInstanceStage.findFirst({
          where: { workflowInstanceId: instance.id },
          orderBy: { enteredAt: 'asc' },
        });
        return firstStage?.actorId ? [firstStage.actorId] : [];
      }

      // ACC-54 — the FIXED half of OrgPosition-based resolution: whoever
      // holds this specific position in this specific, explicitly-configured
      // unit. Unlike ROLE (which returns every holder of a role anywhere in
      // the tenant, with no connection to the triggering object), this is
      // narrowed to one unit — but that unit is chosen at CONFIG time, so it
      // is the same pool for every instance of the template. The RELATIVE
      // variant, which derives the unit from the triggering object's own
      // orgUnitId, is deliberately not built yet: no workflow-driven object
      // carries an orgUnitId to derive from (Committee has none), so it
      // would resolve empty for every object that exists today.
      //
      // Returns [] rather than throwing when either field is unset, exactly
      // like every other case in this switch (SPECIFIC_USER, ROLE,
      // ORG_UNIT_HEAD, COMMITTEE all do the same). That is what lets an
      // unconfigured or half-configured stage flow into ACC-28's
      // unassigned-stage detection and ACC-51/52's task recovery rather than
      // crashing a transition or a sweep — the empty pool IS the signal.
      case 'POSITION_FIXED': {
        if (!stage.assigneePositionId || !stage.assigneeOrgUnitId) return [];
        const holders = await this.prisma.user.findMany({
          where: {
            organizationId,
            positionId: stage.assigneePositionId,
            primaryOrgUnitId: stage.assigneeOrgUnitId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        const holderIds = holders.map((h) => h.id);
        if (holderIds.length === 0) return [];
        // Mirrors ROLE's own SINGLE-mode narrowing directly above: one
        // approver needed means one assignee, and the position is normally
        // isSingleAssignee anyway, so this is a no-op in the common case.
        return stage.approvalMode === 'SINGLE' ? [holderIds[0] as string] : holderIds;
      }

      case 'COMMITTEE': {
        if (!stage.committeeId) return [];
        // Org-scoped read (ACC-22, closing the ACC-17 deferred gap) —
        // organizationId filter on the denormalized column, isActive
        // instead of leftAt: null (both per the plan's Pending Discussions
        // #6/#7 resolutions).
        // assigneeCommitteeRoleValueId (ACC-28) narrows this to a specific
        // committee_member_role when set — null preserves the pre-ACC-28
        // "every active member" behavior.
        const members = await this.prisma.committeeMember.findMany({
          where: {
            committeeId: stage.committeeId,
            organizationId,
            isActive: true,
            ...(stage.assigneeCommitteeRoleValueId
              ? { roleValueId: stage.assigneeCommitteeRoleValueId }
              : {}),
          },
        });
        return members.map((m) => m.userId);
      }

      default:
        return [];
    }
  }

  // ACC-40 Section 2.6.3 — the ACTING_HEAD half of the unified delegation
  // stamp. A narrow, single-actor sibling to resolveAssigneeRaw()'s own
  // ORG_UNIT_HEAD case and OrganizationService.resolveActingHeadForOrgUnit()
  // — deliberately not a modification of either (pool resolution stays a
  // flat string[], unchanged). Walks the SAME hierarchy shape, but asks a
  // different, narrower question: not "who is eligible" but "is THIS
  // specific actor eligible only because they're acting, not because they
  // really hold the position." Returns the OrgUnit id they're acting FOR
  // (the delegation context), or null if they're a real holder (not
  // "acting") or not acting for anything found in the walk.
  //
  // Public (not private) so this phase's own tests can exercise it in
  // isolation before Phase 9 commit 3 wires it into a real write site —
  // same precedent as resolveActingHeadForOrgUnit() (Phase 6 commit 1).
  async resolveActingHeadOrgUnitIdForUser(
    actorId: string,
    orgUnitId: string,
    organizationId: string,
  ): Promise<string | null> {
    let current: string | null = orgUnitId;
    while (current) {
      const isRealHolder = await this.prisma.user.count({
        where: {
          id: actorId,
          organizationId,
          primaryOrgUnitId: current,
          status: 'ACTIVE',
          position: { isUnitHeadPosition: true },
        },
      });
      if (isRealHolder > 0) return null; // real position-holder — not "acting"

      const unit: { actingHeadUserId: string | null; parentId: string | null } | null =
        await this.prisma.orgUnit.findFirst({
          where: { id: current, organizationId },
          select: { actingHeadUserId: true, parentId: true },
        });
      if (!unit) return null;
      if (unit.actingHeadUserId === actorId) return current; // the unit id they're acting FOR

      current = unit.parentId;
    }
    return null;
  }

  // ACC-40 Section 2.6.3 — the OUT_OF_OFFICE_COVERAGE half. Constrained to
  // rawPoolUserIds deliberately — actorId being *someone's* actingUserId
  // tenant-wide is not relevant; only whether they're covering for a person
  // who was actually part of *this* resolution's raw pool counts. Public
  // for the same isolated-testing reason as the sibling above.
  async resolveOutOfOfficeCoverageForUser(
    actorId: string,
    rawPoolUserIds: string[],
    organizationId: string,
  ): Promise<string | null> {
    if (rawPoolUserIds.length === 0) return null;

    const now = new Date();
    const coveredFor = await this.prisma.user.findFirst({
      where: {
        id: { in: rawPoolUserIds },
        organizationId,
        actingUserId: actorId,
        outOfOfficeFrom: { lte: now },
        outOfOfficeTo: { gte: now },
      },
    });
    return coveredFor?.id ?? null;
  }

  // ACC-40 Section 2.6.3 — the unified delegation-reason stamp, computed at
  // the exact moment of writing actorId/approverId (or, per Phase 9 commit
  // 4, each TaskAssignee row). ACTING_HEAD checked first,
  // OUT_OF_OFFICE_COVERAGE second — a stated, deliberate precedence for the
  // rare edge case where both could theoretically resolve (an actor who is
  // both the acting head of a vacant unit and separately covering an
  // absent ROLE-based colleague in the same raw pool). The stamp records
  // one reason, not a set.
  private async resolveDelegationStamp(
    userId: string,
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<{ delegationReason: 'ACTING_HEAD' | 'OUT_OF_OFFICE_COVERAGE'; delegationContextId: string } | null> {
    if (stage.assigneeStrategy === 'ORG_UNIT_HEAD') {
      // Same instance.orgUnitId defensive read as resolveAssigneeRaw()'s
      // own ORG_UNIT_HEAD case — see that case's own comment.
      const orgUnitId = (instance as { orgUnitId?: string | null }).orgUnitId;
      if (orgUnitId) {
        const actingForOrgUnitId = await this.resolveActingHeadOrgUnitIdForUser(userId, orgUnitId, organizationId);
        if (actingForOrgUnitId) {
          return { delegationReason: 'ACTING_HEAD', delegationContextId: actingForOrgUnitId };
        }
      }
    }

    const rawPool = await this.resolveAssigneeRaw(stage, instance, organizationId);
    const coveredForUserId = await this.resolveOutOfOfficeCoverageForUser(userId, rawPool, organizationId);
    if (coveredForUserId) {
      return { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: coveredForUserId };
    }

    return null;
  }

  // Absence and Departure Management, Pattern 1 (Acting Assignment):
  //   IF user.outOfOfficeFrom <= now <= outOfOfficeTo AND actingUserId set:
  //     → substitute actingUser, notify both, audit log the substitution
  //   ELSE (out of office, no acting user set):
  //     → keep the user assigned, notify Tenant Admin to reassign
  private async applyOutOfOfficeRouting(userIds: string[], organizationId: string): Promise<string[]> {
    if (userIds.length === 0) return userIds;

    const now = new Date();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, organizationId },
    });

    const resolved = new Set<string>();
    for (const user of users) {
      const isOutOfOffice =
        user.outOfOfficeFrom && user.outOfOfficeTo && user.outOfOfficeFrom <= now && now <= user.outOfOfficeTo;

      if (!isOutOfOffice) {
        resolved.add(user.id);
        continue;
      }

      if (user.actingUserId) {
        resolved.add(user.actingUserId);

        await this.notificationService.create(
          {
            userId: user.id,
            titleEn: 'Assignment routed to your acting user',
            bodyEn: `An assignment was routed to your acting user while you are on leave.`,
          },
          organizationId,
        );
        await this.notificationService.create(
          {
            userId: user.actingUserId,
            titleEn: 'Assignment routed to you (acting)',
            bodyEn: `You have been assigned as the acting user for a colleague on leave.`,
          },
          organizationId,
        );
        await this.auditLog.log({
          action: 'DELEGATE',
          objectType: 'User',
          objectId: user.id,
          tenantId: organizationId,
          metadata: { assignedToActingUserId: user.actingUserId, reason: 'out-of-office' },
        });
      } else {
        // Out of office with no acting user set — assign normally per the
        // documented fallback, but flag the gap to the Tenant Admin.
        resolved.add(user.id);
        await this.notifyTenantAdminsOfCoverageGap(organizationId, user.id);
      }
    }

    return Array.from(resolved);
  }

  private async notifyTenantAdminsOfCoverageGap(organizationId: string, absentUserId: string): Promise<void> {
    const adminRole = await this.prisma.role.findFirst({ where: { organizationId, key: 'TENANT_ADMIN' } });
    if (!adminRole) return;

    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
    });

    for (const userRole of userRoles) {
      await this.notificationService.create(
        {
          userId: userRole.userId,
          titleEn: 'Coverage gap — user on leave with no acting user',
          bodyEn: `A user on leave (id: ${absentUserId}) has no acting user set and was assigned anyway. Consider reassigning.`,
        },
        organizationId,
      );
    }
  }

  // ── ACC-28 Section 2.5: unassigned-stage detection ──────────────────────────

  // Returns every outgoing ASSIGNEE_POOL transition from `stage` that nobody
  // in the currently-resolved assignee pool could ever fire — either the
  // pool is empty (unreachable regardless of requiredPermission), or the
  // pool is non-empty but nobody in it holds the transition's
  // requiredPermission. Public: called both from checkAndFlagUnassignedStage()
  // below (entry-time, this file) and from SlaMonitorProcessor's periodic
  // sweep (drift-after-entry re-check, plan Section 2.5.1) — the resolution
  // logic must stay identical between both call sites, so it lives in one
  // place rather than being duplicated. Uses resolveAssignee() (OOO-aware),
  // not the raw resolveAssigneeRaw() — fixed per ACC-40 Section 2.6.1: an
  // out-of-office holder with no acting user set is a real, already-flagged
  // coverage gap (notifyTenantAdminsOfCoverageGap()), but one WITH an acting
  // user set must not be misreported as an unassigned/blocked stage.
  async resolveUnassignedBlockingTransitions(
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<PrismaWorkflowTransition[]> {
    const outgoingTransitions = await this.prisma.workflowTransition.findMany({
      where: { fromStageId: stage.id, triggerCondition: 'ASSIGNEE_POOL' },
    });
    if (outgoingTransitions.length === 0) return [];

    const pool = await this.resolveAssignee(stage, instance, organizationId);
    const blocking: PrismaWorkflowTransition[] = [];

    for (const transition of outgoingTransitions) {
      // Empty pool blocks every outgoing ASSIGNEE_POOL transition regardless
      // of requiredPermission — nobody can ever satisfy triggerTransition()'s
      // pool.includes(actorId) check if the pool has no members at all.
      if (pool.length === 0) {
        blocking.push(transition);
        continue;
      }
      if (!transition.requiredPermission) continue;

      let anyQualifies = false;
      for (const userId of pool) {
        const permissions = await this.roleService.getUserPermissions(userId, organizationId);
        if (permissions.includes(transition.requiredPermission)) {
          anyQualifies = true;
          break;
        }
      }
      if (!anyQualifies) blocking.push(transition);
    }

    return blocking;
  }

  // Returns every outgoing ROLE_BASED/SPECIFIC_USER transition from `stage`
  // that has become permanently unreachable — a structurally different check
  // from resolveUnassignedBlockingTransitions() above, not a generalization
  // of it (SYSTEM-REFERENCE.md Section 2.13 / Section 11 Tier 1): ROLE_BASED
  // gating (transition.triggerRoleId) and SPECIFIC_USER gating
  // (transition.triggerUserId) are properties of the TRANSITION itself,
  // independent of the stage's assigneeStrategy/pool entirely — a stage can
  // use any assigneeStrategy at all and still have an outgoing transition
  // gated this way. ROLE_BASED transitions without a triggerRoleId (gated
  // only by requiredPermission, the common case in this codebase's seed
  // data) and SPECIFIC_USER transitions without a triggerUserId are outside
  // this check's scope — requiredPermission-only reachability (does ANY
  // active user hold a role granting this permission, across the whole
  // tenant) is a broader, more expensive question not covered here.
  async resolveUnreachableTriggerConditionTransitions(
    stage: PrismaWorkflowStage,
    organizationId: string,
  ): Promise<PrismaWorkflowTransition[]> {
    const outgoingTransitions = await this.prisma.workflowTransition.findMany({
      where: { fromStageId: stage.id, triggerCondition: { in: ['ROLE_BASED', 'SPECIFIC_USER'] } },
    });
    if (outgoingTransitions.length === 0) return [];

    const blocking: PrismaWorkflowTransition[] = [];

    for (const transition of outgoingTransitions) {
      if (transition.triggerCondition === 'ROLE_BASED' && transition.triggerRoleId) {
        const holderCount = await this.prisma.userRole.count({
          where: { roleId: transition.triggerRoleId, user: { organizationId, status: 'ACTIVE' } },
        });
        if (holderCount === 0) blocking.push(transition);
      } else if (transition.triggerCondition === 'SPECIFIC_USER' && transition.triggerUserId) {
        const user = await this.prisma.user.findFirst({
          where: { id: transition.triggerUserId, organizationId, status: 'ACTIVE' },
        });
        if (!user) blocking.push(transition);
      }
    }

    return blocking;
  }

  // Reuses notifyTenantAdminsOfCoverageGap()'s exact query shape above
  // (Role.findFirst TENANT_ADMIN → UserRole.findMany → one
  // NotificationService.create() per admin) rather than a new mechanism.
  // Public: also called from SlaMonitorProcessor's sweep on a fresh
  // false→true transition (plan Section 2.5.1).
  async notifyTenantAdminsOfUnassignedStage(
    organizationId: string,
    instance: PrismaWorkflowInstance,
    stage: PrismaWorkflowStage,
    blockingTransitions: PrismaWorkflowTransition[],
  ): Promise<void> {
    const adminRole = await this.prisma.role.findFirst({ where: { organizationId, key: 'TENANT_ADMIN' } });
    if (!adminRole) return;

    const userRoles = await this.prisma.userRole.findMany({
      where: { roleId: adminRole.id, user: { organizationId, status: 'ACTIVE' } },
    });

    // Committee's own name resolved via resolveObjectSubjectLabel() — an
    // instance/objectId alone isn't actionable for an admin deciding what
    // to fix. Previously keyed off stage.committeeId here, which is a
    // different field (COMMITTEE-assigneeStrategy pool resolution) that no
    // seeded stage ever sets — confirmed dead in practice, this resolution
    // never actually fired (ACC-34). instance.objectId is the correct key.
    const resolvedLabel = await this.resolveObjectSubjectLabel(instance, organizationId);
    const subjectLabel =
      resolvedLabel !== instance.objectType
        ? `${resolvedLabel} (${instance.objectType})`
        : `${instance.objectType} ${instance.objectId}`;
    const transitionLabels = blockingTransitions.map((t) => t.labelEn).join(', ');

    for (const userRole of userRoles) {
      await this.notificationService.create(
        {
          userId: userRole.userId,
          titleEn: 'Workflow stage unreachable — no eligible assignee',
          // Generic enough to cover both resolution paths that feed
          // `blockingTransitions` (empty/unqualified ASSIGNEE_POOL, or an
          // unheld triggerRoleId / deactivated triggerUserId) without
          // claiming a specific cause the message can't actually verify.
          bodyEn: `In "${stage.nameEn}" for ${subjectLabel}, nobody can currently trigger: ${transitionLabels}. Assign someone eligible or update the transition's trigger configuration to unblock this stage.`,
          objectType: instance.objectType,
          objectId: instance.objectId,
        },
        organizationId,
      );
    }
  }

  // Entry-time check (plan Section 2.5) — called once, right after a new
  // WorkflowInstanceStage row is created (startInstance() for the initial
  // stage, performTransition() for every subsequent one). Freshly-created
  // rows always start isUnassigned: false (schema default), so this only
  // ever performs a false→true transition — the sweep-side symmetric
  // set/clear logic lives in SlaMonitorProcessor, not here.
  private async checkAndFlagUnassignedStage(
    stage: PrismaWorkflowStage,
    instanceStageId: string,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<void> {
    const poolBlocking = await this.resolveUnassignedBlockingTransitions(stage, instance, organizationId);
    const triggerBlocking = await this.resolveUnreachableTriggerConditionTransitions(stage, organizationId);
    const blocking = [...poolBlocking, ...triggerBlocking];
    if (blocking.length === 0) return;

    await this.prisma.workflowInstanceStage.update({
      where: { id: instanceStageId },
      data: { isUnassigned: true, unassignedAt: new Date() },
    });

    await this.notifyTenantAdminsOfUnassignedStage(organizationId, instance, stage, blocking);
  }

  // Sizes the eligible-approver pool for PARALLEL/SEQUENTIAL threshold checks
  // — deliberately separate from resolveAssignee() above, which needs the
  // full instance (for SELF) and isn't meaningful for pool-sizing purposes.
  // ACC-40 Section 2.6.1 — routes its result through applyOutOfOfficeRouting()
  // before returning, same as resolveAssignee() does for resolveAssigneeRaw().
  // Fixes both of this method's callers at once: submitApproval()'s
  // eligibility gate and isApprovalThresholdMet()'s pool-sizing calculation —
  // an out-of-office approver's acting user must be able to both cast the
  // vote and count toward the threshold in their place.
  private async resolveApproverPool(
    stage: PrismaWorkflowStage,
    organizationId: string,
    instance: PrismaWorkflowInstance,
  ): Promise<string[]> {
    let rawPool: string[];
    if (stage.assigneeStrategy === 'COMMITTEE') {
      if (!stage.committeeId) return [];
      // Org-scoped read (ACC-22, closing the ACC-17 deferred gap) — same
      // fix as resolveAssigneeRaw()'s COMMITTEE case above. Same
      // assigneeCommitteeRoleValueId filter too (ACC-28) — a PARALLEL-mode
      // stage narrowed to e.g. "chairman" must size its threshold against
      // that same narrowed pool, not the full membership.
      const members = await this.prisma.committeeMember.findMany({
        where: {
          committeeId: stage.committeeId,
          organizationId,
          isActive: true,
          ...(stage.assigneeCommitteeRoleValueId
            ? { roleValueId: stage.assigneeCommitteeRoleValueId }
            : {}),
        },
      });
      rawPool = members.map((m) => m.userId);
    } else if (stage.assigneeStrategy === 'ROLE' && stage.assigneeRoleId) {
      const userRoles = await this.prisma.userRole.findMany({
        where: { roleId: stage.assigneeRoleId, user: { organizationId, status: 'ACTIVE' } },
      });
      rawPool = userRoles.map((ur) => ur.userId);
    } else if (
      stage.assigneeStrategy === 'POSITION_FIXED' &&
      stage.assigneePositionId &&
      stage.assigneeOrgUnitId
    ) {
      // ACC-54 — required for the same reason ACC-40 gave for the
      // ORG_UNIT_HEAD case directly below: this method is structurally
      // separate from resolveAssigneeRaw(), so a strategy gaining a case
      // there does NOT gain one here. Without this branch a POSITION_FIXED
      // stage fell through to the terminal `else` and returned [], which
      // silently disabled both consumers on any multi-approver stage —
      // submitApproval()'s eligibility gate (`approverPool.length > 0 &&
      // ...` skips entirely on an empty pool) and isApprovalThresholdMet()'s
      // sizing (`pool.length || Math.max(approvals.length, 1)` falls back to
      // the approval count, making ALL satisfiable by the first approver).
      //
      // Same query as resolveAssigneeRaw()'s POSITION_FIXED case, minus its
      // SINGLE-mode narrowing: this method only ever runs for multi-approver
      // stages, and a threshold must be sized against the whole eligible
      // pool rather than one arbitrarily-chosen member of it.
      const holders = await this.prisma.user.findMany({
        where: {
          organizationId,
          positionId: stage.assigneePositionId,
          primaryOrgUnitId: stage.assigneeOrgUnitId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      rawPool = holders.map((h) => h.id);
    } else if (stage.assigneeStrategy === 'ORG_UNIT_HEAD') {
      // ACC-40 Section 2.6.2 — required prerequisite this investigation
      // surfaced: without this case, submitApproval()'s eligibility gate
      // and isApprovalThresholdMet()'s pool-sizing calculation are both
      // complete no-ops for ORG_UNIT_HEAD-strategy stages, even after
      // resolveAssigneeRaw() gains its own case, since this is a
      // structurally separate method that case doesn't touch. Same
      // instance.orgUnitId defensive read as resolveAssigneeRaw()'s case —
      // degrades to an empty pool for every real caller today, for the
      // identical reason (no workflow-driven object has this field yet).
      // TODO(ACC-40): same note as resolveAssigneeRaw()'s ORG_UNIT_HEAD
      // case — replace this cast with a properly-typed field reference
      // once a real orgUnitId column exists, don't just trust the cast.
      const orgUnitId = (instance as { orgUnitId?: string | null }).orgUnitId;
      rawPool = orgUnitId
        ? await this.organizationService.resolveActingHeadForOrgUnit(orgUnitId, organizationId)
        : [];
    } else {
      // Any other assigneeStrategy on a multi-approver stage is a seed/config
      // error — there is no well-defined pool to size a threshold against.
      return [];
    }
    return this.applyOutOfOfficeRouting(rawPool, organizationId);
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

  // unassignedTaskWarnings defaults to [] — every call site except
  // performTransition() (the only one with actions to report on) is
  // unaffected (ACC-34).
  private mapInstance(
    instance: PrismaWorkflowInstance,
    unassignedTaskWarnings: string[] = [],
  ): IWorkflowInstance {
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
      unassignedTaskWarnings,
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
      delegationReason: approval.delegationReason,
      delegationContextId: approval.delegationContextId,
    };
  }
}
