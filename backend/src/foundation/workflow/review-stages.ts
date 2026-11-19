import type { StageAssigneeKind, StageWhoMode, WorkflowStage, WorkflowTransition } from '../../../generated/prisma/client';
import type { EngineTx } from './workflow.service';
import { refuseProtected, WorkflowRefusalException } from './workflow-refusal';

/**
 * ACC-245 — ADDED REVIEW STAGES in a committee change request's workflow, the one
 * reshaping its protected template allows. Plan: backend/Plans/step-245-change-
 * request-review-stages.md (option B, Ahmad, 19 Nov).
 *
 *   Draft → [review stage 1 → … → review stage n] → Under review → Approved
 *
 * Each added review stage is decided by its own people (its `who` pool, never the
 * requester); Under review is still decided by the chain of authority, LAST, and
 * is still the only stage whose Approve applies the change.
 *
 * THE SHAPE. A review stage is an UNKEYED, non-initial, non-final stage of the
 * protected template, ordered between Draft and Under review. It has four moves,
 * all the app's (mover APP), each logging an audit action as the seed's do:
 *   ADVANCE → the next review stage, or Under review   ("Approve")
 *   RETURN  → Returned                                   ("Return for changes")
 *   EXIT    → Rejected                                   ("Reject")
 *   EXIT    → Withdrawn                                  ("Withdraw")
 * The moves INTO the first review stage are the two Submit moves (Draft's and
 * Returned's single ADVANCE), so a returned request starts the review over.
 *
 * Adding a stage after X re-points X's ADVANCE (or both Submit moves, when X is
 * Draft) to it; removing one re-points the move into it past it. These are the
 * only move changes the system makes; a person still cannot edit these moves.
 *
 * LOCKS, in this order, inside the caller's transaction: the template (the
 * caller's lockTemplate), then every OPEN record standing in a stage whose
 * forward move is re-pointed (FOR UPDATE, by id), then those moves. The engine
 * takes a record's lock and never the template's, and re-reads a move's target
 * under the record's lock (applyMove), so a move prepared before the edit is
 * refused, never sent to the old target.
 */

/** At most this many review stages: their orders sit between Draft's and Under review's. */
export const MAX_REVIEW_STAGES = 9;

/**
 * ACC-245 PR 3a — who may decide an added review stage, in this version: "any
 * one of them" only, never the CREATOR kind (it names whoever raised the
 * request, who is taken out of every pool). The save's refusals
 * (REVIEW_STAGE_ANY_ONE, REVIEW_STAGE_NO_CREATOR) and the template read's
 * `reviewStages.who` both read these, so the screen never keeps a copy.
 */
export const REVIEW_STAGE_WHO_MODES: readonly StageWhoMode[] = ['ANY_ONE'];
export const REVIEW_STAGE_REFUSED_KINDS: readonly StageAssigneeKind[] = ['CREATOR'];

/**
 * ACC-245 PR 3a — whether one more review stage fits: fewer than the maximum, and
 * room for its order between Draft's and Under review's. addReviewStageInTx()
 * refuses with REVIEW_STAGE_LIMIT exactly when this is false, and the template
 * read's `reviewStages.canAdd` is this.
 */
export function reviewStageFits(draftOrder: number, underReviewOrder: number, count: number): boolean {
  return count < MAX_REVIEW_STAGES && draftOrder + count + 1 < underReviewOrder;
}

type ReadStage = Pick<WorkflowStage, 'id' | 'key' | 'order' | 'isInitial' | 'isFinal' | 'nameEn' | 'nameAr'>;

/** ACC-245 PR 3a — the template read's `reviewStages`, for the protected change request template. */
export interface ReviewStagesRead {
  canAdd: boolean;
  max: number;
  count: number;
  /** Where a new review stage may go: after Draft, or after one of the review stages, in order. */
  after: { id: string; nameEn: string; nameAr: string | null }[];
  who: { modes: StageWhoMode[]; assigneeKinds: StageAssigneeKind[] };
}

/**
 * ACC-245 PR 3a — `reviewStages` from the template's stages (already read, in
 * order) and the record type's kinds: the same shape readShape() and
 * reviewStageFits() decide by. A template missing its seeded Draft or Under
 * review can take no review stage (readShape() refuses ADD_STAGE then).
 */
export function reviewStagesRead(stages: readonly ReadStage[], kinds: readonly StageAssigneeKind[]): ReviewStagesRead {
  const who = { modes: [...REVIEW_STAGE_WHO_MODES], assigneeKinds: kinds.filter((k) => !REVIEW_STAGE_REFUSED_KINDS.includes(k)) };
  // P209 — the SAME shape check the save makes (shapeOf, which readShape() refuses
  // ADD_STAGE by), so `canAdd` is never true where the save refuses.
  const shape = shapeOf(stages);
  if (!shape) return { canAdd: false, max: MAX_REVIEW_STAGES, count: stages.filter(isReviewStage).length, after: [], who };
  return {
    canAdd: reviewStageFits(shape.draft.order, shape.underReview.order, shape.review.length),
    max: MAX_REVIEW_STAGES,
    count: shape.review.length,
    after: [shape.draft, ...shape.review].map(({ id, nameEn, nameAr }) => ({ id, nameEn, nameAr })),
    who,
  };
}

const LOG_AUDIT = [{ actionType: 'LOG_AUDIT' as const, order: 10 }];

type StageRow = Pick<WorkflowStage, 'id' | 'key' | 'order' | 'isInitial' | 'isFinal' | 'nameEn' | 'nameAr'>;

interface Shape {
  draft: StageRow;
  returned: StageRow;
  underReview: StageRow;
  rejected: StageRow;
  withdrawn: StageRow;
  /** The added review stages, in order. */
  review: StageRow[];
}

/**
 * Is this stage an added review stage? On the protected change request template,
 * the seed keys every stage (ACC-239) and only an added review stage has no key,
 * so "unkeyed, not first, not final" identifies one. That is what lets the
 * request's policy treat an unkeyed stage as a review stage, and what keeps a
 * seeded stage from being removed or re-shaped as one. Ask it only of a stage of
 * a PROTECTED template: on a tenant's own template an unkeyed stage is ordinary.
 */
export function isReviewStage(stage: Pick<WorkflowStage, 'key' | 'isInitial' | 'isFinal'>): boolean {
  return stage.key === null && !stage.isInitial && !stage.isFinal;
}

/**
 * The protected template's shape, from its stages: the five seeded keyed stages
 * a review stage is wired to, and the review stages in order (order, then id).
 * Null when any keyed stage is missing: no reshaping is safe then. The ONE check:
 * the save refuses by it (readShape) and the template read answers by it
 * (reviewStagesRead), so the two cannot disagree (P209).
 */
function shapeOf(stages: readonly StageRow[]): Shape | null {
  const keyed = (key: string) => stages.find((s) => s.key === key);
  const draft = keyed('draft');
  const returned = keyed('returned');
  const underReview = keyed('under_review');
  const rejected = keyed('rejected');
  const withdrawn = keyed('withdrawn');
  if (!draft || !returned || !underReview || !rejected || !withdrawn) return null;
  const review = stages.filter(isReviewStage).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { draft, returned, underReview, rejected, withdrawn, review };
}

async function readShape(tx: EngineTx, templateId: string, refusal: 'ADD_STAGE' | 'REMOVE_STAGE'): Promise<Shape> {
  const stages = await tx.workflowStage.findMany({
    where: { workflowTemplateId: templateId },
    select: { id: true, key: true, order: true, isInitial: true, isFinal: true, nameEn: true, nameAr: true },
  });
  const shape = shapeOf(stages);
  // The seeded shape is not there: no reshaping is safe.
  if (!shape) refuseProtected(refusal);
  return shape;
}

/** The app's single forward move out of each of these stages, locked. */
async function lockAdvances(tx: EngineTx, fromStageIds: string[]): Promise<WorkflowTransition[]> {
  const moves = await tx.workflowTransition.findMany({
    where: { fromStageId: { in: fromStageIds }, kind: 'ADVANCE', mover: 'APP' },
    orderBy: { id: 'asc' },
  });
  for (const move of moves) await tx.$queryRaw`SELECT id FROM "WorkflowTransition" WHERE id = ${move.id} FOR UPDATE`;
  return moves;
}

/** Every open record standing in these stages, locked by id: their forward move is about to change. */
async function lockRecordsIn(tx: EngineTx, templateId: string, organizationId: string, stageIds: string[]): Promise<void> {
  await tx.$queryRaw`
    SELECT wi.id FROM "WorkflowInstance" wi
    WHERE wi."organizationId" = ${organizationId}
      AND wi."workflowTemplateId" = ${templateId}
      AND wi."currentStageId" = ANY(${stageIds}::text[])
    ORDER BY wi.id
    FOR UPDATE`;
}

/** Orders the review stages one apart, starting after Draft's. */
async function renumber(tx: EngineTx, shape: Shape, ordered: string[]): Promise<void> {
  for (const [i, id] of ordered.entries()) {
    await tx.workflowStage.update({ where: { id }, data: { order: shape.draft.order + 1 + i } });
  }
}

export interface AddedReviewStage {
  stage: WorkflowStage;
  /** The previous stage on the review path (Draft, or a review stage). */
  afterStageId: string;
  /** Where the new stage's Approve leads. */
  nextStageId: string;
  createdMoveIds: string[];
  repointedMoveIds: string[];
}

/**
 * Adds a review stage after `afterStageId` (Draft, or a review stage; omitted:
 * after the last review stage). Run inside the caller's transaction, AFTER it has
 * locked the template. Writes the stage, its four moves and the re-pointing; the
 * caller writes its `who`.
 */
export async function addReviewStageInTx(
  tx: EngineTx,
  templateId: string,
  organizationId: string,
  data: {
    nameEn: string;
    nameAr: string | null;
    description: string | null;
    slaWorkingHours: number | null;
    escalationConfig: unknown;
    whoMode: WorkflowStage['whoMode'];
  },
  afterStageId: string | undefined,
): Promise<AddedReviewStage> {
  const shape = await readShape(tx, templateId, 'ADD_STAGE');
  if (!reviewStageFits(shape.draft.order, shape.underReview.order, shape.review.length)) {
    throw new WorkflowRefusalException('REVIEW_STAGE_LIMIT', { max: MAX_REVIEW_STAGES });
  }
  const path = [shape.draft, ...shape.review];
  const at = afterStageId === undefined ? path.length - 1 : path.findIndex((s) => s.id === afterStageId);
  if (at < 0) throw new WorkflowRefusalException('REVIEW_STAGE_POSITION', {});
  const after = path[at]!;
  const next = shape.review[at] ?? shape.underReview; // the stage after `after` on the path

  // The forward moves that lead to `next` from `after` (both Submit moves when it is Draft).
  const fromIds = after.id === shape.draft.id ? [shape.draft.id, shape.returned.id] : [after.id];
  await lockRecordsIn(tx, templateId, organizationId, fromIds);
  const repointed = await lockAdvances(tx, fromIds);
  if (repointed.length !== fromIds.length || repointed.some((m) => m.toStageId !== next.id)) refuseProtected('ADD_STAGE');

  const stage = await tx.workflowStage.create({
    data: {
      workflowTemplateId: templateId,
      nameEn: data.nameEn,
      nameAr: data.nameAr,
      description: data.description,
      order: shape.draft.order + 1 + at,
      slaWorkingHours: data.slaWorkingHours,
      isInitial: false,
      isFinal: false,
      escalationConfig: (data.escalationConfig ?? undefined) as never,
      flags: [],
      whoMode: data.whoMode,
    },
  });

  const move = (toStageId: string, kind: WorkflowTransition['kind'], labelEn: string, labelAr: string) =>
    tx.workflowTransition.create({
      data: { fromStageId: stage.id, toStageId, kind, labelEn, labelAr, mover: 'APP', actions: { create: LOG_AUDIT } },
      select: { id: true },
    });
  const created = [
    await move(next.id, 'ADVANCE', 'Approve', 'اعتماد'),
    await move(shape.returned.id, 'RETURN', 'Return for changes', 'إعادة للتعديل'),
    await move(shape.rejected.id, 'EXIT', 'Reject', 'رفض'),
    await move(shape.withdrawn.id, 'EXIT', 'Withdraw', 'سحب'),
  ];
  await tx.workflowTransition.updateMany({ where: { id: { in: repointed.map((m) => m.id) } }, data: { toStageId: stage.id } });

  const ordered = [...shape.review.map((s) => s.id)];
  ordered.splice(at, 0, stage.id);
  await renumber(tx, shape, ordered);

  return {
    stage: { ...stage, order: shape.draft.order + 1 + at },
    afterStageId: after.id,
    nextStageId: next.id,
    createdMoveIds: created.map((m) => m.id),
    repointedMoveIds: repointed.map((m) => m.id),
  };
}

export interface RemovedReviewStage {
  previousStageId: string;
  nextStageId: string;
  deletedMoveIds: string[];
  repointedMoveIds: string[];
}

/**
 * Removes a review stage nobody has used. Run inside the caller's transaction,
 * AFTER it has locked the template and the stage and checked that no record ever
 * entered it (STAGE_IN_USE). Re-points the move into it past it, then deletes its
 * four moves, its people and the stage.
 */
export async function removeReviewStageInTx(
  tx: EngineTx,
  templateId: string,
  organizationId: string,
  stageId: string,
  /**
   * Run once the records are locked: the caller's "nobody entered it" check
   * (STAGE_IN_USE), again. A request that was moving INTO the stage when the
   * caller first counted has committed by now (its instance lock is what we
   * waited on), so it is counted here, never met by the stage's RESTRICT key.
   */
  afterLocks: () => Promise<void>,
): Promise<RemovedReviewStage> {
  const shape = await readShape(tx, templateId, 'REMOVE_STAGE');
  const at = shape.review.findIndex((s) => s.id === stageId);
  if (at < 0) refuseProtected('REMOVE_STAGE');
  const previous = at === 0 ? shape.draft : shape.review[at - 1]!;
  const next = shape.review[at + 1] ?? shape.underReview;

  const fromIds = previous.id === shape.draft.id ? [shape.draft.id, shape.returned.id] : [previous.id];
  await lockRecordsIn(tx, templateId, organizationId, fromIds);
  const repointed = await lockAdvances(tx, fromIds);
  if (repointed.length !== fromIds.length || repointed.some((m) => m.toStageId !== stageId)) refuseProtected('REMOVE_STAGE');
  await afterLocks();
  await tx.workflowTransition.updateMany({ where: { id: { in: repointed.map((m) => m.id) } }, data: { toStageId: next.id } });

  const own = await tx.workflowTransition.findMany({ where: { fromStageId: stageId }, select: { id: true } });
  const ownIds = own.map((m) => m.id);
  await tx.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: { in: ownIds } } });
  await tx.workflowTransition.deleteMany({ where: { id: { in: ownIds } } });
  await tx.workflowStageAssignee.deleteMany({ where: { organizationId, stageId } });
  await tx.workflowStage.delete({ where: { id: stageId } });
  await renumber(
    tx,
    shape,
    shape.review.filter((s) => s.id !== stageId).map((s) => s.id),
  );

  return { previousStageId: previous.id, nextStageId: next.id, deletedMoveIds: ownIds, repointedMoveIds: repointed.map((m) => m.id) };
}
