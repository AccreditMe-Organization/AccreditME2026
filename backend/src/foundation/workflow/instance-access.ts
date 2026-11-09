import type { WorkflowObjectType } from '../../../generated/prisma/client';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkflowRefusalException } from './workflow-refusal';
import { type StagePool, type StagePoolService, mayActInStagePool } from './stage-pool.service';

/**
 * ACC-282 (Ahmad, 8 Nov) — who may READ a record's workflow and who may ACT on it.
 * The ONE place this rule lives; WorkflowService asks it and keeps no copy.
 *
 * - READ (the instance list, an instance, its stage history, its moves list):
 *   whoever may open the record — the parent rule, ACC-281's for a committee
 *   (`committees:view`, or an active member of THAT committee). workflows:view is no
 *   longer needed to read, and no longer enough on its own (ACC-101 already
 *   required the record). Anyone else gets exactly the refusal a missing record
 *   gets: the parent check's 403 where the request names the record, the
 *   instance's 404 where it is read first.
 * - ACT (press a move — which on a multi-approver stage IS the vote — or vote):
 *   may open the record, THEN is in the current stage's pool. Someone who may not
 *   open the record gets the identical not-found refusal before the pool is read;
 *   someone who may, but is outside the pool, keeps today's NOT_IN_STAGE_POOL.
 * - MOVES: listed only for someone in the current stage's pool, as before; an
 *   empty list for anyone else who may open the record.
 *
 * COST: the read rule is the parent check every one of these routes already made,
 * so it adds no query for anyone, workflows:view holders included. A press or a
 * vote gains that same parent check (one indexed read), and resolves the pool once
 * (StagePoolService batches by kind). Nothing here runs on the per-request path.
 */
export const INSTANCE_NOT_FOUND = 'Workflow instance not found';

export interface InstanceViewer {
  id: string;
  permissions: readonly string[];
}

/** The record an instance belongs to, as the parent rule reads it. */
interface InstanceRecord {
  id: string;
  objectType: string;
  objectId: string;
}

/** The stage being acted on, as a refusal names it. */
interface ActedStage {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

type PoolClient = Parameters<StagePoolService['resolve']>[3];

export class InstanceAccess {
  constructor(
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly stagePool: StagePoolService,
  ) {}

  /** A read that names the record (ACC-101 clause a): checked before anything is read; 403 as today. */
  assertMayReadRecord(objectType: string, objectId: string, organizationId: string, viewer: InstanceViewer): Promise<void> {
    return this.objectVisibility.assertCanView(objectType, objectId, organizationId, viewer.permissions, viewer.id);
  }

  /** A read that found the instance first (clause b): the identical 404 for a record the viewer may not open. */
  assertMayReadInstance(instance: InstanceRecord, organizationId: string, viewer: InstanceViewer): Promise<void> {
    return this.objectVisibility.assertCanViewOrNotFound(
      instance.objectType,
      instance.objectId,
      organizationId,
      viewer.permissions,
      INSTANCE_NOT_FOUND,
      viewer.id,
    );
  }

  /** The current stage's pool for this record: who may press its moves. One resolution. */
  poolOf(organizationId: string, stageId: string, instance: InstanceRecord, client?: PoolClient): Promise<StagePool> {
    const record = this.poolRecord(instance);
    return client ? this.stagePool.resolve(organizationId, stageId, record, client) : this.stagePool.resolve(organizationId, stageId, record);
  }

  /** Whether this viewer works the stage now (the ONE copy of the rule, ACC-271). */
  mayAct(pool: StagePool, viewerId: string): boolean {
    return mayActInStagePool(pool, viewerId);
  }

  /**
   * A press or a vote: may open the record (the identical 404 otherwise, before
   * any pool is read), then is in the stage's pool. Returns the pool, so the
   * caller resolves it once.
   */
  async assertMayAct(
    instance: InstanceRecord,
    stage: ActedStage,
    organizationId: string,
    viewer: InstanceViewer,
  ): Promise<StagePool> {
    await this.assertMayReadInstance(instance, organizationId, viewer);
    const pool = await this.poolOf(organizationId, stage.id, instance);
    const stageNames = { stageNameEn: stage.nameEn, stageNameAr: stage.nameAr };
    if (pool.members.length === 0) throw new WorkflowRefusalException('STAGE_HAS_NO_ONE', stageNames);
    if (!this.mayAct(pool, viewer.id)) throw new WorkflowRefusalException('NOT_IN_STAGE_POOL', stageNames);
    return pool;
  }

  private poolRecord(instance: InstanceRecord): { id: string; objectType: WorkflowObjectType; objectId: string } {
    return { id: instance.id, objectType: instance.objectType as WorkflowObjectType, objectId: instance.objectId };
  }
}
