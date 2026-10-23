import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { COMMITTEES_PERMISSIONS } from '../../../common/constants/permissions';
import { NotificationService } from '../../notification/notification.service';
import { TaskService } from '../../task/task.service';
import { EngineTx, WorkflowService } from '../../workflow/workflow.service';
import { CHANGE_REQUEST_STAGE_KEYS } from '../../workflow/workflow-stage-keys';
import { lockWorkflowInstance } from '../../task/stage-deadline';
import { assertCommitteeReferences, lockCommitteeHierarchy } from '../committee-reference-checks';
import { committeeTypeValues } from '../committee-type-values';
import { ChangeRequestRefusal } from './change-request-refusal';
import {
  ACTION_TARGET_STAGE,
  ChangeRequestAction,
  assertCommitteeAllowsRaise,
  awaitsDecision,
  committeeAllowsRaise,
  assertCommitteeStageAllows,
  assertRequestStageAllows,
  requestStagePolicy,
  stagesAllow,
} from './change-request-policy';
import {
  ChangeRequestListQueryDto,
  CommitteeChangeValuesDto,
  CreateChangeRequestDto,
  RejectChangeRequestDto,
  ReturnChangeRequestDto,
  UpdateChangeRequestDto,
} from './dto/change-request.dto';

/**
 * ACC-239 — a change to an APPROVED committee goes through a request: the
 * requester proposes, someone else with committees:approve decides, and an
 * approval applies every value at once. Plan:
 * backend/Plans/step-238-committee-changes.md (§10, §12).
 *
 * THE REQUEST'S STATE IS ITS STAGE KEY. There is no status column: the request
 * has a workflow instance on the fixed six-stage template (PROTECTED_TEMPLATES),
 * and every move is a SYSTEM_AUTOMATIC transition fired from here, after this
 * service has decided who may make it. Writes that belong with a move (the
 * "from" values at Submit, the applied values at Approve) run inside the
 * engine's stage-change transaction through `inTx`, so the two commit together.
 *
 * LOCK ORDER, everywhere: the request's instance → the committee's instance →
 * the organisation's hierarchy lock (only when a parent or Reports to changes)
 * → the committee row → the request row. The engine takes the first itself.
 *
 * Every read is scoped by organisation, so another organisation's request or
 * committee is the identical 404 a missing one is.
 */

/** The committee fields a request may change (Q6: the terms-of-reference link is not one). */
export const CHANGE_FIELDS = [
  'nameEn',
  'nameAr',
  'typeValueId',
  'purpose',
  'quorumCount',
  'meetingFrequency',
  'orgUnitId',
  'parentCommitteeId',
  'reportingToCommitteeId',
] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type ChangeValue = string | number | null;
export type ChangeValues = Partial<Record<ChangeField, ChangeValue>>;

/** Fields that can never be empty on an approved committee: a null for one of them is "not changing". */
const REQUIRED_FIELDS: ReadonlySet<ChangeField> = new Set<ChangeField>(['nameEn', 'typeValueId', 'quorumCount', 'meetingFrequency']);

const OBJECT_TYPE = 'COMMITTEE_CHANGE_REQUEST' as const;
const PAGE = 50;
const STAGE_ORDER = new Map<string, number>(CHANGE_REQUEST_STAGE_KEYS.map((k, i) => [k, i]));

type CommitteeRow = Record<ChangeField, ChangeValue> & { id: string; organizationId: string; updatedAt: Date };

export interface ChangeRequestActions {
  edit: boolean;
  submit: boolean;
  withdraw: boolean;
  approve: boolean;
  return: boolean;
  reject: boolean;
}

/** ACC-240 — a person named on a request, read within its organisation. */
export interface ChangeRequestPerson {
  id: string;
  name: string;
}

/**
 * ACC-240 — the name of each id-valued field's value (a type, an owning unit,
 * a committee), keyed by the id. Only the ids this response names, resolved
 * within its organisation, inactive values included: a closed request still
 * names what it named. An id that does not resolve is absent.
 */
export type ChangeRequestLabels = Record<string, { en: string; ar: string | null }>;

export interface IChangeRequest {
  id: string;
  committeeId: string;
  committeeNameEn: string;
  committeeNameAr: string | null;
  number: number;
  /** The stage key — the request's state. Null for a stage with no key. */
  status: string | null;
  requestedBy: { id: string; name: string };
  reason: string;
  changes: ChangeValues;
  fromValues: ChangeValues | null;
  submittedAt: Date | null;
  returnNote: string | null;
  rejectionReason: string | null;
  decidedById: string | null;
  /** ACC-240 — whoever last returned, approved or rejected it. */
  decidedBy: ChangeRequestPerson | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  termsTaskId: string | null;
  withdrawnById: string | null;
  /** ACC-240 — whoever withdrew it. */
  withdrawnBy: ChangeRequestPerson | null;
  withdrawnAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  actions: ChangeRequestActions;
  /** ACC-240 — names for the ids in `changes` and `fromValues`. */
  labels: ChangeRequestLabels;
}

/** ACC-240 — the committee's open request, for its banner, and whether this viewer may raise one now. */
export interface IOpenChangeRequest {
  request: IChangeRequest | null;
  /**
   * The create call's own three checks, answered without creating:
   * committees:edit_details, the committee's stage allows a request
   * (COMMITTEE_STAGE_POLICY.raise), and no open request (drafts count).
   */
  canRaise: boolean;
}

export interface IChangeRequestPage {
  items: IChangeRequest[];
  total: number;
  matching: number;
}

export type ChangeImpact =
  | { code: 'QUORUM'; from: ChangeValue; to: ChangeValue; inProgress: number }
  | { code: 'NAME' }
  | { code: 'TYPE' }
  | { code: 'PURPOSE' }
  | { code: 'MEETING_FREQUENCY'; from: ChangeValue; to: ChangeValue }
  | { code: 'OWNING_UNIT'; from: ChangeValue; to: ChangeValue }
  | { code: 'PARENT'; from: ChangeValue; to: ChangeValue }
  | { code: 'REPORTS_TO'; from: ChangeValue; to: ChangeValue }
  | { code: 'TERMS_TASK' };

export interface IChangeRequestPreview {
  changedFields: ChangeField[];
  impacts: ChangeImpact[];
  /** ACC-240 — names for the ids in `impacts` (the from and to of a unit or a committee). */
  labels: ChangeRequestLabels;
}

/** Who is asking: their id and the permissions their roles grant (TenantGuard, per request). */
export interface ChangeRequestViewer {
  userId: string;
  permissions: string[];
}

type RequestRow = Prisma.CommitteeChangeRequestGetPayload<{
  include: {
    requestedBy: { select: { id: true; name: true } };
    committee: { select: { nameEn: true; nameAr: true } };
  };
}>;

const REQUEST_INCLUDE = {
  requestedBy: { select: { id: true, name: true } },
  committee: { select: { nameEn: true, nameAr: true } },
} as const;

@Injectable()
export class CommitteeChangeRequestService {
  private readonly logger = new Logger(CommitteeChangeRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly tasks: TaskService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  // ── Writes ──────────────────────────────────────────────────────────────────

  async create(committeeId: string, dto: CreateChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    requirePermission(viewer, COMMITTEES_PERMISSIONS.EDIT_DETAILS);
    const committee = await this.loadCommittee(committeeId, organizationId);
    const changes = normaliseChanges(dto.changes, committee);

    // Every read the engine can do first (the template, the first stage).
    const requestId = randomUUID();
    const preparedStart = await this.workflow.prepareInstanceStart(OBJECT_TYPE, requestId, organizationId);

    const { request, started } = await this.prisma.$transaction(async (tx) => {
      // The committee's stage, under its instance's share lock: a transition
      // into Dissolution Pending in flight finishes first, or waits for this.
      const stageKey = await committeeStageKey(tx, committeeId, organizationId);
      assertCommitteeAllowsRaise(stageKey);

      // ONE OPEN REQUEST PER COMMITTEE, drafts included. The committee's row
      // lock queues two creates; the second then sees the first's request.
      await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${committeeId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const existing = await tx.committeeChangeRequest.findMany({
        where: { committeeId, organizationId },
        select: { id: true, number: true },
      });
      const states = await requestStageKeys(tx, existing.map((r) => r.id), organizationId);
      if (existing.some((r) => isOpen(states.get(r.id)))) {
        throw new ChangeRequestRefusal('CHANGE_REQUEST_ALREADY_OPEN');
      }

      // The proposed references, checked now so a bad one is said at once; the
      // approval checks them again, authoritatively, under the hierarchy lock.
      await assertCommitteeReferences(tx, referenceChange(committeeId, organizationId, changes), this.logger);

      const number = existing.reduce((max, r) => Math.max(max, r.number), 0) + 1;
      const request = await tx.committeeChangeRequest.create({
        data: {
          id: requestId,
          organizationId,
          committeeId,
          number,
          requestedById: viewer.userId,
          reason: dto.reason.trim(),
          changes: changes as Prisma.InputJsonValue,
        },
      });
      const started = await this.workflow.insertInstanceStartInTx(tx, preparedStart, requestId, organizationId, viewer.userId);
      return { request, started };
    });

    // The draft is the requester's own: no "assigned to you" notice.
    await this.workflow.finishInstanceStart(preparedStart, started, organizationId, viewer.userId, { notifyInitialAssignee: false });
    await this.auditLog.log({
      action: 'CREATE',
      objectType: 'CommitteeChangeRequest',
      objectId: request.id,
      actorId: viewer.userId,
      tenantId: organizationId,
      after: request as unknown as Record<string, unknown>,
    });

    if (dto.submit) return this.submit(request.id, organizationId, viewer);
    return this.getOne(request.id, organizationId, viewer);
  }

  async update(id: string, dto: UpdateChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    requirePermission(viewer, COMMITTEES_PERMISSIONS.EDIT_DETAILS);
    const loaded = await this.loadRequest(id, organizationId);
    assertRequester(loaded.row, viewer);

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // The request's instance first: a Submit in flight finishes before this
      // reads the stage, so a submitted request is never edited after the fact.
      await lockWorkflowInstance(tx, loaded.instanceId, organizationId);
      const stage = await instanceStageKey(tx, loaded.instanceId);
      assertRequestStageAllows(stage, 'edit');
      assertCommitteeStageAllows(await committeeStageKey(tx, loaded.row.committeeId, organizationId), 'edit');

      await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const before = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });
      if (dto.expectedUpdatedAt !== undefined && new Date(dto.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
        throw new ChangeRequestRefusal('CHANGE_REQUEST_CHANGED');
      }

      let changes: ChangeValues | undefined;
      if (dto.changes !== undefined) {
        const committee = await tx.committee.findFirstOrThrow({ where: { id: before.committeeId, organizationId } });
        changes = normaliseChanges(dto.changes, committee as unknown as CommitteeRow);
        await assertCommitteeReferences(tx, referenceChange(before.committeeId, organizationId, changes), this.logger);
      }
      const after = await tx.committeeChangeRequest.update({
        where: { id },
        data: {
          ...(changes !== undefined && { changes: changes as Prisma.InputJsonValue }),
          ...(dto.reason !== undefined && { reason: dto.reason.trim() }),
        },
      });
      return { before, after };
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
    });
    return this.getOne(id, organizationId, viewer);
  }

  async submit(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    requirePermission(viewer, COMMITTEES_PERMISSIONS.EDIT_DETAILS);
    const loaded = await this.loadRequest(id, organizationId);
    assertRequester(loaded.row, viewer);
    assertRequestStageAllows(loaded.stageKey, 'submit');

    let fromValues: ChangeValues = {};
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.submit, organizationId, viewer.userId, {
      inTx: async (tx) => {
        // Re-read under the instance's lock: the stage the move starts from.
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'submit');
        assertCommitteeStageAllows(await committeeStageKey(tx, loaded.row.committeeId, organizationId), 'submit');

        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${loaded.row.committeeId} AND "organizationId" = ${organizationId} FOR SHARE`;
        const committee = (await tx.committee.findFirstOrThrow({
          where: { id: loaded.row.committeeId, organizationId },
        })) as unknown as CommitteeRow;
        await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const request = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });

        // The values as they stand NOW, for every field the request changes.
        // A value that has since come to equal the proposal is not a change.
        const changes = dropUnchanged(request.changes as ChangeValues, committee);
        if (Object.keys(changes).length === 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_CHANGES');
        fromValues = pick(committee, Object.keys(changes) as ChangeField[]);
        await assertCommitteeReferences(tx, referenceChange(committee.id, organizationId, changes), this.logger);

        await tx.committeeChangeRequest.update({
          where: { id },
          data: {
            changes: changes as Prisma.InputJsonValue,
            fromValues: fromValues as Prisma.InputJsonValue,
            submittedAt: new Date(),
          },
        });
      },
    });

    await this.auditLog.log({
      action: 'SUBMIT',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { from: loaded.stageKey, fromValues },
    });

    // Q1 — every committees:approve holder but the requester is told.
    const committee = loaded.row.committee;
    const approvers = await this.permissionHolders(organizationId, COMMITTEES_PERMISSIONS.APPROVE);
    for (const userId of approvers.filter((u) => u !== loaded.row.requestedById)) {
      await this.notify(userId, organizationId, loaded.row.committeeId, {
        titleEn: `Change request #${loaded.row.number} to review`,
        titleAr: `طلب التغيير رقم ${loaded.row.number} بانتظار المراجعة`,
        bodyEn: `${loaded.row.requestedBy.name} asked to change ${committee.nameEn}.`,
        bodyAr: `طلب ${loaded.row.requestedBy.name} تغيير ${committee.nameAr ?? committee.nameEn}.`,
      });
    }
    return this.getOne(id, organizationId, viewer);
  }

  async withdraw(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadRequest(id, organizationId);
    const own = loaded.row.requestedById === viewer.userId;
    const allowed = (stage: string | null): boolean => {
      assertRequestStageAllows(stage, 'withdraw');
      // The requester withdraws at any open stage; an approver only where the
      // stage says someone else may (a draft left behind).
      return own || (hasPermission(viewer, COMMITTEES_PERMISSIONS.APPROVE) && requestStagePolicy(stage).othersMayWithdraw);
    };
    if (!allowed(loaded.stageKey)) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_REQUESTER');
    assertCommitteeStageAllows(await committeeStageKey(this.prisma, loaded.row.committeeId, organizationId), 'withdraw');

    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.withdraw, organizationId, viewer.userId, {
      outcome: 'SKIPPED',
      inTx: async (tx) => {
        if (!allowed(await instanceStageKey(tx, loaded.instanceId))) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_REQUESTER');
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { withdrawnById: viewer.userId, withdrawnAt: new Date() },
        });
      },
    });

    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { decision: 'WITHDRAWN', from: loaded.stageKey },
    });
    // Q1 — withdrawing your own request tells nobody; someone else's tells you.
    if (!own) {
      await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
        titleEn: `Change request #${loaded.row.number} withdrawn`,
        titleAr: `سُحب طلب التغيير رقم ${loaded.row.number}`,
        bodyEn: `Your change request for ${loaded.row.committee.nameEn} was withdrawn.`,
        bodyAr: `سُحب طلب التغيير الذي قدّمته على ${loaded.row.committee.nameAr ?? loaded.row.committee.nameEn}.`,
      });
    }
    return this.getOne(id, organizationId, viewer);
  }

  async approve(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadDecision(id, organizationId, viewer, 'approve');
    const changes = loaded.row.changes as ChangeValues;
    const touchesHierarchy = 'parentCommitteeId' in changes || 'reportingToCommitteeId' in changes;

    // Prepared before the transaction: the task's SLA window and its assignee.
    const preparedTask = await this.tasks.prepareRecordTask(
      {
        title: 'Revise the terms of reference',
        titleAr: 'مراجعة النظام الداخلي',
        description: `Change request #${loaded.row.number} was approved. Update the committee's terms of reference to match.`,
        priority: 'MEDIUM',
        sourceType: 'COMMITTEE',
        sourceId: loaded.row.committeeId,
        assigneeUserIds: [loaded.row.requestedById],
      },
      organizationId,
    );

    // Filled inside the transaction, read after it commits.
    const out: { before?: CommitteeRow; after?: CommitteeRow; task?: Awaited<ReturnType<TaskService['insertPrepared']>> } = {};

    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.approve, organizationId, viewer.userId, {
      outcome: 'APPROVED',
      inTx: async (tx) => {
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'approve');

        // The committee's instance: no committee transition moves under the
        // apply, and a committee now dissolving refuses it.
        await lockCommitteeInstance(tx, loaded.row.committeeId, organizationId);
        assertCommitteeStageAllows(await committeeStageKey(tx, loaded.row.committeeId, organizationId), 'approve');
        if (touchesHierarchy) await lockCommitteeHierarchy(tx, organizationId);
        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${loaded.row.committeeId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const before = (await tx.committee.findFirstOrThrow({
          where: { id: loaded.row.committeeId, organizationId },
        })) as unknown as CommitteeRow;

        await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const request = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });
        const proposed = request.changes as ChangeValues;
        const fromValues = (request.fromValues ?? {}) as ChangeValues;

        // Q11 — DRIFT. Any value that differs from what the requester saw at
        // Submit refuses the whole approval: nothing is applied, and the
        // approver is told to return it.
        const drifted = (Object.keys(proposed) as ChangeField[]).filter((f) => !sameValue(before[f], fromValues[f]));
        if (drifted.length > 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_COMMITTEE_CHANGED', { fields: drifted });

        await assertCommitteeReferences(tx, referenceChange(before.id, organizationId, proposed), this.logger);

        const after = (await tx.committee.update({
          where: { id: before.id },
          data: proposed as Prisma.CommitteeUncheckedUpdateInput,
        })) as unknown as CommitteeRow;

        const task = await this.tasks.insertPrepared(tx, preparedTask, organizationId, viewer.userId);
        const now = new Date();
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { decidedById: viewer.userId, decidedAt: now, appliedAt: now, termsTaskId: task.id },
        });
        Object.assign(out, { before, after, task });
      },
    });

    const { before: done, after: appliedRow, task: createdTask } = out;
    if (done && appliedRow && createdTask) {
      // One audit row for the committee's change, naming the request.
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Committee',
        objectId: loaded.row.committeeId,
        actorId: viewer.userId,
        tenantId: organizationId,
        before: pick(done, Object.keys(changes) as ChangeField[]) as Record<string, unknown>,
        after: pick(appliedRow, Object.keys(changes) as ChangeField[]) as Record<string, unknown>,
        metadata: { changeRequestId: id, changeRequestNumber: loaded.row.number },
      });
      await this.auditLog.log({
        action: 'APPROVE',
        objectType: 'CommitteeChangeRequest',
        objectId: id,
        actorId: viewer.userId,
        tenantId: organizationId,
        metadata: { termsTaskId: createdTask.id },
      });
      await this.tasks.announceCreated(createdTask, preparedTask, organizationId, viewer.userId);
    }
    await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
      titleEn: `Change request #${loaded.row.number} approved`,
      titleAr: `اعتُمد طلب التغيير رقم ${loaded.row.number}`,
      bodyEn: `Your changes to ${loaded.row.committee.nameEn} were applied.`,
      bodyAr: `طُبّقت التغييرات التي طلبتها على ${loaded.row.committee.nameAr ?? loaded.row.committee.nameEn}.`,
    });
    return this.getOne(id, organizationId, viewer);
  }

  async returnForChanges(id: string, dto: ReturnChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadDecision(id, organizationId, viewer, 'return');
    const note = dto.note.trim();
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.return, organizationId, viewer.userId, {
      outcome: 'REJECTED',
      comment: note,
      inTx: async (tx) => {
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'return');
        // The committee's stage decides whether a decision may still be made.
        assertCommitteeStageAllows(await committeeStageKey(tx, loaded.row.committeeId, organizationId), 'return');
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { returnNote: note, decidedById: viewer.userId, decidedAt: new Date() },
        });
      },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { decision: 'RETURNED', note },
    });
    await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
      titleEn: `Change request #${loaded.row.number} returned`,
      titleAr: `أُعيد طلب التغيير رقم ${loaded.row.number}`,
      bodyEn: note,
      bodyAr: note,
    });
    return this.getOne(id, organizationId, viewer);
  }

  async reject(id: string, dto: RejectChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadDecision(id, organizationId, viewer, 'reject');
    const reason = dto.reason.trim();
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.reject, organizationId, viewer.userId, {
      outcome: 'REJECTED',
      comment: reason,
      inTx: async (tx) => {
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'reject');
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { rejectionReason: reason, decidedById: viewer.userId, decidedAt: new Date() },
        });
      },
    });
    await this.auditLog.log({
      action: 'REJECT',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { reason },
    });
    await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
      titleEn: `Change request #${loaded.row.number} rejected`,
      titleAr: `رُفض طلب التغيير رقم ${loaded.row.number}`,
      bodyEn: reason,
      bodyAr: reason,
    });
    return this.getOne(id, organizationId, viewer);
  }

  // ── Reads ───────────────────────────────────────────────────────────────────

  async getOne(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const row = await this.prisma.committeeChangeRequest.findFirst({ where: { id, organizationId }, include: REQUEST_INCLUDE });
    if (!row) throw new NotFoundException('Change request not found');
    const [stages, committeeStage, extras] = await Promise.all([
      requestStageKeys(this.prisma, [row.id], organizationId),
      committeeStageKey(this.prisma, row.committeeId, organizationId),
      this.loadExtras([row], organizationId),
    ]);
    return toDto(row, stages.get(row.id)?.key ?? null, committeeStage, viewer, extras);
  }

  /** The committee's requests — its panel and See all — searched, sorted and paged here (they are few). */
  async list(committeeId: string, query: ChangeRequestListQueryDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequestPage> {
    await this.loadCommittee(committeeId, organizationId);
    const rows = await this.prisma.committeeChangeRequest.findMany({
      where: { committeeId, organizationId },
      include: REQUEST_INCLUDE,
    });
    const [stages, committeeStage, extras] = await Promise.all([
      requestStageKeys(this.prisma, rows.map((r) => r.id), organizationId),
      committeeStageKey(this.prisma, committeeId, organizationId),
      this.loadExtras(rows, organizationId),
    ]);
    const all = rows.map((r) => toDto(r, stages.get(r.id)?.key ?? null, committeeStage, viewer, extras));

    const needle = (query.q ?? '').trim().replace(/^#/, '').toLocaleLowerCase();
    const matching = needle
      ? all.filter((r) => String(r.number) === needle || r.requestedBy.name.toLocaleLowerCase().includes(needle))
      : all;
    const dir = query.dir === 'asc' ? 1 : -1;
    const sort = query.sort ?? 'number';
    const sorted = [...matching].sort((a, b) => {
      let c = 0;
      if (sort === 'status') c = (STAGE_ORDER.get(a.status ?? '') ?? 99) - (STAGE_ORDER.get(b.status ?? '') ?? 99);
      if (sort === 'requested') c = a.createdAt.getTime() - b.createdAt.getTime();
      return (c || a.number - b.number) * dir;
    });
    const skip = query.skip ?? 0;
    return { items: sorted.slice(skip, skip + (query.take ?? PAGE)), total: all.length, matching: matching.length };
  }

  /**
   * The committee's open request, for its banner — or null — and `canRaise`:
   * whether `create()` would accept a request from this viewer now. It is the
   * create call's own three checks, read from the same functions (the
   * permission, `committeeAllowsRaise()`, `isOpen()`), never a second copy.
   * Create re-checks all three under the committee's row lock; this is a read.
   */
  async openSummary(committeeId: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IOpenChangeRequest> {
    await this.loadCommittee(committeeId, organizationId);
    const rows = await this.prisma.committeeChangeRequest.findMany({
      where: { committeeId, organizationId },
      include: REQUEST_INCLUDE,
      orderBy: { number: 'desc' },
    });
    const [states, committeeStage] = await Promise.all([
      requestStageKeys(this.prisma, rows.map((r) => r.id), organizationId),
      committeeStageKey(this.prisma, committeeId, organizationId),
    ]);
    const open = rows.find((r) => isOpen(states.get(r.id))) ?? null;
    const canRaise = hasPermission(viewer, COMMITTEES_PERMISSIONS.EDIT_DETAILS) && committeeAllowsRaise(committeeStage) && !open;
    if (!open) return { request: null, canRaise };
    const extras = await this.loadExtras([open], organizationId);
    return { request: toDto(open, states.get(open.id)?.key ?? null, committeeStage, viewer, extras), canRaise };
  }

  /** Every request under review that the viewer may decide: not their own. */
  async awaitingDecision(organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest[]> {
    requirePermission(viewer, COMMITTEES_PERMISSIONS.APPROVE);
    const rows = await this.prisma.committeeChangeRequest.findMany({
      where: { organizationId, requestedById: { not: viewer.userId }, submittedAt: { not: null } },
      include: REQUEST_INCLUDE,
      orderBy: { submittedAt: 'asc' },
    });
    const stages = await requestStageKeys(this.prisma, rows.map((r) => r.id), organizationId);
    const waiting = rows.filter((r) => awaitsDecision(stages.get(r.id)?.key));
    const committeeStages = new Map<string, string | null>();
    for (const r of waiting) {
      if (!committeeStages.has(r.committeeId)) committeeStages.set(r.committeeId, await committeeStageKey(this.prisma, r.committeeId, organizationId));
    }
    const extras = await this.loadExtras(waiting, organizationId);
    return waiting.map((r) => toDto(r, stages.get(r.id)?.key ?? null, committeeStages.get(r.committeeId) ?? null, viewer, extras));
  }

  /** What approving these changes would do — for Request a change, before anything is saved. */
  async preview(committeeId: string, values: CommitteeChangeValuesDto, organizationId: string): Promise<IChangeRequestPreview> {
    const committee = await this.loadCommittee(committeeId, organizationId);
    const changes = normaliseChanges(values, committee, { allowEmpty: true });
    const fields = Object.keys(changes) as ChangeField[];
    if (fields.length > 0) {
      await this.prisma.$transaction((tx) =>
        assertCommitteeReferences(tx, referenceChange(committeeId, organizationId, changes), this.logger),
      );
    }

    const impacts: ChangeImpact[] = [];
    const span = (f: ChangeField) => ({ from: committee[f], to: changes[f] ?? null });
    if ('quorumCount' in changes) {
      // Votes already open keep the quorum they began with (ACC-239's snapshot).
      const inProgress = await this.prisma.workflowInstanceStage.count({
        where: {
          exitedAt: null,
          stage: { approvalMode: 'COMMITTEE', committeeId },
          workflowInstance: { organizationId, status: 'IN_PROGRESS' },
        },
      });
      impacts.push({ code: 'QUORUM', ...span('quorumCount'), inProgress });
    }
    if ('nameEn' in changes || 'nameAr' in changes) impacts.push({ code: 'NAME' });
    if ('typeValueId' in changes) impacts.push({ code: 'TYPE' });
    if ('purpose' in changes) impacts.push({ code: 'PURPOSE' });
    if ('meetingFrequency' in changes) impacts.push({ code: 'MEETING_FREQUENCY', ...span('meetingFrequency') });
    if ('orgUnitId' in changes) impacts.push({ code: 'OWNING_UNIT', ...span('orgUnitId') });
    if ('parentCommitteeId' in changes) impacts.push({ code: 'PARENT', ...span('parentCommitteeId') });
    if ('reportingToCommitteeId' in changes) impacts.push({ code: 'REPORTS_TO', ...span('reportingToCommitteeId') });
    if (fields.length > 0) impacts.push({ code: 'TERMS_TASK' });
    const ids: Record<'typeValueId' | 'orgUnitId' | 'committeeId', string[]> = { typeValueId: [], orgUnitId: [], committeeId: [] };
    for (const impact of impacts) {
      const bucket = impact.code === 'OWNING_UNIT' ? ids.orgUnitId : impact.code === 'PARENT' || impact.code === 'REPORTS_TO' ? ids.committeeId : null;
      if (bucket && 'from' in impact) for (const v of [impact.from, impact.to]) if (typeof v === 'string') bucket.push(v);
    }
    return { changedFields: fields, impacts, labels: await this.resolveLabels(ids, organizationId) };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * ACC-240 — the people and the value names the given requests carry, each
   * read once for all of them, every read scoped by organisation. A request's
   * own labels are then picked from these by `toDto()`, so each response names
   * only its own ids.
   */
  private async loadExtras(rows: RequestRow[], organizationId: string): Promise<DtoExtras> {
    const personIds = [...new Set(rows.flatMap((r) => [r.decidedById, r.withdrawnById]).filter((id): id is string => !!id))];
    const ids: Record<'typeValueId' | 'orgUnitId' | 'committeeId', string[]> = { typeValueId: [], orgUnitId: [], committeeId: [] };
    for (const row of rows) {
      for (const values of [row.changes, row.fromValues] as unknown[]) {
        if (!values || typeof values !== 'object') continue;
        for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
          const bucket = LABELLED_FIELDS[field as ChangeField];
          if (bucket && typeof value === 'string') ids[bucket].push(value);
        }
      }
    }
    const [people, labels] = await Promise.all([
      personIds.length
        ? this.prisma.user.findMany({ where: { id: { in: personIds }, organizationId }, select: { id: true, name: true } })
        : Promise.resolve([] as ChangeRequestPerson[]),
      this.resolveLabels(ids, organizationId),
    ]);
    return { people: new Map(people.map((p) => [p.id, p])), labels };
  }

  /**
   * ACC-240 — names for type, unit and committee ids, within the organisation
   * only (another organisation's id resolves to nothing), inactive values
   * included. Types go through ACC-246's resolver, which reads the shared
   * system values and this organisation's own rows, with its label overrides.
   */
  private async resolveLabels(
    ids: Record<'typeValueId' | 'orgUnitId' | 'committeeId', string[]>,
    organizationId: string,
  ): Promise<ChangeRequestLabels> {
    const unique = (list: string[]) => [...new Set(list)];
    const [types, units, committees] = await Promise.all([
      committeeTypeValues(this.prisma, organizationId, unique(ids.typeValueId)),
      ids.orgUnitId.length
        ? this.prisma.orgUnit.findMany({ where: { id: { in: unique(ids.orgUnitId) }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([]),
      ids.committeeId.length
        ? this.prisma.committee.findMany({ where: { id: { in: unique(ids.committeeId) }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([]),
    ]);
    const labels: ChangeRequestLabels = {};
    for (const t of types.values()) labels[t.id] = { en: t.labelEn, ar: t.labelAr };
    for (const u of units) labels[u.id] = { en: u.nameEn, ar: u.nameAr };
    for (const c of committees) labels[c.id] = { en: c.nameEn, ar: c.nameAr };
    return labels;
  }

  private async loadCommittee(committeeId: string, organizationId: string): Promise<CommitteeRow> {
    const committee = await this.prisma.committee.findFirst({ where: { id: committeeId, organizationId } });
    if (!committee) throw new NotFoundException('Committee not found');
    return committee as unknown as CommitteeRow;
  }

  private async loadRequest(id: string, organizationId: string): Promise<{ row: RequestRow; instanceId: string; stageKey: string | null }> {
    const row = await this.prisma.committeeChangeRequest.findFirst({ where: { id, organizationId }, include: REQUEST_INCLUDE });
    if (!row) throw new NotFoundException('Change request not found');
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { organizationId, objectType: OBJECT_TYPE, objectId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!instance) throw new NotFoundException('Change request not found');
    const stages = await requestStageKeys(this.prisma, [id], organizationId);
    return { row, instanceId: instance.id, stageKey: stages.get(id)?.key ?? null };
  }

  /** Approve, Return, Reject: committees:approve, never the requester, and what both stages allow (the policy). */
  private async loadDecision(
    id: string,
    organizationId: string,
    viewer: ChangeRequestViewer,
    action: Extract<ChangeRequestAction, 'approve' | 'return' | 'reject'>,
  ): Promise<{ row: RequestRow; instanceId: string; stageKey: string | null }> {
    requirePermission(viewer, COMMITTEES_PERMISSIONS.APPROVE);
    const loaded = await this.loadRequest(id, organizationId);
    if (loaded.row.requestedById === viewer.userId) throw new ChangeRequestRefusal('CHANGE_REQUEST_OWN_DECISION');
    assertRequestStageAllows(loaded.stageKey, action);
    assertCommitteeStageAllows(await committeeStageKey(this.prisma, loaded.row.committeeId, organizationId), action);
    return loaded;
  }

  /** Active users holding `permission` through an active role, in this organisation. */
  private async permissionHolders(organizationId: string, permission: string): Promise<string[]> {
    const [module, action] = permission.split(':');
    const rows = await this.prisma.userRole.findMany({
      where: {
        user: { organizationId, status: 'ACTIVE' },
        role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async notify(
    userId: string,
    organizationId: string,
    committeeId: string,
    text: { titleEn: string; titleAr: string; bodyEn: string; bodyAr: string },
  ): Promise<void> {
    try {
      // The notice opens the committee, where the request's banner is.
      await this.notifications.create({ userId, ...text, objectType: 'COMMITTEE', objectId: committeeId }, organizationId);
    } catch (err) {
      // A notice that fails never undoes a decision already committed.
      this.logger.warn(`Change request notice to ${userId} failed: ${(err as Error).message}`);
    }
  }
}

// ── Pure rules ────────────────────────────────────────────────────────────────

function hasPermission(viewer: ChangeRequestViewer, permission: string): boolean {
  return viewer.permissions.includes(permission);
}

function requirePermission(viewer: ChangeRequestViewer, permission: string): void {
  if (!hasPermission(viewer, permission)) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_ALLOWED', { permission });
}

function assertRequester(row: { requestedById: string }, viewer: ChangeRequestViewer): void {
  if (row.requestedById !== viewer.userId) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_REQUESTER');
}

/**
 * The proposal, as a diff against the committee: a field left out is not
 * changing; text is trimmed; an empty purpose or Arabic name is cleared
 * (ACC-160: never ''); a value equal to today's is dropped. A required field
 * sent as null is not a change. Nothing left is NO_CHANGES (unless a preview).
 */
export function normaliseChanges(
  values: CommitteeChangeValuesDto | undefined,
  committee: CommitteeRow,
  options: { allowEmpty?: boolean } = {},
): ChangeValues {
  const source = (values ?? {}) as Partial<Record<ChangeField, ChangeValue | undefined>>;
  const out: ChangeValues = {};
  for (const field of CHANGE_FIELDS) {
    let value = source[field];
    if (value === undefined) continue;
    if (typeof value === 'string') value = value.trim();
    if ((field === 'purpose' || field === 'nameAr') && value === '') value = null;
    if (value === null && REQUIRED_FIELDS.has(field)) continue;
    if (sameValue(committee[field], value)) continue;
    out[field] = value;
  }
  if ('quorumCount' in out && (typeof out.quorumCount !== 'number' || out.quorumCount < 1)) {
    throw new ChangeRequestRefusal('CHANGE_REQUEST_QUORUM_MIN');
  }
  if (!options.allowEmpty && Object.keys(out).length === 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_CHANGES');
  return out;
}

function dropUnchanged(changes: ChangeValues, committee: CommitteeRow): ChangeValues {
  const out: ChangeValues = {};
  for (const field of Object.keys(changes) as ChangeField[]) {
    if (!CHANGE_FIELDS.includes(field)) continue;
    if (!sameValue(committee[field], changes[field])) out[field] = changes[field] ?? null;
  }
  return out;
}

function pick(committee: CommitteeRow, fields: ChangeField[]): ChangeValues {
  return Object.fromEntries(fields.map((f) => [f, committee[f] ?? null]));
}

function sameValue(a: ChangeValue | undefined, b: ChangeValue | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/** Only what the request changes is checked (ACC-233: an untouched reference is never re-checked). */
function referenceChange(committeeId: string, organizationId: string, changes: ChangeValues) {
  return {
    organizationId,
    committeeId,
    ...('parentCommitteeId' in changes && { parentCommitteeId: changes.parentCommitteeId as string | null }),
    ...('reportingToCommitteeId' in changes && { reportingToCommitteeId: changes.reportingToCommitteeId as string | null }),
    ...('orgUnitId' in changes && { orgUnitId: changes.orgUnitId as string | null }),
  };
}

/** Which label kind each id-valued field takes. */
const LABELLED_FIELDS: Partial<Record<ChangeField, 'typeValueId' | 'orgUnitId' | 'committeeId'>> = {
  typeValueId: 'typeValueId',
  orgUnitId: 'orgUnitId',
  parentCommitteeId: 'committeeId',
  reportingToCommitteeId: 'committeeId',
};

/** ACC-240 — what `loadExtras()` read for a set of requests. */
interface DtoExtras {
  people: Map<string, ChangeRequestPerson>;
  labels: ChangeRequestLabels;
}

/** A request is open unless its stage says closed; a request with no instance counts as open (fail safe). */
function isOpen(state: { open: boolean } | undefined): boolean {
  return state?.open ?? true;
}

/** This request's own labels: only the ids its changes and from-values name. */
function labelsFor(row: RequestRow, all: ChangeRequestLabels): ChangeRequestLabels {
  const out: ChangeRequestLabels = {};
  for (const values of [row.changes, row.fromValues] as unknown[]) {
    if (!values || typeof values !== 'object') continue;
    for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
      if (LABELLED_FIELDS[field as ChangeField] && typeof value === 'string' && all[value]) out[value] = all[value]!;
    }
  }
  return out;
}

function toDto(
  row: RequestRow,
  status: string | null,
  committeeStage: string | null,
  viewer: ChangeRequestViewer,
  extras: DtoExtras,
): IChangeRequest {
  const own = row.requestedById === viewer.userId;
  const approver = hasPermission(viewer, COMMITTEES_PERMISSIONS.APPROVE);
  const editor = hasPermission(viewer, COMMITTEES_PERMISSIONS.EDIT_DETAILS);
  // What both stages allow (the policy); who is asking decides the rest.
  const stage = (action: ChangeRequestAction) => stagesAllow(status, committeeStage, action);
  const deciding = approver && !own;
  return {
    id: row.id,
    committeeId: row.committeeId,
    committeeNameEn: row.committee.nameEn,
    committeeNameAr: row.committee.nameAr,
    number: row.number,
    status,
    requestedBy: { id: row.requestedBy.id, name: row.requestedBy.name },
    reason: row.reason,
    changes: row.changes as ChangeValues,
    fromValues: (row.fromValues as ChangeValues | null) ?? null,
    submittedAt: row.submittedAt,
    returnNote: row.returnNote,
    rejectionReason: row.rejectionReason,
    decidedById: row.decidedById,
    decidedBy: (row.decidedById && extras.people.get(row.decidedById)) || null,
    decidedAt: row.decidedAt,
    appliedAt: row.appliedAt,
    termsTaskId: row.termsTaskId,
    withdrawnById: row.withdrawnById,
    withdrawnBy: (row.withdrawnById && extras.people.get(row.withdrawnById)) || null,
    withdrawnAt: row.withdrawnAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    actions: {
      edit: own && editor && stage('edit'),
      submit: own && editor && stage('submit'),
      withdraw: stage('withdraw') && (own || (approver && requestStagePolicy(status).othersMayWithdraw)),
      approve: deciding && stage('approve'),
      return: deciding && stage('return'),
      reject: deciding && stage('reject'),
    },
    labels: labelsFor(row, extras.labels),
  };
}

// ── Locks and stage reads ─────────────────────────────────────────────────────

type Reader = Pick<EngineTx, '$queryRaw' | 'workflowInstance' | 'workflowStage'>;

/**
 * The committee's current stage key: its newest COMMITTEE instance's stage,
 * read FOR SHARE inside a transaction (so a committee transition in flight
 * finishes first). Null when the committee has no instance, or its stage no key.
 */
async function committeeStageKey(client: Pick<EngineTx, '$queryRaw'>, committeeId: string, organizationId: string): Promise<string | null> {
  const rows = await client.$queryRaw<{ key: string | null }[]>`
    SELECT ws."key" AS "key"
    FROM "WorkflowInstance" wi
    LEFT JOIN "WorkflowStage" ws ON ws.id = wi."currentStageId"
    WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = 'COMMITTEE' AND wi."objectId" = ${committeeId}
    ORDER BY wi."createdAt" DESC
    LIMIT 1
    FOR SHARE OF wi`;
  return rows[0]?.key ?? null;
}

/** The committee's newest instance, locked for the apply. */
async function lockCommitteeInstance(tx: EngineTx, committeeId: string, organizationId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT wi.id FROM "WorkflowInstance" wi
    WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = 'COMMITTEE' AND wi."objectId" = ${committeeId}
    ORDER BY wi."createdAt" DESC
    LIMIT 1
    FOR UPDATE`;
}

/** The stage key the request's instance stands in right now (inside the engine's lock, its from-stage). */
async function instanceStageKey(tx: Reader, instanceId: string): Promise<string | null> {
  const instance = await tx.workflowInstance.findFirst({ where: { id: instanceId }, select: { currentStageId: true } });
  if (!instance?.currentStageId) return null;
  const stage = await tx.workflowStage.findFirst({ where: { id: instance.currentStageId }, select: { key: true } });
  return stage?.key ?? null;
}


/**
 * Each request's stage key, and whether it is open. A request whose instance
 * was cancelled is closed; any other instance in a stage that is not one of
 * the three closed keys — a stage with no key included — is open.
 */
async function requestStageKeys(
  client: Pick<EngineTx, 'workflowInstance' | 'workflowStage'>,
  requestIds: string[],
  organizationId: string,
): Promise<Map<string, { key: string | null; open: boolean }>> {
  const out = new Map<string, { key: string | null; open: boolean }>();
  if (requestIds.length === 0) return out;
  const instances = await client.workflowInstance.findMany({
    where: { organizationId, objectType: OBJECT_TYPE, objectId: { in: requestIds } },
    orderBy: { createdAt: 'asc' },
    select: { objectId: true, currentStageId: true, status: true },
  });
  const stageIds = [...new Set(instances.map((i) => i.currentStageId).filter((s): s is string => !!s))];
  const stages = await client.workflowStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, key: true } });
  const keyOf = new Map(stages.map((s) => [s.id, s.key]));
  // Ascending, so the newest instance of a request is the one kept.
  for (const instance of instances) {
    const key = instance.currentStageId ? keyOf.get(instance.currentStageId) ?? null : null;
    out.set(instance.objectId, { key, open: instance.status !== 'CANCELLED' && requestStagePolicy(key).open });
  }
  return out;
}
