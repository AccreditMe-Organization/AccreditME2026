import type { WorkflowObjectType, WorkflowTransitionKind } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowRefusalException } from './workflow-refusal';

// ACC-238 — what a record must satisfy before a transition may move it, per
// kind of record. FAIL OPEN, unlike RECORD_ROUTES: a kind with no entry has no
// precondition, because a missing rule here must never stop an existing
// workflow. A precondition reads the RECORD, never a person's permission —
// who may fire a transition stays the transition's own `requiredPermission`.
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
  kind: WorkflowTransitionKind;
}

export type TransitionPrecondition = (client: PreconditionClient, ctx: TransitionPreconditionContext) => Promise<void>;

export const TRANSITION_PRECONDITIONS: Partial<Record<WorkflowObjectType, TransitionPrecondition>> = {
  // A committee leaves Formation only with a quorum of at least 1 (Ahmad,
  // 15 Oct): 0 means "not set yet", and a committee cannot be approved without
  // one. Only a forward move out of Formation is checked.
  COMMITTEE: async (client, ctx) => {
    if (ctx.kind !== 'ADVANCE' || ctx.fromStageKey !== 'formation') return;
    const rows = await client.$queryRaw<{ quorumCount: number }[]>`
      SELECT "quorumCount" FROM "Committee"
      WHERE id = ${ctx.objectId} AND "organizationId" = ${ctx.organizationId}
      FOR SHARE`;
    const committee = rows[0];
    if (committee && committee.quorumCount < 1) {
      throw new WorkflowRefusalException('COMMITTEE_QUORUM_NOT_SET');
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
