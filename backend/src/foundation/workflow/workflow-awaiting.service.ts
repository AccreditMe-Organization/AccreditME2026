import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionMover, WorkflowObjectType, WorkflowTransitionKind } from '../../../generated/prisma/client';
import { recordTypesVisibleTo } from '../../common/services/object-visibility.service';
import { recordNamesOf } from '../task/task-record-names';
import { StagePoolService, mayActInStagePool } from './stage-pool.service';
import { isConvertedStage, transitionMover } from './workflow-pool';
import { IWorkflowAwaitingMe, IWorkflowAwaitingRow } from './interfaces/workflow-awaiting.interface';

/** How many rows Home's "Awaiting my action" shows; `total` counts past it. */
export const AWAITING_ME_ROWS = 5;

/** Who-modes where each member records their own vote, so one already cast is done. */
const VOTING_MODES = new Set(['ALL', 'COMMITTEE_VOTE']);

/**
 * ACC-271 — the records waiting on THIS viewer's decision: Home's "Awaiting my
 * action" (approved drawing, Task Screens §10). Self-scoped: it answers only
 * for the caller, so it needs no permission of its own.
 *
 * A record is waiting on the viewer when ALL of these hold:
 *   1. its stage entry is open, in the viewer's organisation, on a running
 *      (IN_PROGRESS) instance, at the instance's current stage; the stage is
 *      converted (whoMode set) and not final;
 *   2. the stage is a DECISION POINT: among its moves made by a PERSON (APP
 *      moves never count) there is an ADVANCE and a RETURN or EXIT, so a
 *      committee in Terms Review counts and an Active one does not, and the
 *      change-request template (all APP moves) never appears;
 *   3. the viewer may make those moves: the engine's own rule,
 *      mayActInStagePool(), that triggerTransition() refuses on;
 *   4. the viewer is in the pool NOW (`members`, so an acting user standing in
 *      for someone away is, and the absent person is not);
 *   5. on an "All of them" or Committee vote stage, they have not already
 *      recorded their decision on this entry;
 *   6. they may see the record's type, and the record is named through
 *      recordNamesOf(); one it cannot name is left out (fail closed).
 *
 * BATCHED (the performance rule): one candidates query, one resolveMany(),
 * one approvals query and one names call, however many rows. Nothing here runs
 * on the per-request guard path.
 */
@Injectable()
export class WorkflowAwaitingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stagePool: StagePoolService,
  ) {}

  async awaitingMe(organizationId: string, viewerId: string, permissions: readonly string[]): Promise<IWorkflowAwaitingMe> {
    // 6, first half: only record types the viewer may see are read at all.
    const types = recordTypesVisibleTo(permissions) as WorkflowObjectType[];
    if (types.length === 0) return { total: 0, rows: [] };

    // 1 and 2 — ONE query: the open entries on converted, non-final stages,
    // with each stage's moves and its template's stage order.
    const entries = await this.prisma.workflowInstanceStage.findMany({
      where: {
        exitedAt: null,
        workflowInstance: { organizationId, status: 'IN_PROGRESS', objectType: { in: types } },
        stage: { whoMode: { not: null }, isFinal: false, workflowTemplate: { organizationId } },
      },
      select: {
        id: true,
        enteredAt: true,
        stageId: true,
        workflowInstance: { select: { id: true, objectType: true, objectId: true, currentStageId: true } },
        stage: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            whoMode: true,
            transitionsFrom: { select: { kind: true, mover: true, triggerCondition: true } },
            workflowTemplate: { select: { stages: { select: { id: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } } },
          },
        },
      },
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
    });
    const candidates = entries.filter(
      (e) => e.workflowInstance.currentStageId === e.stageId && isConvertedStage(e.stage) && isDecisionPoint(e.stage.transitionsFrom),
    );
    if (candidates.length === 0) return { total: 0, rows: [] };

    // 3 and 4 — every candidate's pool in ONE call; 5 — the viewer's votes in ONE query.
    const voting = candidates.filter((e) => VOTING_MODES.has(e.stage.whoMode ?? '')).map((e) => e.id);
    const [pools, voted] = await Promise.all([
      this.stagePool.resolveMany(
        organizationId,
        candidates.map((e) => ({ key: e.id, stageId: e.stageId, instance: e.workflowInstance })),
      ),
      voting.length
        ? this.prisma.workflowApproval.findMany({
            where: {
              approverId: viewerId,
              decision: { not: 'PENDING' },
              workflowInstanceStageId: { in: voting },
              workflowInstanceStage: { workflowInstance: { organizationId } },
            },
            select: { workflowInstanceStageId: true },
          })
        : Promise.resolve([] as { workflowInstanceStageId: string }[]),
    ]);
    const votedOn = new Set(voted.map((v) => v.workflowInstanceStageId));
    const waiting = candidates.filter((e) => {
      const pool = pools.get(e.id);
      return !!pool && mayActInStagePool(pool, viewerId) && pool.members.includes(viewerId) && !votedOn.has(e.id);
    });
    if (waiting.length === 0) return { total: 0, rows: [] };

    // 6, second half — the names, in ONE batched call; an unnamed record is out.
    const names = await recordNamesOf(
      this.prisma,
      waiting.map((e) => ({ sourceType: e.workflowInstance.objectType, sourceId: e.workflowInstance.objectId })),
      organizationId,
      permissions,
    );
    const rows: IWorkflowAwaitingRow[] = [];
    for (const e of waiting) {
      const named = names.get(`${e.workflowInstance.objectType}:${e.workflowInstance.objectId}`);
      if (!named?.nameEn) continue;
      const order = e.stage.workflowTemplate.stages;
      rows.push({
        instanceStageId: e.id,
        record: { type: named.type, id: named.id, nameEn: named.nameEn, nameAr: named.nameAr },
        stage: {
          id: e.stage.id,
          nameEn: e.stage.nameEn,
          nameAr: e.stage.nameAr,
          position: order.findIndex((s) => s.id === e.stage.id) + 1,
          stageCount: order.length,
        },
        since: e.enteredAt,
      });
    }
    return { total: rows.length, rows: rows.slice(0, AWAITING_ME_ROWS) };
  }
}

/** A stage a person decides at: a person's ADVANCE and a person's RETURN or EXIT. */
function isDecisionPoint(moves: readonly { kind: WorkflowTransitionKind; mover: TransitionMover | null; triggerCondition: string }[]): boolean {
  const byPerson = moves.filter((m) => transitionMover(m) === 'PERSON');
  return byPerson.some((m) => m.kind === 'ADVANCE') && byPerson.some((m) => m.kind === 'RETURN' || m.kind === 'EXIT');
}
