// ACC-173 — a task status as words, for sentences a person reads: 409
// refusals and the stage gate's message. Never the raw enum, and never
// `status.toLowerCase()`, which printed "an on_hold task" and "IN_PROGRESS".
//
// PENDING reads as "assigned" — ACC-163's rename — and a legacy OVERDUE row is
// an Assigned task (overdue is a flag, not a status).

const LABELS: Record<string, { article: 'a' | 'an'; phrase: string; title: string }> = {
  PENDING: { article: 'an', phrase: 'assigned', title: 'Assigned' },
  OVERDUE: { article: 'an', phrase: 'assigned', title: 'Assigned' },
  IN_PROGRESS: { article: 'an', phrase: 'in-progress', title: 'In progress' },
  ON_HOLD: { article: 'an', phrase: 'on-hold', title: 'On hold' },
  COMPLETED: { article: 'a', phrase: 'completed', title: 'Completed' },
  CANCELLED: { article: 'a', phrase: 'cancelled', title: 'Cancelled' },
  REJECTED: { article: 'a', phrase: 'rejected', title: 'Rejected' },
  UNASSIGNED: { article: 'an', phrase: 'unassigned', title: 'Unassigned' },
  DELEGATED: { article: 'a', phrase: 'delegated', title: 'Delegated' },
};

const FALLBACK = { article: 'a' as const, phrase: 'closed', title: 'Closed' };

/** "A completed task", "An on-hold task" — the start of a refusal sentence. */
export function aTaskThatIs(status: string): string {
  const label = LABELS[status] ?? FALLBACK;
  const article = label.article === 'an' ? 'An' : 'A';
  return `${article} ${label.phrase} task`;
}

/** "On hold", "In progress" — a status shown on its own. */
export function taskStatusTitle(status: string): string {
  return (LABELS[status] ?? FALLBACK).title;
}
