import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import {
  Prisma,
  TaskPriority,
  TaskSourceType,
  WorkflowInstance as PrismaWorkflowInstance,
  WorkflowStage as PrismaWorkflowStage,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { taskSlaFromSettings } from '../tenant/task-sla-settings';
import { PreparedTask, TaskService } from '../task/task.service';
import type { ResolvedPlacement } from '../task/task-assignment.service';
import { PoolTarget, isPoolMember, resolvePoolMemberIds } from '../task/task-pool';
import {
  CreateStageTaskDefinitionDto,
  StageTaskAssignKindValue,
  UpdateStageTaskDefinitionDto,
} from './dto/stage-task-definition.dto';
import {
  IStageTaskDefinition,
  IStageTaskDefinitionSaved,
  StageTaskDefinitionWarning,
} from './interfaces/stage-task-definition.interface';
import { RECORD_ROUTES } from './stage-task-record-routes';
import { DueHours } from './stage-deadline-rule';
import { WorkflowRefusalException } from './workflow-refusal';

const COMMITTEE_MEMBER_ROLE_CATEGORY = 'committee_member_role';

const DEFINITION_INCLUDE = {
  orgUnit: { select: { id: true, nameEn: true, nameAr: true } },
  position: { select: { id: true, nameEn: true, nameAr: true } },
  user: { select: { id: true, name: true } },
  committee: { select: { id: true, nameEn: true, nameAr: true } },
  committeeRoleValue: { select: { id: true, labelEn: true, labelAr: true } },
} as const;

type DefinitionRow = Prisma.WorkflowStageTaskDefinitionGetPayload<{ include: typeof DEFINITION_INCLUDE }>;

interface Route {
  assignKind: StageTaskAssignKindValue;
  orgUnitId: string | null;
  positionId: string | null;
  userId: string | null;
  committeeId: string | null;
  committeeRoleValueId: string | null;
}

// What each kind needs, may take, and nothing else.
const ROUTE_FIELDS: Record<StageTaskAssignKindValue, { required: (keyof Route)[]; optional: (keyof Route)[] }> = {
  POSITION: { required: ['orgUnitId', 'positionId'], optional: ['userId'] },
  RECORD_UNIT_POSITION: { required: ['positionId'], optional: [] },
  COMMITTEE_ROLE: { required: ['committeeId', 'committeeRoleValueId'], optional: [] },
  RECORD_COMMITTEE_ROLE: { required: ['committeeRoleValueId'], optional: [] },
};
const ROUTE_KEYS = ['orgUnitId', 'positionId', 'userId', 'committeeId', 'committeeRoleValueId'] as const;

/** The record entering a stage — all placement needs (the instance may not exist yet, on start). */
export type EnteringRecord = Pick<PrismaWorkflowInstance, 'objectType' | 'objectId'>;

/** A stage entry's tasks, prepared before the engine's transaction. */
export interface PreparedStageEntryTasks {
  tasks: PreparedTask[];
  /** One line per task that landed with nobody to act (ACC-34's warnings). */
  warnings: string[];
}

/**
 * ACC-190 (CF-07) — task definitions on workflow stages: configured per tenant
 * in workflow settings, turned into real tasks every time a record ENTERS the
 * stage. Plan: backend/Plans/step-190-stage-task-definitions.md.
 *
 * Every query scopes by organizationId: a definition carries its own, and a
 * stage is reached through its template's (WorkflowStage has none).
 */
@Injectable()
export class StageTaskDefinitionService {
  private readonly logger = new Logger(StageTaskDefinitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    // forwardRef: task.service → tenant.service → workflow-template.service →
    // this file → task.service is an import cycle, so TaskService is still
    // undefined when this class's constructor types are recorded — the same
    // cycle TaskService resolves for TenantService.
    @Inject(forwardRef(() => TaskService))
    private readonly taskService: TaskService,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────────────

  async list(stageId: string, organizationId: string): Promise<IStageTaskDefinition[]> {
    await this.loadStage(stageId, organizationId);
    const dueHours = await this.dueHoursFor(organizationId);
    const rows = await this.prisma.workflowStageTaskDefinition.findMany({
      where: { stageId, organizationId },
      include: DEFINITION_INCLUDE,
      orderBy: { order: 'asc' },
    });
    return rows.map((row) => this.toView(row, dueHours));
  }

  /** Per stage of a template: how many tasks it creates, and the longest one's due hours. */
  async summaryForStages(
    stageIds: readonly string[],
    organizationId: string,
  ): Promise<Map<string, { taskDefinitionCount: number; longestTaskHours: number | null }>> {
    const summary = new Map<string, { taskDefinitionCount: number; longestTaskHours: number | null }>();
    if (stageIds.length === 0) return summary;
    const dueHours = await this.dueHoursFor(organizationId);
    const rows = await this.prisma.workflowStageTaskDefinition.findMany({
      where: { organizationId, stageId: { in: [...stageIds] } },
      select: { stageId: true, priority: true },
    });
    for (const row of rows) {
      const current = summary.get(row.stageId) ?? { taskDefinitionCount: 0, longestTaskHours: null };
      const hours = dueHours(row.priority);
      summary.set(row.stageId, {
        taskDefinitionCount: current.taskDefinitionCount + 1,
        longestTaskHours: Math.max(current.longestTaskHours ?? 0, hours),
      });
    }
    return summary;
  }

  // ── Writes ───────────────────────────────────────────────────────────────────

  async create(
    stageId: string,
    dto: CreateStageTaskDefinitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IStageTaskDefinitionSaved> {
    const stage = await this.loadStage(stageId, organizationId);
    const route = this.routeFrom(dto.assignKind, dto);
    await this.validate(stage, route, dto.priority, organizationId);

    const last = await this.prisma.workflowStageTaskDefinition.findFirst({
      where: { stageId, organizationId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const row = await this.prisma.workflowStageTaskDefinition.create({
      data: {
        organizationId,
        stageId,
        order: (last?.order ?? 0) + 10,
        titleEn: dto.titleEn,
        titleAr: dto.titleAr ?? null,
        description: dto.description ?? null,
        isMandatory: dto.isMandatory,
        requiresEvidence: dto.requiresEvidence ?? false,
        priority: dto.priority,
        ...route,
        createdById: actorId,
      },
      include: DEFINITION_INCLUDE,
    });

    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'WorkflowStageTaskDefinition',
      objectId: row.id,
      actorId,
      tenantId: organizationId,
      after: this.auditShape(row),
    });
    return { definition: this.toView(row, await this.dueHoursFor(organizationId)), warning: await this.warningFor(route, organizationId) };
  }

  async update(
    id: string,
    dto: UpdateStageTaskDefinitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IStageTaskDefinitionSaved> {
    const existing = await this.loadDefinition(id, organizationId);
    const stage = await this.loadStage(existing.stageId, organizationId);

    // A new kind brings its own route fields; otherwise the stored ones are
    // kept and only what was sent replaces them.
    const route = dto.assignKind
      ? this.routeFrom(dto.assignKind, dto)
      : this.routeFrom(existing.assignKind as StageTaskAssignKindValue, { ...existing, ...definedOnly(dto) });
    const priority = dto.priority ?? existing.priority;
    await this.validate(stage, route, priority, organizationId);

    const row = await this.prisma.workflowStageTaskDefinition.update({
      where: { id },
      data: {
        ...(dto.titleEn !== undefined && { titleEn: dto.titleEn }),
        ...(dto.titleAr !== undefined && { titleAr: dto.titleAr }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isMandatory !== undefined && { isMandatory: dto.isMandatory }),
        ...(dto.requiresEvidence !== undefined && { requiresEvidence: dto.requiresEvidence }),
        priority,
        ...route,
        updatedById: actorId,
      },
      include: DEFINITION_INCLUDE,
    });

    // Full before and after — unlike updateStage(), whose audit names only the
    // stage's names (the gap CLAUDE.md records under Open/Deferred Items).
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'WorkflowStageTaskDefinition',
      objectId: id,
      actorId,
      tenantId: organizationId,
      before: this.auditShape(existing),
      after: this.auditShape(row),
    });
    return { definition: this.toView(row, await this.dueHoursFor(organizationId)), warning: await this.warningFor(route, organizationId) };
  }

  /** Deleted outright: tasks already created keep their snapshot (the link goes null). */
  async remove(id: string, organizationId: string, actorId: string): Promise<void> {
    const existing = await this.loadDefinition(id, organizationId);
    await this.prisma.workflowStageTaskDefinition.delete({ where: { id } });
    await this.auditLog.log({
      action: 'DELETE',
      objectType: 'WorkflowStageTaskDefinition',
      objectId: id,
      actorId,
      tenantId: organizationId,
      before: this.auditShape(existing),
    });
  }

  async reorder(stageId: string, ids: string[], organizationId: string, actorId: string): Promise<IStageTaskDefinition[]> {
    await this.loadStage(stageId, organizationId);
    const current = await this.prisma.workflowStageTaskDefinition.findMany({
      where: { stageId, organizationId },
      orderBy: { order: 'asc' },
      select: { id: true },
    });
    const currentIds = current.map((d) => d.id);
    const sameSet = ids.length === currentIds.length && new Set(ids).size === ids.length && ids.every((id) => currentIds.includes(id));
    if (!sameSet) throw new WorkflowRefusalException('STAGE_TASK_ORDER_MISMATCH');

    await this.prisma.$transaction(
      ids.map((id, index) => this.prisma.workflowStageTaskDefinition.update({ where: { id }, data: { order: (index + 1) * 10, updatedById: actorId } })),
    );
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'WorkflowStage',
      objectId: stageId,
      actorId,
      tenantId: organizationId,
      before: { taskDefinitionOrder: currentIds },
      after: { taskDefinitionOrder: ids },
      metadata: { event: 'stage_task_definitions_reordered' },
    });
    return this.list(stageId, organizationId);
  }

  /**
   * The stage-deadline rule for a stage's own deadline: refused when it would
   * be shorter than the longest task defined on it. No deadline breaks nothing.
   */
  async assertStageDeadlineFits(stageId: string, slaWorkingHours: number | null, organizationId: string): Promise<void> {
    if (slaWorkingHours === null) return;
    const definitions = await this.prisma.workflowStageTaskDefinition.findMany({
      where: { stageId, organizationId },
      select: { id: true, priority: true },
    });
    if (definitions.length === 0) return;
    const dueHours = await this.dueHoursFor(organizationId);
    const longest = Math.max(...definitions.map((d) => dueHours(d.priority)));
    if (longest > slaWorkingHours) {
      throw new WorkflowRefusalException('STAGE_DEADLINE_BEFORE_TASKS', {
        stageHours: slaWorkingHours,
        longestTaskHours: longest,
        definitionIds: definitions.filter((d) => dueHours(d.priority) > slaWorkingHours).map((d) => d.id),
      });
    }
  }

  // ── Stage entry ──────────────────────────────────────────────────────────────

  /**
   * The tasks a record entering `stage` gets, one per definition in order,
   * prepared BEFORE the engine opens its transaction (every read happens
   * here). The definition is read now and never again for these tasks: the
   * task is a snapshot (Ahmad's model, point 2).
   *
   * Placement is the manual-task route (ACC-167's rules), resolved at entry:
   *   a chosen person still in the position → that person
   *   a single-holder position → its holder (none → UNASSIGNED, target kept)
   *   anything else, and every committee role → a pool
   * A route whose unit or position has since been deactivated still creates
   * the task with its target — a stage entry never fails over a definition,
   * and Setup health lists a task nobody can act on.
   */
  async prepareEntryTasks(
    stage: PrismaWorkflowStage,
    instance: EnteringRecord,
    sourceType: TaskSourceType | null,
    enteredAt: Date,
    organizationId: string,
  ): Promise<PreparedStageEntryTasks> {
    const definitions = await this.prisma.workflowStageTaskDefinition.findMany({
      where: { stageId: stage.id, organizationId },
      orderBy: { order: 'asc' },
    });
    if (definitions.length === 0) return { tasks: [], warnings: [] };
    if (!sourceType) {
      this.logger.warn(`Stage ${stage.id} has ${definitions.length} task definition(s), but ${instance.objectType} has no task source type: none created`);
      return { tasks: [], warnings: [] };
    }

    const tasks: PreparedTask[] = [];
    const warnings: string[] = [];
    for (const definition of definitions) {
      const placement = await this.placementAtEntry(definition, instance, organizationId);
      const prepared = await this.taskService.prepareStageEntryTask(
        {
          title: definition.titleEn,
          titleAr: definition.titleAr,
          description: definition.description,
          priority: definition.priority,
          requiresEvidence: definition.requiresEvidence,
          isMandatory: definition.isMandatory,
          sourceType,
          sourceId: instance.objectId,
          sourceStageId: stage.id,
          stageTaskDefinitionId: definition.id,
          placement,
        },
        enteredAt,
        organizationId,
      );
      tasks.push(prepared);
      if (prepared.data.status === 'UNASSIGNED') {
        warnings.push(`"${definition.titleEn}" was created with nobody to act on it`);
      } else if (prepared.pooled && placement) {
        const members = await resolvePoolMemberIds(this.prisma, placement.target, organizationId);
        if (members.length === 0) warnings.push(`"${definition.titleEn}" went to a pool nobody is in yet`);
      }
    }
    return { tasks, warnings };
  }

  private async placementAtEntry(
    definition: { assignKind: string; orgUnitId: string | null; positionId: string | null; userId: string | null; committeeId: string | null; committeeRoleValueId: string | null },
    instance: EnteringRecord,
    organizationId: string,
  ): Promise<ResolvedPlacement | null> {
    const recordRoute = RECORD_ROUTES[instance.objectType];
    let target: PoolTarget | null = null;
    switch (definition.assignKind) {
      case 'POSITION':
        target = { kind: 'POSITION', orgUnitId: definition.orgUnitId!, positionId: definition.positionId! };
        break;
      case 'RECORD_UNIT_POSITION': {
        const unitId = recordRoute ? await recordRoute.unit(this.prisma, instance.objectId, organizationId) : null;
        target = unitId ? { kind: 'POSITION', orgUnitId: unitId, positionId: definition.positionId! } : null;
        break;
      }
      case 'COMMITTEE_ROLE':
        target = { kind: 'COMMITTEE_ROLE', committeeId: definition.committeeId!, roleValueId: definition.committeeRoleValueId! };
        break;
      case 'RECORD_COMMITTEE_ROLE': {
        const committeeId = recordRoute ? await recordRoute.committee(this.prisma, instance.objectId, organizationId) : null;
        target = committeeId ? { kind: 'COMMITTEE_ROLE', committeeId, roleValueId: definition.committeeRoleValueId! } : null;
        break;
      }
    }
    if (!target) return null;

    if (target.kind === 'COMMITTEE_ROLE') return { target, pooled: true, directUserIds: [] };
    if (definition.userId && (await isPoolMember(this.prisma, definition.userId, target, organizationId))) {
      return { target, pooled: false, directUserIds: [definition.userId] };
    }
    const position = await this.prisma.orgPosition.findFirst({
      where: { id: target.positionId, organizationId },
      select: { isSingleAssignee: true },
    });
    if (position?.isSingleAssignee) {
      return { target, pooled: false, directUserIds: await resolvePoolMemberIds(this.prisma, target, organizationId) };
    }
    return { target, pooled: true, directUserIds: [] };
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private async loadStage(stageId: string, organizationId: string): Promise<PrismaWorkflowStage & { workflowTemplate: { objectType: string } }> {
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id: stageId, workflowTemplate: { organizationId } },
      include: { workflowTemplate: { select: { objectType: true } } },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');
    return stage;
  }

  private async loadDefinition(id: string, organizationId: string): Promise<DefinitionRow> {
    const row = await this.prisma.workflowStageTaskDefinition.findFirst({
      where: { id, organizationId },
      include: DEFINITION_INCLUDE,
    });
    if (!row) throw new NotFoundException('Stage task not found');
    return row;
  }

  /** The route a kind uses, from what was sent; a field the kind needs and lacks, or does not use and got, is refused. */
  private routeFrom(kind: StageTaskAssignKindValue, source: Partial<Record<keyof Route, string | null | undefined>>): Route {
    const fields = ROUTE_FIELDS[kind];
    const route: Route = { assignKind: kind, orgUnitId: null, positionId: null, userId: null, committeeId: null, committeeRoleValueId: null };
    const missing: string[] = [];
    const unused: string[] = [];
    for (const key of ROUTE_KEYS) {
      const value = source[key] ?? null;
      if (fields.required.includes(key)) {
        if (!value) missing.push(key);
        else route[key] = value;
      } else if (fields.optional.includes(key)) {
        route[key] = value;
      } else if (value) {
        unused.push(key);
      }
    }
    if (missing.length > 0 || unused.length > 0) {
      throw new WorkflowRefusalException('STAGE_TASK_ROUTE_INCOMPLETE', { assignKind: kind, missing, unused });
    }
    return route;
  }

  private async validate(
    stage: PrismaWorkflowStage & { workflowTemplate: { objectType: string } },
    route: Route,
    priority: TaskPriority,
    organizationId: string,
  ): Promise<void> {
    if (stage.isFinal) throw new WorkflowRefusalException('STAGE_TASK_ON_FINAL_STAGE');

    const relative = route.assignKind === 'RECORD_UNIT_POSITION' || route.assignKind === 'RECORD_COMMITTEE_ROLE';
    if (relative && !RECORD_ROUTES[stage.workflowTemplate.objectType as keyof typeof RECORD_ROUTES]) {
      throw new WorkflowRefusalException('STAGE_TASK_ROUTE_NOT_AVAILABLE', { objectType: stage.workflowTemplate.objectType });
    }

    // Tenant-scoped, each one: another tenant's id is the same 404 as a missing one.
    if (route.orgUnitId) {
      const unit = await this.prisma.orgUnit.findFirst({ where: { id: route.orgUnitId, organizationId, isActive: true }, select: { id: true } });
      if (!unit) throw new WorkflowRefusalException('STAGE_TASK_UNIT_NOT_FOUND');
    }
    if (route.positionId) {
      const position = await this.prisma.orgPosition.findFirst({ where: { id: route.positionId, organizationId, isActive: true }, select: { id: true } });
      if (!position) throw new WorkflowRefusalException('STAGE_TASK_POSITION_NOT_FOUND');
    }
    if (route.committeeId) {
      const committee = await this.prisma.committee.findFirst({ where: { id: route.committeeId, organizationId }, select: { id: true } });
      if (!committee) throw new WorkflowRefusalException('STAGE_TASK_COMMITTEE_NOT_FOUND');
    }
    if (route.committeeRoleValueId) {
      const role = await this.prisma.lookupValue.findFirst({
        where: { id: route.committeeRoleValueId, category: { key: COMMITTEE_MEMBER_ROLE_CATEGORY }, OR: [{ organizationId: null }, { organizationId }] },
        select: { id: true },
      });
      if (!role) throw new WorkflowRefusalException('STAGE_TASK_ROLE_NOT_FOUND');
    }
    if (route.userId && route.orgUnitId && route.positionId) {
      const target: PoolTarget = { kind: 'POSITION', orgUnitId: route.orgUnitId, positionId: route.positionId };
      if (!(await isPoolMember(this.prisma, route.userId, target, organizationId))) {
        throw new WorkflowRefusalException('STAGE_TASK_USER_NOT_IN_POSITION');
      }
    }

    // The stage-deadline rule: this task's due time against the stage's deadline.
    if (stage.slaWorkingHours !== null) {
      const taskHours = (await this.dueHoursFor(organizationId))(priority);
      if (taskHours > stage.slaWorkingHours) {
        throw new WorkflowRefusalException('STAGE_TASK_DUE_AFTER_STAGE_DEADLINE', {
          taskHours,
          stageHours: stage.slaWorkingHours,
          priority,
        });
      }
    }
  }

  private async warningFor(route: Route, organizationId: string): Promise<StageTaskDefinitionWarning> {
    if (route.assignKind === 'POSITION' && !route.userId) {
      const members = await resolvePoolMemberIds(
        this.prisma,
        { kind: 'POSITION', orgUnitId: route.orgUnitId!, positionId: route.positionId! },
        organizationId,
      );
      return members.length === 0 ? 'POSITION_HAS_NO_HOLDER' : null;
    }
    if (route.assignKind === 'COMMITTEE_ROLE') {
      const members = await resolvePoolMemberIds(
        this.prisma,
        { kind: 'COMMITTEE_ROLE', committeeId: route.committeeId!, roleValueId: route.committeeRoleValueId! },
        organizationId,
      );
      return members.length === 0 ? 'POOL_EMPTY' : null;
    }
    return null;
  }

  private async dueHoursFor(organizationId: string): Promise<DueHours> {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
    const sla = taskSlaFromSettings(org?.settings);
    return (priority) => sla[priority].dueAfterHours;
  }

  private toView(row: DefinitionRow, dueHours: DueHours): IStageTaskDefinition {
    return {
      id: row.id,
      stageId: row.stageId,
      order: row.order,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      description: row.description,
      isMandatory: row.isMandatory,
      requiresEvidence: row.requiresEvidence,
      priority: row.priority,
      assignKind: row.assignKind,
      orgUnitId: row.orgUnitId,
      positionId: row.positionId,
      userId: row.userId,
      committeeId: row.committeeId,
      committeeRoleValueId: row.committeeRoleValueId,
      orgUnit: row.orgUnit,
      position: row.position,
      user: row.user,
      committee: row.committee,
      committeeRole: row.committeeRoleValue,
      dueAfterHours: dueHours(row.priority),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** The stored fields only — the related names are display, not state. */
  private auditShape(row: DefinitionRow): Record<string, unknown> {
    return {
      id: row.id,
      stageId: row.stageId,
      order: row.order,
      titleEn: row.titleEn,
      titleAr: row.titleAr,
      description: row.description,
      isMandatory: row.isMandatory,
      requiresEvidence: row.requiresEvidence,
      priority: row.priority,
      assignKind: row.assignKind,
      orgUnitId: row.orgUnitId,
      positionId: row.positionId,
      userId: row.userId,
      committeeId: row.committeeId,
      committeeRoleValueId: row.committeeRoleValueId,
    };
  }
}

/** The keys of a PATCH body that were actually sent (undefined is "not sent"; null is "clear"). */
function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<T>;
}
