import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import {
  Prisma,
  WorkflowTemplate as PrismaWorkflowTemplate,
  WorkflowStage as PrismaWorkflowStage,
  WorkflowTransition as PrismaWorkflowTransition,
  WorkflowTransitionAction as PrismaWorkflowTransitionAction,
  WorkflowObjectType,
} from '../../../generated/prisma/client';
import { IWorkflowTemplate } from './interfaces/workflow-template.interface';
import { IWorkflowStage } from './interfaces/workflow-stage.interface';
import {
  IWorkflowTransition,
  IWorkflowTransitionAction,
  IWorkflowTransitionWriteResult,
  TransitionPermissionWarning,
} from './interfaces/workflow-transition.interface';
import { CreateWorkflowTemplateDto } from './dto/create-workflow-template.dto';
import { UpdateWorkflowTemplateDto } from './dto/update-workflow-template.dto';
import { CreateWorkflowStageDto } from './dto/create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from './dto/create-workflow-transition.dto';
import { UpdateWorkflowTransitionDto } from './dto/update-workflow-transition.dto';
import { CreateWorkflowTransitionActionDto } from './dto/create-workflow-transition-action.dto';
import { UpdateWorkflowTransitionActionDto } from './dto/update-workflow-transition-action.dto';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { writeStartingAssignments } from './workflow-who';
import { PROTECTED_TEMPLATES } from './workflow-stage-keys';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { RECORD_ROUTES } from './stage-task-record-routes';
import { refuseProtected, WHO_MOVED_TO_STAGE_AR, WorkflowRefusalException } from './workflow-refusal';
import {
  isRecordAction,
  isStageFlag,
  newStageActionKeys,
  orderedActionKeys,
  orderedFlagKeys,
  recordActionsFor,
  recordFieldsFor,
  stageFlagsFor,
} from './record-registry';
import type { EngineTx } from './workflow.service';
import {
  assertKnownAndGrantable,
  isPlatformPermission,
} from '../roles/permission-grantability';
import type { IStageWho, IStageWhoEntry } from './interfaces/workflow-stage.interface';
import {
  assertWhoShape,
  assigneeKindsFor,
  entryKey,
  normalizeEntry,
  whoAuditEntries,
  whoSentence,
  type WhoEntryField,
  type WhoEntryForSentence,
  type WhoEntryInput,
} from './stage-who';
import { appMoveFor } from './app-moves';
import { isConvertedStage, transitionMover } from './workflow-pool';

/** Stage fields a protected template's stage may still change (names, description, deadline and its escalation). */
const PROTECTED_STAGE_EDITABLE: ReadonlySet<string> = new Set(['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig']);

/**
 * ACC-255 — every stage field an audit row may name, in the stage form's
 * order, then the stage rules. `addStage` and `removeStage` record all of
 * them; `updateStage` records the ones that changed (`stageAuditDiff`).
 */
const STAGE_AUDIT_FIELDS = [
  'nameEn',
  'nameAr',
  'description',
  'order',
  'slaWorkingHours',
  'isInitial',
  'isFinal',
  'approvalMode',
  'parallelThreshold',
  'committeeId',
  'assigneeStrategy',
  'assigneeUserId',
  'assigneeRoleId',
  'assigneeCommitteeRoleValueId',
  'assigneePositionId',
  'assigneeOrgUnitId',
  'escalationConfig',
] as const;

/** ACC-255 — a stage as an audit row records it: every field, its allowed actions and its flags. */
export function stageSnapshot(
  stage: Pick<PrismaWorkflowStage, (typeof STAGE_AUDIT_FIELDS)[number]> & { flags?: string[] | null },
  actions: readonly string[],
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const field of STAGE_AUDIT_FIELDS) snapshot[field] = (stage as Record<string, unknown>)[field] ?? null;
  snapshot['actions'] = [...actions];
  snapshot['flags'] = [...(stage.flags ?? [])];
  return snapshot;
}

/**
 * ACC-255 — the fields that differ between two snapshots, before and after.
 * A field re-sent unchanged is not listed; null when nothing changed, so a
 * no-op save writes no audit row. Arrays (actions, flags) compare as sets.
 */
export function stageAuditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (sameAuditValue(before[field], after[field])) continue;
    diff.before[field] = before[field] ?? null;
    diff.after[field] = after[field] ?? null;
  }
  return Object.keys(diff.after).length > 0 ? diff : null;
}

function sameAuditValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b) && a.every((v) => typeof v === 'string') && b.every((v) => typeof v === 'string')) {
    return sameKeySet(a as string[], b as string[]);
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function sameKeySet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((k) => right.has(k));
}

/**
 * ACC-271 PR 3 — the people fields the engine no longer reads once a stage is
 * converted (plan §4.2, §4.6). Old screens send them on every save, so an
 * UNCHANGED value is accepted and ignored, and a CHANGED one is refused
 * (WHO_MOVED_TO_STAGE): silently ignoring it would look saved and do nothing
 * (Ahmad, 28 Oct, condition b).
 */
export const OLD_STAGE_WHO_FIELDS = [
  'assigneeStrategy',
  'assigneeUserId',
  'assigneeRoleId',
  'approvalMode',
  'parallelThreshold',
  'committeeId',
  'assigneeCommitteeRoleValueId',
  'assigneePositionId',
  'assigneeOrgUnitId',
] as const;
export const OLD_TRANSITION_WHO_FIELDS = ['triggerCondition', 'triggerRoleId', 'triggerUserId', 'requiredPermission'] as const;

/** An empty string and null both mean "not set". */
const oldValue = (value: unknown): unknown => (typeof value === 'string' && value.trim() === '' ? null : (value ?? null));

/** Refuses the first old people field the save CHANGES from what is stored. */
function refuseChangedOldPeopleField(
  stored: Record<string, unknown>,
  sent: Record<string, unknown>,
  fields: readonly string[],
): void {
  const field = fields.find((f) => sent[f] !== undefined && oldValue(sent[f]) !== oldValue(stored[f]));
  if (field !== undefined) {
    throw new WorkflowRefusalException('WHO_MOVED_TO_STAGE', { field, messageAr: WHO_MOVED_TO_STAGE_AR });
  }
}

/** The ids a set of entries names, per field, deduplicated. */
function idsOf(entries: WhoEntryInput[], field: WhoEntryField): string[] {
  return [...new Set(entries.map((e) => e[field]).filter((v): v is string => typeof v === 'string' && v !== ''))];
}

interface WhoReferences {
  users: Map<string, { id: string; name: string; status: string }>;
  positions: Map<string, { id: string; nameEn: string; nameAr: string | null }>;
  units: Map<string, { id: string; nameEn: string; nameAr: string | null }>;
  committees: Map<string, { id: string; nameEn: string; nameAr: string | null }>;
  roles: Map<string, { id: string; labelEn: string; labelAr: string | null }>;
}

/** The names an entry is read with, from the batched references. */
function entryForSentence(entry: WhoEntryInput, refs: WhoReferences): WhoEntryForSentence {
  const n = normalizeEntry(entry);
  const position = n.positionId ? refs.positions.get(n.positionId) : undefined;
  const unit = n.orgUnitId ? refs.units.get(n.orgUnitId) : undefined;
  const committee = n.committeeId ? refs.committees.get(n.committeeId) : undefined;
  const role = n.committeeRoleValueId ? refs.roles.get(n.committeeRoleValueId) : undefined;
  return {
    ...n,
    userName: n.userId ? (refs.users.get(n.userId)?.name ?? null) : null,
    positionNameEn: position?.nameEn ?? null,
    positionNameAr: position?.nameAr ?? null,
    orgUnitNameEn: unit?.nameEn ?? null,
    orgUnitNameAr: unit?.nameAr ?? null,
    committeeNameEn: committee?.nameEn ?? null,
    committeeNameAr: committee?.nameAr ?? null,
    roleLabelEn: role?.labelEn ?? null,
    roleLabelAr: role?.labelAr ?? null,
  };
}

/** A stored entry row, as the read and the audit see it. */
type StoredWhoEntry = WhoEntryInput & { id: string; order: number; isStartingAssignment: boolean };

/** ACC-255 — the exactly-one flags of a record type (STAGE_FLAG_EXACTLY_ONE guards them). */
function exactlyOneFlags(objectType: WorkflowObjectType): string[] {
  return stageFlagsFor(objectType).filter((f) => f.cardinality === 'exactlyOne').map((f) => f.key);
}

@Injectable()
export class WorkflowTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly stageTasks: StageTaskDefinitionService,
  ) {}

  // ── Seed ─────────────────────────────────────────────────────────────────────

  async seedDefaultWorkflows(organizationId: string): Promise<void> {
    await applyWorkflowSeed(this.prisma, organizationId, SYSTEM_WORKFLOW_SEED);
  }

  /**
   * ACC-271 (plan §5) — the tenant admin's starting assignment on every stage
   * the seed marked (a converted stage with no entry), once the first admin
   * exists: PlatformTenantService.createTenant() calls it right after the
   * invite. Running it again writes nothing. The admin is usually still
   * INVITED here, and an INVITED person is in no pool until they accept, so
   * those stages read as unassigned until then (Q5).
   */
  async assignStartingAssignments(organizationId: string, adminUserId: string, actorId: string): Promise<{ stageIds: string[] }> {
    const admin = await this.prisma.user.findFirst({ where: { id: adminUserId, organizationId }, select: { id: true } });
    if (!admin) throw new NotFoundException('User not found');
    const written = await writeStartingAssignments(this.prisma, organizationId, adminUserId, actorId);
    if (written.stageIds.length > 0) {
      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'CREATE',
        objectType: 'WorkflowStageAssignee',
        objectId: adminUserId,
        after: { kind: 'SPECIFIC_USER', userId: adminUserId, isStartingAssignment: true, stageCount: written.stageIds.length },
        metadata: { event: 'starting_assignments', stageIds: written.stageIds },
      });
    }
    return written;
  }

  // ── Templates ────────────────────────────────────────────────────────────────

  async getTemplates(organizationId: string): Promise<IWorkflowTemplate[]> {
    const templates = await this.prisma.workflowTemplate.findMany({
      where: { organizationId },
      orderBy: [{ objectType: 'asc' }, { nameEn: 'asc' }],
    });
    return templates.map((t) => this.mapTemplate(t));
  }

  async getTemplateById(id: string, organizationId: string): Promise<IWorkflowTemplate> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');

    const stages = await this.prisma.workflowStage.findMany({
      where: { workflowTemplateId: id },
      orderBy: { order: 'asc' },
      include: {
        transitionsFrom: {
          include: { actions: { orderBy: { order: 'asc' } } },
        },
        // ACC-255 — the record actions each stage allows.
        recordActions: { where: { organizationId }, select: { actionKey: true } },
        // ACC-271 PR 3 — who works each stage, in order.
        assignees: { where: { organizationId }, orderBy: { order: 'asc' } },
      },
    });

    // Independent reads together (the performance rule): what entering each
    // stage creates (ACC-190), the live counts (ACC-255), the priorities' due
    // times (ACC-208), and the names every stage's entries are read with — one
    // query per kind for the whole template (ACC-271 PR 3), never per row.
    const [stageTasks, liveCounts, taskDueHours, refs] = await Promise.all([
      this.stageTasks.summaryForStages(stages.map((s) => s.id), organizationId),
      this.liveCountsByStage(id, organizationId),
      this.stageTasks.taskDueHours(organizationId),
      this.loadWhoReferences(stages.flatMap((s) => s.assignees ?? []), organizationId),
    ]);
    const recordRoute = RECORD_ROUTES[template.objectType];
    const stageKeys = new Map(stages.map((s) => [s.id, s.key]));

    return {
      ...this.mapTemplate(template),
      // ACC-208 (B2, B3).
      recordRoutes: { unit: typeof recordRoute?.unit === 'function', committee: typeof recordRoute?.committee === 'function' },
      taskDueHours,
      // ACC-271 PR 3 — the kinds a stage of this record type may be worked by.
      assigneeKinds: assigneeKindsFor(template.objectType),
      // ACC-255 — what a stage of this record type may allow and mean.
      recordActions: recordActionsFor(template.objectType).map(({ key, labelKey, permissionKey }) => ({ key, labelKey, permissionKey })),
      stageFlags: stageFlagsFor(template.objectType).map(({ key, labelKey, cardinality }) => ({ key, labelKey, cardinality })),
      recordFields: recordFieldsFor(template.objectType).map(({ key, labelKey, kind }) => ({ key, labelKey, kind })),
      stages: stages.map((s) => ({
        ...this.mapStage(
          s,
          s.transitionsFrom.map((t) => ({
            ...this.mapTransition(t, t.actions.map((a) => this.mapTransitionAction(a))),
            // ACC-271 PR 3 — when the app runs one of its own moves.
            ...(transitionMover(t) === 'APP' && this.appMoveOf(template.objectType, s.key, stageKeys.get(t.toStageId))),
          })),
          orderedActionKeys(template.objectType, s.recordActions.map((r) => r.actionKey)),
        ),
        taskDefinitionCount: stageTasks.get(s.id)?.taskDefinitionCount ?? 0,
        longestTaskHours: stageTasks.get(s.id)?.longestTaskHours ?? null,
        liveCount: liveCounts.get(s.id) ?? 0,
        ...this.whoRead(s.whoMode, s.assignees ?? [], refs),
      })),
    };
  }

  /** ACC-271 PR 3 — `appMove` for an APP transition; nothing when the registry has no entry (a test failure, app-moves.spec.ts). */
  private appMoveOf(
    objectType: WorkflowObjectType,
    fromStageKey: string | null,
    toStageKey: string | null | undefined,
  ): { appMove?: { key: string; en: string; ar: string } } {
    const appMove = appMoveFor(objectType, fromStageKey, toStageKey);
    return appMove ? { appMove } : {};
  }

  // ── Who works a stage (ACC-271 PR 3) ─────────────────────────────────────────

  /**
   * Every id a set of entries names, read once per kind for the whole set
   * (users, positions, units, committees, committee roles) in Promise.all,
   * each scoped by the organisation. An id of another organisation is absent,
   * exactly as an invented one is.
   */
  private async loadWhoReferences(entries: WhoEntryInput[], organizationId: string): Promise<WhoReferences> {
    const userIds = idsOf(entries, 'userId');
    const positionIds = idsOf(entries, 'positionId');
    const unitIds = idsOf(entries, 'orgUnitId');
    const committeeIds = idsOf(entries, 'committeeId');
    const roleIds = idsOf(entries, 'committeeRoleValueId');
    const [users, positions, units, committees, roles] = await Promise.all([
      userIds.length === 0
        ? []
        : this.prisma.user.findMany({ where: { id: { in: userIds }, organizationId }, select: { id: true, name: true, status: true } }),
      positionIds.length === 0
        ? []
        : this.prisma.orgPosition.findMany({ where: { id: { in: positionIds }, organizationId }, select: { id: true, nameEn: true, nameAr: true } }),
      unitIds.length === 0
        ? []
        : this.prisma.orgUnit.findMany({ where: { id: { in: unitIds }, organizationId }, select: { id: true, nameEn: true, nameAr: true } }),
      committeeIds.length === 0
        ? []
        : this.prisma.committee.findMany({ where: { id: { in: committeeIds }, organizationId }, select: { id: true, nameEn: true, nameAr: true } }),
      // A committee role is the SYSTEM value or this organisation's own, as
      // validateCommitteeRoleValueId() reads it.
      roleIds.length === 0
        ? []
        : this.prisma.lookupValue.findMany({
            where: { id: { in: roleIds }, category: { key: 'committee_member_role' }, OR: [{ organizationId: null }, { organizationId }] },
            select: { id: true, labelEn: true, labelAr: true },
          }),
    ]);
    return {
      users: new Map(users.map((u) => [u.id, u])),
      positions: new Map(positions.map((p) => [p.id, p])),
      units: new Map(units.map((u) => [u.id, u])),
      committees: new Map(committees.map((c) => [c.id, c])),
      roles: new Map(roles.map((r) => [r.id, r])),
    };
  }

  /**
   * Refuses an entry that names anything outside this organisation (or nothing
   * at all), and a person who can no longer sign in. One read per kind.
   */
  private async assertWhoReferences(entries: Required<WhoEntryInput>[], organizationId: string): Promise<void> {
    const refs = await this.loadWhoReferences(entries, organizationId);
    const known: Record<WhoEntryField, Map<string, unknown>> = {
      userId: refs.users,
      positionId: refs.positions,
      orgUnitId: refs.units,
      committeeId: refs.committees,
      committeeRoleValueId: refs.roles,
    };
    entries.forEach((entry, index) => {
      for (const field of Object.keys(known) as WhoEntryField[]) {
        const value = entry[field];
        if (value !== null && !known[field].has(value)) {
          throw new WorkflowRefusalException('WHO_REFERENCE_NOT_FOUND', { index, field });
        }
      }
      // INACTIVE is what deactivation writes; SUSPENDED is dormant but means
      // the same. An INVITED person may be chosen: they join once they accept.
      const status = entry.userId ? refs.users.get(entry.userId)?.status : undefined;
      if (status === 'INACTIVE' || status === 'SUSPENDED') throw new WorkflowRefusalException('WHO_USER_NOT_ACTIVE', { index });
    });
  }

  /** A stage's `who` and its sentence, from its stored entries and the batched names. */
  private whoRead(
    whoMode: PrismaWorkflowStage['whoMode'],
    entries: StoredWhoEntry[],
    refs: WhoReferences,
  ): { who: IStageWho | null; whoSentence: { en: string; ar: string } | null } {
    if (!isConvertedStage({ whoMode }) || whoMode === null) return { who: null, whoSentence: null };
    const named = entries.map((e) => entryForSentence(e, refs));
    return {
      who: {
        mode: whoMode,
        entries: entries.map((e, i): IStageWhoEntry => {
          const n = named[i]!;
          return {
            id: e.id,
            order: e.order,
            kind: n.kind,
            userId: n.userId,
            user: n.userId && n.userName !== null ? { id: n.userId, name: n.userName ?? '' } : null,
            positionId: n.positionId,
            position: n.positionId ? (refs.positions.get(n.positionId) ?? null) : null,
            orgUnitId: n.orgUnitId,
            orgUnit: n.orgUnitId ? (refs.units.get(n.orgUnitId) ?? null) : null,
            committeeId: n.committeeId,
            committee: n.committeeId ? (refs.committees.get(n.committeeId) ?? null) : null,
            committeeRoleValueId: n.committeeRoleValueId,
            committeeRole: n.committeeRoleValueId ? (refs.roles.get(n.committeeRoleValueId) ?? null) : null,
            isStartingAssignment: e.isStartingAssignment,
          };
        }),
      },
      whoSentence: whoSentence(whoMode, named),
    };
  }

  /**
   * Replaces a stage's entries with `wanted`, inside the stage's transaction. An
   * entry that survives unchanged keeps its row, and so its starting-assignment
   * flag; a replaced or removed one goes, and a new one starts without the flag.
   */
  private async replaceStageWho(
    tx: EngineTx,
    stageId: string,
    organizationId: string,
    wanted: Required<WhoEntryInput>[],
    actorId: string,
  ): Promise<void> {
    // One read, one delete, one insert, whatever the number of entries: an
    // entry kept in place is left alone; one kept but moved is written again in
    // its new place with its own flag, author and creation time.
    const rows = await tx.workflowStageAssignee.findMany({ where: { organizationId, stageId } });
    const byKey = new Map(rows.map((r) => [entryKey(r), r]));
    const untouched = new Set<string>();
    const creates: Prisma.WorkflowStageAssigneeCreateManyInput[] = [];
    for (const [index, entry] of wanted.entries()) {
      const existing = byKey.get(entryKey(entry));
      if (existing && existing.order === index + 1) {
        untouched.add(existing.id);
      } else if (existing) {
        creates.push({
          organizationId,
          stageId,
          order: index + 1,
          ...entry,
          isStartingAssignment: existing.isStartingAssignment,
          createdAt: existing.createdAt,
          createdById: existing.createdById,
        });
      } else {
        creates.push({ organizationId, stageId, order: index + 1, ...entry, isStartingAssignment: false, createdById: actorId });
      }
    }
    const remove = rows.filter((r) => !untouched.has(r.id)).map((r) => r.id);
    if (remove.length > 0) await tx.workflowStageAssignee.deleteMany({ where: { id: { in: remove }, organizationId, stageId } });
    if (creates.length > 0) await tx.workflowStageAssignee.createMany({ data: creates });
  }

  /**
   * ACC-271 PR 3 (plan §9) — "Keep this assignment": the stage's starting entry
   * stays, and stops being flagged. One audit row (no reason, Q12); a stage with
   * no starting entry changes nothing and writes nothing. The next Setup health
   * run closes the condition.
   */
  async keepStartingAssignment(stageId: string, organizationId: string, actorId: string): Promise<{ kept: boolean }> {
    const stage = await this.prisma.workflowStage.findFirst({ where: { id: stageId, workflowTemplate: { organizationId } }, select: { id: true } });
    if (!stage) throw new NotFoundException('Workflow stage not found');
    const { count } = await this.prisma.workflowStageAssignee.updateMany({
      where: { stageId, organizationId, isStartingAssignment: true },
      data: { isStartingAssignment: false },
    });
    if (count === 0) return { kept: false };
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowStage',
      objectId: stageId,
      before: { startingAssignment: true },
      after: { startingAssignment: false },
      metadata: { event: 'keep_starting_assignment', entries: count },
    });
    return { kept: true };
  }

  /**
   * ACC-255 PR 4b-be (G4) — how many of the organisation's records stand in
   * each stage of a template: ONE grouped count of its workflow instances by
   * current stage, whatever the number of stages and records. A cancelled
   * instance is not counted; one that reached a final stage is (it is still
   * there). Scoped by the organisation as well as the template, so an instance
   * of another organisation can never be counted.
   */
  private async liveCountsByStage(templateId: string, organizationId: string): Promise<Map<string, number>> {
    const groups = await this.prisma.workflowInstance.groupBy({
      by: ['currentStageId'],
      where: { organizationId, workflowTemplateId: templateId, currentStageId: { not: null }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    return new Map(groups.flatMap((g) => (g.currentStageId ? [[g.currentStageId, g._count._all] as const] : [])));
  }

  async createTemplate(
    dto: CreateWorkflowTemplateDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTemplate> {
    // ACC-239 — the seeded template is the only one for a protected type.
    if (PROTECTED_TEMPLATES.has(dto.objectType)) refuseProtected('CREATE_TEMPLATE');
    const template = await this.prisma.workflowTemplate.create({
      data: {
        organizationId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        objectType: dto.objectType,
        isDefault: dto.isDefault ?? false,
        isActive: true,
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTemplate',
      objectId: template.id,
      after: { nameEn: template.nameEn, nameAr: template.nameAr, objectType: template.objectType },
    });

    return this.mapTemplate(template);
  }

  async updateTemplate(
    id: string,
    dto: UpdateWorkflowTemplateDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTemplate> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    // ACC-239 — renaming is allowed; changing the type to or from a protected
    // one, or giving up a protected template's default, is not. Only a value
    // that CHANGES is refused: a form sends the unchanged ones too.
    if (dto.objectType !== undefined && dto.objectType !== template.objectType) {
      if (PROTECTED_TEMPLATES.has(template.objectType) || PROTECTED_TEMPLATES.has(dto.objectType)) refuseProtected('CHANGE_TYPE');
    }
    if (PROTECTED_TEMPLATES.has(template.objectType) && dto.isDefault === false && template.isDefault) {
      refuseProtected('REPLACE_DEFAULT');
    }

    const updated = await this.prisma.workflowTemplate.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.objectType !== undefined && { objectType: dto.objectType }),
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { nameEn: template.nameEn, nameAr: template.nameAr, objectType: template.objectType },
      after: { nameEn: updated.nameEn, nameAr: updated.nameAr, objectType: updated.objectType },
    });

    return this.mapTemplate(updated);
  }

  async setDefault(id: string, organizationId: string, actorId: string): Promise<void> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    if (template.isDefault) return;
    // ACC-239 — a protected type keeps its seeded template as the default.
    if (PROTECTED_TEMPLATES.has(template.objectType)) refuseProtected('REPLACE_DEFAULT');

    await this.prisma.$transaction([
      this.prisma.workflowTemplate.updateMany({
        where: { organizationId, objectType: template.objectType, NOT: { id } },
        data: { isDefault: false },
      }),
      this.prisma.workflowTemplate.update({ where: { id }, data: { isDefault: true } }),
    ]);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { isDefault: false },
      after: { isDefault: true },
    });
  }

  async deactivateTemplate(id: string, organizationId: string, actorId: string): Promise<void> {
    const template = await this.prisma.workflowTemplate.findFirst({ where: { id, organizationId } });
    if (!template) throw new NotFoundException('Workflow template not found');
    if (!template.isActive) return;
    if (PROTECTED_TEMPLATES.has(template.objectType)) refuseProtected('DEACTIVATE');

    await this.prisma.workflowTemplate.update({ where: { id }, data: { isActive: false } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTemplate',
      objectId: id,
      before: { isActive: true },
      after: { isActive: false },
    });
  }

  // ── Stages ───────────────────────────────────────────────────────────────────

  async addStage(
    templateId: string,
    dto: CreateWorkflowStageDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowStage> {
    const template = await this.prisma.workflowTemplate.findFirst({
      where: { id: templateId, organizationId },
    });
    if (!template) throw new NotFoundException('Workflow template not found');
    if (PROTECTED_TEMPLATES.has(template.objectType)) refuseProtected('ADD_STAGE');
    // ACC-255 — a new stage allows what the save names, or the record type's
    // new-stage defaults (what such a stage allowed before stage rules).
    const rules = this.stageRuleKeys(template.objectType, dto.actions, dto.flags);
    const actions = rules.actions ?? newStageActionKeys(template.objectType);
    const flags = rules.flags ?? [];

    if (dto.assigneeUserId) {
      await this.validateAssigneeUserId(dto.assigneeUserId, organizationId);
    }
    if (dto.committeeId) {
      await this.validateCommitteeId(dto.committeeId, organizationId);
    }
    if (dto.assigneeCommitteeRoleValueId) {
      await this.validateCommitteeRoleValueId(dto.assigneeCommitteeRoleValueId, organizationId);
    }
    if (dto.assigneePositionId) {
      await this.validateAssigneePositionId(dto.assigneePositionId, organizationId);
    }
    if (dto.assigneeOrgUnitId) {
      await this.validateAssigneeOrgUnitId(dto.assigneeOrgUnitId, organizationId);
    }

    const counted = exactlyOneFlags(template.objectType).filter((f) => flags.includes(f));
    const stage = await this.prisma.$transaction(async (tx) => {
      if (counted.length > 0) await this.lockTemplate(tx, templateId, organizationId);
      const created = await tx.workflowStage.create({
      data: {
        workflowTemplateId: templateId,
        nameEn: dto.nameEn,
        nameAr: dto.nameAr,
        description: dto.description ?? null,
        order: dto.order,
        slaWorkingHours: dto.slaWorkingHours ?? null,
        isInitial: dto.isInitial ?? false,
        isFinal: dto.isFinal ?? false,
        approvalMode: dto.approvalMode,
        parallelThreshold: dto.parallelThreshold ?? null,
        // Org-validated above (ACC-22, closing the ACC-17 deferred gap) —
        // mirrors validateAssigneeUserId() for assigneeUserId just above.
        committeeId: dto.committeeId ?? null,
        assigneeStrategy: dto.assigneeStrategy,
        assigneeUserId: dto.assigneeUserId ?? null,
        assigneeRoleId: dto.assigneeRoleId ?? null,
        assigneeCommitteeRoleValueId: dto.assigneeCommitteeRoleValueId ?? null,
        assigneePositionId: dto.assigneePositionId ?? null,
        assigneeOrgUnitId: dto.assigneeOrgUnitId ?? null,
        escalationConfig: this.toJson(dto.escalationConfig),
        flags,
      },
      });
      if (actions.length > 0) {
        await tx.workflowStageRecordAction.createMany({
          data: actions.map((actionKey) => ({ organizationId, stageId: created.id, actionKey })),
        });
      }
      await this.assertFlagCardinality(tx, templateId, counted);
      return created;
    });

    // ACC-255 — the whole new stage, its actions and flags included.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowStage',
      objectId: stage.id,
      after: stageSnapshot(stage, actions),
    });

    return this.mapStage(stage, undefined, actions);
  }

  async updateStage(
    id: string,
    dto: UpdateWorkflowStageDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowStage> {
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id, workflowTemplate: { organizationId } },
      include: {
        workflowTemplate: { select: { objectType: true } },
        recordActions: { where: { organizationId }, select: { actionKey: true } },
      },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');
    const objectType = stage.workflowTemplate.objectType;
    const storedActions = orderedActionKeys(objectType, (stage.recordActions ?? []).map((r) => r.actionKey));
    const storedFlags = stage.flags ?? [];
    const stored = stage as unknown as Record<string, unknown>;
    const { who: sentWho, ...fields } = dto;

    // ACC-271 PR 3 — once a stage is converted (or this save converts it), the
    // old people fields are not read: re-sending one unchanged is accepted, a
    // CHANGED one is refused (WHO_MOVED_TO_STAGE).
    if (isConvertedStage(stage) || sentWho !== undefined) {
      refuseChangedOldPeopleField(stored, fields as Record<string, unknown>, OLD_STAGE_WHO_FIELDS);
    }
    // ACC-271 PR 3 — the `who` sent, checked for shape before anything is read.
    const recordRoute = RECORD_ROUTES[objectType];
    const wantedWho =
      sentWho === undefined
        ? undefined
        : assertWhoShape(objectType, sentWho, { unit: typeof recordRoute?.unit === 'function', committee: typeof recordRoute?.committee === 'function' });
    const storedEntries: StoredWhoEntry[] = await this.prisma.workflowStageAssignee.findMany({
      where: { organizationId, stageId: id },
      orderBy: { order: 'asc' },
    });
    const whoChanged =
      sentWho !== undefined &&
      wantedWho !== undefined &&
      (sentWho.mode !== stage.whoMode ||
        storedEntries.map((e) => entryKey(e)).join('\n') !== wantedWho.map((e) => entryKey(e)).join('\n'));

    // ACC-239 — a protected template's stage keeps its shape: only a field
    // that CHANGES, outside names, description and deadline, is refused.
    // ACC-255 — actions and flags compare as sets, so re-sending the stored
    // ones passes. ACC-271 PR 3 — and so does an unchanged `who`.
    if (PROTECTED_TEMPLATES.has(objectType)) {
      const changed = Object.entries(fields).filter(([field, value]) => {
        if (value === undefined || PROTECTED_STAGE_EDITABLE.has(field)) return false;
        if (field === 'actions') return !sameKeySet(storedActions, value as string[]);
        if (field === 'flags') return !sameKeySet(storedFlags, value as string[]);
        return (stored[field] ?? null) !== (value ?? null);
      });
      if (changed.length > 0 || whoChanged) refuseProtected('STAGE_FIELD');
    }
    // Every id the new `who` names is this organisation's, and no chosen person is deactivated.
    if (whoChanged && wantedWho) await this.assertWhoReferences(wantedWho, organizationId);
    const rules = this.stageRuleKeys(objectType, dto.actions, dto.flags);

    if (dto.assigneeUserId) {
      await this.validateAssigneeUserId(dto.assigneeUserId, organizationId);
    }
    if (dto.committeeId) {
      await this.validateCommitteeId(dto.committeeId, organizationId);
    }
    if (dto.assigneeCommitteeRoleValueId) {
      await this.validateCommitteeRoleValueId(dto.assigneeCommitteeRoleValueId, organizationId);
    }
    if (dto.assigneePositionId) {
      await this.validateAssigneePositionId(dto.assigneePositionId, organizationId);
    }
    if (dto.assigneeOrgUnitId) {
      await this.validateAssigneeOrgUnitId(dto.assigneeOrgUnitId, organizationId);
    }

    // ACC-190 — the stage-deadline rule from the stage's side: a deadline
    // shorter than the longest task defined on it is refused. And a stage that
    // creates tasks cannot become final: a final stage completes the record the
    // moment it arrives, so its tasks could hold nothing.
    if (dto.slaWorkingHours !== undefined) {
      await this.stageTasks.assertStageDeadlineFits(id, dto.slaWorkingHours ?? null, organizationId);
    }
    if (dto.isFinal === true && !stage.isFinal) {
      const defined = await this.prisma.workflowStageTaskDefinition.count({ where: { stageId: id, organizationId } });
      if (defined > 0) throw new WorkflowRefusalException('STAGE_TASK_ON_FINAL_STAGE', { taskDefinitionCount: defined });
    }

    // ACC-255 — an exactly-one flag this save adds or removes is re-counted
    // across the template after the write, under the template's lock.
    const newFlags = rules.flags;
    const counted =
      newFlags === undefined ? [] : exactlyOneFlags(objectType).filter((f) => storedFlags.includes(f) !== newFlags.includes(f));

    const { updated, actionsBefore, actionsAfter } = await this.prisma.$transaction(async (tx) => {
      if (counted.length > 0) await this.lockTemplate(tx, stage.workflowTemplateId, organizationId);
      // The update takes the stage's row lock, so the action rows read next
      // are the ones no other save is changing.
      const written = await tx.workflowStage.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.slaWorkingHours !== undefined && { slaWorkingHours: dto.slaWorkingHours }),
        ...(dto.isInitial !== undefined && { isInitial: dto.isInitial }),
        ...(dto.isFinal !== undefined && { isFinal: dto.isFinal }),
        ...(dto.approvalMode !== undefined && { approvalMode: dto.approvalMode }),
        ...(dto.parallelThreshold !== undefined && { parallelThreshold: dto.parallelThreshold }),
        // Org-validated above (ACC-22, closing the ACC-17 deferred gap) —
        // see the same validation in addStage above.
        ...(dto.committeeId !== undefined && { committeeId: dto.committeeId }),
        ...(dto.assigneeStrategy !== undefined && { assigneeStrategy: dto.assigneeStrategy }),
        ...(dto.assigneeUserId !== undefined && { assigneeUserId: dto.assigneeUserId }),
        ...(dto.assigneeRoleId !== undefined && { assigneeRoleId: dto.assigneeRoleId }),
        ...(dto.assigneeCommitteeRoleValueId !== undefined && {
          assigneeCommitteeRoleValueId: dto.assigneeCommitteeRoleValueId,
        }),
        // ACC-54 — `!== undefined` rather than a truthiness check, matching
        // every sibling above: it lets an explicit null clear a previously-set
        // value (e.g. switching a stage away from POSITION_FIXED), which
        // `dto.x && ...` would silently ignore.
        ...(dto.assigneePositionId !== undefined && { assigneePositionId: dto.assigneePositionId }),
        ...(dto.assigneeOrgUnitId !== undefined && { assigneeOrgUnitId: dto.assigneeOrgUnitId }),
        ...(dto.escalationConfig !== undefined && { escalationConfig: this.toJson(dto.escalationConfig) }),
        ...(newFlags !== undefined && { flags: newFlags }),
        // ACC-271 PR 3 — how the stage's people decide; setting it converts the stage.
        ...(whoChanged && sentWho && { whoMode: sentWho.mode }),
      },
      });
      const replaced =
        rules.actions === undefined
          ? { before: storedActions, after: storedActions }
          : await this.replaceStageActions(tx, id, organizationId, rules.actions);
      // ACC-271 PR 3 — the entries, under the stage's row lock the update took.
      if (whoChanged && wantedWho) await this.replaceStageWho(tx, id, organizationId, wantedWho, actorId);
      await this.assertFlagCardinality(tx, stage.workflowTemplateId, counted);
      return { updated: written, actionsBefore: replaced.before, actionsAfter: replaced.after };
    });

    // ACC-271 PR 3 — the stage's who as it now stands, named once for the audit and the response.
    const entriesAfter: StoredWhoEntry[] = whoChanged
      ? await this.prisma.workflowStageAssignee.findMany({ where: { organizationId, stageId: id }, orderBy: { order: 'asc' } })
      : storedEntries;
    const refs = await this.loadWhoReferences([...storedEntries, ...entriesAfter], organizationId);
    const whoAudit = (mode: PrismaWorkflowStage['whoMode'], entries: StoredWhoEntry[]): Record<string, unknown> => ({
      whoMode: mode ?? null,
      whoEntries: whoAuditEntries(entries.map((e) => ({ ...entryForSentence(e, refs), isStartingAssignment: e.isStartingAssignment }))),
    });

    // ACC-255 — every field that changed, before and after; nothing for a no-op.
    // ACC-271 PR 3 — who works the stage too: how they decide, and each entry
    // as a numbered phrase (a reorder is a change; an unchanged who is not).
    const diff = stageAuditDiff(
      { ...stageSnapshot(stage, orderedActionKeys(objectType, actionsBefore)), ...whoAudit(stage.whoMode, storedEntries) },
      { ...stageSnapshot(updated, orderedActionKeys(objectType, actionsAfter)), ...whoAudit(updated.whoMode, entriesAfter) },
    );
    if (diff) {
      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'UPDATE',
        objectType: 'WorkflowStage',
        objectId: id,
        before: diff.before,
        after: diff.after,
      });
    }

    return {
      ...this.mapStage(updated, undefined, orderedActionKeys(objectType, actionsAfter)),
      ...this.whoRead(updated.whoMode, entriesAfter, refs),
    };
  }

  async removeStage(id: string, organizationId: string, actorId: string): Promise<void> {
    const stage = await this.prisma.workflowStage.findFirst({
      where: { id, workflowTemplate: { organizationId } },
      include: {
        workflowTemplate: { select: { objectType: true } },
        recordActions: { where: { organizationId }, select: { actionKey: true } },
      },
    });
    if (!stage) throw new NotFoundException('Workflow stage not found');
    if (PROTECTED_TEMPLATES.has(stage.workflowTemplate.objectType)) refuseProtected('REMOVE_STAGE');

    const referencingTransition = await this.prisma.workflowTransition.findFirst({
      where: { OR: [{ fromStageId: id }, { toStageId: id }] },
    });
    if (referencingTransition) {
      throw new ConflictException(
        'This stage is still referenced by a transition and cannot be removed',
      );
    }

    if (stage.isInitial) {
      const siblingCount = await this.prisma.workflowStage.count({
        where: { workflowTemplateId: stage.workflowTemplateId, NOT: { id } },
      });
      if (siblingCount > 0) {
        throw new ConflictException(
          'The initial stage cannot be removed while other stages exist in this template',
        );
      }
    }

    // ACC-255 — the action rows go with the stage (cascade); an exactly-one
    // flag it carried must still sit on exactly one stage afterwards.
    const objectType = stage.workflowTemplate.objectType;
    const counted = exactlyOneFlags(objectType).filter((f) => (stage.flags ?? []).includes(f));
    await this.prisma.$transaction(async (tx) => {
      if (counted.length > 0) await this.lockTemplate(tx, stage.workflowTemplateId, organizationId);
      await tx.workflowStage.delete({ where: { id } });
      await this.assertFlagCardinality(tx, stage.workflowTemplateId, counted);
    });

    // ACC-255 — the whole removed stage, its actions and flags included.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowStage',
      objectId: id,
      before: stageSnapshot(stage, orderedActionKeys(objectType, (stage.recordActions ?? []).map((r) => r.actionKey))),
    });
  }

  // ── Stage rules (ACC-255) ────────────────────────────────────────────────────

  /**
   * Checks a save's action and flag keys against the record type's registry,
   * and returns them deduplicated in registry order (undefined = not sent).
   */
  private stageRuleKeys(
    objectType: WorkflowObjectType,
    actions: string[] | undefined,
    flags: string[] | undefined,
  ): { actions?: string[]; flags?: string[] } {
    const unknownAction = actions?.find((key) => !isRecordAction(objectType, key));
    if (unknownAction !== undefined) {
      throw new WorkflowRefusalException('STAGE_ACTION_UNKNOWN', { actionKey: unknownAction, objectType });
    }
    const unknownFlag = flags?.find((key) => !isStageFlag(objectType, key));
    if (unknownFlag !== undefined) {
      throw new WorkflowRefusalException('STAGE_FLAG_UNKNOWN', { flag: unknownFlag, objectType });
    }
    return {
      ...(actions !== undefined && { actions: orderedActionKeys(objectType, actions) }),
      ...(flags !== undefined && { flags: orderedFlagKeys(objectType, flags) }),
    };
  }

  /** Replaces a stage's action rows with `wanted`, writing only the difference. Run inside the stage's transaction. */
  private async replaceStageActions(
    tx: EngineTx,
    stageId: string,
    organizationId: string,
    wanted: string[],
  ): Promise<{ before: string[]; after: string[] }> {
    const rows = await tx.workflowStageRecordAction.findMany({ where: { organizationId, stageId }, select: { actionKey: true } });
    const before = rows.map((r) => r.actionKey);
    const remove = before.filter((key) => !wanted.includes(key));
    const add = wanted.filter((key) => !before.includes(key));
    if (remove.length > 0) {
      await tx.workflowStageRecordAction.deleteMany({ where: { organizationId, stageId, actionKey: { in: remove } } });
    }
    if (add.length > 0) {
      await tx.workflowStageRecordAction.createMany({ data: add.map((actionKey) => ({ organizationId, stageId, actionKey })) });
    }
    return { before, after: wanted };
  }

  /** Locks the template row, so two saves touching an exactly-one flag count one after the other. */
  private async lockTemplate(tx: EngineTx, templateId: string, organizationId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "WorkflowTemplate" WHERE id = ${templateId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  }

  /**
   * Refuses (409 STAGE_FLAG_EXACTLY_ONE, rolling the save back) when a flag the
   * save touched no longer sits on exactly one stage of the template. Only a
   * touched flag is counted, so a template already short of one (before its
   * backfill) is not refused an unrelated save.
   */
  private async assertFlagCardinality(tx: EngineTx, templateId: string, flags: string[]): Promise<void> {
    for (const flag of flags) {
      const holders = await tx.workflowStage.findMany({
        where: { workflowTemplateId: templateId, flags: { has: flag } },
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: { order: 'asc' },
      });
      if (holders.length !== 1) {
        // ACC-255 PR 4b-be (G3) — the ids beside the names, in the same order,
        // so the stage editor can say which OTHER stage holds the flag.
        throw new WorkflowRefusalException('STAGE_FLAG_EXACTLY_ONE', {
          flag,
          stageNames: holders.map(({ nameEn, nameAr }) => ({ nameEn, nameAr })),
          stageIds: holders.map((h) => h.id),
        });
      }
    }
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  async addTransition(
    dto: CreateWorkflowTransitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionWriteResult> {
    const fromStage = await this.prisma.workflowStage.findFirst({
      where: { id: dto.fromStageId, workflowTemplate: { organizationId } },
      include: { workflowTemplate: { select: { objectType: true } } },
    });
    if (!fromStage) throw new NotFoundException('From-stage not found');
    if (PROTECTED_TEMPLATES.has(fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');

    const toStage = await this.prisma.workflowStage.findFirst({
      where: { id: dto.toStageId, workflowTemplate: { organizationId } },
    });
    if (!toStage) throw new NotFoundException('To-stage not found');

    if (fromStage.workflowTemplateId !== toStage.workflowTemplateId) {
      throw new ConflictException('A transition must connect two stages of the same template');
    }
    this.assertNoRetiredValidator(dto.validatorConfig);
    // ACC-271 PR 3 — from a converted stage, whoever works it presses the move:
    // a new move names no role, person or permission (nothing would read them),
    // and is never the app's (only seeds write those, plan §4.4). The trigger
    // condition an old screen sends is kept, unread; the mover is PERSON.
    const converted = isConvertedStage(fromStage);
    if (converted) {
      refuseChangedOldPeopleField(
        { triggerCondition: dto.triggerCondition === 'SYSTEM_AUTOMATIC' ? null : dto.triggerCondition, triggerRoleId: null, triggerUserId: null, requiredPermission: null },
        dto as unknown as Record<string, unknown>,
        OLD_TRANSITION_WHO_FIELDS,
      );
    }
    await this.assertTransitionPermissionGrantable(dto.requiredPermission, organizationId);

    const transition = await this.prisma.workflowTransition.create({
      data: {
        fromStageId: dto.fromStageId,
        toStageId: dto.toStageId,
        labelEn: dto.labelEn,
        labelAr: dto.labelAr,
        requiredPermission: dto.requiredPermission ?? null,
        triggerCondition: dto.triggerCondition,
        triggerUserId: dto.triggerUserId ?? null,
        triggerRoleId: dto.triggerRoleId ?? null,
        validatorConfig: this.toJson(dto.validatorConfig),
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(converted && { mover: 'PERSON' as const }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransition',
      objectId: transition.id,
      after: { labelEn: transition.labelEn, labelAr: transition.labelAr },
    });

    // Resolved AFTER the write, deliberately — this is advice about a saved
    // record, not a precondition for saving it.
    const permissionWarning = await this.resolvePermissionWarning(
      transition.requiredPermission,
      organizationId,
    );

    return { transition: this.mapTransition(transition), permissionWarning };
  }

  async updateTransition(
    id: string,
    dto: UpdateWorkflowTransitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionWriteResult> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
      include: { fromStage: { select: { whoMode: true, workflowTemplate: { select: { objectType: true } } } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');
    if (PROTECTED_TEMPLATES.has(transition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');
    // ACC-271 PR 3 — from a converted stage the move is pressed by whoever works
    // it: the old people fields re-sent unchanged pass, a changed one is refused.
    if (isConvertedStage(transition.fromStage)) {
      refuseChangedOldPeopleField(transition as unknown as Record<string, unknown>, dto as unknown as Record<string, unknown>, OLD_TRANSITION_WHO_FIELDS);
    }
    this.assertNoRetiredValidator(dto.validatorConfig);
    // Only a CHANGED key is checked. A transition already holding a key that
    // could not be chosen today (a seeded forward reference) keeps it when any
    // other field is edited, or when the editor sends the same key back.
    if (dto.requiredPermission !== undefined && dto.requiredPermission !== transition.requiredPermission) {
      await this.assertTransitionPermissionGrantable(dto.requiredPermission, organizationId);
    }

    const updated = await this.prisma.workflowTransition.update({
      where: { id },
      data: {
        ...(dto.labelEn !== undefined && { labelEn: dto.labelEn }),
        ...(dto.labelAr !== undefined && { labelAr: dto.labelAr }),
        ...(dto.requiredPermission !== undefined && { requiredPermission: dto.requiredPermission }),
        ...(dto.triggerCondition !== undefined && { triggerCondition: dto.triggerCondition }),
        ...(dto.triggerUserId !== undefined && { triggerUserId: dto.triggerUserId }),
        ...(dto.triggerRoleId !== undefined && { triggerRoleId: dto.triggerRoleId }),
        ...(dto.validatorConfig !== undefined && { validatorConfig: this.toJson(dto.validatorConfig) }),
        ...(dto.isApprovalPath !== undefined && { isApprovalPath: dto.isApprovalPath }),
        ...(dto.kind !== undefined && { kind: dto.kind }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTransition',
      objectId: id,
      before: {
        labelEn: transition.labelEn,
        labelAr: transition.labelAr,
        requiredPermission: transition.requiredPermission,
        triggerCondition: transition.triggerCondition,
        triggerUserId: transition.triggerUserId,
        triggerRoleId: transition.triggerRoleId,
        validatorConfig: transition.validatorConfig,
        isApprovalPath: transition.isApprovalPath,
        kind: transition.kind,
      },
      after: {
        labelEn: updated.labelEn,
        labelAr: updated.labelAr,
        requiredPermission: updated.requiredPermission,
        triggerCondition: updated.triggerCondition,
        triggerUserId: updated.triggerUserId,
        triggerRoleId: updated.triggerRoleId,
        validatorConfig: updated.validatorConfig,
        isApprovalPath: updated.isApprovalPath,
        kind: updated.kind,
      },
    });

    // Resolved against the SAVED value, not dto.requiredPermission — an
    // update that leaves the field untouched must still report a pre-existing
    // problem, otherwise editing an unrelated field would silently clear a
    // warning the transition still deserves.
    const permissionWarning = await this.resolvePermissionWarning(
      updated.requiredPermission,
      organizationId,
    );

    return { transition: this.mapTransition(updated), permissionWarning };
  }

  async removeTransition(id: string, organizationId: string, actorId: string): Promise<void> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
      include: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');
    if (PROTECTED_TEMPLATES.has(transition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');

    await this.prisma.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: id } });
    await this.prisma.workflowTransition.delete({ where: { id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowTransition',
      objectId: id,
      before: { labelEn: transition.labelEn, labelAr: transition.labelAr },
    });
  }

  // ── Transition Actions ───────────────────────────────────────────────────────

  async addTransitionAction(
    transitionId: string,
    dto: CreateWorkflowTransitionActionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id: transitionId, fromStage: { workflowTemplate: { organizationId } } },
      include: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');
    if (PROTECTED_TEMPLATES.has(transition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');
    if (dto.actionType === 'CREATE_TASK') throw new WorkflowRefusalException('ACTION_TYPE_RETIRED');

    const action = await this.prisma.workflowTransitionAction.create({
      data: {
        workflowTransitionId: transitionId,
        actionType: dto.actionType,
        order: dto.order,
        isEnabled: dto.isEnabled ?? true,
        configJson: this.toJson(dto.configJson),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransitionAction',
      objectId: action.id,
      after: { actionType: action.actionType, order: action.order },
    });

    return this.mapTransitionAction(action);
  }

  async updateTransitionAction(
    id: string,
    dto: UpdateWorkflowTransitionActionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionAction> {
    const action = await this.prisma.workflowTransitionAction.findFirst({
      where: { id, workflowTransition: { fromStage: { workflowTemplate: { organizationId } } } },
      include: { workflowTransition: { select: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } } } },
    });
    if (!action) throw new NotFoundException('Workflow transition action not found');
    if (PROTECTED_TEMPLATES.has(action.workflowTransition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');
    if (dto.actionType === 'CREATE_TASK') throw new WorkflowRefusalException('ACTION_TYPE_RETIRED');

    const updated = await this.prisma.workflowTransitionAction.update({
      where: { id },
      data: {
        ...(dto.actionType !== undefined && { actionType: dto.actionType }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(dto.configJson !== undefined && { configJson: this.toJson(dto.configJson) }),
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTransitionAction',
      objectId: id,
      before: { actionType: action.actionType, order: action.order, isEnabled: action.isEnabled },
      after: { actionType: updated.actionType, order: updated.order, isEnabled: updated.isEnabled },
    });

    return this.mapTransitionAction(updated);
  }

  async removeTransitionAction(id: string, organizationId: string, actorId: string): Promise<void> {
    const action = await this.prisma.workflowTransitionAction.findFirst({
      where: { id, workflowTransition: { fromStage: { workflowTemplate: { organizationId } } } },
      include: { workflowTransition: { select: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } } } },
    });
    if (!action) throw new NotFoundException('Workflow transition action not found');
    if (PROTECTED_TEMPLATES.has(action.workflowTransition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');

    await this.prisma.workflowTransitionAction.delete({ where: { id } });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'DELETE',
      objectType: 'WorkflowTransitionAction',
      objectId: id,
      before: { actionType: action.actionType, order: action.order },
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  // Record<string, unknown> doesn't structurally satisfy Prisma's InputJsonValue
  // type (it lacks the array-like index signature Prisma's Json type union
  // expects) — cast explicitly at every Json-field write, same pattern already
  // used by LookupService for attributeSchema/attributes.
  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
  }

  // ACC-190 — the task gate replaced this validator: a stage's mandatory tasks
  // hold every ADVANCE out of it without opting in.
  private assertNoRetiredValidator(config: Record<string, unknown> | undefined): void {
    if (config && 'allPreviousStageTasksComplete' in config) {
      throw new WorkflowRefusalException('VALIDATOR_RETIRED');
    }
  }

  // Re-validates a client-supplied assigneeUserId belongs to this org before
  // it's written onto a WorkflowStage — mirrors the re-scoping the ROLE case
  // already gets for free downstream (assigneeRoleId's eventual userRole
  // lookup is joined against user:{organizationId}); SPECIFIC_USER had no
  // equivalent check at write time (see ACC-17).
  private async validateAssigneeUserId(userId: string, organizationId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!user) {
      throw new NotFoundException('Assignee user not found in this tenant');
    }
  }

  // Re-validates a client-supplied committeeId belongs to this org before
  // it's written onto a WorkflowStage — same pattern as
  // validateAssigneeUserId() above. Deferred from ACC-17 ("no Committee/
  // CommitteeMember data exists anywhere yet, so there's nothing real to
  // validate against — must be revisited when Committee Management ships")
  // — closed here as part of ACC-22, since Committee is now a real table.
  private async validateCommitteeId(committeeId: string, organizationId: string): Promise<void> {
    const committee = await this.prisma.committee.findFirst({ where: { id: committeeId, organizationId } });
    if (!committee) {
      throw new NotFoundException('Committee not found in this tenant');
    }
  }

  // ACC-54 — same pattern as validateAssigneeUserId()/validateCommitteeId()
  // above, for the POSITION_FIXED pair. Both need it independently: a stage
  // could otherwise be written referencing another tenant's position, or
  // another tenant's org unit, or one of each.
  //
  // These are genuinely needed rather than defence-in-depth theatre —
  // resolveAssigneeRaw()'s POSITION_FIXED case does filter its own query by
  // organizationId, so a cross-tenant id would resolve to an empty pool
  // rather than leaking anyone. But storing a foreign tenant's id on a stage
  // is still wrong: it silently produces a permanently unresolvable stage,
  // and it puts another tenant's identifier in this tenant's configuration
  // where an admin can see it. Rejecting at write time is the same call
  // ACC-17 made for assigneeUserId for the same reason.
  private async validateAssigneePositionId(
    positionId: string,
    organizationId: string,
  ): Promise<void> {
    const position = await this.prisma.orgPosition.findFirst({
      where: { id: positionId, organizationId },
    });
    if (!position) {
      throw new NotFoundException('Assignee position not found in this tenant');
    }
  }

  private async validateAssigneeOrgUnitId(orgUnitId: string, organizationId: string): Promise<void> {
    const orgUnit = await this.prisma.orgUnit.findFirst({
      where: { id: orgUnitId, organizationId },
    });
    if (!orgUnit) {
      throw new NotFoundException('Assignee org unit not found in this tenant');
    }
  }

  // ACC-28 — same pattern as validateAssigneeUserId()/validateCommitteeId()
  // above. A LookupValue is visible to this tenant if it's the SYSTEM row
  // (organizationId: null) or a tenant-scoped row (custom value, or an
  // overrideLabel()-created override with its own id) — same "system OR
  // tenant" shape LookupService.getValues() itself resolves against.
  // ACC-120 slice 5 (F1) — a transition may not REQUIRE a key no role can be
  // given: that is a transition nobody can ever fire. So a key a person picks
  // is refused, with the role save's own codes, when it is unknown
  // (PERMISSION_UNKNOWN), a platform key inside a tenant
  // (PLATFORM_PERMISSION_NOT_ALLOWED) or a key nothing checks yet
  // (PERMISSION_NOT_IN_USE). No key (null or blank) is always allowed. The
  // rule is permission-grantability.ts, the one the role save reads.
  //
  // This governs the EDITOR's writes only. seedTemplates() writes its
  // transitions directly, forward references included, and is untouched.
  private async assertTransitionPermissionGrantable(
    key: string | null | undefined,
    organizationId: string,
  ): Promise<void> {
    if (!key || key.trim() === '') return;
    // The organisation is read only for a platform key, the one case where it
    // changes the answer.
    const isPlatformOrg = isPlatformPermission(key)
      ? (
          await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: { isPlatformOrg: true },
          })
        )?.isPlatformOrg === true
      : false;
    assertKnownAndGrantable([key], isPlatformOrg);
  }

  // ACC-55 — resolves why a transition's requiredPermission may be
  // unsatisfiable. Unlike every validate*() method above this is NOT a
  // validator: it never throws and never blocks a write.
  //
  // It cannot be one. seedTemplates() writes 45 transitions carrying
  // permission strings for modules that do not exist yet (workflow.seed.ts:66-81
  // declares them deliberate forward references), and a transition that already
  // holds one keeps it through an unrelated edit — so a saved value can still be
  // unknown or ungranted. Since ACC-120 slice 5 a NEWLY chosen key is refused
  // first (assertTransitionPermissionGrantable above); this reports on the rest.
  //
  // Returns null when the permission is genuinely satisfiable, or when none is
  // set at all (6 seeded transitions have no requiredPermission, which is a
  // valid configuration meaning "gated by triggerCondition alone").
  async resolvePermissionWarning(
    requiredPermission: string | null | undefined,
    organizationId: string,
  ): Promise<TransitionPermissionWarning | null> {
    if (!requiredPermission || requiredPermission.trim() === '') return null;

    const [module, action] = requiredPermission.split(':');
    if (!module || !action) return 'UNKNOWN_PERMISSION';

    // Permission is a GLOBAL table — no organizationId column, one row per
    // module:action shared by every tenant (only RolePermission is
    // tenant-scoped, via Role). So this query is correctly unscoped, and must
    // not be "fixed" to filter by organizationId: there is no such field.
    const permission = await this.prisma.permission.findFirst({
      where: { module, action },
      select: { id: true },
    });
    if (!permission) return 'UNKNOWN_PERMISSION';

    // Tenant-scoped through Role. isActive matters: a deactivated role's
    // grants cannot satisfy triggerTransition(), which reads permissions via
    // the actor's live role assignments.
    const holdingRoles = await this.prisma.rolePermission.count({
      where: {
        permissionId: permission.id,
        role: { organizationId, isActive: true },
      },
    });

    return holdingRoles === 0 ? 'NO_ACTIVE_ROLE_HOLDS' : null;
  }

  private async validateCommitteeRoleValueId(roleValueId: string, organizationId: string): Promise<void> {
    const value = await this.prisma.lookupValue.findFirst({
      where: {
        id: roleValueId,
        category: { key: 'committee_member_role' },
        OR: [{ organizationId: null }, { organizationId }],
      },
    });
    if (!value) {
      throw new NotFoundException('Committee member role lookup value not found in this tenant');
    }
  }

  // ── Internal mappers ─────────────────────────────────────────────────────────

  private mapTemplate(template: PrismaWorkflowTemplate): IWorkflowTemplate {
    return {
      id: template.id,
      organizationId: template.organizationId,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      objectType: template.objectType,
      isDefault: template.isDefault,
      isActive: template.isActive,
      // ACC-255 PR 4b-be (G6) — the server's own rule, the one every refusal reads.
      isProtected: PROTECTED_TEMPLATES.has(template.objectType),
      // ACC-255 PR 4b — what a protected template's stage may still change: the
      // set updateStage() checks, never a second list.
      ...(PROTECTED_TEMPLATES.has(template.objectType) && { editableStageFields: [...PROTECTED_STAGE_EDITABLE] }),
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private mapStage(stage: PrismaWorkflowStage, transitions?: IWorkflowTransition[], actions: string[] = []): IWorkflowStage {
    return {
      id: stage.id,
      workflowTemplateId: stage.workflowTemplateId,
      nameEn: stage.nameEn,
      nameAr: stage.nameAr,
      description: stage.description,
      order: stage.order,
      slaWorkingHours: stage.slaWorkingHours,
      isInitial: stage.isInitial,
      isFinal: stage.isFinal,
      approvalMode: stage.approvalMode,
      parallelThreshold: stage.parallelThreshold,
      committeeId: stage.committeeId,
      assigneeStrategy: stage.assigneeStrategy,
      assigneeUserId: stage.assigneeUserId,
      assigneeRoleId: stage.assigneeRoleId,
      assigneeCommitteeRoleValueId: stage.assigneeCommitteeRoleValueId,
      assigneePositionId: stage.assigneePositionId,
      assigneeOrgUnitId: stage.assigneeOrgUnitId,
      escalationConfig: stage.escalationConfig as Record<string, unknown> | null,
      actions,
      flags: [...(stage.flags ?? [])],
      ...(transitions !== undefined && { transitions }),
    };
  }

  private mapTransition(
    transition: PrismaWorkflowTransition,
    actions?: IWorkflowTransitionAction[],
  ): IWorkflowTransition {
    return {
      id: transition.id,
      fromStageId: transition.fromStageId,
      toStageId: transition.toStageId,
      labelEn: transition.labelEn,
      labelAr: transition.labelAr,
      requiredPermission: transition.requiredPermission,
      triggerCondition: transition.triggerCondition,
      triggerUserId: transition.triggerUserId,
      triggerRoleId: transition.triggerRoleId,
      validatorConfig: transition.validatorConfig as Record<string, unknown> | null,
      isApprovalPath: transition.isApprovalPath,
      kind: transition.kind,
      mover: transitionMover(transition),
      ...(actions !== undefined && { actions }),
    };
  }

  private mapTransitionAction(action: PrismaWorkflowTransitionAction): IWorkflowTransitionAction {
    return {
      id: action.id,
      workflowTransitionId: action.workflowTransitionId,
      actionType: action.actionType,
      order: action.order,
      isEnabled: action.isEnabled,
      configJson: action.configJson as Record<string, unknown> | null,
    };
  }
}
