import type { AssignTargetDto } from '../../services/task.service';

/**
 * ACC-199 — the "assigned on an AI suggestion" claim a dialog sends on save:
 * only while the person "Assign … instead" chose is STILL the one chosen.
 * Choosing someone else afterwards drops it. The server checks the rest.
 */
export function followedHint(
  followed: { id: string; userId: string } | null,
  assignTo: AssignTargetDto | null,
): { id: string } | null {
  if (!followed || !assignTo || !('userId' in assignTo) || assignTo.userId !== followed.userId) return null;
  return { id: followed.id };
}
