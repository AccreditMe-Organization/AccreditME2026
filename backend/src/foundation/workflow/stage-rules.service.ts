import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkflowObjectType } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isRecordAction, orderedActionKeys, orderedFlagKeys, recordActionsFor } from './record-registry';
import { WorkflowRefusalException } from './workflow-refusal';
import type { EngineTx } from './workflow.service';

/**
 * ACC-255 — the engine's answer to "what does this record's current stage
 * allow, and what does it mean?", read from the stage's own configuration
 * (`WorkflowStageRecordAction` rows and `WorkflowStage.flags`), never from a
 * stage key or name.
 *
 * A stage only NARROWS what a role allows; it never grants. Callers check the
 * person's permission first, then ask this — both must say yes. This service
 * never reads a permission.
 *
 * FAIL CLOSED (plan D14): a record with no instance, or an instance with no
 * current stage, allows nothing and has no flags, and is logged with ids only.
 * An action the record type's registry does not list is never allowed.
 *
 * In ACC-255 PR 1 nothing decides by these answers yet; the committee read
 * reports them, and the parity check compares them with the old maps.
 */

export interface StageRules {
  /** The current stage's id, or null when the record has no live stage. */
  stageId: string | null;
  stageNameEn: string | null;
  stageNameAr: string | null;
  /** The stage's flags, in registry order. */
  flags: string[];
  /** Every action the record type's registry lists, true when this stage allows it. */
  actions: Record<string, boolean>;
}

export interface CurrentStageRulesOptions {
  /** `share` takes FOR SHARE OF the instance, so a transition in flight finishes first. Only inside a transaction. */
  lock?: 'share' | 'none';
}

type Reader = Pick<EngineTx, '$queryRaw' | 'workflowStage' | 'workflowStageRecordAction'>;

interface CurrentStageRow {
  instanceId: string;
  stageId: string | null;
}

@Injectable()
export class StageRulesService {
  private readonly logger = new Logger(StageRulesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The rules of the record's current stage: its NEWEST instance's stage (the
   * rule `committeeStagesAndCounts()` and `committeeStageKey()` already use).
   */
  async currentStageRules(
    objectType: WorkflowObjectType,
    objectId: string,
    organizationId: string,
    client: Reader = this.prisma,
    { lock = 'none' }: CurrentStageRulesOptions = {},
  ): Promise<StageRules> {
    const lockClause = lock === 'share' ? Prisma.sql`FOR SHARE OF wi` : Prisma.empty;
    const rows = await client.$queryRaw<CurrentStageRow[]>`
      SELECT wi.id AS "instanceId", wi."currentStageId" AS "stageId"
      FROM "WorkflowInstance" wi
      WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = ${objectType}::"WorkflowObjectType" AND wi."objectId" = ${objectId}
      ORDER BY wi."createdAt" DESC
      LIMIT 1
      ${lockClause}`;
    const stageId = rows[0]?.stageId ?? null;
    if (!stageId) {
      this.logger.warn(`No current stage: objectType=${objectType} objectId=${objectId} organizationId=${organizationId}`);
      return emptyRules(objectType);
    }
    const [stage, actionRows] = await Promise.all([
      client.workflowStage.findFirst({
        where: { id: stageId, workflowTemplate: { organizationId } },
        select: { id: true, nameEn: true, nameAr: true, flags: true },
      }),
      client.workflowStageRecordAction.findMany({
        where: { organizationId, stageId },
        select: { actionKey: true },
      }),
    ]);
    if (!stage) {
      this.logger.warn(`Current stage not found: objectType=${objectType} objectId=${objectId} stageId=${stageId}`);
      return emptyRules(objectType);
    }
    return buildRules(objectType, stage, actionRows.map((r) => r.actionKey));
  }

  /**
   * The same answer for many records of one type, in three queries whatever
   * their number (the lists). A record missing from the result has no stage.
   */
  async stageRulesFor(
    organizationId: string,
    objectType: WorkflowObjectType,
    objectIds: string[],
    client: Pick<EngineTx, 'workflowInstance' | 'workflowStage' | 'workflowStageRecordAction'> = this.prisma,
  ): Promise<Map<string, StageRules>> {
    const result = new Map<string, StageRules>();
    if (objectIds.length === 0) return result;
    const instances = await client.workflowInstance.findMany({
      where: { organizationId, objectType, objectId: { in: objectIds } },
      orderBy: { createdAt: 'desc' },
      select: { objectId: true, currentStageId: true },
    });
    const stageIdByObject = new Map<string, string | null>();
    for (const instance of instances) {
      if (!stageIdByObject.has(instance.objectId)) stageIdByObject.set(instance.objectId, instance.currentStageId);
    }
    const stageIds = [...new Set([...stageIdByObject.values()].filter((id): id is string => !!id))];
    const [stages, actionRows] =
      stageIds.length > 0
        ? await Promise.all([
            client.workflowStage.findMany({
              where: { id: { in: stageIds }, workflowTemplate: { organizationId } },
              select: { id: true, nameEn: true, nameAr: true, flags: true },
            }),
            client.workflowStageRecordAction.findMany({
              where: { organizationId, stageId: { in: stageIds } },
              select: { stageId: true, actionKey: true },
            }),
          ])
        : [[], []];
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const actionsByStage = new Map<string, string[]>();
    for (const row of actionRows) actionsByStage.set(row.stageId, [...(actionsByStage.get(row.stageId) ?? []), row.actionKey]);

    for (const objectId of objectIds) {
      const stageId = stageIdByObject.get(objectId) ?? null;
      const stage = stageId ? stageById.get(stageId) : undefined;
      result.set(objectId, stage ? buildRules(objectType, stage, actionsByStage.get(stage.id) ?? []) : emptyRules(objectType));
    }
    return result;
  }

  /** Whether the record's current stage allows the action. An unregistered action is never allowed. */
  async stageAllows(
    objectType: WorkflowObjectType,
    objectId: string,
    actionKey: string,
    organizationId: string,
    client: Reader = this.prisma,
    options: CurrentStageRulesOptions = {},
  ): Promise<boolean> {
    if (!isRecordAction(objectType, actionKey)) {
      this.logger.error(`Unregistered record action asked: objectType=${objectType} action=${actionKey}`);
      return false;
    }
    const rules = await this.currentStageRules(objectType, objectId, organizationId, client, options);
    return rules.actions[actionKey] === true;
  }

  /** Refuses with 409 STAGE_ACTION_NOT_ALLOWED, naming the action and the stage, when the stage does not allow it. */
  async assertStageAllows(
    objectType: WorkflowObjectType,
    objectId: string,
    actionKey: string,
    organizationId: string,
    client: Reader = this.prisma,
    options: CurrentStageRulesOptions = {},
  ): Promise<void> {
    if (!isRecordAction(objectType, actionKey)) {
      this.logger.error(`Unregistered record action asked: objectType=${objectType} action=${actionKey}`);
      throw new WorkflowRefusalException('STAGE_ACTION_NOT_ALLOWED', { action: actionKey, stageNameEn: null, stageNameAr: null });
    }
    const rules = await this.currentStageRules(objectType, objectId, organizationId, client, options);
    if (rules.actions[actionKey] !== true) {
      throw new WorkflowRefusalException('STAGE_ACTION_NOT_ALLOWED', {
        action: actionKey,
        stageNameEn: rules.stageNameEn,
        stageNameAr: rules.stageNameAr,
      });
    }
  }
}

function emptyRules(objectType: WorkflowObjectType): StageRules {
  return {
    stageId: null,
    stageNameEn: null,
    stageNameAr: null,
    flags: [],
    actions: Object.fromEntries(recordActionsFor(objectType).map((a) => [a.key, false])),
  };
}

function buildRules(
  objectType: WorkflowObjectType,
  stage: { id: string; nameEn: string; nameAr: string | null; flags: string[] },
  actionKeys: string[],
): StageRules {
  const allowed = new Set(orderedActionKeys(objectType, actionKeys));
  return {
    stageId: stage.id,
    stageNameEn: stage.nameEn,
    stageNameAr: stage.nameAr,
    flags: orderedFlagKeys(objectType, stage.flags),
    actions: Object.fromEntries(recordActionsFor(objectType).map((a) => [a.key, allowed.has(a.key)])),
  };
}
