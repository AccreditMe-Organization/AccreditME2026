import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditLogService } from '../../../../common/services/audit-log.service';
import { RecordTaskClosure, TaskService } from '../../../task/task.service';
import { AppliedSystemMove, EngineTx, PreparedSystemMove, WorkflowService } from '../../../workflow/workflow.service';
import { ACTION_TARGET_STAGE, REQUEST_STAGE_POLICY, awaitsDecision } from '../change-request-policy';
import type { ChangeRequestStageKey } from '../../../workflow/workflow-stage-keys';

const OBJECT_TYPE = 'COMMITTEE_CHANGE_REQUEST' as const;

/**
 * The stages a departure withdraws from: open, allowing `withdraw`, and NOT
 * awaiting a decision (draft and returned today). A request already sent for
 * decision is left to its deciders; a stage with no key is skipped, because it
 * cannot be told apart from one under review. Derived from the policy, never listed.
 */
export const DEPARTURE_WITHDRAWS_FROM: readonly string[] = (Object.keys(REQUEST_STAGE_POLICY) as ChangeRequestStageKey[]).filter(
  (key) => REQUEST_STAGE_POLICY[key].open && REQUEST_STAGE_POLICY[key].actions.has('withdraw') && !awaitsDecision(key),
);

interface DepartureWithdrawal {
  requestId: string;
  committeeId: string;
  fromStageKey: string;
  move: PreparedSystemMove;
}

interface AppliedWithdrawal {
  withdrawal: DepartureWithdrawal;
  move: AppliedSystemMove;
  closure: RecordTaskClosure | null;
}

export interface PreparedDeparture {
  organizationId: string;
  leaverId: string;
  actorId: string;
  withdrawals: DepartureWithdrawal[];
  /** What withdrawInTx() actually applied: a request that moved meanwhile is not here. */
  applied: AppliedWithdrawal[];
}

/**
 * ACC-283 PR 2b (plan §4.7, Q8) — when a person is deactivated, their unfinished
 * change requests (draft or returned) are withdrawn INSIDE the deactivation's
 * transaction, each "Finish or withdraw" task cancelled with it.
 *
 *   prepare()       before the transaction: ONE indexed query, and nothing else when
 *                   the leaver has no such request;
 *   withdrawInTx()  inside it, last: per request in id order, its instance FOR UPDATE
 *                   (the engine's lock), its request row, its finish task's row — so
 *                   "instance, then task" holds (ACC-190). A request that moved since
 *                   prepare() is skipped, never refusing the deactivation;
 *   finish()        after commit: the engine's after-commit half, the request's audit
 *                   row and the task's. Sends NO notice: the leaver is inactive and
 *                   nobody awaits a draft (the withdraw move's only action is LOG_AUDIT).
 *
 * The withdrawing actor is the person deactivating: the leaver withdrew nothing.
 */
@Injectable()
export class ChangeRequestDepartureService {
  private readonly logger = new Logger(ChangeRequestDepartureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly tasks: TaskService,
    private readonly auditLog: AuditLogService,
  ) {}

  async prepare(organizationId: string, leaverId: string, actorId: string): Promise<PreparedDeparture> {
    // Driven by CommitteeChangeRequest(organizationId, requestedById); the newest
    // instance through WorkflowInstance(objectType, objectId). Every table scoped.
    const rows = await this.prisma.$queryRaw<{ id: string; committeeId: string; instanceId: string; stageKey: string }[]>`
      SELECT r.id, r."committeeId", i.id AS "instanceId", s.key AS "stageKey"
      FROM "CommitteeChangeRequest" r
      JOIN LATERAL (
        SELECT wi.id, wi."currentStageId", wi.status
        FROM "WorkflowInstance" wi
        WHERE wi."objectType"::text = ${OBJECT_TYPE} AND wi."objectId" = r.id AND wi."organizationId" = ${organizationId}
        ORDER BY wi."createdAt" DESC
        LIMIT 1
      ) i ON TRUE
      JOIN "WorkflowStage" s ON s.id = i."currentStageId"
      JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
      WHERE r."organizationId" = ${organizationId} AND r."requestedById" = ${leaverId}
        AND i.status::text <> ${'CANCELLED'}
        AND s.key = ANY(${[...DEPARTURE_WITHDRAWS_FROM]}::text[])
      ORDER BY r.id ASC`;
    const withdrawals: DepartureWithdrawal[] = [];
    for (const row of rows) {
      withdrawals.push({
        requestId: row.id,
        committeeId: row.committeeId,
        fromStageKey: row.stageKey,
        move: await this.workflow.prepareSystemTransition(row.instanceId, ACTION_TARGET_STAGE.withdraw, organizationId, actorId),
      });
    }
    return { organizationId, leaverId, actorId, withdrawals, applied: [] };
  }

  /** Inside the caller's transaction, after its own locks. Records what it applied on `prepared`. */
  async withdrawInTx(tx: EngineTx, prepared: PreparedDeparture): Promise<void> {
    const { organizationId, actorId } = prepared;
    const applied: AppliedWithdrawal[] = [];
    for (const withdrawal of prepared.withdrawals) {
      let closure: RecordTaskClosure | null = null;
      const move = await this.workflow.systemTransitionInTx(tx, withdrawal.move, {
        // Moved since prepare() (the leaver pressed Send a moment before): skipped.
        ifMoved: 'skip',
        inTx: async (inner) => {
          const request = await inner.committeeChangeRequest.update({
            where: { id: withdrawal.requestId, organizationId },
            data: { withdrawnById: actorId, withdrawnAt: new Date() },
          });
          // The finish task goes with the request: its row last.
          if (request.finishTaskId) closure = await this.tasks.closeRecordTaskInTx(inner, request.finishTaskId, organizationId, actorId, 'CANCELLED');
        },
      });
      if (move) applied.push({ withdrawal, move, closure });
    }
    prepared.applied = applied;
  }

  /**
   * After commit. Each withdrawal's follow-up is on its own: one that fails is
   * logged (ids only) and the others still run. Sends no notice.
   */
  async finish(prepared: PreparedDeparture): Promise<void> {
    const { organizationId, actorId, leaverId } = prepared;
    for (const { withdrawal, move, closure } of prepared.applied) {
      try {
        await this.workflow.finishSystemTransition(move);
        await this.auditLog.log({
          action: 'UPDATE',
          objectType: 'CommitteeChangeRequest',
          objectId: withdrawal.requestId,
          actorId,
          tenantId: organizationId,
          metadata: { decision: 'WITHDRAWN', cause: 'departure', leaverId, from: withdrawal.fromStageKey },
        });
        if (closure) await this.tasks.auditRecordTaskClosure(closure, organizationId, actorId, 'CHANGE_REQUEST_WITHDRAWN_ON_DEPARTURE');
      } catch (err) {
        this.logger.error(
          `Departure withdrawal follow-up failed: organizationId=${organizationId} requestId=${withdrawal.requestId} leaverId=${leaverId} (${(err as Error).name})`,
        );
      }
    }
  }
}
