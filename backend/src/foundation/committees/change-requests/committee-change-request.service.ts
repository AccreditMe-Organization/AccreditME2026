import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { COMMITTEES_PERMISSIONS } from '../../../common/constants/permissions';
import { NotificationService } from '../../notification/notification.service';
import { RecordTaskClosure, TaskService } from '../../task/task.service';
import { EngineTx, WorkflowService } from '../../workflow/workflow.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { STAGE_FLAG } from '../../workflow/record-registry';
import { CHANGE_REQUEST_STAGE_KEYS } from '../../workflow/workflow-stage-keys';
import { MAX_REVIEW_STAGES } from '../../workflow/review-stages';
import { lockWorkflowInstance } from '../../task/stage-deadline';
import { assertCommitteeReferences, lockCommitteeHierarchy } from '../committee-reference-checks';
import { committeeTypeValues } from '../committee-type-values';
import { ChangeRequestRefusal } from './change-request-refusal';
import { assertMaySeeCommittee, assertMayWriteCommittee, mayReadCommittee } from '../../../common/services/committee-membership';
import { seatValues } from '../committee-seat-rules';
import { canonicalSeatActions, currentSeatActionMap, sameSeatActions, seatActionWanted, writeSeatActions } from '../seat-actions';
import { assertMemberAction, memberActionsFor } from '../member-actions';
import { ChainResult, ChainStep, mayDecideAnyChangeRequest, resolveDecisionChains } from './change-request-chain';
import {
  ACTION_TARGET_STAGE,
  ChangeRequestAction,
  CommitteeStageRules,
  assertCommitteeAllowsRaise,
  AWAITING_DECISION_KEYS,
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
 * requester proposes, someone else decides, and an approval applies every value
 * at once. Plan: backend/Plans/step-238-committee-changes.md (§10, §12).
 *
 * ACC-283 PR 2 — WHO DECIDES IS THE CHAIN OF AUTHORITY (change-request-chain.ts),
 * resolved live on every read and decision, never stored, never a role:
 * committees:approve is not read here any more. The root unit's head may instead
 * Approve now their own request (Q4). A draft or returned request gives its
 * requester a "Finish or withdraw" task (Q8), completed on Submit and cancelled
 * on Withdraw, its row locked LAST. Plan: backend/Plans/step-283-change-request-chain.md.
 *
 * THE REQUEST'S STATE IS ITS STAGE KEY. There is no status column: the request
 * has a workflow instance on the fixed six-stage template (PROTECTED_TEMPLATES),
 * and every move is an app move (mover APP) fired from here, after this
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
/**
 * ACC-283 PR 5 (Q12) — the committee's WHOLE seat-action map is one request
 * field: seat id → its actions, canonical (seatActionMap()'s shape), stored in
 * `changes` and `fromValues` beside the committee's own fields. It is previewed,
 * drift-checked and applied as one.
 */
export const SEAT_ACTIONS_FIELD = 'seatActions' as const;
export type SeatActionMap = Record<string, string[]>;
/** Every field a request may change: the committee's own, and its seat actions. */
export type RequestField = ChangeField | typeof SEAT_ACTIONS_FIELD;
export type ChangeValues = Partial<Record<ChangeField, ChangeValue>> & { seatActions?: SeatActionMap };

/** Fields that can never be empty on an approved committee: a null for one of them is "not changing". */
const REQUIRED_FIELDS: ReadonlySet<ChangeField> = new Set<ChangeField>(['nameEn', 'typeValueId', 'quorumCount', 'meetingFrequency']);

const OBJECT_TYPE = 'COMMITTEE_CHANGE_REQUEST' as const;

/** ACC-281 — the most requests the awaiting-decision list returns, oldest submitted first. */
export const AWAITING_DECISION_CAP = 200;
const PAGE = 50;
const STAGE_ORDER = new Map<string, number>(CHANGE_REQUEST_STAGE_KEYS.map((k, i) => [k, i]));

type CommitteeRow = Record<ChangeField, ChangeValue> & { id: string; organizationId: string; updatedAt: Date };

/** ACC-283 PR 5 — the committee's seat actions now, and the seats the organisation uses. */
interface SeatsNow {
  current: SeatActionMap;
  usedSeatIds: ReadonlySet<string>;
}

/**
 * Read ONLY when a request names seat actions (two queries), so a request that
 * changes only the committee's own fields costs what it did before.
 */
async function seatsNow(
  client: Pick<PrismaService, '$queryRaw' | 'committeeSeatAction'>,
  committeeId: string,
  organizationId: string,
): Promise<SeatsNow> {
  const usedSeatIds = new Set((await seatValues(client, organizationId)).map((seat) => seat.id));
  return { current: await currentSeatActionMap(client, organizationId, committeeId, usedSeatIds), usedSeatIds };
}

/** Does this proposal (a DTO or stored values) name the seat actions? */
function namesSeatActions(values: unknown): boolean {
  return !!values && typeof values === 'object' && (values as Record<string, unknown>)[SEAT_ACTIONS_FIELD] != null;
}

/** The committee's own fields a set of values names (never the seat actions). */
function scalarFields(values: ChangeValues): ChangeField[] {
  return (Object.keys(values) as ChangeField[]).filter((field) => CHANGE_FIELDS.includes(field));
}

type LabelIds = Record<'typeValueId' | 'orgUnitId' | 'committeeId' | 'seatValueId', string[]>;
const noLabelIds = (): LabelIds => ({ typeValueId: [], orgUnitId: [], committeeId: [], seatValueId: [] });

export interface ChangeRequestActions {
  edit: boolean;
  /** "Send for decision": false when the chain has nobody to send it to (ACC-283 §4.3). */
  submit: boolean;
  withdraw: boolean;
  approve: boolean;
  return: boolean;
  reject: boolean;
  /** ACC-283 PR 2 (Q4) — the root unit's head may approve their own request at once. */
  approveNow: boolean;
}

/** ACC-283 PR 2 — who decides a request under review: the step, never a person (Q15). */
export type AwaitingDecisionBy =
  | {
      kind: 'REPORTS_TO_SEAT';
      committee: { id: string; nameEn: string; nameAr: string | null };
      seats: { id: string; labelEn: string; labelAr: string | null }[];
    }
  | { kind: 'UNIT_HEAD'; unit: { id: string; nameEn: string; nameAr: string | null } };

/** ACC-283 PR 2 — the decision's authority, on its audit row (ids only). */
type DecisionAuthority =
  | { kind: 'REPORTS_TO_SEAT'; committeeId: string; seatIds: string[] }
  | { kind: 'UNIT_HEAD'; unitId: string; isRoot: boolean }
  | { kind: 'ROOT_HEAD_OWN' }
  // ACC-245 — a review stage's people.
  | { kind: 'REVIEW_STAGE'; stageId: string };

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
  /** ACC-283 PR 2 — under review only: who decides it now, by step. Null otherwise. */
  awaitingDecisionBy: AwaitingDecisionBy | null;
  /** ACC-283 PR 2 (Q8) — the requester's "Finish or withdraw" task, while one exists. */
  finishTaskId: string | null;
}

/** ACC-240 — the committee's open request, for its banner, and whether this viewer may raise one now. */
export interface IOpenChangeRequest {
  request: IChangeRequest | null;
  /**
   * The create call's own three checks, answered without creating:
   * committees:edit_details, the committee's stage allows a request (its
   * stored request_change action, ACC-255), and no open request (drafts count).
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
  // ACC-283 PR 5 — the whole map, before and after; `labels` names its seats.
  | { code: 'SEAT_ACTIONS'; from: SeatActionMap; to: SeatActionMap }
  | { code: 'TERMS_TASK' };

export interface IChangeRequestPreview {
  changedFields: RequestField[];
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

/** A request as loadRequest() reads it: the row, its newest instance, and its stage key. */
type LoadedRequest = { row: RequestRow; instanceId: string; stageKey: string | null; stageId: string | null };

/** ACC-283 PR 2 — the requester's task while a request is a draft or returned (Q8; lane A's Arabic). */
const FINISH_TASK = { title: 'Finish or withdraw the change request', titleAr: 'إكمال طلب التغيير أو سحبه' } as const;

@Injectable()
export class CommitteeChangeRequestService {
  private readonly logger = new Logger(CommitteeChangeRequestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly tasks: TaskService,
    private readonly auditLog: AuditLogService,
    private readonly notifications: NotificationService,
    // ACC-255 PR 2 — the committee's current stage, from its stored rules.
    private readonly stageRules: StageRulesService,
  ) {}

  // ── Writes ──────────────────────────────────────────────────────────────────

  async create(committeeId: string, dto: CreateChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    // ACC-283 PR 6 — the one rule (member-actions.ts): Edit details on a committee
    // they may write to, OR their seat here allows request_change. Refused as
    // before: CHANGE_REQUEST_NOT_ALLOWED naming the key, or for a key holder who
    // may not write here, the 404 a missing committee gets.
    await assertMemberAction(this.prisma, organizationId, committeeId, asCommitteeViewer(viewer), 'request_change', { notAllowed: requestNotAllowed });
    const committee = await this.loadCommittee(committeeId, organizationId);
    const seats = namesSeatActions(dto.changes) ? await seatsNow(this.prisma, committeeId, organizationId) : undefined;
    const changes = normaliseChanges(dto.changes, committee, {}, seats);

    // Every read the engine can do first (the template, the first stage), and
    // (ACC-283 Q8) the requester's "Finish or withdraw" task.
    const requestId = randomUUID();
    const preparedStart = await this.workflow.prepareInstanceStart(OBJECT_TYPE, requestId, organizationId);
    const preparedFinish = await this.prepareFinishTask(committeeId, viewer.userId, organizationId);

    const { request, started, finishTask } = await this.prisma.$transaction(async (tx) => {
      // The committee's stage, under its instance's share lock: a transition
      // into Dissolution Pending in flight finishes first, or waits for this.
      const stage = await this.committeeStage(tx, committeeId, organizationId);
      assertCommitteeAllowsRaise(stage);

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
      const finishTask = await this.tasks.insertPrepared(tx, preparedFinish, organizationId, viewer.userId);
      const request = await tx.committeeChangeRequest.create({
        data: {
          id: requestId,
          organizationId,
          committeeId,
          number,
          requestedById: viewer.userId,
          reason: dto.reason.trim(),
          changes: changes as Prisma.InputJsonValue,
          finishTaskId: finishTask.id,
        },
      });
      const started = await this.workflow.insertInstanceStartInTx(tx, preparedStart, requestId, organizationId, viewer.userId);
      return { request, started, finishTask };
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
    // The task's audit row; no "assigned to you" notice: the requester made it themselves.
    await this.tasks.announceCreated(finishTask, { ...preparedFinish, eligibleAssigneeIds: [] }, organizationId, viewer.userId);

    if (dto.submit) return this.submit(request.id, organizationId, viewer);
    return this.getOne(request.id, organizationId, viewer);
  }

  async update(id: string, dto: UpdateChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadRequest(id, organizationId);
    await this.assertMayRequestChange(loaded.row, organizationId, viewer); // ACC-283 PR 6
    assertRequester(loaded.row, viewer);

    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // The request's instance first: a Submit in flight finishes before this
      // reads the stage, so a submitted request is never edited after the fact.
      await lockWorkflowInstance(tx, loaded.instanceId, organizationId);
      const stage = await instanceStageKey(tx, loaded.instanceId);
      assertRequestStageAllows(stage, 'edit');
      assertCommitteeStageAllows(await this.committeeStage(tx, loaded.row.committeeId, organizationId), 'edit');

      await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      const before = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });
      if (dto.expectedUpdatedAt !== undefined && new Date(dto.expectedUpdatedAt).getTime() !== before.updatedAt.getTime()) {
        throw new ChangeRequestRefusal('CHANGE_REQUEST_CHANGED');
      }

      let changes: ChangeValues | undefined;
      if (dto.changes !== undefined) {
        const committee = await tx.committee.findFirstOrThrow({ where: { id: before.committeeId, organizationId } });
        const seats = namesSeatActions(dto.changes) ? await seatsNow(tx, before.committeeId, organizationId) : undefined;
        changes = normaliseChanges(dto.changes, committee as unknown as CommitteeRow, {}, seats);
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
    const loaded = await this.loadRequest(id, organizationId);
    await this.assertMayRequestChange(loaded.row, organizationId, viewer); // ACC-283 PR 6
    assertRequester(loaded.row, viewer);
    assertRequestStageAllows(loaded.stageKey, 'submit');

    // ACC-283 PR 2 — "Send for decision" needs someone to send it to. Nobody but the
    // requester (the root head's own request, §4.3): only Approve now is offered.
    // Nobody at all (a root that is already headless, Q7): refused and logged.
    const chain = await this.chainOf(loaded.row, organizationId);
    if (chain.step.kind === 'NONE') {
      if (chain.requesterHeadsRoot) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_DECIDER', { approveNow: true });
      this.logger.error(
        `Submit refused, no decider: changeRequestId=${id} committeeId=${loaded.row.committeeId} organizationId=${organizationId}`,
      );
      throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_DECIDER');
    }

    await this.performSubmit(loaded, organizationId, viewer);

    // Q1, ACC-283 — whoever decides now is told, never the requester. ACC-245 — the
    // first review stage's people when there is one, else the chain's deciders.
    await this.notifyDecidersOf(loaded.row, organizationId);
    return this.getOne(id, organizationId, viewer);
  }

  /**
   * The Submit move: the "from" values stored, the requester's finish task
   * completed, in the engine's transaction. LOCK ORDER: the request's instance
   * (the engine's), the committee's instance FOR SHARE (its stage), the committee
   * row FOR SHARE, the request row, then the finish task's row LAST (ACC-283).
   * Submit and Approve now both run it.
   */
  private async performSubmit(loaded: LoadedRequest, organizationId: string, viewer: ChangeRequestViewer): Promise<void> {
    const id = loaded.row.id;
    let fromValues: ChangeValues = {};
    let closure: RecordTaskClosure | null = null;
    // ACC-245 — the forward move out of Draft or Returned (its single ADVANCE): to the
    // first added review stage, or to Under review when there is none.
    await this.workflow.triggerSystemAdvance(loaded.instanceId, organizationId, viewer.userId, {
      inTx: async (tx) => {
        // Re-read under the instance's lock: the stage the move starts from.
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'submit');
        assertCommitteeStageAllows(await this.committeeStage(tx, loaded.row.committeeId, organizationId), 'submit');

        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${loaded.row.committeeId} AND "organizationId" = ${organizationId} FOR SHARE`;
        const committee = (await tx.committee.findFirstOrThrow({
          where: { id: loaded.row.committeeId, organizationId },
        })) as unknown as CommitteeRow;
        await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const request = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });

        // The values as they stand NOW, for every field the request changes.
        // A value that has since come to equal the proposal is not a change.
        // ACC-283 PR 5 — the seat actions, read under the committee row's share
        // lock: every write of them holds that row FOR UPDATE.
        const seats = namesSeatActions(request.changes) ? await seatsNow(tx, committee.id, organizationId) : undefined;
        const changes = dropUnchanged(request.changes as ChangeValues, committee, seats);
        if (Object.keys(changes).length === 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_CHANGES');
        fromValues = { ...pick(committee, scalarFields(changes)), ...(changes.seatActions && seats && { seatActions: seats.current }) };
        await assertCommitteeReferences(tx, referenceChange(committee.id, organizationId, changes), this.logger);

        await tx.committeeChangeRequest.update({
          where: { id },
          data: {
            changes: changes as Prisma.InputJsonValue,
            fromValues: fromValues as Prisma.InputJsonValue,
            submittedAt: new Date(),
          },
        });
        // ACC-283 Q8 — the requester's finish task is done: its row last.
        if (request.finishTaskId) closure = await this.tasks.closeRecordTaskInTx(tx, request.finishTaskId, organizationId, viewer.userId, 'COMPLETED');
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
    if (closure) await this.tasks.auditRecordTaskClosure(closure, organizationId, viewer.userId, 'CHANGE_REQUEST_SUBMITTED');
  }

  async withdraw(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadRequest(id, organizationId);
    await this.assertMayWriteRequest(loaded.row, organizationId, viewer); // ACC-281
    // ACC-283 Q8 — only the requester withdraws, at any open stage. Nobody else
    // withdraws another person's draft (it had been a committees:approve holder's).
    const own = loaded.row.requestedById === viewer.userId;
    const allowed = (stage: string | null): boolean => {
      assertRequestStageAllows(stage, 'withdraw');
      return own;
    };
    if (!allowed(loaded.stageKey)) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_REQUESTER');
    assertCommitteeStageAllows(await this.committeeStage(this.prisma, loaded.row.committeeId, organizationId, 'none'), 'withdraw');

    let closure: RecordTaskClosure | null = null;
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.withdraw, organizationId, viewer.userId, {
      inTx: async (tx) => {
        if (!allowed(await instanceStageKey(tx, loaded.instanceId))) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_REQUESTER');
        const request = await tx.committeeChangeRequest.update({
          where: { id },
          data: { withdrawnById: viewer.userId, withdrawnAt: new Date() },
        });
        // ACC-283 Q8 — the finish task goes with the request: its row last.
        if (request.finishTaskId) closure = await this.tasks.closeRecordTaskInTx(tx, request.finishTaskId, organizationId, viewer.userId, 'CANCELLED');
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
    if (closure) await this.tasks.auditRecordTaskClosure(closure, organizationId, viewer.userId, 'CHANGE_REQUEST_WITHDRAWN');
    // Withdrawing your own request tells nobody (only the requester withdraws now).
    return this.getOne(id, organizationId, viewer);
  }

  async approve(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const { loaded, chain } = await this.loadDecision(id, organizationId, viewer, 'approve');
    if (loaded.stageKey === null) {
      // ACC-245 — an added review stage: Approve moves the request ONE step on, to
      // the next review stage or to Under review. Nothing is applied: only the
      // chain's Approve, in Under review, applies the change.
      await this.performReviewAdvance(loaded, organizationId, viewer, authorityOf(chain.step), 'APPROVED');
      await this.notifyDecidersOf(loaded.row, organizationId);
      return this.getOne(id, organizationId, viewer);
    }
    await this.performApprove(loaded, organizationId, viewer, authorityOf(chain.step), { notifyRequester: true });
    return this.getOne(id, organizationId, viewer);
  }

  /**
   * ACC-245 — the app's forward move out of an added review stage (its single
   * ADVANCE), under the engine's lock, re-checking that the request still stands in
   * a review stage and that the committee's stage still allows a decision. One
   * audit row on the request. `decision` is APPROVED (its people), or SKIPPED (the
   * root head's own Approve now, which passes review stages by, Q1).
   */
  private async performReviewAdvance(
    loaded: LoadedRequest,
    organizationId: string,
    viewer: ChangeRequestViewer,
    authority: DecisionAuthority | null,
    decision: 'APPROVED' | 'SKIPPED',
  ): Promise<void> {
    await this.workflow.triggerSystemAdvance(loaded.instanceId, organizationId, viewer.userId, {
      inTx: async (tx) => {
        const key = await instanceStageKey(tx, loaded.instanceId);
        if (key !== null) throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_UNDER_REVIEW');
        assertRequestStageAllows(key, 'approve');
        assertCommitteeStageAllows(await this.committeeStage(tx, loaded.row.committeeId, organizationId), 'approve');
      },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeChangeRequest',
      objectId: loaded.row.id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { decision: decision === 'APPROVED' ? 'REVIEW_APPROVED' : 'REVIEW_SKIPPED', stageId: loaded.stageId, authority },
    });
  }

  /**
   * ACC-245 — tells whoever decides the request NOW (after it moved): an added
   * review stage's people, or the chain's deciders once it reaches Under review.
   * Never the requester. A request that is not awaiting a decision tells nobody.
   */
  private async notifyDecidersOf(row: RequestRow, organizationId: string): Promise<void> {
    const stage = (await requestStageKeys(this.prisma, [row.id], organizationId)).get(row.id);
    if (!stage || !stage.open || !awaitsDecision(stage.key)) return;
    const decision = await this.decisionOf(row, stage, organizationId);
    for (const userId of decision.deciderIds.filter((u) => u !== row.requestedById)) {
      await this.notify(userId, organizationId, row.committeeId, {
        titleEn: `Change request #${row.number} to review`,
        titleAr: `طلب التغيير رقم ${row.number} بانتظار المراجعة`,
        bodyEn: `${row.requestedBy.name} asked to change ${row.committee.nameEn}.`,
        bodyAr: `طلب ${row.requestedBy.name} تغيير ${row.committee.nameAr ?? row.committee.nameEn}.`,
      });
    }
  }

  /**
   * ACC-283 PR 2 (Q4) — the root unit's head applies their OWN request at once, as
   * their own final decision. Only the requester, only while they head the root
   * (a head holder or the acting cover in force), never anyone else.
   *
   * A draft or returned request: the reference checks run first, READ ONLY, so a
   * request that would fail is refused while it is still a draft; then Submit's
   * transaction and Approve's, back to back, each in its own lock order. If the
   * approve fails after the submit committed (a rare race), the request is under
   * review: with nobody else in the chain, Approve now stays offered to retry;
   * with deciders, they decide it. Once sent for decision to someone else, Approve
   * now is not offered again.
   */
  async approveNow(id: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const loaded = await this.loadRequest(id, organizationId);
    await this.assertMayRequestChange(loaded.row, organizationId, viewer); // ACC-283 PR 6
    if (loaded.row.requestedById !== viewer.userId) throw new ChangeRequestRefusal('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');
    const chain = await this.chainOf(loaded.row, organizationId);
    if (!chain.requesterHeadsRoot) throw new ChangeRequestRefusal('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');

    if (loaded.stageKey === null) {
      // ACC-245 (Q1) — in an added review stage: the root head's own Approve now
      // passes the remaining review stages by (below).
    } else if (awaitsDecision(loaded.stageKey)) {
      // Only the retry: nobody but the requester is left to decide it.
      if (chain.step.kind !== 'NONE') throw new ChangeRequestRefusal('CHANGE_REQUEST_APPROVE_NOW_NOT_ALLOWED');
    } else {
      assertRequestStageAllows(loaded.stageKey, 'submit');
      // The checks Submit and Approve make, first and read only, so a failing
      // request is refused while it is still a draft.
      const committee = await this.loadCommittee(loaded.row.committeeId, organizationId);
      const seats = namesSeatActions(loaded.row.changes) ? await seatsNow(this.prisma, committee.id, organizationId) : undefined;
      const changes = dropUnchanged(loaded.row.changes as ChangeValues, committee, seats);
      if (Object.keys(changes).length === 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_CHANGES');
      await this.prisma.$transaction((tx) => assertCommitteeReferences(tx, referenceChange(committee.id, organizationId, changes), this.logger));
      await this.performSubmit(loaded, organizationId, viewer);
    }
    // ACC-245 (Q1) — the root head's own Approve now SKIPS added review stages: each
    // is passed by with the app's forward move, recorded, until Under review.
    let reloaded = await this.loadRequest(id, organizationId);
    for (let step = 0; reloaded.stageKey === null && step <= MAX_REVIEW_STAGES; step++) {
      await this.performReviewAdvance(reloaded, organizationId, viewer, { kind: 'ROOT_HEAD_OWN' }, 'SKIPPED');
      reloaded = await this.loadRequest(id, organizationId);
    }
    await this.performApprove(reloaded, organizationId, viewer, { kind: 'ROOT_HEAD_OWN' }, { notifyRequester: false });
    return this.getOne(id, organizationId, viewer);
  }

  /**
   * The Approve move. LOCK ORDER (ACC-239, unchanged): the request's instance (the
   * engine's), the committee's instance, the hierarchy lock (only when a parent or
   * Reports to changes), the committee row, the request row. The decider was
   * resolved before (the chain takes no lock); `authority` names the step on the
   * audit row.
   */
  private async performApprove(
    loaded: LoadedRequest,
    organizationId: string,
    viewer: ChangeRequestViewer,
    // Null only if no step decided, which a decider never is (they come from a step).
    authority: DecisionAuthority | null,
    options: { notifyRequester: boolean },
  ): Promise<void> {
    const id = loaded.row.id;
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
    const out: {
      before?: CommitteeRow;
      after?: CommitteeRow;
      task?: Awaited<ReturnType<TaskService['insertPrepared']>>;
      seatChange?: { before: SeatActionMap; after: SeatActionMap } | null;
    } = {};

    // ACC-255 §4.3 — the target is the one stage of this request's template
    // flagged APPLIES_APPROVED_CHANGE, never a fixed key.
    const approvedStageKey = await this.approvedStageKey(loaded.instanceId, organizationId);
    await this.workflow.triggerSystemTransition(loaded.instanceId, approvedStageKey, organizationId, viewer.userId, {
      inTx: async (tx) => {
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'approve');

        // The committee's instance: no committee transition moves under the
        // apply, and a committee now dissolving refuses it.
        await lockCommitteeInstance(tx, loaded.row.committeeId, organizationId);
        assertCommitteeStageAllows(await this.committeeStage(tx, loaded.row.committeeId, organizationId), 'approve');
        if (touchesHierarchy) await lockCommitteeHierarchy(tx, organizationId);
        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${loaded.row.committeeId} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const before = (await tx.committee.findFirstOrThrow({
          where: { id: loaded.row.committeeId, organizationId },
        })) as unknown as CommitteeRow;

        // The request's values. Its row is locked LATER (ACC-283 §7: seat-action
        // rows are written after the committee row and before the request row).
        // Reading it first is safe: every write of a request holds its instance's
        // lock, which the engine took first here.
        const request = await tx.committeeChangeRequest.findFirstOrThrow({ where: { id, organizationId } });
        const proposed = request.changes as ChangeValues;
        const fromValues = (request.fromValues ?? {}) as ChangeValues;
        // ACC-283 PR 5 — the seat actions now, under the committee row's lock.
        const seats = namesSeatActions(proposed) ? await seatsNow(tx, before.id, organizationId) : undefined;

        // Q11 — DRIFT. Any value that differs from what the requester saw at
        // Submit refuses the whole approval: nothing is applied, and the
        // approver is told to return it.
        const drifted: RequestField[] = scalarFields(proposed).filter((f) => !sameValue(before[f], fromValues[f]));
        // ACC-283 PR 5 (Q12) — the seat-action map drifts as ONE field: what is
        // stored now against what the requester saw at Submit. A proposed seat
        // the organisation no longer uses is drift too, so nothing is ever
        // written for it.
        if (
          proposed.seatActions &&
          seats &&
          (!sameSeatActions(seats.current, fromValues.seatActions) || Object.keys(proposed.seatActions).some((seat) => !seats.usedSeatIds.has(seat)))
        ) {
          drifted.push(SEAT_ACTIONS_FIELD);
        }
        if (drifted.length > 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_COMMITTEE_CHANGED', { fields: drifted });

        await assertCommitteeReferences(tx, referenceChange(before.id, organizationId, proposed), this.logger);

        // ACC-283 PR 5 — the seat actions, by the one writer the Formation edit uses.
        const seatChange =
          proposed.seatActions && seats
            ? await writeSeatActions(tx, organizationId, before.id, seatActionWanted(proposed.seatActions), seats.usedSeatIds)
            : null;
        const columns = Object.fromEntries(scalarFields(proposed).map((f) => [f, proposed[f] ?? null]));
        const after = (await tx.committee.update({
          where: { id: before.id },
          // Seat actions are part of the terms of reference: a change to them alone
          // still makes a stale Formation save of the committee stale.
          data: { ...columns, ...(seatChange && { updatedAt: new Date() }) } as Prisma.CommitteeUncheckedUpdateInput,
        })) as unknown as CommitteeRow;

        await tx.$queryRaw`SELECT id FROM "CommitteeChangeRequest" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
        const task = await this.tasks.insertPrepared(tx, preparedTask, organizationId, viewer.userId);
        const now = new Date();
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { decidedById: viewer.userId, decidedAt: now, appliedAt: now, termsTaskId: task.id },
        });
        Object.assign(out, { before, after, task, seatChange });
      },
    });

    const { before: done, after: appliedRow, task: createdTask, seatChange } = out;
    if (done && appliedRow && createdTask) {
      // One audit row for the committee's change, naming the request.
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: 'Committee',
        objectId: loaded.row.committeeId,
        actorId: viewer.userId,
        tenantId: organizationId,
        before: { ...pick(done, scalarFields(changes)), ...(seatChange && { seatActions: seatChange.before }) } as Record<string, unknown>,
        after: { ...pick(appliedRow, scalarFields(changes)), ...(seatChange && { seatActions: seatChange.after }) } as Record<string, unknown>,
        metadata: { changeRequestId: id, changeRequestNumber: loaded.row.number },
      });
      await this.auditLog.log({
        action: 'APPROVE',
        objectType: 'CommitteeChangeRequest',
        objectId: id,
        actorId: viewer.userId,
        tenantId: organizationId,
        metadata: { termsTaskId: createdTask.id, authority },
      });
      await this.tasks.announceCreated(createdTask, preparedTask, organizationId, viewer.userId);
    }
    // Approve now is the requester's own decision: nobody to tell.
    if (options.notifyRequester) {
      await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
        titleEn: `Change request #${loaded.row.number} approved`,
        titleAr: `اعتُمد طلب التغيير رقم ${loaded.row.number}`,
        bodyEn: `Your changes to ${loaded.row.committee.nameEn} were applied.`,
        bodyAr: `طُبّقت التغييرات التي طلبتها على ${loaded.row.committee.nameAr ?? loaded.row.committee.nameEn}.`,
      });
    }
  }

  async returnForChanges(id: string, dto: ReturnChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const { loaded, chain } = await this.loadDecision(id, organizationId, viewer, 'return');
    const note = dto.note.trim();
    // ACC-283 Q8 — a returned request is a draft again: a new finish task for its requester.
    const preparedFinish = await this.prepareFinishTask(loaded.row.committeeId, loaded.row.requestedById, organizationId);
    let finishTask: Awaited<ReturnType<TaskService['insertPrepared']>> | null = null;
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.return, organizationId, viewer.userId, {
      comment: note,
      inTx: async (tx) => {
        assertRequestStageAllows(await instanceStageKey(tx, loaded.instanceId), 'return');
        // The committee's stage decides whether a decision may still be made.
        assertCommitteeStageAllows(await this.committeeStage(tx, loaded.row.committeeId, organizationId), 'return');
        finishTask = await this.tasks.insertPrepared(tx, preparedFinish, organizationId, loaded.row.requestedById);
        await tx.committeeChangeRequest.update({
          where: { id },
          data: { returnNote: note, decidedById: viewer.userId, decidedAt: new Date(), finishTaskId: finishTask.id },
        });
      },
    });
    await this.auditLog.log({
      action: 'UPDATE',
      objectType: 'CommitteeChangeRequest',
      objectId: id,
      actorId: viewer.userId,
      tenantId: organizationId,
      metadata: { decision: 'RETURNED', note, authority: authorityOf(chain.step) },
    });
    if (finishTask) await this.tasks.announceCreated(finishTask, preparedFinish, organizationId, viewer.userId);
    await this.notify(loaded.row.requestedById, organizationId, loaded.row.committeeId, {
      titleEn: `Change request #${loaded.row.number} returned`,
      titleAr: `أُعيد طلب التغيير رقم ${loaded.row.number}`,
      bodyEn: note,
      bodyAr: note,
    });
    return this.getOne(id, organizationId, viewer);
  }

  async reject(id: string, dto: RejectChangeRequestDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequest> {
    const { loaded, chain } = await this.loadDecision(id, organizationId, viewer, 'reject');
    const reason = dto.reason.trim();
    await this.workflow.triggerSystemTransition(loaded.instanceId, ACTION_TARGET_STAGE.reject, organizationId, viewer.userId, {
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
      metadata: { reason, authority: authorityOf(chain.step) },
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
    // ACC-281 — committees:view as today; anyone else only for a request on a
    // committee they are an active member of, or (ACC-283 PR 2a) oversee as a head
    // or cover of its unit or above, or (PR 2) decide now. Anyone else gets today's
    // 403 whether the request exists or not, so the answer reveals nothing.
    if (!hasPermission(viewer, COMMITTEES_PERMISSIONS.VIEW)) {
      const admitted =
        !!row &&
        ((await mayReadCommittee(this.prisma, row.committeeId, organizationId, asCommitteeViewer(viewer))) ||
          (await this.isCurrentDecider(row, organizationId, viewer)));
      if (!admitted) throw new ForbiddenException(`Required permission: ${COMMITTEES_PERMISSIONS.VIEW}`);
    }
    if (!row) throw new NotFoundException('Change request not found');
    const committeeStage = await this.committeeStage(this.prisma, row.committeeId, organizationId, 'none');
    const [dto] = await this.toDtos([row], organizationId, viewer, () => committeeStage);
    return dto!;
  }

  /** The committee's requests — its panel and See all — searched, sorted and paged here (they are few). */
  async list(committeeId: string, query: ChangeRequestListQueryDto, organizationId: string, viewer: ChangeRequestViewer): Promise<IChangeRequestPage> {
    await assertMaySeeCommittee(this.prisma, committeeId, organizationId, asCommitteeViewer(viewer)); // ACC-281
    await this.loadCommittee(committeeId, organizationId);
    const rows = await this.prisma.committeeChangeRequest.findMany({
      where: { committeeId, organizationId },
      include: REQUEST_INCLUDE,
    });
    const committeeStage = await this.committeeStage(this.prisma, committeeId, organizationId, 'none');
    const all = await this.toDtos(rows, organizationId, viewer, () => committeeStage);

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
   * create call's own checks, read from the same functions (the one rule's
   * `request_change`, `committeeAllowsRaise()`, `isOpen()`), never a second copy.
   * Create re-checks the last two under the committee's row lock; this is a read.
   *
   * ACC-283 — #325 added the write precondition so an overseeing head, who READS
   * the committee but may not raise a request (Q6), is not offered one. PR 6
   * folds it into the rule (member-actions.ts): the role's Edit details on a
   * committee they may write to, OR their seat allows request_change. From the
   * seat the read check just read: no extra query for the membership.
   */
  async openSummary(committeeId: string, organizationId: string, viewer: ChangeRequestViewer): Promise<IOpenChangeRequest> {
    const access = await assertMaySeeCommittee(this.prisma, committeeId, organizationId, asCommitteeViewer(viewer)); // ACC-281
    await this.loadCommittee(committeeId, organizationId);
    const rows = await this.prisma.committeeChangeRequest.findMany({
      where: { committeeId, organizationId },
      include: REQUEST_INCLUDE,
      orderBy: { number: 'desc' },
    });
    const [states, committeeStage, may] = await Promise.all([
      requestStageKeys(this.prisma, rows.map((r) => r.id), organizationId),
      this.committeeStage(this.prisma, committeeId, organizationId, 'none'),
      // ACC-283 PR 6 — memberActions.request_change, by the one rule, from the seat
      // the read check just read. It contains the write precondition, so an
      // overseeing head (no seat) is false.
      memberActionsFor(this.prisma, organizationId, committeeId, asCommitteeViewer(viewer), { actions: ['request_change'], seat: access.seat }),
    ]);
    const open = rows.find((r) => isOpen(states.get(r.id))) ?? null;
    const canRaise = may.request_change && committeeAllowsRaise(committeeStage) && !open;
    if (!open) return { request: null, canRaise };
    const [dto] = await this.toDtos([open], organizationId, viewer, () => committeeStage);
    return { request: dto!, canRaise };
  }

  /**
   * Every request under review that the viewer decides now (ACC-283 PR 2: by the
   * chain, never committees:view or committees:approve; the route has no gate).
   *
   * CHEAP FIRST, three reads at once: the unit the viewer heads, the units they
   * cover, and whether they hold a seat that decides reporting changes. Nobody who
   * holds none of those can be in any chain: an empty list, three queries. Anyone
   * else: the requests under review (SQL, capped), then ONE chain resolution for
   * all of them, kept where the viewer is a decider.
   */
  async awaitingDecision(organizationId: string, viewer: ChangeRequestViewer, now: Date = new Date()): Promise<IChangeRequest[]> {
    // Prompt 85 — ONE indexed query: someone who heads, covers and holds no deciding
    // seat has nothing waiting, so nothing else is read.
    if (!(await mayDecideAnyChangeRequest(this.prisma, organizationId, viewer.userId, now))) return [];

    // ACC-281 — filtered IN THE QUERY: the ids of the requests whose NEWEST
    // instance stands in a stage awaiting a decision (the policy's own keys),
    // oldest submitted first, capped. Every table is scoped by organisation.
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id
      FROM "CommitteeChangeRequest" r
      JOIN LATERAL (
        SELECT wi."currentStageId"
        FROM "WorkflowInstance" wi
        WHERE wi."organizationId" = ${organizationId}
          AND wi."objectType"::text = ${OBJECT_TYPE}
          AND wi."objectId" = r.id
        ORDER BY wi."createdAt" DESC
        LIMIT 1
      ) li ON TRUE
      JOIN "WorkflowStage" s ON s.id = li."currentStageId"
      JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
      WHERE r."organizationId" = ${organizationId}
        AND r."submittedAt" IS NOT NULL
        AND r."requestedById" <> ${viewer.userId}
        AND s.key = ANY(${[...AWAITING_DECISION_KEYS]}::text[])
      ORDER BY r."submittedAt" ASC, r.id ASC
      LIMIT ${AWAITING_DECISION_CAP}`;
    if (ids.length === AWAITING_DECISION_CAP) {
      this.logger.warn(`Awaiting decision reached its cap of ${AWAITING_DECISION_CAP}: organizationId=${organizationId}`);
    }
    if (ids.length === 0) return [];
    const order = new Map(ids.map((r, i) => [r.id, i]));
    const rows = (
      await this.prisma.committeeChangeRequest.findMany({
        where: { id: { in: ids.map((r) => r.id) }, organizationId },
        include: REQUEST_INCLUDE,
      })
    ).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const chains = await resolveDecisionChains(
      this.prisma,
      organizationId,
      rows.map((r) => ({ id: r.id, committeeId: r.committeeId, requesterId: r.requestedById })),
      now,
    );
    const mine = rows.filter((r) => chains.get(r.id)?.deciderIds.includes(viewer.userId));
    if (mine.length === 0) return [];
    // ACC-255 PR 2 — every committee's stage in one batch (three queries), not one read each.
    const committeeStages = await this.stageRules.stageRulesFor(organizationId, 'COMMITTEE', [...new Set(mine.map((r) => r.committeeId))]);
    const dtos = await this.toDtos(mine, organizationId, viewer, (id) => committeeStages.get(id) ?? NO_STAGE, chains);
    // A second guard that changes nothing while the query is right (a spec holds the two equal).
    return dtos.filter((d) => awaitsDecision(d.status));
  }

  /** What approving these changes would do — for Request a change, before anything is saved. */
  async preview(
    committeeId: string,
    values: CommitteeChangeValuesDto,
    organizationId: string,
    viewer: ChangeRequestViewer,
  ): Promise<IChangeRequestPreview> {
    await assertMaySeeCommittee(this.prisma, committeeId, organizationId, asCommitteeViewer(viewer)); // ACC-281
    const committee = await this.loadCommittee(committeeId, organizationId);
    const seats = namesSeatActions(values) ? await seatsNow(this.prisma, committeeId, organizationId) : undefined;
    const changes = normaliseChanges(values, committee, { allowEmpty: true }, seats);
    const fields = Object.keys(changes) as RequestField[];
    if (fields.length > 0) {
      await this.prisma.$transaction((tx) =>
        assertCommitteeReferences(tx, referenceChange(committeeId, organizationId, changes), this.logger),
      );
    }

    const impacts: ChangeImpact[] = [];
    const span = (f: ChangeField) => ({ from: committee[f], to: changes[f] ?? null });
    if ('quorumCount' in changes) {
      // Votes already open keep the quorum they began with (ACC-239's snapshot).
      // ACC-271 PR 6a — counted by who mode and the vote's committee
      // (WorkflowService.countOpenCommitteeVotes); it read the old approval mode before,
      // which no converted stage has, so it always said 0.
      const inProgress = await this.workflow.countOpenCommitteeVotes(organizationId, committeeId);
      impacts.push({ code: 'QUORUM', ...span('quorumCount'), inProgress });
    }
    if ('nameEn' in changes || 'nameAr' in changes) impacts.push({ code: 'NAME' });
    if ('typeValueId' in changes) impacts.push({ code: 'TYPE' });
    if ('purpose' in changes) impacts.push({ code: 'PURPOSE' });
    if ('meetingFrequency' in changes) impacts.push({ code: 'MEETING_FREQUENCY', ...span('meetingFrequency') });
    if ('orgUnitId' in changes) impacts.push({ code: 'OWNING_UNIT', ...span('orgUnitId') });
    if ('parentCommitteeId' in changes) impacts.push({ code: 'PARENT', ...span('parentCommitteeId') });
    if ('reportingToCommitteeId' in changes) impacts.push({ code: 'REPORTS_TO', ...span('reportingToCommitteeId') });
    if (changes.seatActions && seats) impacts.push({ code: 'SEAT_ACTIONS', from: seats.current, to: changes.seatActions });
    if (fields.length > 0) impacts.push({ code: 'TERMS_TASK' });
    const ids = noLabelIds();
    for (const impact of impacts) {
      if (impact.code === 'SEAT_ACTIONS') {
        ids.seatValueId.push(...Object.keys(impact.from), ...Object.keys(impact.to));
        continue;
      }
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
    const ids = noLabelIds();
    for (const row of rows) {
      for (const values of [row.changes, row.fromValues] as unknown[]) {
        if (!values || typeof values !== 'object') continue;
        for (const [field, value] of Object.entries(values as Record<string, unknown>)) {
          // ACC-283 PR 5 — the seat-action map's keys are seats.
          if (field === SEAT_ACTIONS_FIELD && value && typeof value === 'object') {
            ids.seatValueId.push(...Object.keys(value));
            continue;
          }
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
  private async resolveLabels(ids: LabelIds, organizationId: string): Promise<ChangeRequestLabels> {
    const unique = (list: string[]) => [...new Set(list)];
    const [types, units, committees, seats] = await Promise.all([
      committeeTypeValues(this.prisma, organizationId, unique(ids.typeValueId)),
      ids.orgUnitId.length
        ? this.prisma.orgUnit.findMany({ where: { id: { in: unique(ids.orgUnitId) }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([]),
      ids.committeeId.length
        ? this.prisma.committee.findMany({ where: { id: { in: unique(ids.committeeId) }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([]),
      // ACC-283 PR 5 — the seats a seat-action map names, by the same resolver.
      committeeTypeValues(this.prisma, organizationId, unique(ids.seatValueId), 'committee_member_role'),
    ]);
    const labels: ChangeRequestLabels = {};
    for (const t of types.values()) labels[t.id] = { en: t.labelEn, ar: t.labelAr };
    for (const seat of seats.values()) labels[seat.id] = { en: seat.labelEn, ar: seat.labelAr };
    for (const u of units) labels[u.id] = { en: u.nameEn, ar: u.nameAr };
    for (const c of committees) labels[c.id] = { en: c.nameEn, ar: c.nameAr };
    return labels;
  }

  /**
   * ACC-283 PR 6 — editing, submitting or approving-now one's request: the one rule
   * for request_change (member-actions.ts) on the request's committee. Read after
   * the request, so anyone who is neither a member nor a committees:view holder
   * gets "Change request not found", key or not: the answer never says whether
   * the id exists. A member or holder whom neither the role nor the seat allows
   * gets CHANGE_REQUEST_NOT_ALLOWED naming the key, as before.
   */
  private async assertMayRequestChange(row: { committeeId: string }, organizationId: string, viewer: ChangeRequestViewer): Promise<void> {
    await assertMemberAction(this.prisma, organizationId, row.committeeId, asCommitteeViewer(viewer), 'request_change', {
      notAllowed: requestNotAllowed,
      notFoundMessage: 'Change request not found',
      afterRecordRead: true,
    });
  }

  /**
   * ACC-281 — withdrawing a request by id: committees:view, or an active member of
   * the request's committee. Anyone else gets the identical 404 a missing request
   * gets. Not a seat action (only the requester withdraws, Q8), so ACC-283 PR 6 left
   * it as it was. Deciding never calls this: the chain decides (ACC-283 PR 2).
   */
  private async assertMayWriteRequest(row: { committeeId: string }, organizationId: string, viewer: ChangeRequestViewer): Promise<void> {
    await assertMayWriteCommittee(this.prisma, row.committeeId, organizationId, asCommitteeViewer(viewer), 'Change request not found');
  }

  private async loadCommittee(committeeId: string, organizationId: string): Promise<CommitteeRow> {
    const committee = await this.prisma.committee.findFirst({ where: { id: committeeId, organizationId } });
    if (!committee) throw new NotFoundException('Committee not found');
    return committee as unknown as CommitteeRow;
  }

  /**
   * ACC-255 PR 2 — the committee's current stage, from its stored rules
   * (StageRulesService): the actions it allows and its flags. Inside a
   * transaction the instance is read FOR SHARE, so a committee transition in
   * flight finishes first, exactly as the old key read did.
   */
  private committeeStage(
    client: Parameters<StageRulesService['currentStageRules']>[3],
    committeeId: string,
    organizationId: string,
    lock: 'share' | 'none' = 'share',
  ): Promise<CommitteeStageRules> {
    return this.stageRules.currentStageRules('COMMITTEE', committeeId, organizationId, client, { lock });
  }

  /**
   * ACC-255 §4.3 — approve's target: the one stage of this request's template
   * flagged APPLIES_APPROVED_CHANGE. Exactly one is enforced on every stage
   * save; if a template ever has none (or more), approve is refused and the
   * ids logged, and no change is applied from an unflagged stage.
   */
  private async approvedStageKey(instanceId: string, organizationId: string): Promise<string> {
    const flagged = await this.prisma.workflowStage.findMany({
      where: {
        flags: { has: STAGE_FLAG.APPLIES_APPROVED_CHANGE },
        workflowTemplate: { organizationId, instances: { some: { id: instanceId, organizationId } } },
      },
      select: { id: true, key: true },
    });
    if (flagged.length !== 1 || !flagged[0]!.key) {
      this.logger.warn(`Approve refused: instance ${instanceId} (organisation ${organizationId}) has ${flagged.length} stage(s) flagged APPLIES_APPROVED_CHANGE.`);
      throw new ChangeRequestRefusal('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    }
    return flagged[0]!.key;
  }

  private async loadRequest(id: string, organizationId: string): Promise<LoadedRequest> {
    const row = await this.prisma.committeeChangeRequest.findFirst({ where: { id, organizationId }, include: REQUEST_INCLUDE });
    if (!row) throw new NotFoundException('Change request not found');
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { organizationId, objectType: OBJECT_TYPE, objectId: id },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!instance) throw new NotFoundException('Change request not found');
    const stages = await requestStageKeys(this.prisma, [id], organizationId);
    return { row, instanceId: instance.id, stageKey: stages.get(id)?.key ?? null, stageId: stages.get(id)?.stageId ?? null };
  }

  /**
   * Approve, Return, Reject (ACC-283 PR 2): a CURRENT DECIDER of the request, by
   * the chain, resolved before the transaction (it takes no lock), and what both
   * stages allow. Anyone else, in this order: the requester gets
   * CHANGE_REQUEST_OWN_DECISION; someone who may read the request gets
   * CHANGE_REQUEST_NOT_DECIDER, naming the step that decides; anyone else the 404
   * a missing request gets.
   */
  private async loadDecision(
    id: string,
    organizationId: string,
    viewer: ChangeRequestViewer,
    action: Extract<ChangeRequestAction, 'approve' | 'return' | 'reject'>,
  ): Promise<{ loaded: LoadedRequest; chain: ChainResult }> {
    const loaded = await this.loadRequest(id, organizationId);
    // ACC-245 — in an added review stage, its people decide; in Under review, the chain.
    const chain = await this.decisionOf(loaded.row, { key: loaded.stageKey, stageId: loaded.stageId, instanceId: loaded.instanceId }, organizationId);
    const mayRead = async () =>
      hasPermission(viewer, COMMITTEES_PERMISSIONS.VIEW) ||
      (await mayReadCommittee(this.prisma, loaded.row.committeeId, organizationId, asCommitteeViewer(viewer)));
    // ACC-245 — a review stage's people are whoever the stage names, so the record
    // comes first (ACC-282's order): a pool member who cannot open the committee
    // gets the 404 a missing request gets, before anything moves.
    if (loaded.stageKey === null && chain.deciderIds.includes(viewer.userId) && !(await mayRead())) {
      throw new NotFoundException('Change request not found');
    }
    if (!chain.deciderIds.includes(viewer.userId)) {
      if (loaded.row.requestedById === viewer.userId) throw new ChangeRequestRefusal('CHANGE_REQUEST_OWN_DECISION');
      if (!(await mayRead())) throw new NotFoundException('Change request not found');
      const by = awaitsDecision(loaded.stageKey) ? (await this.nameSteps([chain], organizationId))(chain.step) : null;
      throw new ChangeRequestRefusal('CHANGE_REQUEST_NOT_DECIDER', { awaitingDecisionBy: by });
    }
    assertRequestStageAllows(loaded.stageKey, action);
    assertCommitteeStageAllows(await this.committeeStage(this.prisma, loaded.row.committeeId, organizationId, 'none'), action);
    return { loaded, chain };
  }

  /** ACC-283 PR 2 — one request's chain (resolveDecisionChains for one). */
  private async chainOf(row: { id: string; committeeId: string; requestedById: string }, organizationId: string): Promise<ChainResult> {
    const chains = await resolveDecisionChains(this.prisma, organizationId, [
      { id: row.id, committeeId: row.committeeId, requesterId: row.requestedById },
    ]);
    return chains.get(row.id)!;
  }

  /**
   * ACC-245 — who decides this request where it stands: in an added review stage,
   * that stage's people (its pool, out-of-office routed, never the requester); in
   * any other stage, the chain. `requesterHeadsRoot` is the chain's either way
   * (Approve now). One chain resolution and at most one pool read.
   */
  private async decisionOf(
    row: { id: string; committeeId: string; requestedById: string },
    stage: { key: string | null; stageId: string | null; instanceId?: string | null } | undefined,
    organizationId: string,
  ): Promise<ChainResult> {
    const chain = await this.chainOf(row, organizationId);
    const decisions = await this.reviewDecisions(organizationId, [row], () => stage, () => chain);
    return decisions.get(row.id) ?? chain;
  }

  /**
   * ACC-245 — for the rows standing in an added review stage, the decision of that
   * stage's people, in ONE batched pool read (StagePoolService.resolveMany through
   * the engine), never one per row. Rows elsewhere are absent.
   */
  private async reviewDecisions(
    organizationId: string,
    rows: { id: string; requestedById: string }[],
    stageOf: (id: string) => { key: string | null; stageId: string | null; instanceId?: string | null } | undefined,
    chainOf: (id: string) => ChainResult | undefined,
  ): Promise<Map<string, ChainResult>> {
    const out = new Map<string, ChainResult>();
    const review = rows.flatMap((r) => {
      const stage = stageOf(r.id);
      return stage && stage.key === null && stage.stageId && stage.instanceId ? [{ row: r, stageId: stage.stageId, instanceId: stage.instanceId }] : [];
    });
    if (review.length === 0) return out;
    const pools = await this.workflow.stagePoolMembers(
      organizationId,
      review.map(({ row, stageId, instanceId }) => ({ key: row.id, stageId, instance: { id: instanceId, objectType: OBJECT_TYPE, objectId: row.id } })),
    );
    for (const { row, stageId } of review) {
      const people = [...new Set((pools.get(row.id) ?? []).filter((id) => id !== row.requestedById))].sort();
      out.set(row.id, { step: { kind: 'REVIEW_STAGE', stageId }, deciderIds: people, requesterHeadsRoot: chainOf(row.id)?.requesterHeadsRoot ?? false });
    }
    return out;
  }

  /** ACC-283 PR 2 — is the viewer a current decider of this request (under review, in its chain)? */
  private async isCurrentDecider(row: RequestRow, organizationId: string, viewer: ChangeRequestViewer): Promise<boolean> {
    const stage = (await requestStageKeys(this.prisma, [row.id], organizationId)).get(row.id);
    if (!stage || !stage.open || !awaitsDecision(stage.key)) return false;
    return (await this.decisionOf(row, stage, organizationId)).deciderIds.includes(viewer.userId);
  }

  /**
   * ACC-283 PR 2 — the responses for these rows, from ONE batch: their stages and
   * names, and ONE chain resolution for the rows that need it (under review: who
   * decides; the viewer's own draft or returned request: Send for decision and
   * Approve now). `known` passes chains the caller already resolved.
   */
  private async toDtos(
    rows: RequestRow[],
    organizationId: string,
    viewer: ChangeRequestViewer,
    committeeStageOf: (committeeId: string) => CommitteeStageRules,
    known?: Map<string, ChainResult>,
  ): Promise<IChangeRequest[]> {
    if (rows.length === 0) return [];
    const [stages, extras] = await Promise.all([
      requestStageKeys(this.prisma, rows.map((r) => r.id), organizationId),
      this.loadExtras(rows, organizationId),
    ]);
    const needsChain = rows.filter((r) => {
      const state = stages.get(r.id);
      return isOpen(state) && (awaitsDecision(state?.key) || r.requestedById === viewer.userId);
    });
    const missing = needsChain.filter((r) => !known?.has(r.id));
    const resolved = missing.length
      ? await resolveDecisionChains(
          this.prisma,
          organizationId,
          missing.map((r) => ({ id: r.id, committeeId: r.committeeId, requesterId: r.requestedById })),
        )
      : new Map<string, ChainResult>();
    const chainOnly = (id: string) => known?.get(id) ?? resolved.get(id);
    // ACC-245 — a request in an added review stage is decided by that stage's people.
    const review = await this.reviewDecisions(organizationId, needsChain, (id) => stages.get(id), chainOnly);
    const chainFor = (id: string) => review.get(id) ?? chainOnly(id);
    const underReview = needsChain.filter((r) => awaitsDecision(stages.get(r.id)?.key));
    const named = await this.nameSteps(
      underReview.map((r) => chainFor(r.id)).filter((c): c is ChainResult => !!c),
      organizationId,
    );
    // ACC-283 PR 6 — request_change by the one rule, once per committee among the
    // viewer's OWN requests (only those can offer edit, submit or approve now):
    // one list on one committee asks once, the awaiting list never.
    const ownCommittees = [...new Set(rows.filter((r) => r.requestedById === viewer.userId).map((r) => r.committeeId))];
    const mayRequest = new Map(
      await Promise.all(
        ownCommittees.map(
          async (committeeId) =>
            [
              committeeId,
              (await memberActionsFor(this.prisma, organizationId, committeeId, asCommitteeViewer(viewer), { actions: ['request_change'] }))
                .request_change,
            ] as const,
        ),
      ),
    );
    return rows.map((r) => {
      const status = stages.get(r.id)?.key ?? null;
      const chain = chainFor(r.id);
      const by = chain && awaitsDecision(status) ? named(chain.step) : null;
      return toDto(r, status, committeeStageOf(r.committeeId), viewer, extras, chain, by, mayRequest.get(r.committeeId) ?? false);
    });
  }

  /**
   * ACC-283 PR 2 — names the deciding steps for `awaitingDecisionBy`: the Reports-to
   * committees, their seats and the units, each read once (three queries at most),
   * scoped by organisation. Never a person.
   */
  private async nameSteps(chains: ChainResult[], organizationId: string): Promise<(step: ChainStep) => AwaitingDecisionBy | null> {
    const committeeIds = new Set<string>();
    const unitIds = new Set<string>();
    let seatsNeeded = false;
    for (const { step } of chains) {
      if (step.kind === 'REPORTS_TO_SEAT') {
        committeeIds.add(step.committeeId);
        seatsNeeded = true;
      }
      if (step.kind === 'UNIT_HEAD') unitIds.add(step.unitId);
    }
    const [committees, units, seats] = await Promise.all([
      committeeIds.size
        ? this.prisma.committee.findMany({ where: { id: { in: [...committeeIds] }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([] as { id: string; nameEn: string; nameAr: string | null }[]),
      unitIds.size
        ? this.prisma.orgUnit.findMany({ where: { id: { in: [...unitIds] }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([] as { id: string; nameEn: string; nameAr: string | null }[]),
      seatsNeeded ? seatValues(this.prisma, organizationId) : Promise.resolve([]),
    ]);
    const committeeById = new Map(committees.map((c) => [c.id, c]));
    const unitById = new Map(units.map((u) => [u.id, u]));
    const seatById = new Map(seats.map((v) => [v.id, v]));
    return (step) => {
      if (step.kind === 'REPORTS_TO_SEAT') {
        const committee = committeeById.get(step.committeeId);
        if (!committee) return null;
        return {
          kind: 'REPORTS_TO_SEAT',
          committee,
          seats: step.seatIds.flatMap((id) => {
            const seat = seatById.get(id);
            return seat ? [{ id, labelEn: seat.labelEn, labelAr: seat.labelAr }] : [];
          }),
        };
      }
      if (step.kind === 'UNIT_HEAD') {
        const unit = unitById.get(step.unitId);
        return unit ? { kind: 'UNIT_HEAD', unit } : null;
      }
      return null;
    };
  }

  /** ACC-283 PR 2 (Q8) — the requester's "Finish or withdraw" task, prepared before a transaction. */
  private prepareFinishTask(committeeId: string, requesterId: string, organizationId: string) {
    return this.tasks.prepareRecordTask(
      {
        ...FINISH_TASK,
        description: 'Finish this change request and send it for decision, or withdraw it.',
        priority: 'MEDIUM',
        sourceType: 'COMMITTEE',
        sourceId: committeeId,
        assigneeUserIds: [requesterId],
      },
      organizationId,
    );
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

/** ACC-283 PR 2 — the step that decided, for the decision's audit row (ids only). */
function authorityOf(step: ChainStep): DecisionAuthority | null {
  if (step.kind === 'REPORTS_TO_SEAT') return { kind: 'REPORTS_TO_SEAT', committeeId: step.committeeId, seatIds: step.seatIds };
  if (step.kind === 'UNIT_HEAD') return { kind: 'UNIT_HEAD', unitId: step.unitId, isRoot: step.isRoot };
  if (step.kind === 'REVIEW_STAGE') return { kind: 'REVIEW_STAGE', stageId: step.stageId };
  return null;
}

function hasPermission(viewer: ChangeRequestViewer, permission: string): boolean {
  return viewer.permissions.includes(permission);
}

/** ACC-281 — the membership rule's viewer shape. */
function asCommitteeViewer(viewer: ChangeRequestViewer): { id: string; permissions: readonly string[] } {
  return { id: viewer.userId, permissions: viewer.permissions };
}

/** ACC-283 PR 6 — today's refusal for a request write the rule does not allow, naming the key. */
function requestNotAllowed(permission: string): ChangeRequestRefusal {
  return new ChangeRequestRefusal('CHANGE_REQUEST_NOT_ALLOWED', { permission });
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
  // ACC-283 PR 5 — the committee's seat actions now: required when `values` names them.
  seats?: SeatsNow,
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
  // ACC-283 PR 5 (Q12) — the whole seat-action map, checked and canonical; equal
  // to what is stored now, it is not a change. Null is "not changing".
  if (values?.seatActions != null) {
    if (!seats) throw new Error("normaliseChanges: seat actions need the committee's seats");
    const map = canonicalSeatActions(values.seatActions, seats.usedSeatIds);
    if (!sameSeatActions(map, seats.current)) out.seatActions = map;
  }
  if ('quorumCount' in out && (typeof out.quorumCount !== 'number' || out.quorumCount < 1)) {
    throw new ChangeRequestRefusal('CHANGE_REQUEST_QUORUM_MIN');
  }
  if (!options.allowEmpty && Object.keys(out).length === 0) throw new ChangeRequestRefusal('CHANGE_REQUEST_NO_CHANGES');
  return out;
}

function dropUnchanged(changes: ChangeValues, committee: CommitteeRow, seats?: SeatsNow): ChangeValues {
  const out: ChangeValues = {};
  for (const field of scalarFields(changes)) {
    if (!sameValue(committee[field], changes[field])) out[field] = changes[field] ?? null;
  }
  // ACC-283 PR 5 — the seat-action map, as one value.
  if (changes.seatActions) {
    if (!seats) throw new Error("dropUnchanged: seat actions need the committee's seats");
    if (!sameSeatActions(changes.seatActions, seats.current)) out.seatActions = changes.seatActions;
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
      if (field === SEAT_ACTIONS_FIELD && value && typeof value === 'object') {
        for (const seat of Object.keys(value)) if (all[seat]) out[seat] = all[seat]!;
        continue;
      }
      if (LABELLED_FIELDS[field as ChangeField] && typeof value === 'string' && all[value]) out[value] = all[value]!;
    }
  }
  return out;
}

function toDto(
  row: RequestRow,
  status: string | null,
  committeeStage: CommitteeStageRules,
  viewer: ChangeRequestViewer,
  extras: DtoExtras,
  chain: ChainResult | undefined,
  awaitingDecisionBy: AwaitingDecisionBy | null,
  /** ACC-283 PR 6 — request_change by the one rule (member-actions.ts), for the viewer's own request. */
  mayRequestChange: boolean,
): IChangeRequest {
  const own = row.requestedById === viewer.userId;
  const editor = mayRequestChange;
  // What both stages allow (the policy); who is asking decides the rest.
  const stage = (action: ChangeRequestAction) => stagesAllow(status, committeeStage, action);
  // ACC-283 PR 2 — the chain decides, never a role.
  const deciding = !!chain && chain.deciderIds.includes(viewer.userId);
  const nobodyElse = !!chain && chain.step.kind === 'NONE';
  const rootHeadOwn = own && editor && !!chain?.requesterHeadsRoot;
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
      // "Send for decision" — not when nobody else is in the chain (§4.3).
      submit: own && editor && stage('submit') && !nobodyElse,
      // Q8 — only the requester withdraws.
      withdraw: own && stage('withdraw'),
      approve: deciding && stage('approve'),
      return: deciding && stage('return'),
      reject: deciding && stage('reject'),
      // Q4 — the root head's own request: from a draft or returned one, or to
      // retry under review when nobody else is in the chain.
      // ACC-245 (Q1) — in an added review stage it passes the review stages by.
      approveNow:
        rootHeadOwn && (status === null ? stage('approve') : awaitsDecision(status) ? nobodyElse && stage('approve') : stage('submit')),
    },
    labels: labelsFor(row, extras.labels),
    awaitingDecisionBy,
    finishTaskId: row.finishTaskId,
  };
}

// ── Locks and stage reads ─────────────────────────────────────────────────────

type Reader = Pick<EngineTx, '$queryRaw' | 'workflowInstance' | 'workflowStage'>;

/** ACC-255 PR 2 — a committee with no live stage: nothing allowed, no flags (D14). */
const NO_STAGE: CommitteeStageRules = { actions: {}, flags: [] };

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
): Promise<Map<string, { key: string | null; open: boolean; stageId: string | null; instanceId: string }>> {
  const out = new Map<string, { key: string | null; open: boolean; stageId: string | null; instanceId: string }>();
  if (requestIds.length === 0) return out;
  const instances = await client.workflowInstance.findMany({
    where: { organizationId, objectType: OBJECT_TYPE, objectId: { in: requestIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, objectId: true, currentStageId: true, status: true },
  });
  const stageIds = [...new Set(instances.map((i) => i.currentStageId).filter((s): s is string => !!s))];
  const stages = await client.workflowStage.findMany({ where: { id: { in: stageIds } }, select: { id: true, key: true } });
  const keyOf = new Map(stages.map((s) => [s.id, s.key]));
  // Ascending, so the newest instance of a request is the one kept.
  for (const instance of instances) {
    const key = instance.currentStageId ? keyOf.get(instance.currentStageId) ?? null : null;
    out.set(instance.objectId, {
      key,
      open: instance.status !== 'CANCELLED' && requestStagePolicy(key).open,
      // ACC-245 — where it stands, for a review stage's pool.
      stageId: instance.currentStageId ?? null,
      instanceId: instance.id,
    });
  }
  return out;
}
