import type {
  StageWhoMode,
  WorkflowApprovalDecision,
  WorkflowInstanceStageOutcome,
  WorkflowTransitionKind,
} from '../../../generated/prisma/client';

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

/**
 * ACC-202 — the outcome a stage entry is left with is the move's KIND, on every
 * path: a person's press, a vote that decides, a recorded decision and the
 * app's own moves (Ahmad, 13 Nov). performTransition() is the only caller, so
 * no caller can pass an outcome that disagrees with the move. SKIPPED stays
 * cancelInstance()'s, which is not a move. Rows written before ACC-202 keep
 * what they were written with (no backfill).
 */
export const STAGE_EXIT_OUTCOME: Readonly<Record<WorkflowTransitionKind, WorkflowInstanceStageOutcome>> = {
  ADVANCE: 'APPROVED',
  RETURN: 'RETURNED',
  EXIT: 'EXITED',
};

export function stageExitOutcome(kind: WorkflowTransitionKind): WorkflowInstanceStageOutcome {
  return STAGE_EXIT_OUTCOME[kind];
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
