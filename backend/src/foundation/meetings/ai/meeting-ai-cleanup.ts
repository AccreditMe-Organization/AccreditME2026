import type { EngineTx } from '../../workflow/workflow.service';

/**
 * ACC-322 — when Meetings AI's stored rows end (plan step-322 §2). Each runs
 * inside the transaction of the move that ends them. What keeps a run's save
 * from slipping in after the delete is the INSTANCE lock: the move holds the
 * meeting's workflow instance FOR UPDATE until it commits, and a save takes it
 * FOR SHARE first, so it waits for the move and then re-checks the stage
 * (finding it gone, it saves nothing). Distribute also holds the meeting row;
 * the cancelled effect takes no meeting-row lock and needs none.
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
