import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { TransitionMover, WorkflowObjectType, WorkflowTransitionKind } from '../../../generated/prisma/client';
import { recordTypesVisibleTo } from '../../common/services/object-visibility.service';
import { recordNamesOf } from '../task/task-record-names';
import { memberCommitteeIds, seesEveryCommittee } from '../../common/services/committee-membership';
import { StagePoolService, mayActInStagePool } from './stage-pool.service';
import { transitionMover } from './workflow-pool';
import { IWorkflowAwaitingMe, IWorkflowAwaitingRow } from './interfaces/workflow-awaiting.interface';

/** How many rows Home's "Awaiting my action" shows; `total` counts past it. */
export const AWAITING_ME_ROWS = 5;

/**
 * ACC-281 — the most open stage entries read to decide what waits on a viewer.
 * The pool and vote filters run in code (ACC-271: pools resolve at read time), so
 * every candidate is read before paging; this bounds that read. Oldest first, so a
 * capped read keeps the longest-waiting. Hitting it logs a line; total counts
 * within it. One organisation has nowhere near this many records in flight.
 */
export const AWAITING_ME_CANDIDATE_CAP = 1000;

/** ACC-281 — a page of the list: skip and take, both optional. */
export interface AwaitingMePage {
  skip?: number;
  take?: number;
}

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
 *      moves never count) there is an ADVANCE and a RETURN to a DIFFERENT
 *      stage. An EXIT does not count (cancelling is not an approval), nor does
 *      a return that loops to the same stage. So a committee in Terms Review
 *      counts and an Active one does not, a meeting in Minutes review counts
 *      and one in Planned does not, and the change-request template (all APP
 *      moves) never appears;
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
  private readonly logger = new Logger(WorkflowAwaitingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stagePool: StagePoolService,
  ) {}

  async awaitingMe(
    organizationId: string,
    viewerId: string,
    permissions: readonly string[],
    page: AwaitingMePage = {},
  ): Promise<IWorkflowAwaitingMe> {
    // 6, first half: only record types the viewer may see are read at all.
    const types = recordTypesVisibleTo(permissions) as WorkflowObjectType[];
    // ACC-281 — and the committees the viewer is an ACTIVE member of, which they may
    // open without committees:view (Ahmad, Q7). One read, only without the key.
    const memberOf = seesEveryCommittee(permissions) ? [] : [...(await memberCommitteeIds(this.prisma, viewerId, organizationId))];
    const records: Prisma.WorkflowInstanceWhereInput[] = [];
    if (types.length) records.push({ objectType: { in: types } });
    if (memberOf.length) records.push({ objectType: 'COMMITTEE', objectId: { in: memberOf } });
    if (records.length === 0) return { total: 0, rows: [], oldestSince: null };

    // 1 and 2 — ONE query: the open entries on converted, non-final stages,
    // with each stage's moves and its template's stage order.
    const entries = await this.prisma.workflowInstanceStage.findMany({
      where: {
        exitedAt: null,
        workflowInstance: { organizationId, status: 'IN_PROGRESS', OR: records },
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
            transitionsFrom: { select: { kind: true, mover: true, toStageId: true } },
            workflowTemplate: { select: { stages: { select: { id: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] } } },
          },
        },
      },
      // The contract (ACC-281): oldest first, then the entry id, so pages never
      // repeat or skip. The cap keeps the read bounded.
      orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
      take: AWAITING_ME_CANDIDATE_CAP,
    });
    if (entries.length === AWAITING_ME_CANDIDATE_CAP) {
      this.logger.warn(`[AwaitingMe] organization=${organizationId} reached the ${AWAITING_ME_CANDIDATE_CAP}-entry cap; the newest were not read`);
    }
    const candidates = entries.filter(
      (e) => e.workflowInstance.currentStageId === e.stageId && isDecisionPoint(e.stage.id, e.stage.transitionsFrom),
    );
    if (candidates.length === 0) return { total: 0, rows: [], oldestSince: null };

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
    if (waiting.length === 0) return { total: 0, rows: [], oldestSince: null };

    // 6, second half — the names, in ONE batched call; an unnamed record is out.
    const names = await recordNamesOf(
      this.prisma,
      waiting.map((e) => ({ sourceType: e.workflowInstance.objectType, sourceId: e.workflowInstance.objectId })),
      organizationId,
      permissions,
      viewerId, // ACC-281 — a member's committees are named for them
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
    // ACC-279 — entries are read oldest first, so the first kept row is the oldest.
    // ACC-281 — with no page asked for, exactly the answer Home has always read.
    const skip = page.skip ?? 0;
    const take = page.take ?? AWAITING_ME_ROWS;
    return { total: rows.length, rows: rows.slice(skip, skip + take), oldestSince: rows[0]?.since ?? null };
  }
}

/**
 * A stage a person decides at: a person's ADVANCE and a person's RETURN to a
 * DIFFERENT stage. An EXIT is not one (cancelling is not an approval), and a
 * return that loops back to the same stage is not a way back.
 */
function isDecisionPoint(
  stageId: string,
  moves: readonly { kind: WorkflowTransitionKind; mover: TransitionMover | null; toStageId: string }[],
): boolean {
  const byPerson = moves.filter((m) => transitionMover(m) === 'PERSON');
  return byPerson.some((m) => m.kind === 'ADVANCE') && byPerson.some((m) => m.kind === 'RETURN' && m.toStageId !== stageId);
}
