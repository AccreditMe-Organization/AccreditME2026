import type { StageWhoMode, WorkflowApprovalDecision, WorkflowTransitionKind } from '../../../generated/prisma/client';

/**
 * ACC-284 — on a stage decided together, what a press is, and which votes count for a
 * move (Ahmad, 10 Nov; backend/Plans/step-284-vote-on-advance.md "Decisions"). The
 * move's KIND decides, never `isApprovalPath`, which the engine no longer reads.
 *
 *   kind      "All of them" (ALL)   Committee vote (COMMITTEE_VOTE)
 *   ADVANCE   a vote for the move   a vote for the move
 *   RETURN    acts at once          acts at once
 *   EXIT      acts at once          a vote for the move
 *
 * "Any one of them" (ANY_ONE) decides alone: one press moves the record, whatever
 * the kind, as before.
 */
export function isVotingMove(whoMode: StageWhoMode | null, kind: WorkflowTransitionKind): boolean {
  if (whoMode !== 'ALL' && whoMode !== 'COMMITTEE_VOTE') return false;
  if (kind === 'ADVANCE') return true;
  return kind === 'EXIT' && whoMode === 'COMMITTEE_VOTE';
}

/** The outcome stored on the stage entry when a move goes through: forward is approved. */
export function moveOutcome(kind: WorkflowTransitionKind): 'APPROVED' | 'REJECTED' {
  return kind === 'ADVANCE' ? 'APPROVED' : 'REJECTED';
}

export interface CastVote {
  approverId: string;
  decision: WorkflowApprovalDecision;
  /** Absent or null: cast before ACC-284. */
  transitionId?: string | null;
}

const IN_FAVOUR = new Set<WorkflowApprovalDecision>(['APPROVED', 'APPROVED_WITH_COMMENTS']);

/**
 * Is this vote FOR the move? A vote in favour that names the move, or one cast before
 * ACC-284 (no move recorded), which counts for the stage's ADVANCE moves as it did.
 */
export function votesFor(vote: CastVote, move: { id: string; kind: WorkflowTransitionKind }): boolean {
  if (!IN_FAVOUR.has(vote.decision)) return false;
  const named = vote.transitionId ?? null;
  return named === move.id || (named === null && move.kind === 'ADVANCE');
}
