import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { ITask } from '../task/interfaces/task.interface';
import { PreparedTask, StageExitCancellation, TaskService } from '../task/task.service';
import { taskStatusTitle } from '../task/task-status-label';
import { lockWorkflowInstance } from '../task/stage-deadline';
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
import { PreparedStageEntryTasks, StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowRefusalException } from './workflow-refusal';

// The client inside this.prisma.$transaction(async (tx) => …) — read off
// PrismaService, whose extended client has its own transaction type.
type EngineTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

// ACC-190 — a stage change is ONE transaction: the gate, the old entry's exit,
// its open tasks cancelled, the new entry and its tasks, the instance moved.
// Every read that can happen first does (StageTaskDefinitionService.
// prepareEntryTasks), so the transaction holds only writes and the gate. The
// limit is still raised above Prisma's 5 s default: ACC-60 measured a
// transition at 6–11 s from a Middle East client against the Frankfurt
// database, and a stage change that times out half-way would be refused whole
// rather than half-applied — the right failure, but not one to invite.
const STAGE_CHANGE_TX = { maxWait: 10_000, timeout: 20_000 } as const;

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
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly delegationLabels: DelegationLabelService,
    // ACC-101 — resolved from TenantModule, which WorkflowModule already
    // imports; no new module edge.
    private readonly objectVisibility: ObjectVisibilityService,
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
    // ACC-190 — the tasks a stage creates when a record enters it.
    private readonly stageTaskDefinitions: StageTaskDefinitionService,
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

    // ACC-190 — entering the initial stage is a stage entry like any other: its
    // task definitions become tasks. Everything readable is read first; the
    // instance, its first entry and those tasks are written together.
    const enteredAt = new Date();
    const slaDueAt = await this.computeSlaDueAt(initialStage, organizationId, enteredAt);
    const entryTasks = await this.stageTaskDefinitions.prepareEntryTasks(
      initialStage,
      { objectType: template.objectType, objectId },
      this.mapObjectTypeToTaskSourceType(template.objectType),
      enteredAt,
      organizationId,
    );

    const { instance, initialInstanceStage, createdTasks } = await this.prisma.$transaction(async (tx) => {
      const instance = await tx.workflowInstance.create({
        data: {
          organizationId,
          workflowTemplateId: template.id,
          objectType: template.objectType,
          objectId,
          status: 'IN_PROGRESS',
          currentStageId: initialStage.id,
        },
      });
      const initialInstanceStage = await tx.workflowInstanceStage.create({
        data: { workflowInstanceId: instance.id, stageId: initialStage.id, enteredAt, slaDueAt, actorId },
      });
      const createdTasks = await this.insertEntryTasks(tx, entryTasks, instance.id, initialInstanceStage.id, organizationId, actorId);
      return { instance, initialInstanceStage, createdTasks };
    }, STAGE_CHANGE_TX);

    // After commit: the notices and audit rows of the tasks just created.
    await this.announceEntryTasks(createdTasks, organizationId, actorId);

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

    return this.mapInstance(instance, entryTasks.warnings);
  }

  async getInstanceById(id: string, organizationId: string): Promise<IWorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id, organizationId } });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    return this.mapInstance(instance);
  }

  // ACC-101 — the route-facing read. An instance row names the object it
  // belongs to, so serving it to someone who cannot see that object discloses
  // the object's existence and its progress.
  //
  // The unguarded getInstanceById() above is kept for internal callers, per the
  // convention in SYSTEM-REFERENCE: an engine acting on its own behalf has no
  // viewer. Today every caller of the plain one is this method.
  async getInstanceByIdForViewer(
    id: string,
    organizationId: string,
    viewerPermissions: readonly string[],
    viewerId: string,
  ): Promise<IWorkflowInstance> {
    const instance = await this.getInstanceById(id, organizationId);
    // Read-first, so the refusal is shaped as not-found — see
    // ObjectVisibilityService.assertCanViewOrNotFound() for why.
    await this.objectVisibility.assertCanViewOrNotFound(
      instance.objectType,
      instance.objectId,
      organizationId,
      viewerPermissions,
      'Workflow instance not found',
      viewerId,
    );
    return instance;
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
    viewerPermissions: readonly string[],
    viewerId: string,
  ): Promise<IWorkflowStageHistory> {
    // Scoped by id AND organizationId together, per CLAUDE.md's query shape —
    // also the only way to learn which template to diff the visits against.
    //
    // ACC-101 — objectType/objectId are selected so the parent can be checked
    // below. This is the richest of the three reads: it names who acted at each
    // stage and resolves their delegation stamps, so it says more about a
    // committee than the committee list does.
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceId, organizationId },
      select: { id: true, workflowTemplateId: true, objectType: true, objectId: true },
    });
    if (!instance) throw new NotFoundException('Workflow instance not found');

    // Same not-found shaping as getInstanceByIdForViewer(): the instance had to
    // be read to learn its object, so a distinguishable refusal would confirm
    // that an instance with this id exists.
    await this.objectVisibility.assertCanViewOrNotFound(
      instance.objectType,
      instance.objectId,
      organizationId,
      viewerPermissions,
      'Workflow instance not found',
      viewerId,
    );

    const [visitRows, stages, transitions] = await Promise.all([
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
      // ACC-76 — the template's transitions, for naming what moved the record
      // between each pair of visits. Scoped through fromStage rather than by a
      // templateId column, which WorkflowTransition does not have.
      this.prisma.workflowTransition.findMany({
        where: { fromStage: { workflowTemplateId: instance.workflowTemplateId } },
        select: { fromStageId: true, toStageId: true, labelEn: true, labelAr: true },
      }),
    ]);

    // Keyed by from->to. A pair with MORE than one transition is recorded as
    // null rather than picking one: no seeded template has such a pair (67
    // transitions across 8 templates, all unique), but a tenant can create
    // one, and naming the wrong action in a compliance trail is worse than
    // naming none.
    const transitionByPair = new Map<string, { labelEn: string; labelAr: string | null } | null>();
    for (const transition of transitions) {
      const key = `${transition.fromStageId}->${transition.toStageId}`;
      transitionByPair.set(
        key,
        transitionByPair.has(key)
          ? null
          : { labelEn: transition.labelEn, labelAr: transition.labelAr },
      );
    }

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
      this.delegationLabels.resolveMany(visitRows, organizationId, {
        id: viewerId,
        permissions: viewerPermissions,
      }),
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
      visits: visitRows.map((visit, index) => {
        // The visit BEFORE this one supplies two things this row needs and
        // its own columns cannot: which transition brought the record here,
        // and the comment explaining why. See IWorkflowStageVisit.
        const previous = index > 0 ? visitRows[index - 1] : undefined;
        const transition = previous
          ? (transitionByPair.get(`${previous.stageId}->${visit.stageId}`) ?? null)
          : null;

        return {
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
          transitionLabelEn: transition?.labelEn ?? null,
          transitionLabelAr: transition?.labelAr ?? null,
          // The PREVIOUS visit's comment, not this row's own. A comment is
          // written at exit, so it explains the transition INTO the next
          // stage — see IWorkflowStageVisit for why showing it beside this
          // row's actor was a wrong attribution rather than a cosmetic one.
          //
          // Known consequence, accepted: a comment written when the LAST
          // visit is exited (cancelInstance() exits the open stage with
          // outcome SKIPPED) has no following row to appear on. Dropping it
          // beats showing it against the wrong event.
          comment: previous?.comment ?? null,
          isUnassigned: visit.isUnassigned,
          delegation: this.delegationLabels.lookup(visit, delegations),
        };
      }),
    };
  }

  // Plural, and returns every instance ever created for this object — one
  // object can accumulate multiple instances over time (e.g. a document's
  // periodic review cycles each start a fresh WorkflowInstance).
  //
  // ACC-101 — the parent is named in the request here, so it is checked before
  // anything is read.
  async getInstancesByObject(
    objectType: string,
    objectId: string,
    organizationId: string,
    viewerPermissions: readonly string[],
  ): Promise<IWorkflowInstance[]> {
    await this.objectVisibility.assertCanView(
      objectType,
      objectId,
      organizationId,
      viewerPermissions,
    );

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

    // ACC-190 — the gate, early: an ADVANCE this request would actually fire is
    // refused while a mandatory task of this entry is open. On a multi-approver
    // stage that is only the DECIDING vote, refused before it is recorded
    // (Ahmad, 9 Oct, J) — a vote that cannot take effect is not stored.
    // performTransition() checks again under the instance lock; that check is
    // the authoritative one.
    if (transition.kind === 'ADVANCE') {
      const fires =
        fromStage.approvalMode === 'SINGLE' ||
        !transition.isApprovalPath ||
        (await this.isApprovalThresholdMet(fromStage, currentInstanceStage, organizationId, instance, {
          approverId: actorId,
          approved: true,
        }));
      if (fires) await this.assertMandatoryTasksDone(this.prisma, currentInstanceStage.id, organizationId);
    }

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

    // ACC-190 (Ahmad, 9 Oct, J) — the approval path is gated too, and a deciding
    // vote is refused BEFORE it is recorded.
    await this.assertDecidingVoteMayAdvance(stage, instanceStage, organizationId, instance, actorId, dto.decision);

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

  // ACC-190 — the approval path's gate. Which transition this decision would
  // fire, whether it would fire NOW (the threshold, counting this vote), and,
  // if it is an ADVANCE, whether this entry's mandatory tasks are done.
  private async assertDecidingVoteMayAdvance(
    stage: PrismaWorkflowStage,
    instanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    instance: PrismaWorkflowInstance,
    actorId: string,
    decision: SubmitApprovalDto['decision'],
  ): Promise<void> {
    if (decision === 'ABSTAINED') return;
    const approved = decision === 'APPROVED' || decision === 'APPROVED_WITH_COMMENTS';
    // A return fires at once; an approval only when this vote completes the
    // threshold — asked first, so a vote that decides nothing costs no lookup.
    const fires = !approved || (await this.isApprovalThresholdMet(stage, instanceStage, organizationId, instance, { approverId: actorId, approved }));
    if (!fires) return;
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { fromStageId: stage.id, isApprovalPath: approved },
      select: { kind: true },
    });
    if (transition?.kind === 'ADVANCE') await this.assertMandatoryTasksDone(this.prisma, instanceStage.id, organizationId);
  }

  // `assumedVote` counts a vote not yet recorded, replacing any earlier one by
  // the same approver — how ACC-190 asks "would this vote decide it?".
  private async isApprovalThresholdMet(
    fromStage: PrismaWorkflowStage,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    instance: PrismaWorkflowInstance,
    assumedVote?: { approverId: string; approved: boolean },
  ): Promise<boolean> {
    const recorded = await this.prisma.workflowApproval.findMany({
      where: { workflowInstanceStageId: currentInstanceStage.id },
    });
    const approvals = assumedVote
      ? [
          ...recorded.filter((a) => a.approverId !== assumedVote.approverId),
          { approverId: assumedVote.approverId, decision: assumedVote.approved ? 'APPROVED' : 'RETURNED' },
        ]
      : recorded;
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

    // ACC-190 — every read first: the new entry's clock, who is acting for
    // whom, and the tasks the destination stage creates (a snapshot of its
    // definitions, placed and timed from `enteredAt`).
    const enteredAt = new Date();
    const slaDueAt = await this.computeSlaDueAt(toStage, organizationId, enteredAt);
    const delegationStamp = await this.resolveDelegationStamp(actorId, fromStage, instance, organizationId);
    const entryTasks = await this.stageTaskDefinitions.prepareEntryTasks(
      toStage,
      instance,
      this.mapObjectTypeToTaskSourceType(instance.objectType),
      enteredAt,
      organizationId,
    );
    const exitScope = {
      workflowInstanceId: instance.id,
      stageId: currentInstanceStage.stageId,
      workflowInstanceStageId: currentInstanceStage.id,
    };

    // ACC-190 — the stage change itself, all or nothing, under the instance's
    // row lock (the engine's first). Two people pressing at once can no longer
    // both pass the "open entry" read and close the same row twice.
    const { newInstanceStage, updatedInstance, cancellation, createdTasks } = await this.prisma.$transaction(async (tx) => {
      await lockWorkflowInstance(tx, instance.id, organizationId);
      const stillOpen = await tx.workflowInstanceStage.findFirst({
        where: { id: currentInstanceStage.id, workflowInstanceId: instance.id, exitedAt: null },
        select: { id: true },
      });
      if (!stillOpen) throw new ConflictException('This record has already moved on. Reload it and try again');

      // The gate, authoritative: under the lock, nothing can reopen a task
      // between this check and the move.
      if (transition.kind === 'ADVANCE') {
        await this.assertMandatoryTasksDone(tx, currentInstanceStage.id, organizationId);
      }

      await tx.workflowInstanceStage.update({
        where: { id: currentInstanceStage.id },
        data: { exitedAt: enteredAt, outcome, ...(comment !== undefined && { comment }) },
      });

      // ACC-68, ACC-190 — the entry just left takes its open tasks with it.
      // After an ADVANCE the gate has closed every mandatory one, so these are
      // optional (cancelled silently, Ahmad 9 Oct G); a RETURN or EXIT takes
      // the whole entry's open work. Before the new entry's tasks are created,
      // so a self-transition cancels the old ones and then creates fresh ones.
      const cancellation = await this.taskService.cancelStageExitTasksInTx(tx, exitScope, organizationId);

      const newInstanceStage = await tx.workflowInstanceStage.create({
        data: {
          workflowInstanceId: instance.id,
          stageId: toStage.id,
          enteredAt,
          slaDueAt,
          actorId,
          delegationReason: delegationStamp?.delegationReason ?? null,
          delegationContextId: delegationStamp?.delegationContextId ?? null,
        },
      });

      // The person who moved the record in is every new task's creator.
      const createdTasks = await this.insertEntryTasks(tx, entryTasks, instance.id, newInstanceStage.id, organizationId, actorId);

      const updatedInstance = await tx.workflowInstance.update({
        where: { id: instance.id },
        data: {
          currentStageId: toStage.id,
          status: toStage.isFinal ? 'COMPLETED' : 'IN_PROGRESS',
        },
      });
      return { newInstanceStage, updatedInstance, cancellation, createdTasks };
    }, STAGE_CHANGE_TX);

    // ── After commit: audit rows, notices, actions. ──
    await this.taskService.auditStageExitCancellation(cancellation, exitScope, organizationId, actorId);
    await this.announceEntryTasks(createdTasks, organizationId, actorId);

    // ACC-28 Section 2.5 — same check as startInstance(), for the stage this
    // transition just landed on.
    await this.checkAndFlagUnassignedStage(toStage, newInstanceStage.id, instance, organizationId);

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

    // ACC-34's actor-facing warnings now come from the entry's tasks: one line
    // per task created with nobody to act on it, or into an empty pool.
    return this.mapInstance(updatedInstance, entryTasks.warnings);
  }

  // ── Internal: stage entry tasks (ACC-190) ───────────────────────────────────

  // The prepared tasks of an entry, inserted inside the stage-change
  // transaction with the instance and entry they belong to.
  private async insertEntryTasks(
    tx: EngineTx,
    entryTasks: PreparedStageEntryTasks,
    workflowInstanceId: string,
    workflowInstanceStageId: string,
    organizationId: string,
    actorId: string,
  ): Promise<{ task: ITask; prepared: PreparedTask }[]> {
    const created: { task: ITask; prepared: PreparedTask }[] = [];
    for (const prepared of entryTasks.tasks) {
      const task = await this.taskService.insertPrepared(
        tx,
        { ...prepared, data: { ...prepared.data, workflowInstanceId, workflowInstanceStageId } },
        organizationId,
        actorId,
      );
      created.push({ task, prepared });
    }
    return created;
  }

  // After commit: each created task's audit row and notices.
  private async announceEntryTasks(
    created: { task: ITask; prepared: PreparedTask }[],
    organizationId: string,
    actorId: string,
  ): Promise<void> {
    for (const { task, prepared } of created) {
      await this.taskService.announceCreated(task, prepared, organizationId, actorId);
    }
  }

  // ACC-190 — THE GATE. An ADVANCE out of an entry is refused while any of the
  // entry's MANDATORY tasks is open. "Open" is ACC-65's predicate, kept
  // identical to the stage-exit cancel's: everything but COMPLETED and
  // CANCELLED, so UNASSIGNED, REJECTED and ON_HOLD all hold the step. Optional
  // tasks and manual tasks attached to the stage never do. Completing the
  // tasks never moves the record: a person still presses the transition.
  private async assertMandatoryTasksDone(
    client: Pick<EngineTx, 'task'>,
    workflowInstanceStageId: string,
    organizationId: string,
  ): Promise<void> {
    const open = await client.task.findMany({
      where: {
        organizationId,
        workflowInstanceStageId,
        isMandatory: true,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
      select: { id: true, title: true, titleAr: true, status: true },
      orderBy: { createdAt: 'asc' },
    });
    if (open.length === 0) return;
    throw new WorkflowRefusalException('STAGE_TASKS_OPEN', {
      tasks: open.map((t) => ({ ...t, statusLabel: taskStatusTitle(t.status) })),
    });
  }

  // ── Internal: transition actions ─────────────────────────────────────────────

  // Transition actions run after the stage change commits. None of them
  // creates a task any more (ACC-190 retired CREATE_TASK), so none produces
  // the actor-facing warnings — those come from the entry's tasks.
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
      let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
      switch (action.actionType) {
        case 'CREATE_TASK':
          // ACC-190 — RETIRED. A stage's task definitions create its tasks when a
          // record enters it; this action created one generic task per
          // transition. Adding one is refused (ACTION_TYPE_RETIRED) and the
          // backfill removes the seeded ones; one left over is skipped, and
          // logged so it can be found.
          this.logger.warn(`Transition ${transition.id} still has a retired CREATE_TASK action (${action.id}); skipped`);
          responseSummary = 'Retired — tasks now come from the stage task definitions (ACC-190)';
          status = 'FAILED';
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
          status,
          responseSummary,
        },
      });
    }
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
    // minApprovals needs no snapshot — it is answerable from data the engine
    // already owns.
    //
    // ACC-190 — allPreviousStageTasksComplete (ACC-65) is RETIRED: the stage's
    // mandatory tasks hold every ADVANCE without opting in, on the approval
    // path too, which this validator never reached. Saving it is refused
    // (VALIDATOR_RETIRED); one left in stored config is ignored, and said so.
    if ((config as Record<string, unknown>)['allPreviousStageTasksComplete'] !== undefined) {
      this.logger.warn(`Transition ${transition.id} still carries the retired allPreviousStageTasksComplete validator; ignored`);
    }
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

  // Entry-time check (plan Section 2.5) — called once, right after a new
  // WorkflowInstanceStage row is created (startInstance() for the initial
  // stage, performTransition() for every subsequent one). Freshly-created
  // rows always start isUnassigned: false (schema default), so this only
  // ever performs a false→true transition — the sweep-side symmetric
  // set/clear logic lives in SlaMonitorProcessor, not here.
  //
  // ACC-82 — sets the flag and notifies no one. The "Workflow stage
  // unreachable — no eligible assignee" admin notification was removed: an
  // unreachable stage is a Setup health condition (STAGE_WITHOUT_ASSIGNEE),
  // reported once per template stage rather than once per instance entering
  // it (SYSTEM-REFERENCE §13.7).
  private async checkAndFlagUnassignedStage(
    stage: PrismaWorkflowStage,
    instanceStageId: string,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<void> {
    const poolBlocking = await this.resolveUnassignedBlockingTransitions(stage, instance, organizationId);
    const triggerBlocking = await this.resolveUnreachableTriggerConditionTransitions(stage, organizationId);
    if (poolBlocking.length === 0 && triggerBlocking.length === 0) return;

    await this.prisma.workflowInstanceStage.update({
      where: { id: instanceStageId },
      data: { isUnassigned: true, unassignedAt: new Date() },
    });
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

  // ACC-190 — counted from the entry's own `enteredAt`, the same instant its
  // tasks' SLA starts, so the stage deadline and the task due dates share one
  // clock (the stage-deadline rule compares them in working hours from here).
  private async computeSlaDueAt(
    stage: PrismaWorkflowStage,
    organizationId: string,
    from: Date,
  ): Promise<Date | null> {
    if (!stage.slaWorkingHours) return null;
    const deadline = await this.workingCalendar.calculateDeadline(
      DateTime.fromJSDate(from),
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
