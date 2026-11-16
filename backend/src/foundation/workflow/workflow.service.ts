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
import {
  WorkflowInstance as PrismaWorkflowInstance,
  WorkflowInstanceStage as PrismaWorkflowInstanceStage,
  WorkflowStage as PrismaWorkflowStage,
  WorkflowTemplate as PrismaWorkflowTemplate,
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
import { isVotingMove, stageExitOutcome, votesFor } from './workflow-vote';
import { assertTransitionPreconditions, hasTransitionPrecondition } from './transition-preconditions';
import { StagePool, StagePoolRequest, StagePoolService, mayActInStagePool } from './stage-pool.service';
import { INSTANCE_NOT_FOUND, InstanceAccess } from './instance-access';
import type { IWorkflowMoves } from './interfaces/workflow-instance.interface';
import { APP_MOVER_WHERE, transitionMover } from './workflow-pool';

// The client inside this.prisma.$transaction(async (tx) => …) — read off
// PrismaService, whose extended client has its own transaction type.
export type EngineTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/** ACC-239 — startInstance()'s reads, done before any transaction. */
export interface PreparedInstanceStart {
  template: PrismaWorkflowTemplate;
  initialStage: PrismaWorkflowStage;
  enteredAt: Date;
  slaDueAt: Date | null;
  entryTasks: PreparedStageEntryTasks;
  quorumCount: number | null;
}

/** ACC-239 — what insertInstanceStartInTx() wrote. */
export interface StartedInstance {
  instance: PrismaWorkflowInstance;
  initialInstanceStage: PrismaWorkflowInstanceStage;
  createdTasks: { task: ITask; prepared: PreparedTask }[];
}

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
// NOTE on multi-approver routing (ACC-284): on a stage decided together (ALL or
// COMMITTEE_VOTE) the move's KIND (ACC-190) says what a press is — a vote for
// that move, or an act at once (workflow-vote.ts). Each vote records its move,
// and a move goes through when its own threshold is met. The old
// WorkflowTransition.isApprovalPath is no longer read; it is dropped later.
//
// ACC-271 PR 6a — who works a stage, who may move a record out of it and how
// its votes decide come from the stage's pool and who mode only
// (StagePoolService). The old approval, assignee and trigger branches are
// gone; a stage with no `who` has an empty pool and is refused.
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
    @InjectQueue('workflow-actions') private readonly workflowActionsQueue: Queue,
    // ACC-190 — the tasks a stage creates when a record enters it.
    private readonly stageTaskDefinitions: StageTaskDefinitionService,
    // ACC-271 — who works a converted stage (its assignee entries).
    private readonly stagePool: StagePoolService,
  ) {
    this.access = new InstanceAccess(objectVisibility, stagePool);
  }

  // ACC-282 — who may read a record's workflow and who may act on it: the ONE
  // place that rule lives (instance-access.ts). Built from the two services above,
  // so it needs no wiring of its own.
  private readonly access: InstanceAccess;

  // ── Instance lifecycle ───────────────────────────────────────────────────────

  async startInstance(
    objectType: string,
    objectId: string,
    organizationId: string,
    actorId: string,
    templateId?: string,
  ): Promise<IWorkflowInstance> {
    const prepared = await this.prepareInstanceStart(objectType, objectId, organizationId, templateId);
    const started = await this.prisma.$transaction(
      (tx) => this.insertInstanceStartInTx(tx, prepared, objectId, organizationId, actorId),
      STAGE_CHANGE_TX,
    );
    return this.finishInstanceStart(prepared, started, organizationId, actorId);
  }

  /**
   * ACC-239 — startInstance() in three parts, so a module can write its record
   * AND the record's workflow instance in ONE transaction of its own (the
   * committee change request takes the committee's row lock, checks for an open
   * request, and writes both). Every read happens here, before any transaction.
   */
  async prepareInstanceStart(
    objectType: string,
    objectId: string,
    organizationId: string,
    templateId?: string,
  ): Promise<PreparedInstanceStart> {
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
    const quorumCount = await this.quorumSnapshot(initialStage, organizationId, { objectType: template.objectType, objectId });
    return { template, initialStage, enteredAt, slaDueAt, entryTasks, quorumCount };
  }

  /** The instance, its first entry and that entry's tasks, on the caller's transaction. */
  async insertInstanceStartInTx(
    tx: EngineTx,
    prepared: PreparedInstanceStart,
    objectId: string,
    organizationId: string,
    actorId: string,
  ): Promise<StartedInstance> {
    const { template, initialStage, enteredAt, slaDueAt, entryTasks, quorumCount } = prepared;
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
      data: { workflowInstanceId: instance.id, stageId: initialStage.id, enteredAt, slaDueAt, actorId, quorumCount },
    });
    const createdTasks = await this.insertEntryTasks(tx, entryTasks, instance.id, initialInstanceStage.id, organizationId, actorId);
    return { instance, initialInstanceStage, createdTasks };
  }

  /**
   * After commit: notices, flags and the audit row. `notifyInitialAssignee`
   * false is for a record whose module tells the people concerned itself (the
   * committee change request): the generic "New workflow assignment" notice
   * would tell a requester about their own draft.
   */
  async finishInstanceStart(
    prepared: PreparedInstanceStart,
    started: StartedInstance,
    organizationId: string,
    actorId: string,
    options: { notifyInitialAssignee?: boolean } = {},
  ): Promise<IWorkflowInstance> {
    const { initialStage, entryTasks } = prepared;
    const { instance, initialInstanceStage, createdTasks } = started;

    // After commit: the notices and audit rows of the tasks just created.
    await this.announceEntryTasks(createdTasks, organizationId, actorId);

    // No WorkflowTransitionAction fires on stage entry (actions fire on
    // transitions, per the seed data design) — so the initial stage's
    // assignee is notified directly here, the one place nothing else would.
    if (options.notifyInitialAssignee !== false) {
      await this.resolveAndNotifyInitialAssignee(initialStage, instance, organizationId);
    }

    // ACC-28 Section 2.5 — flag the entry unassigned if nobody can work the
    // stage: its pool is empty (ACC-271), e.g. a vacant Chairman seat.
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
    // ObjectVisibilityService.assertCanViewOrNotFound() for why. ACC-282: whoever
    // may open the record may read its workflow (InstanceAccess).
    await this.access.assertMayReadInstance(instance, organizationId, { id: viewerId, permissions: viewerPermissions });
    return instance;
  }

  /**
   * ACC-271 PR 2 — which moves out of the record's current stage this viewer
   * may press: what the record page's buttons show, so no screen keeps its own
   * copy of the rule. Behind the same visibility check as the instance read
   * (the identical 404 for a hidden record).
   *
   * The stage answers from its pool: a person's moves for whoever works it
   * (out-of-office aware), nothing for anyone else and nothing at all while the
   * pool is empty, as it is for a stage with no `who` (PR 6a). Pressing is still
   * decided by triggerTransition(); this only stops a screen offering what the
   * server would refuse. At most the moves of one stage, one pool resolution.
   */
  async getMovesForViewer(
    id: string,
    organizationId: string,
    viewerPermissions: readonly string[],
    viewerId: string,
  ): Promise<IWorkflowMoves> {
    const none: IWorkflowMoves = { transitionIds: [], moves: [] };
    const instance = await this.getInstanceByIdForViewer(id, organizationId, viewerPermissions, viewerId);
    if (!instance.currentStageId) return none;
    const [stage, transitions] = await Promise.all([
      this.prisma.workflowStage.findFirst({
        where: { id: instance.currentStageId, workflowTemplate: { organizationId } },
        select: { id: true, whoMode: true },
      }),
      // ACC-282 — each move carries what its button shows (label, kind) and the
      // stage it leads to, so no screen reads the whole template for them.
      this.prisma.workflowTransition.findMany({
        where: { fromStageId: instance.currentStageId, fromStage: { workflowTemplate: { organizationId } } },
        select: {
          id: true,
          mover: true,
          labelEn: true,
          labelAr: true,
          kind: true,
          toStageId: true,
          toStage: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    if (!stage) return none;
    // PR 6a — no permission branch: a stage with no `who` has an empty pool, so nothing.
    const byPerson = transitions.filter((t) => transitionMover(t) === 'PERSON');
    if (byPerson.length === 0) return none;
    // ACC-282 — moves stay pool-only: anyone else who may open the record gets none.
    const pool = await this.access.poolOf(organizationId, stage.id, instance);
    if (!this.access.mayAct(pool, viewerId)) return none;
    return {
      transitionIds: byPerson.map((t) => t.id),
      moves: byPerson.map((t) => ({
        id: t.id,
        labelEn: t.labelEn,
        labelAr: t.labelAr,
        kind: t.kind,
        toStageId: t.toStageId,
        toStageNameEn: t.toStage.nameEn,
        toStageNameAr: t.toStage.nameAr,
      })),
    };
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
    // that an instance with this id exists. ACC-282: open to whoever may open the
    // record (Ahmad, 8 Nov), like the instance itself.
    await this.access.assertMayReadInstance(instance, organizationId, { id: viewerId, permissions: viewerPermissions });

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
          // ACC-202 — the previous visit's outcome, for the same reason as the
          // comment: it describes the move INTO this visit.
          arrivedBy: previous?.outcome === 'RETURNED' || previous?.outcome === 'EXITED' ? previous.outcome : null,
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
    viewerId?: string,
  ): Promise<IWorkflowInstance[]> {
    // ACC-282 — whoever may open the record may read its workflow (InstanceAccess);
    // the route no longer needs workflows:view. Without a viewer, the parent check
    // is permission-only (ACC-281's fail-closed default).
    await this.access.assertMayReadRecord(objectType, objectId, organizationId, { id: viewerId ?? '', permissions: viewerPermissions });

    const instances = await this.prisma.workflowInstance.findMany({
      where: { organizationId, objectType: objectType as WorkflowObjectType, objectId },
      orderBy: { createdAt: 'desc' },
    });
    return instances.map((i) => this.mapInstance(i));
  }

  // Administrative force-cancel — bypasses the stage's pool and validatorConfig
  // entirely and sets status = CANCELLED regardless of the
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

    // ACC-282 — every by-id read names the organisation in the same where clause.
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: dto.transitionId, fromStageId: instance.currentStageId, fromStage: { workflowTemplate: { organizationId } } },
    });
    if (!transition) {
      throw new NotFoundException("This transition is not available from the instance's current stage");
    }

    const fromStage = await this.prisma.workflowStage.findFirst({
      where: { id: transition.fromStageId, workflowTemplate: { organizationId } },
    });
    if (!fromStage) throw new NotFoundException('Current stage not found');

    // ACC-271 — the stage says who may move the record out of it: its pool
    // (decision 1). PR 6a removed the old branch for a stage with no `who`:
    // StagePoolService gives such a stage an EMPTY pool (fail closed), so it is
    // refused STAGE_HAS_NO_ONE. PR 6b — the move's mover is read alone: APP is
    // the module's own, and a move with none (none exist) is made by nobody.
    const mover = transitionMover(transition);
    if (mover === null) {
      throw new WorkflowRefusalException('MOVE_HAS_NO_MOVER', { stageNameEn: fromStage.nameEn, stageNameAr: fromStage.nameAr });
    }
    if (mover !== 'PERSON') {
      throw new ForbiddenException('This transition can only be fired by a system process');
    }
    // ACC-282 — may open the record (the identical 404 otherwise), then in the pool.
    const pool = await this.access.assertMayAct(instance, fromStage, organizationId, { id: actorId, permissions: userPermissions });

    const currentInstanceStage = await this.prisma.workflowInstanceStage.findFirst({
      where: { workflowInstanceId: instanceId, stageId: fromStage.id, exitedAt: null },
    });
    if (!currentInstanceStage) {
      throw new ConflictException('No active stage entry found for this instance');
    }

    await this.checkValidatorConfig(transition, currentInstanceStage, organizationId);

    // ACC-284 — what this press is: on a stage decided together, a vote for this
    // move (ADVANCE; EXIT on a committee vote), else an act at once.
    const isVote = isVotingMove(fromStage.whoMode, transition.kind);

    // ACC-190 — the gate, early: an ADVANCE this request would actually fire is
    // refused while a mandatory task of this entry is open. On a multi-approver
    // stage that is only the DECIDING vote, refused before it is recorded
    // (Ahmad, 9 Oct, J) — a vote that cannot take effect is not stored.
    // performTransition() checks again under the instance lock; that check is
    // the authoritative one.
    if (transition.kind === 'ADVANCE') {
      const fires =
        !isVote ||
        (await this.isApprovalThresholdMet(
          fromStage,
          currentInstanceStage,
          organizationId,
          instance,
          transition,
          { approverId: actorId, approved: true },
          pool,
        ));
      if (fires) await this.assertMandatoryTasksDone(this.prisma, currentInstanceStage.id, organizationId);
      // ACC-238 — the record's own preconditions (a committee's quorum), early
      // for the same reason; checked again under the lock.
      if (fires) await this.assertPreconditions(this.prisma, instance, fromStage, transition, organizationId);
    }

    if (this.decidesAlone(fromStage)) {
      return this.performTransition(instance, currentInstanceStage, transition, organizationId, actorId, dto.comment, fromStage, { pool });
    }

    // Multi-approver stage: naming a specific transitionId is itself the press.
    // ACC-284 — a voting move is an APPROVED vote FOR THAT MOVE; any other
    // (RETURN; EXIT on "All of them") is recorded RETURNED and acts at once.
    const decision = isVote ? 'APPROVED' : 'RETURNED';

    // ACC-40 Section 2.6.3 — stamped on both branches (create AND update)
    // so a re-vote by the same actor always reflects their CURRENT
    // delegation status, never a stale first-vote snapshot.
    const delegationStamp = await this.resolveDelegationStamp(actorId, fromStage, instance, organizationId, pool);

    // ACC-284 — the vote names its move; pressing another replaces it, and the
    // replacement is audited with the old move and the new one (recordVote()).
    await this.recordVote(organizationId, actorId, currentInstanceStage.id, decision, transition, dto.comment, delegationStamp);

    if (!isVote) {
      // RETURN, and EXIT on "All of them", fire immediately — no threshold
      // required to send something back or end it: the stage halts at once,
      // whoever works it.
      return this.performTransition(instance, currentInstanceStage, transition, organizationId, actorId, dto.comment, fromStage, { pool });
    }

    // ACC-284 — this move's own threshold: votes for other moves never count for it.
    const satisfied = await this.isApprovalThresholdMet(fromStage, currentInstanceStage, organizationId, instance, transition, undefined, pool);
    if (!satisfied) {
      // Threshold not yet met — the vote is recorded, the instance unchanged.
      return this.mapInstance(instance);
    }

    return this.performTransition(instance, currentInstanceStage, transition, organizationId, actorId, dto.comment, fromStage, { pool });
  }

  async submitApproval(
    instanceStageId: string,
    dto: SubmitApprovalDto,
    organizationId: string,
    actorId: string,
    // ACC-282 — the parent check needs the voter's permissions.
    actorPermissions: readonly string[],
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

    // ACC-282 — every by-id read names the organisation in the same where clause.
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id: instanceStage.stageId, workflowTemplate: { organizationId } },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');

    // The stage's pool is resolved for this record, so the instance is read
    // here (triggerTransition() already has it loaded).
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { id: instanceStage.workflowInstanceId, organizationId },
    });
    if (!instance) throw new NotFoundException(INSTANCE_NOT_FOUND);

    // ACC-271 — the stage's pool decides who may vote, and an EMPTY pool refuses
    // everyone (plan gap 3). ACC-282: the voter must also be able to open the
    // record, with the identical 404 otherwise, checked first (InstanceAccess).
    const pool = await this.access.assertMayAct(instance, stage, organizationId, { id: actorId, permissions: actorPermissions });

    // ACC-284 — the decision's move, by kind: an approval votes for the stage's
    // ADVANCE, a return acts along its RETURN; exactly one, else a 409.
    const move = await this.voteMoveFor(stage, dto.decision);

    // ACC-190 (Ahmad, 9 Oct, J) — the approval path is gated too, and a deciding
    // vote is refused BEFORE it is recorded.
    await this.assertDecidingVoteMayAdvance(stage, instanceStage, organizationId, instance, actorId, dto.decision, move, pool);

    // ACC-40 Section 2.6.3 — stamped on both branches, same reasoning as
    // triggerTransition()'s own upsert: a re-submitted approval always
    // reflects the actor's CURRENT delegation status.
    const delegationStamp = await this.resolveDelegationStamp(actorId, stage, instance, organizationId, pool);

    // ACC-284 — one way to record a vote, audited with its move before and after.
    const approval = await this.recordVote(organizationId, actorId, instanceStageId, dto.decision, move, dto.comment, delegationStamp);

    await this.maybeAdvanceAfterApproval(stage, instanceStage, organizationId, actorId, dto, instance, move, pool);

    return this.mapApproval(approval);
  }

  /**
   * ACC-284 — records a member's vote in a stage entry, and audits it.
   *
   * One vote per member per entry (the upsert on entry + member): pressing again
   * REPLACES it. The audit row says what changed, with who (the actor) and when
   * (its createdAt):
   *   - a first vote: CREATE, after = the decision and the move;
   *   - a vote whose move or decision changed: UPDATE, before = the OLD move and
   *     decision, after = the NEW ones (each move by id and both labels);
   *   - the same move and decision pressed again: no row (nothing changed).
   * One indexed read of the member's current vote first, inside this press only.
   */
  private async recordVote(
    organizationId: string,
    actorId: string,
    workflowInstanceStageId: string,
    decision: PrismaWorkflowApproval['decision'],
    move: Pick<PrismaWorkflowTransition, 'id' | 'labelEn' | 'labelAr'> | null,
    comment: string | undefined,
    delegationStamp: Awaited<ReturnType<WorkflowService['resolveDelegationStamp']>>,
  ): Promise<PrismaWorkflowApproval> {
    const key = { workflowInstanceStageId_approverId: { workflowInstanceStageId, approverId: actorId } };
    const previous = await this.prisma.workflowApproval.findUnique({
      where: key,
      select: { decision: true, transitionId: true, transition: { select: { id: true, labelEn: true, labelAr: true } } },
    });
    const fields = {
      decision,
      transitionId: move?.id ?? null,
      comment: comment ?? null,
      decidedAt: new Date(),
      delegationReason: delegationStamp?.delegationReason ?? null,
      delegationContextId: delegationStamp?.delegationContextId ?? null,
    };
    const approval = await this.prisma.workflowApproval.upsert({
      where: key,
      update: fields,
      create: { workflowInstanceStageId, approverId: actorId, ...fields },
    });

    const named = (m: Pick<PrismaWorkflowTransition, 'id' | 'labelEn' | 'labelAr'> | null) =>
      m ? { id: m.id, labelEn: m.labelEn, labelAr: m.labelAr } : null;
    const after = { decision, move: named(move) };
    if (!previous) {
      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'CREATE',
        objectType: 'WorkflowApproval',
        objectId: approval.id,
        after,
        metadata: { workflowInstanceStageId },
      });
    } else if (previous.decision !== decision || (previous.transitionId ?? null) !== (move?.id ?? null)) {
      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'UPDATE',
        objectType: 'WorkflowApproval',
        objectId: approval.id,
        before: { decision: previous.decision, move: named(previous.transition) },
        after,
        metadata: { workflowInstanceStageId, replaced: true },
      });
    }
    return approval;
  }

  // ── Internal: shared advance logic ───────────────────────────────────────────

  private async maybeAdvanceAfterApproval(
    stage: PrismaWorkflowStage,
    instanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    actorId: string,
    dto: SubmitApprovalDto,
    // Caller-supplied (submitApproval() already fetched it), rather than this
    // method re-fetching the same row a second time in the same request.
    instance: PrismaWorkflowInstance,
    // ACC-284 — the decision's move (voteMoveFor()); null for ABSTAINED.
    move: PrismaWorkflowTransition | null,
    // ACC-271 — a converted stage's pool, already resolved by the caller.
    pool?: StagePool,
  ): Promise<void> {
    // ABSTAINED never auto-routes — per module-designs.md, majority-abstained
    // requires Quality Officer escalation, not automatic advancement.
    if (dto.decision === 'ABSTAINED' || !move) return;

    const isApprovalDecision = dto.decision === 'APPROVED' || dto.decision === 'APPROVED_WITH_COMMENTS';

    if (!isApprovalDecision) {
      await this.performTransition(instance, instanceStage, move, organizationId, actorId, dto.comment, stage, { pool });
      return;
    }

    const satisfied = await this.isApprovalThresholdMet(stage, instanceStage, organizationId, instance, move, undefined, pool);
    if (!satisfied) return;
    await this.performTransition(instance, instanceStage, move, organizationId, actorId, dto.comment, stage, { pool });
  }

  /**
   * ACC-284 — the move a recorded decision is about, by KIND: an approval votes for
   * the stage's ADVANCE, a return acts along its RETURN. Exactly one, else 409
   * VOTE_MOVE_AMBIGUOUS naming the stage (a person presses the move itself instead).
   * ABSTAINED is about no move.
   */
  private async voteMoveFor(stage: PrismaWorkflowStage, decision: SubmitApprovalDto['decision']): Promise<PrismaWorkflowTransition | null> {
    if (decision === 'ABSTAINED') return null;
    const kind = decision === 'APPROVED' || decision === 'APPROVED_WITH_COMMENTS' ? 'ADVANCE' : 'RETURN';
    const moves = await this.prisma.workflowTransition.findMany({ where: { fromStageId: stage.id, kind }, take: 2 });
    if (moves.length !== 1) {
      throw new WorkflowRefusalException('VOTE_MOVE_AMBIGUOUS', { stageNameEn: stage.nameEn, stageNameAr: stage.nameAr });
    }
    return moves[0]!;
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
    // ACC-284 — the decision's move (voteMoveFor()); null for ABSTAINED.
    move: PrismaWorkflowTransition | null,
    pool?: StagePool,
  ): Promise<void> {
    if (decision === 'ABSTAINED' || !move) return;
    const approved = decision === 'APPROVED' || decision === 'APPROVED_WITH_COMMENTS';
    // A return fires at once; an approval only when this vote completes the
    // move's threshold.
    const fires =
      !approved ||
      (await this.isApprovalThresholdMet(stage, instanceStage, organizationId, instance, move, { approverId: actorId, approved }, pool));
    if (!fires) return;
    if (move.kind === 'ADVANCE') {
      await this.assertMandatoryTasksDone(this.prisma, instanceStage.id, organizationId);
      await this.assertPreconditions(this.prisma, instance, stage, move, organizationId);
    }
  }

  /**
   * ACC-239 — the move a MODULE makes on its own record: along the app's move
   * (mover APP) from the record's current stage to the stage keyed
   * `toStageKey`. A person never fires these through the generic endpoint
   * (triggerTransition() refuses a move whose mover is not PERSON); the
   * module's own endpoint has already checked who may act.
   *
   * `inTx` is the engine's first caller-supplied write: it runs INSIDE the
   * stage-change transaction, under the instance's row lock, after the "still
   * open" check and the gate and before the move is written, so the module's
   * write and the stage move commit together or not at all. ACC-64 still
   * holds: the engine emits nothing of its own; the module decides what to
   * write, the engine only lends the transaction. Only the app's moves
   * (mover APP) accept it.
   */
  async triggerSystemTransition(
    instanceId: string,
    toStageKey: string,
    organizationId: string,
    actorId: string,
    // ACC-202 — no outcome option: the stage is left with the move's kind's outcome.
    options: { comment?: string; inTx?: (tx: EngineTx) => Promise<void> } = {},
  ): Promise<IWorkflowInstance> {
    const instance = await this.prisma.workflowInstance.findFirst({ where: { id: instanceId, organizationId } });
    if (!instance) throw new NotFoundException('Workflow instance not found');
    if (!instance.currentStageId) throw new ConflictException('Workflow instance has no current stage');

    // ACC-271 — the move the app runs: mover APP (PR 6b: nothing else).
    const transition = await this.prisma.workflowTransition.findFirst({
      where: {
        fromStageId: instance.currentStageId,
        toStage: { key: toStageKey, workflowTemplateId: instance.workflowTemplateId },
        ...APP_MOVER_WHERE,
      },
    });
    if (!transition) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'TRANSITION_NOT_AVAILABLE',
        message: "This record can't make that move from the stage it is in now. Reload it and try again.",
      });
    }
    const fromStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.fromStageId } });
    if (!fromStage) throw new NotFoundException('Current stage not found');
    const currentInstanceStage = await this.prisma.workflowInstanceStage.findFirst({
      where: { workflowInstanceId: instance.id, stageId: instance.currentStageId, exitedAt: null },
      orderBy: { enteredAt: 'desc' },
    });
    if (!currentInstanceStage) throw new ConflictException('No active stage entry found for this instance');

    return this.performTransition(instance, currentInstanceStage, transition, organizationId, actorId, options.comment, fromStage, {
      inTx: options.inTx,
    });
  }

  // `assumedVote` counts a vote not yet recorded, replacing any earlier one by
  // the same approver — how ACC-190 asks "would this vote decide it?".
  // ACC-284 — the threshold of ONE move. Votes count per move: a vote for another
  // move never counts for this one (a committee vote's quorum still counts every
  // vote cast). A vote cast before ACC-284 names no move and counts for the
  // stage's ADVANCE moves, as it did (votesFor()).
  private async isApprovalThresholdMet(
    fromStage: PrismaWorkflowStage,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    organizationId: string,
    instance: PrismaWorkflowInstance,
    move: Pick<PrismaWorkflowTransition, 'id' | 'kind'>,
    assumedVote?: { approverId: string; approved: boolean },
    // ACC-271 — a converted stage's pool, when the caller already has it.
    pool?: StagePool,
  ): Promise<boolean> {
    const recorded = await this.prisma.workflowApproval.findMany({
      where: { workflowInstanceStageId: currentInstanceStage.id },
      select: { approverId: true, decision: true, transitionId: true },
    });
    const approvals = assumedVote
      ? [
          ...recorded.filter((a) => a.approverId !== assumedVote.approverId),
          {
            approverId: assumedVote.approverId,
            decision: assumedVote.approved ? ('APPROVED' as const) : ('RETURNED' as const),
            transitionId: move.id,
          },
        ]
      : recorded;
    const forMove = approvals.filter((a) => votesFor(a, move));
    const approvedCount = forMove.length;

    // ACC-271 — the stage decides by its who mode (plan §4.3). PR 6a removed
    // the old approval-mode branch.
    const stagePool = pool ?? (await this.stagePool.resolve(organizationId, fromStage.id, instance));
    if (fromStage.whoMode === 'ANY_ONE') return approvedCount >= 1;
    if (fromStage.whoMode === 'COMMITTEE_VOTE') {
      // The committee's own quorum and majority. A stage whose committee
      // resolves to none decides nothing (plan gap 5). The quorum is the one
      // saved when this entry began (ACC-239), so a quorum changed while the
      // vote is open does not move it; an entry with none saved reads it live.
      // The committee read is org-scoped (ACC-22).
      const committeeId = stagePool.voteCommitteeId;
      if (!committeeId) return false;
      const quorum =
        currentInstanceStage.quorumCount ??
        (await this.prisma.committee.findFirst({ where: { id: committeeId, organizationId } }))?.quorumCount ??
        null;
      if (quorum === null || approvals.length < quorum) return false;
      return approvedCount > approvals.length / 2;
    }
    // ALL: every CURRENT member of the pool has approved — someone who left is
    // no longer waited for, and their earlier approval harms nothing (Q6). An
    // acting user's place is filled by their own approval or by the approval of
    // the absent member they stand in for. An empty pool decides nothing (gap
    // 3), and so does a stage with no `who` (PR 6a: its pool is empty).
    if (stagePool.members.length === 0) return false;
    const approvedBy = new Set(forMove.map((a) => a.approverId));
    return stagePool.members.every((member) => {
      const covered = stagePool.coveringFor.get(member);
      return approvedBy.has(member) || (covered !== undefined && approvedBy.has(covered));
    });
  }

  private async performTransition(
    instance: PrismaWorkflowInstance,
    currentInstanceStage: PrismaWorkflowInstanceStage,
    transition: PrismaWorkflowTransition,
    organizationId: string,
    actorId: string,
    comment: string | undefined,
    // ACC-40 Section 2.6.3 — the stage actorId was resolved eligible
    // against (not toStage) — every caller already has this in scope
    // (triggerTransition()'s own fromStage local, or
    // maybeAdvanceAfterApproval()'s own stage parameter), so it's threaded
    // through rather than re-derived here.
    fromStage: PrismaWorkflowStage,
    // ACC-239 — a module's write, inside this transaction (triggerSystemTransition()).
    // ACC-271 — `pool`: the from-stage's pool, when the caller resolved it.
    hook: { inTx?: (tx: EngineTx) => Promise<void>; pool?: StagePool } = {},
  ): Promise<IWorkflowInstance> {
    const toStage = await this.prisma.workflowStage.findFirst({ where: { id: transition.toStageId } });
    if (!toStage) throw new NotFoundException('Target stage not found');

    // ACC-190 — every read first: the new entry's clock, who is acting for
    // whom, and the tasks the destination stage creates (a snapshot of its
    // definitions, placed and timed from `enteredAt`).
    const enteredAt = new Date();
    const slaDueAt = await this.computeSlaDueAt(toStage, organizationId, enteredAt);
    const delegationStamp = await this.resolveDelegationStamp(actorId, fromStage, instance, organizationId, hook.pool);
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
    // ACC-239 — the quorum a committee-approval stage's vote will count against.
    const quorumCount = await this.quorumSnapshot(toStage, organizationId, instance);

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
      // ACC-238 — the record's own preconditions, authoritative: the record is
      // read FOR SHARE inside this transaction, so an edit cannot slip between
      // the check and the move.
      await this.assertPreconditions(tx, instance, fromStage, transition, organizationId, toStage);

      // ACC-239 — the module's own write, under this same lock and transaction.
      if (hook.inTx) {
        // ACC-271 — the move the app runs (mover APP; PR 6b: nothing else).
        if (transitionMover(transition) !== 'APP') {
          throw new Error('Only a move the app runs (mover APP) takes a write of its own');
        }
        await hook.inTx(tx);
      }

      // ACC-202 — left with the outcome of the move's kind, whoever made it.
      await tx.workflowInstanceStage.update({
        where: { id: currentInstanceStage.id },
        data: { exitedAt: enteredAt, outcome: stageExitOutcome(transition.kind), ...(comment !== undefined && { comment }) },
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
          quorumCount,
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
    // ACC-271 PR 4 — whoever was still on a task this move closed is told, now
    // that it has committed (a move that rolled back never gets here).
    await this.taskService.noticeStageExitClosures(cancellation, organizationId, actorId, {
      kind: transition.kind,
      record: { objectType: instance.objectType, objectId: instance.objectId },
      toStage: { nameEn: toStage.nameEn, nameAr: toStage.nameAr },
      transition: { labelEn: transition.labelEn, labelAr: transition.labelAr },
    });
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

  /**
   * ACC-239 — the quorum to save on an entry into a committee-approval stage:
   * the stage's committee's quorum now. Null for any other stage. Read before
   * the transaction, with every other read, scoped by organisation.
   */
  //
  // ACC-271 — a Committee vote's committee: the stage's COMMITTEE entry's own,
  // or the record's. PR 6a removed the old approval-mode branch.
  private async quorumSnapshot(
    stage: PrismaWorkflowStage,
    organizationId: string,
    record: Pick<StagePoolRequest['instance'], 'objectType' | 'objectId'>,
  ): Promise<number | null> {
    const committeeId =
      stage.whoMode === 'COMMITTEE_VOTE' ? await this.stagePool.voteCommitteeId(organizationId, stage.id, record) : null;
    if (!committeeId) return null;
    const committee = await this.prisma.committee.findFirst({
      where: { id: committeeId, organizationId },
      select: { quorumCount: true },
    });
    return committee?.quorumCount ?? null;
  }

  // ACC-238 — TRANSITION_PRECONDITIONS for this record's kind (a committee
  // needs a quorum to leave Formation). Fails open: a kind with no entry has
  // none. Read the precondition registry, not this method, for the rules.
  //
  // ACC-286 — the precondition also reads both stages' flags (going live). The
  // early callers load the destination's flags here; performTransition() passes
  // the stage it has already read. Only a kind with a precondition pays the read.
  private async assertPreconditions(
    client: Pick<EngineTx, '$queryRaw'>,
    instance: PrismaWorkflowInstance,
    fromStage: PrismaWorkflowStage,
    transition: Pick<PrismaWorkflowTransition, 'kind' | 'toStageId'>,
    organizationId: string,
    toStage?: Pick<PrismaWorkflowStage, 'flags'>,
  ): Promise<void> {
    if (!hasTransitionPrecondition(instance.objectType)) return;
    const toStageFlags =
      toStage?.flags ??
      (
        await this.prisma.workflowStage.findFirst({
          where: { id: transition.toStageId, workflowTemplateId: fromStage.workflowTemplateId },
          select: { flags: true },
        })
      )?.flags ??
      [];
    await assertTransitionPreconditions(client, instance.objectType, {
      objectId: instance.objectId,
      organizationId,
      fromStageKey: fromStage.key,
      fromStageFlags: fromStage.flags,
      toStageFlags,
      kind: transition.kind,
    });
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
      select: {
        id: true,
        title: true,
        titleAr: true,
        status: true,
        // ACC-208 (B7) — what the "Can't move yet" dialog names beside each
        // task: who has it (or the pool it waits in), when it is due, and
        // whether it needs evidence. The person pressing the transition can
        // already see these tasks on the record.
        dueAt: true,
        requiresEvidence: true,
        assignees: {
          where: { removedAt: null },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { assignedAt: 'asc' },
        },
        assignedOrgUnit: { select: { nameEn: true, nameAr: true } },
        assignedPosition: { select: { nameEn: true, nameAr: true } },
        assignedCommittee: { select: { nameEn: true, nameAr: true } },
        assignedCommitteeRoleValue: {
          select: { labelEn: true, labelAr: true, labelOverrideEn: true, labelOverrideAr: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (open.length === 0) return;
    throw new WorkflowRefusalException('STAGE_TASKS_OPEN', {
      tasks: open.map((t) => ({
        id: t.id,
        title: t.title,
        titleAr: t.titleAr,
        status: t.status,
        statusLabel: taskStatusTitle(t.status),
        dueAt: t.dueAt,
        requiresEvidence: t.requiresEvidence,
        assignees: t.assignees.map((a) => a.user),
        pool: openTaskPool(t),
      })),
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
      // ACC-239 — a change request's tasks sit on its committee.
      case 'COMMITTEE_CHANGE_REQUEST':
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

    const assigneeIds = await this.whoWorks(toStage, instance, organizationId);
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
    const assigneeIds = await this.whoWorks(initialStage, instance, organizationId);
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

  // ACC-271 — the people a stage's work and notices go to: its pool's members.
  // A pool resolves without notices: it is read on every decision, and a notice
  // per read would repeat. PR 6a — a stage with no `who` has an empty pool, so
  // nobody (the old strategy's assignees are gone).
  private async whoWorks(
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
  ): Promise<string[]> {
    return (await this.stagePool.resolve(organizationId, stage.id, instance)).members;
  }

  /**
   * ACC-271 — many converted stages' pools at once (StagePoolService.
   * resolveMany(), one query per kind), for the 15-minute sweep. Public so the
   * sweep reuses the engine's resolution rather than a copy.
   */
  async resolveStagePools(organizationId: string, requests: StagePoolRequest[]): Promise<Map<string, StagePool>> {
    return this.stagePool.resolveMany(organizationId, requests);
  }

  /**
   * ACC-271 PR 6a — how many open entries are Committee votes counting against
   * this committee: stages with whoMode COMMITTEE_VOTE whose vote committee —
   * the stage's COMMITTEE entry's own, else the record's, as
   * StagePoolService.voteCommitteeIds() resolves it — is this one. For the
   * change-request preview ("open votes keep the quorum they began with").
   * BATCHED: one entries query plus one batched committee resolution, never
   * one per entry. It used to read the old approval mode, which no converted
   * stage has, so it always answered 0.
   */
  async countOpenCommitteeVotes(organizationId: string, committeeId: string): Promise<number> {
    const entries = await this.prisma.workflowInstanceStage.findMany({
      where: {
        exitedAt: null,
        stage: { whoMode: 'COMMITTEE_VOTE', workflowTemplate: { organizationId } },
        workflowInstance: { organizationId, status: 'IN_PROGRESS' },
      },
      select: { id: true, stageId: true, workflowInstance: { select: { objectType: true, objectId: true } } },
    });
    if (entries.length === 0) return 0;
    const committees = await this.stagePool.voteCommitteeIds(
      organizationId,
      entries.map((e) => ({ key: e.id, stageId: e.stageId, instance: e.workflowInstance })),
    );
    return entries.filter((e) => committees.get(e.id) === committeeId).length;
  }

  /** ACC-271 PR 4 — the sweep's leaver rule on "All of them" entries (StagePoolService.recordPoolChanges()). */
  async recordPoolChanges(organizationId: string, pools: ReadonlyMap<string, StagePool>): Promise<{ joined: number; left: number }> {
    return this.stagePool.recordPoolChanges(organizationId, pools);
  }

  // Whether one person's action decides the stage: a stage worked by Any one of
  // them. PR 6a removed the old approval-mode branch.
  private decidesAlone(stage: PrismaWorkflowStage): boolean {
    return stage.whoMode === 'ANY_ONE';
  }

  // ACC-40 Section 2.6.3 — the unified delegation-reason stamp, computed at
  // the exact moment of writing actorId/approverId. ACC-271 — the stage's pool
  // already knows why each person is in it: acting head of a unit an Org unit
  // head entry names (checked first), or standing in for an absent member. The
  // stamp records one reason, not a set. PR 6a removed the old strategy path.
  private async resolveDelegationStamp(
    userId: string,
    stage: PrismaWorkflowStage,
    instance: PrismaWorkflowInstance,
    organizationId: string,
    // The stage's pool, when the caller already has it.
    pool?: StagePool,
  ): Promise<{ delegationReason: 'ACTING_HEAD' | 'OUT_OF_OFFICE_COVERAGE'; delegationContextId: string } | null> {
    const stagePool = pool ?? (await this.stagePool.resolve(organizationId, stage.id, instance));
    const actingFor = stagePool.actingHeadOf.get(userId);
    if (actingFor) return { delegationReason: 'ACTING_HEAD', delegationContextId: actingFor };
    const coveredFor = stagePool.coveringFor.get(userId);
    if (coveredFor) return { delegationReason: 'OUT_OF_OFFICE_COVERAGE', delegationContextId: coveredFor };
    return null;
  }

  // ── ACC-28 Section 2.5: unassigned-stage detection ──────────────────────────

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
    // ACC-271 — a stage is unassigned when its pool is empty (plan §4.5), as a
    // stage with no `who` always is (PR 6a removed the two old detectors).
    const pool = await this.stagePool.resolve(organizationId, stage.id, instance);
    // ACC-271 PR 4 — who an "All of them" stage starts with, so the sweep can
    // tell when someone leaves it (plan §8).
    if (stage.whoMode === 'ALL') await this.stagePool.recordPoolChanges(organizationId, new Map([[instanceStageId, pool]]));
    if (pool.members.length > 0) return;

    await this.prisma.workflowInstanceStage.update({
      where: { id: instanceStageId },
      data: { isUnassigned: true, unassignedAt: new Date() },
    });
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

type Named = { nameEn: string; nameAr: string | null };

/**
 * ACC-208 (B7) — the pool an open stage task waits in, so the "Can't move yet"
 * dialog can say where it sits when nobody holds it yet. Null when the task
 * has no target (a person was chosen, or it came from before ACC-167).
 */
function openTaskPool(task: {
  assignedOrgUnit: Named | null;
  assignedPosition: Named | null;
  assignedCommittee: Named | null;
  assignedCommitteeRoleValue: { labelEn: string; labelAr: string | null; labelOverrideEn: string | null; labelOverrideAr: string | null } | null;
}):
  | { kind: 'POSITION'; orgUnit: Named; position: Named }
  | { kind: 'COMMITTEE_ROLE'; committee: Named; role: { labelEn: string; labelAr: string | null } }
  | null {
  if (task.assignedOrgUnit && task.assignedPosition) {
    return { kind: 'POSITION', orgUnit: task.assignedOrgUnit, position: task.assignedPosition };
  }
  const role = task.assignedCommitteeRoleValue;
  if (task.assignedCommittee && role) {
    return {
      kind: 'COMMITTEE_ROLE',
      committee: task.assignedCommittee,
      role: { labelEn: role.labelOverrideEn ?? role.labelEn, labelAr: role.labelOverrideAr ?? role.labelAr },
    };
  }
  return null;
}
