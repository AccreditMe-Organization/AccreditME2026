import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
import { refuseProtected, WorkflowRefusalException } from './workflow-refusal';
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
import type { IStageWho, IStageWhoEntry } from './interfaces/workflow-stage.interface';
import {
  assertWhoShape,
  assigneeKindsFor,
  entryKey,
  normalizeEntry,
  whoAuditEntries,
  whoRulesFor,
  whoSentence,
  type WhoEntryField,
  type WhoEntryForSentence,
  type WhoEntryInput,
} from './stage-who';
import { appMoveFor } from './app-moves';
import { auditSecretsOf, headerChanges, maskActionConfig, mergeActionConfig } from './webhook-config-secrets';
import { transitionMover } from './workflow-pool';
import {
  assertHasStartingStage,
  assertStartAndEnd,
  clearOtherStartingStages,
  readStartEnd,
  type NamedStage,
} from './workflow-start-end';

/** Stage fields a protected template's stage may still change (names, description, deadline and its escalation). */
const PROTECTED_STAGE_EDITABLE: ReadonlySet<string> = new Set(['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig']);

/**
 * ACC-255 — every stage field an audit row may name, in the stage form's
 * order, then the stage rules. `addStage` and `removeStage` record all of
 * them; `updateStage` records the ones that changed (`stageAuditDiff`).
 * ACC-271 PR 6b — who works the stage is recorded beside them (`whoMode`,
 * `whoEntries`); the old people columns never are.
 */
const STAGE_AUDIT_FIELDS = ['nameEn', 'nameAr', 'description', 'order', 'slaWorkingHours', 'isInitial', 'isFinal', 'escalationConfig'] as const;

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

/** ACC-271 PR 5-be — a Fixed position entry's key in the holder counts. */
const holderKey = (positionId: string, orgUnitId: string): string => `${positionId}|${orgUnitId}`;

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
    // ACC-271 PR 5-be — and how many hold each Fixed position entry's position
    // in its unit: one grouped count for the whole template.
    const allEntries = stages.flatMap((s) => s.assignees ?? []);
    const [stageTasks, liveCounts, taskDueHours, refs, holders] = await Promise.all([
      this.stageTasks.summaryForStages(stages.map((s) => s.id), organizationId),
      this.liveCountsByStage(id, organizationId),
      this.stageTasks.taskDueHours(organizationId),
      this.loadWhoReferences(allEntries, organizationId),
      this.holderCountsFor(allEntries, organizationId),
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
      // ACC-271 PR 5-be — the rules a stage's who must meet, from the constants
      // the save validates against.
      whoRules: whoRulesFor(template.objectType),
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
        ...this.whoRead(s.whoMode, s.assignees ?? [], refs, holders),
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
      // A committee role is the SYSTEM value or this organisation's own (custom,
      // or an override with its own id), as LookupService.getValues() resolves it.
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
   * ACC-271 PR 5-be — how many hold each Fixed position entry's position in its
   * unit, by the holder rule the assignment picker counts with (ACTIVE, that
   * position, that unit as their primary unit). ONE grouped count for any
   * number of entries, scoped by the organisation; none when there are no
   * Fixed position entries.
   */
  private async holderCountsFor(entries: WhoEntryInput[], organizationId: string): Promise<Map<string, number>> {
    const fixed = entries.filter((e) => e.kind === 'POSITION_IN_UNIT' && e.positionId && e.orgUnitId);
    if (fixed.length === 0) return new Map();
    const groups = await this.prisma.user.groupBy({
      by: ['positionId', 'primaryOrgUnitId'],
      where: {
        organizationId,
        status: 'ACTIVE',
        positionId: { in: idsOf(fixed, 'positionId') },
        primaryOrgUnitId: { in: idsOf(fixed, 'orgUnitId') },
      },
      _count: { _all: true },
    });
    return new Map(
      groups.flatMap((g) => (g.positionId && g.primaryOrgUnitId ? [[holderKey(g.positionId, g.primaryOrgUnitId), g._count._all] as const] : [])),
    );
  }

  /**
   * Refuses an entry that names anything outside this organisation (or nothing
   * at all), and a person who can no longer sign in. One read per kind; returns
   * what it read, so a caller names the entries without reading them again.
   */
  private async assertWhoReferences(entries: Required<WhoEntryInput>[], organizationId: string): Promise<WhoReferences> {
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
    return refs;
  }

  /** A stage's `who` and its sentence, from its stored entries and the batched names. */
  private whoRead(
    whoMode: PrismaWorkflowStage['whoMode'],
    entries: StoredWhoEntry[],
    refs: WhoReferences,
    holders: Map<string, number>,
  ): { who: IStageWho | null; whoSentence: { en: string; ar: string } | null } {
    if (whoMode === null) return { who: null, whoSentence: null };
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
            holderCount:
              n.kind === 'POSITION_IN_UNIT' && n.positionId && n.orgUnitId ? (holders.get(holderKey(n.positionId, n.orgUnitId)) ?? 0) : null,
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

    // ACC-57 (Q2) — becoming the default needs a starting stage, checked under
    // the template lock a stage save takes, so the two cannot interleave.
    const becomesDefault = dto.isDefault === true && !template.isDefault;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (becomesDefault) {
        await this.lockTemplate(tx, id, organizationId);
        await assertHasStartingStage(tx, id);
      }
      return tx.workflowTemplate.update({
        where: { id },
        data: {
          ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
          ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
          ...(dto.objectType !== undefined && { objectType: dto.objectType }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        },
      });
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

    // ACC-57 (Q2) — a template with no starting stage can't become the
    // default: startInstance() would throw at whoever next creates a record.
    await this.prisma.$transaction(async (tx) => {
      await this.lockTemplate(tx, id, organizationId);
      await assertHasStartingStage(tx, id);
      await tx.workflowTemplate.updateMany({
        where: { organizationId, objectType: template.objectType, NOT: { id } },
        data: { isDefault: false },
      });
      await tx.workflowTemplate.update({ where: { id }, data: { isDefault: true } });
    });

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

    // ACC-271 PR 5-be — a stage is converted in the same transaction that
    // creates it, its `who` checked exactly as a who save is: its shape first,
    // then every id it names against this organisation. PR 6a — a stage created
    // without `who` is refused (WHO_REQUIRED): the engine reads nothing else,
    // so such a stage would be worked by nobody. PR 6b — the DTO has no old
    // people field, so none can be sent beside it.
    const { who: sentWho } = dto;
    if (sentWho === undefined) throw new WorkflowRefusalException('WHO_REQUIRED');
    const recordRoute = RECORD_ROUTES[template.objectType];
    const wantedWho = assertWhoShape(template.objectType, sentWho, {
      unit: typeof recordRoute?.unit === 'function',
      committee: typeof recordRoute?.committee === 'function',
    });
    const whoRefs = await this.assertWhoReferences(wantedWho, organizationId);

    const counted = exactlyOneFlags(template.objectType).filter((f) => flags.includes(f));
    const { stage, movedFrom } = await this.prisma.$transaction(async (tx) => {
      // ACC-57 — a new stage always changes the template's start and end, so
      // the template is locked and read before the write, and checked after.
      await this.lockTemplate(tx, templateId, organizationId);
      const before = await readStartEnd(tx, templateId);
      // Q1 — a new starting stage takes over from the old one.
      const moved = dto.isInitial ? await clearOtherStartingStages(tx, templateId, before) : [];
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
        // ACC-271 PR 6b — no old people column is written: they keep their
        // database defaults, nothing reads them, and 6c drops them.
        escalationConfig: this.toJson(dto.escalationConfig),
        flags,
        // ACC-271 PR 5-be — how the new stage's people decide; setting it converts the stage.
        whoMode: sentWho.mode,
      },
      });
      if (actions.length > 0) {
        await tx.workflowStageRecordAction.createMany({
          data: actions.map((actionKey) => ({ organizationId, stageId: created.id, actionKey })),
        });
      }
      // ACC-271 PR 5-be — the entries, in the transaction that creates the stage.
      await this.replaceStageWho(tx, created.id, organizationId, wantedWho, actorId);
      await this.assertFlagCardinality(tx, templateId, counted);
      await assertStartAndEnd(tx, templateId, before, created);
      return { stage: created, movedFrom: moved };
    });
    await this.auditStartingStageMoved(movedFrom, organizationId, actorId);

    // ACC-271 PR 5-be — the new stage's who, named once for the audit and the
    // response from the references its check already read.
    const entries: StoredWhoEntry[] = await this.prisma.workflowStageAssignee.findMany({
      where: { organizationId, stageId: stage.id },
      orderBy: { order: 'asc' },
    });
    const holders = await this.holderCountsFor(entries, organizationId);
    const named = {
      whoMode: stage.whoMode ?? null,
      whoEntries: whoAuditEntries(entries.map((e) => ({ ...entryForSentence(e, whoRefs), isStartingAssignment: e.isStartingAssignment }))),
    };

    // ACC-255 — the whole new stage, its actions and flags included; ACC-271
    // PR 5-be — and who works it, as a who save records it.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowStage',
      objectId: stage.id,
      after: { ...stageSnapshot(stage, actions), ...named },
    });

    return {
      ...this.mapStage(stage, undefined, actions),
      ...this.whoRead(stage.whoMode, entries, whoRefs, holders),
      ...(movedFrom.length > 0 && { startingStageMovedFrom: movedFrom }),
    };
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

    // ACC-57 — a save that changes Initial or Final is checked against the
    // template's start and end, under the template lock, after the write.
    const touchesStartEnd =
      (dto.isInitial !== undefined && dto.isInitial !== stage.isInitial) || (dto.isFinal !== undefined && dto.isFinal !== stage.isFinal);

    const { updated, actionsBefore, actionsAfter, movedFrom } = await this.prisma.$transaction(async (tx) => {
      if (counted.length > 0 || touchesStartEnd) await this.lockTemplate(tx, stage.workflowTemplateId, organizationId);
      const before = touchesStartEnd ? await readStartEnd(tx, stage.workflowTemplateId) : null;
      // Q1 — ticking Initial moves the starting stage here.
      const moved =
        before && dto.isInitial === true && !stage.isInitial
          ? await clearOtherStartingStages(tx, stage.workflowTemplateId, before, id)
          : [];
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
      if (before) await assertStartAndEnd(tx, stage.workflowTemplateId, before, written);
      return { updated: written, actionsBefore: replaced.before, actionsAfter: replaced.after, movedFrom: moved };
    });
    await this.auditStartingStageMoved(movedFrom, organizationId, actorId);

    // ACC-271 PR 3 — the stage's who as it now stands, named once for the audit and the response.
    const entriesAfter: StoredWhoEntry[] = whoChanged
      ? await this.prisma.workflowStageAssignee.findMany({ where: { organizationId, stageId: id }, orderBy: { order: 'asc' } })
      : storedEntries;
    const [refs, holders] = await Promise.all([
      this.loadWhoReferences([...storedEntries, ...entriesAfter], organizationId),
      this.holderCountsFor(entriesAfter, organizationId),
    ]);
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
      ...this.whoRead(updated.whoMode, entriesAfter, refs, holders),
      ...(movedFrom.length > 0 && { startingStageMovedFrom: movedFrom }),
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

    // ACC-255 — the action rows go with the stage (cascade); an exactly-one
    // flag it carried must still sit on exactly one stage afterwards.
    const objectType = stage.workflowTemplate.objectType;
    const counted = exactlyOneFlags(objectType).filter((f) => (stage.flags ?? []).includes(f));
    await this.prisma.$transaction(async (tx) => {
      // Template, then stage: the order every stage save takes. The stage's
      // row lock holds off anything that would reference it (a transition, a
      // record entering it) until the delete commits, so the counts below
      // cannot go stale between the count and the delete.
      await this.lockTemplate(tx, stage.workflowTemplateId, organizationId);
      await tx.$queryRaw`SELECT id FROM "WorkflowStage" WHERE id = ${id} FOR UPDATE`;

      // ACC-191 (Q4) — the transitions in and out go first, said from a code.
      const transitionCount = await tx.workflowTransition.count({
        where: { OR: [{ fromStageId: id }, { toStageId: id }], fromStage: { workflowTemplate: { organizationId } } },
      });
      if (transitionCount > 0) throw new WorkflowRefusalException('STAGE_HAS_TRANSITIONS', { transitionCount });

      // ACC-191 — a stage a record has entered is kept: its history names it
      // (WorkflowInstanceStage.stageId, RESTRICT). It can be renamed.
      const recordCount = await this.recordsThatEntered(tx, id, organizationId);
      if (recordCount > 0) throw new WorkflowRefusalException('STAGE_IN_USE', { recordCount });

      // ACC-57 — removing the starting stage while others remain leaves the
      // template with none (STAGE_INITIAL_REQUIRED, which replaced the old
      // codeless refusal); removing the last stage leaves a template not yet built.
      const before = await readStartEnd(tx, stage.workflowTemplateId);
      await tx.workflowStage.delete({ where: { id } });
      await this.assertFlagCardinality(tx, stage.workflowTemplateId, counted);
      await assertStartAndEnd(tx, stage.workflowTemplateId, before, stage);
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

  /**
   * ACC-191 — how many records have entered a stage: distinct records, so one
   * that came back through the stage counts once. Any entry at all blocks the
   * delete (RESTRICT); a count of 0 with entries cannot happen, since every
   * entry has an instance and every instance a record.
   */
  private async recordsThatEntered(tx: EngineTx, stageId: string, organizationId: string): Promise<number> {
    const [row] = await tx.$queryRaw<{ entries: number; records: number }[]>`
      SELECT COUNT(*)::int AS entries, COUNT(DISTINCT (wi."objectType", wi."objectId"))::int AS records
      FROM "WorkflowInstanceStage" e
      JOIN "WorkflowInstance" wi ON wi.id = e."workflowInstanceId"
      WHERE e."stageId" = ${stageId} AND wi."organizationId" = ${organizationId}`;
    return row && row.entries > 0 ? Math.max(row.records, 1) : 0;
  }

  /** ACC-57 (Q1) — one audit row per stage that stopped being the starting stage because another took over. */
  private async auditStartingStageMoved(movedFrom: NamedStage[], organizationId: string, actorId: string): Promise<void> {
    for (const stage of movedFrom) {
      await this.auditLog.log({
        tenantId: organizationId,
        actorId,
        action: 'UPDATE',
        objectType: 'WorkflowStage',
        objectId: stage.id,
        before: { isInitial: true },
        after: { isInitial: false },
      });
    }
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
    // ACC-271 PR 6b — whoever works the from-stage presses the move: it names no
    // role, person or permission, and is never the app's (only seeds write
    // those, plan §4.4). Its mover is always PERSON; the old people columns
    // keep their database defaults (6c drops them).
    const transition = await this.prisma.workflowTransition.create({
      data: {
        fromStageId: dto.fromStageId,
        toStageId: dto.toStageId,
        labelEn: dto.labelEn,
        labelAr: dto.labelAr,
        validatorConfig: this.toJson(dto.validatorConfig),
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(dto.isApprovalPath !== undefined && { isApprovalPath: dto.isApprovalPath }),
        mover: 'PERSON',
      },
    });

    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransition',
      objectId: transition.id,
      after: { labelEn: transition.labelEn, labelAr: transition.labelAr, mover: transition.mover },
    });

    return { transition: this.mapTransition(transition) };
  }

  async updateTransition(
    id: string,
    dto: UpdateWorkflowTransitionDto,
    organizationId: string,
    actorId: string,
  ): Promise<IWorkflowTransitionWriteResult> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
      include: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');
    if (PROTECTED_TEMPLATES.has(transition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');
    this.assertNoRetiredValidator(dto.validatorConfig);

    const updated = await this.prisma.workflowTransition.update({
      where: { id },
      data: {
        ...(dto.labelEn !== undefined && { labelEn: dto.labelEn }),
        ...(dto.labelAr !== undefined && { labelAr: dto.labelAr }),
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
        validatorConfig: transition.validatorConfig,
        isApprovalPath: transition.isApprovalPath,
        kind: transition.kind,
        mover: transition.mover,
      },
      after: {
        labelEn: updated.labelEn,
        labelAr: updated.labelAr,
        validatorConfig: updated.validatorConfig,
        isApprovalPath: updated.isApprovalPath,
        kind: updated.kind,
        mover: updated.mover,
      },
    });

    return { transition: this.mapTransition(updated) };
  }

  async removeTransition(id: string, organizationId: string, actorId: string): Promise<void> {
    const transition = await this.prisma.workflowTransition.findFirst({
      where: { id, fromStage: { workflowTemplate: { organizationId } } },
      include: { fromStage: { select: { workflowTemplate: { select: { objectType: true } } } } },
    });
    if (!transition) throw new NotFoundException('Workflow transition not found');
    if (PROTECTED_TEMPLATES.has(transition.fromStage.workflowTemplate.objectType)) refuseProtected('TRANSITION');

    // ACC-191 (Q3) — a transition whose actions have run is kept: their log
    // rows name the actions (WorkflowActionLog, RESTRICT). Counted and deleted
    // in one transaction, under the transition's and its actions' row locks, so
    // no run can be logged between the count and the delete.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WorkflowTransition" WHERE id = ${id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "WorkflowTransitionAction" WHERE "workflowTransitionId" = ${id} FOR UPDATE`;
      const runCount = await tx.workflowActionLog.count({
        where: { organizationId, workflowTransitionAction: { workflowTransitionId: id } },
      });
      if (runCount > 0) throw new WorkflowRefusalException('TRANSITION_IN_USE', { runCount });
      await tx.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: id } });
      await tx.workflowTransition.delete({ where: { id } });
    });

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

    // ACC-277 — stored as sent, less the read-only markers a client may echo back.
    const configJson = dto.configJson === undefined ? undefined : mergeActionConfig(null, dto.configJson);
    // ACC-271 PR 5b — a left-out order puts the action last: the transition's
    // highest order + 10, or 10 when it has none. One aggregate read, made only
    // when the order is left out. Order is not unique, so two adds at once may
    // tie, which only leaves their relative order to the read's tie-break.
    const order = dto.order ?? (await this.nextActionOrder(transitionId, organizationId));
    const action = await this.prisma.workflowTransitionAction.create({
      data: {
        workflowTransitionId: transitionId,
        actionType: dto.actionType,
        order,
        isEnabled: dto.isEnabled ?? true,
        configJson: this.toJson(configJson),
      },
    });

    // ACC-277 — header names and whether a signing secret is set; never a value.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'CREATE',
      objectType: 'WorkflowTransitionAction',
      objectId: action.id,
      after: { actionType: action.actionType, order: action.order, ...auditSecretsOf(configJson ?? null) },
    });

    return this.mapTransitionAction(action);
  }

  /** The order that puts a new action after every action already on the transition. */
  private async nextActionOrder(transitionId: string, organizationId: string): Promise<number> {
    const { _max } = await this.prisma.workflowTransitionAction.aggregate({
      where: { workflowTransitionId: transitionId, workflowTransition: { fromStage: { workflowTemplate: { organizationId } } } },
      _max: { order: true },
    });
    return _max.order === null ? 10 : _max.order + 10;
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

    // ACC-277 — a secret sent empty keeps its stored value, a value replaces
    // it, and a header left out is removed (mergeActionConfig).
    const storedConfig = action.configJson as Record<string, unknown> | null;
    const configJson = dto.configJson === undefined ? undefined : mergeActionConfig(storedConfig, dto.configJson);
    const updated = await this.prisma.workflowTransitionAction.update({
      where: { id },
      data: {
        ...(dto.actionType !== undefined && { actionType: dto.actionType }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.isEnabled !== undefined && { isEnabled: dto.isEnabled }),
        ...(configJson !== undefined && { configJson: this.toJson(configJson) }),
      },
    });

    // ACC-277 — header names, and which a save added, removed or changed;
    // never a value.
    const afterConfig = configJson ?? storedConfig;
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'WorkflowTransitionAction',
      objectId: id,
      before: { actionType: action.actionType, order: action.order, isEnabled: action.isEnabled, ...auditSecretsOf(storedConfig) },
      after: {
        actionType: updated.actionType,
        order: updated.order,
        isEnabled: updated.isEnabled,
        ...auditSecretsOf(afterConfig),
        ...(configJson !== undefined && {
          headersChanged: headerChanges(storedConfig, configJson),
          signingSecretChanged: (storedConfig?.['signingSecret'] ?? null) !== (configJson['signingSecret'] ?? null),
        }),
      },
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

    // ACC-191 — an action that has run is kept: its log rows name it
    // (WorkflowActionLog, RESTRICT). It can be turned off instead. Counted and
    // deleted under the action's row lock, so no run is logged in between.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WorkflowTransitionAction" WHERE id = ${id} FOR UPDATE`;
      const runCount = await tx.workflowActionLog.count({ where: { organizationId, workflowTransitionActionId: id } });
      if (runCount > 0) throw new WorkflowRefusalException('TRANSITION_ACTION_IN_USE', { runCount });
      await tx.workflowTransitionAction.delete({ where: { id } });
    });

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
      // ACC-277 — the one way an action leaves this service: secrets masked.
      configJson: maskActionConfig(action.configJson as Record<string, unknown> | null),
    };
  }
}
