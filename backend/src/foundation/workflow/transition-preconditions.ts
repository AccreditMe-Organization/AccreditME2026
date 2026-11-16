import type { WorkflowObjectType, WorkflowTransitionKind } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowRefusalException } from './workflow-refusal';
import { STAGE_FLAG } from './record-registry';
import { activeMemberCount, emptyRequiredSeats } from '../committees/committee-seat-rules';

// ACC-238 — what a record must satisfy before a transition may move it, per
// kind of record. FAIL OPEN, unlike RECORD_ROUTES: a kind with no entry has no
// precondition, because a missing rule here must never stop an existing
// workflow. A precondition reads the RECORD, never a person — who may fire a
// transition is its from-stage's pool (ACC-271).
//
// Run by WorkflowService twice: early, before a deciding vote is recorded, and
// again inside the stage-change transaction under the instance's row lock,
// which is the authoritative check. Inside the transaction the record is read
// FOR SHARE, so an edit committing in between waits, or is seen.

type PreconditionClient = Pick<PrismaService, '$queryRaw'>;

export interface TransitionPreconditionContext {
  objectId: string;
  organizationId: string;
  /** The key of the stage being left; null for a stage a tenant added. */
  fromStageKey: string | null;
  /** ACC-286 — the flags of the stage being left and of the stage being entered. */
  fromStageFlags: readonly string[];
  toStageFlags: readonly string[];
  kind: WorkflowTransitionKind;
}

/**
 * ACC-286 — the move puts the record in force: it enters a stage flagged
 * IN_FORCE from one that is not. Read from the flags, never a stage key or name
 * (Ahmad, 14 Nov, Q2). On the seed that is Terms Review → Active; a move
 * between two in-force stages (Active ↔ Suspended) is not going live, so a
 * committee already in force can still be suspended.
 */
export function goesLive(ctx: Pick<TransitionPreconditionContext, 'fromStageFlags' | 'toStageFlags'>): boolean {
  return ctx.toStageFlags.includes(STAGE_FLAG.IN_FORCE) && !ctx.fromStageFlags.includes(STAGE_FLAG.IN_FORCE);
}

export type TransitionPrecondition = (client: PreconditionClient, ctx: TransitionPreconditionContext) => Promise<void>;

export const TRANSITION_PRECONDITIONS: Partial<Record<WorkflowObjectType, TransitionPrecondition>> = {
  // A committee leaves Formation only with a quorum of at least 1 (Ahmad,
  // 15 Oct): 0 means "not set yet", and a committee cannot be approved without
  // one. Only a forward move out of Formation is checked.
  //
  // ACC-286 — and it goes live (goesLive()) only with as many members as its
  // quorum and every required seat filled, counting ACTIVE users only
  // (committee-seat-rules.ts). Checked in that order. Inside the stage-change
  // transaction the committee row is read FOR SHARE, and a member write locks
  // it FOR UPDATE, so a removal cannot slip between this check and the move.
  COMMITTEE: async (client, ctx) => {
    const formationExit = ctx.kind === 'ADVANCE' && ctx.fromStageKey === 'formation';
    const live = goesLive(ctx);
    if (!formationExit && !live) return;
    const rows = await client.$queryRaw<{ quorumCount: number }[]>`
      SELECT "quorumCount" FROM "Committee"
      WHERE id = ${ctx.objectId} AND "organizationId" = ${ctx.organizationId}
      FOR SHARE`;
    const committee = rows[0];
    if (!committee) return;
    if (formationExit && committee.quorumCount < 1) {
      throw new WorkflowRefusalException('COMMITTEE_QUORUM_NOT_SET');
    }
    if (!live) return;

    const members = await activeMemberCount(client, ctx.organizationId, ctx.objectId);
    if (members < committee.quorumCount) {
      throw new WorkflowRefusalException('COMMITTEE_MEMBERS_BELOW_QUORUM', { quorum: committee.quorumCount, members });
    }
    const empty = await emptyRequiredSeats(client, ctx.organizationId, ctx.objectId);
    if (empty.length > 0) {
      throw new WorkflowRefusalException('COMMITTEE_REQUIRED_SEATS_EMPTY', {
        seats: empty.map((s) => ({ id: s.id, labelEn: s.labelEn, labelAr: s.labelAr })),
      });
    }
  },
};

export async function assertTransitionPreconditions(
  client: PreconditionClient,
  objectType: WorkflowObjectType,
  ctx: TransitionPreconditionContext,
): Promise<void> {
  const precondition = TRANSITION_PRECONDITIONS[objectType];
  if (precondition) await precondition(client, ctx);
}

/** ACC-286 — whether this kind of record has a precondition at all (so the engine skips its reads otherwise). */
export function hasTransitionPrecondition(objectType: WorkflowObjectType): boolean {
  return TRANSITION_PRECONDITIONS[objectType] !== undefined;
}
