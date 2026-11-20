import type { EngineTx } from '../../workflow/workflow.service';

/**
 * ACC-322 — when Meetings AI's stored rows end (plan step-322 §2). Each runs
 * inside the transaction of the move that ends them, under the meeting row's
 * lock, so no run's save can slip in after it: a save re-checks the stage
 * under the same lock.
 */

type AiTx = Pick<EngineTx, 'meetingAiNotes' | 'meetingAiSuggestion'>;

/**
 * Distribute Minutes (M2, M3): the undecided minutes and action suggestions,
 * and every writer's rough notes. Returns how many suggestions it deleted,
 * counted by the delete itself, for the move's audit row.
 */
export async function discardMinutesAi(tx: AiTx, meetingId: string, organizationId: string): Promise<number> {
  const [suggestions] = await Promise.all([
    tx.meetingAiSuggestion.deleteMany({ where: { organizationId, meetingId, kind: { in: ['ITEM_MINUTES', 'ACTION_ITEM'] } } }),
    tx.meetingAiNotes.deleteMany({ where: { organizationId, meetingId } }),
  ]);
  return suggestions.count;
}

/** The meeting is cancelled: every suggestion of every kind, and the rough notes. */
export async function discardAllMeetingAi(tx: AiTx, meetingId: string, organizationId: string): Promise<void> {
  await Promise.all([
    tx.meetingAiSuggestion.deleteMany({ where: { organizationId, meetingId } }),
    tx.meetingAiNotes.deleteMany({ where: { organizationId, meetingId } }),
  ]);
}
