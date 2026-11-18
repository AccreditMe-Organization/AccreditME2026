import type { WorkflowObjectType } from '../../../generated/prisma/client';
import { STAGE_FLAG } from './record-registry';

/**
 * ACC-316 PR 3a — A MOVE THAT NEEDS A REASON, per record type, keyed by a flag
 * of the stage the move ENTERS (plan step-316 §3.8.2). A person's press into
 * such a stage must carry a non-blank comment, or it is 400 REASON_REQUIRED; the
 * comment is stored on the entry left, as every comment is, and the record's
 * own notices quote it.
 *
 * FAIL OPEN, as TRANSITION_PRECONDITIONS is: a type with no entry needs no
 * reason, because a missing rule here must never stop an existing workflow.
 * Keyed by flag, never by a stage key or name, so a tenant's renamed or added
 * stage keeps the rule as long as it keeps the meaning.
 *
 * The moves list says it per move (`needsReason`), so the move buttons ask for
 * the reason before the press rather than after a refusal.
 */
export const MOVE_REASON_FLAGS: Partial<Record<WorkflowObjectType, readonly string[]>> = {
  // A cancelled meeting's invitees are told why.
  MEETING: [STAGE_FLAG.MEETING_CANCELLED],
};

/** Whether a move into a stage with these flags, on a record of this type, needs a reason. */
export function moveNeedsReason(objectType: WorkflowObjectType, toStageFlags: readonly string[]): boolean {
  const flags = MOVE_REASON_FLAGS[objectType];
  return !!flags && flags.some((flag) => toStageFlags.includes(flag));
}

/** Whether this type has any reason rule: only then is the destination's flags read. */
export function hasMoveReasonRule(objectType: WorkflowObjectType): boolean {
  return (MOVE_REASON_FLAGS[objectType]?.length ?? 0) > 0;
}
