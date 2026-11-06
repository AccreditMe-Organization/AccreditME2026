import type { Prisma, TransitionMover } from '../../../generated/prisma/client';

/**
 * ACC-271 — who moves the record along a transition: PERSON (whoever works the
 * from-stage) or APP (the module's own code). PR 6b — the stored `mover` only,
 * never the old trigger column. Null (none exist: the seed, the editor and
 * the backfill all write one) is neither: a person is refused
 * MOVE_HAS_NO_MOVER, and the app never finds it.
 */
export function transitionMover(transition: { mover?: TransitionMover | null }): TransitionMover | null {
  return transition.mover ?? null;
}

/** transitionMover() === 'APP', as a WHERE clause, for the module's own moves. */
export const APP_MOVER_WHERE: Prisma.WorkflowTransitionWhereInput = { mover: 'APP' };
