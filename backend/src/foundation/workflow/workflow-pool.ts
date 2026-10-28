import type { Prisma, StageWhoMode, TransitionMover } from '../../../generated/prisma/client';

/**
 * ACC-271 — the two questions every engine path asks before it decides who may
 * act, answered in one place.
 *
 * THE TRANSITION WINDOW (plan §4.6): until every stage is converted, a stage
 * with a `whoMode` is worked by its assignee entries (StagePoolService), and a
 * stage without one by the old columns, exactly as before. Loose `!= null`, so
 * a row read without the column (an older select, a test fixture) is treated
 * as unconverted rather than as converted with no one in it.
 */
export function isConvertedStage(stage: { whoMode?: StageWhoMode | null }): boolean {
  return stage.whoMode != null;
}

/**
 * Who moves the record along a transition. `mover` is null until the backfill
 * (PR 2) writes it, and then reads as today: SYSTEM_AUTOMATIC is the module's
 * own code (APP), anything else a person.
 */
export function transitionMover(transition: {
  mover?: TransitionMover | null;
  triggerCondition: string;
}): TransitionMover {
  return transition.mover ?? (transition.triggerCondition === 'SYSTEM_AUTOMATIC' ? 'APP' : 'PERSON');
}

/** transitionMover() === 'APP', as a WHERE clause, for the module's own moves. */
export const APP_MOVER_WHERE: Prisma.WorkflowTransitionWhereInput = {
  OR: [{ mover: 'APP' }, { mover: null, triggerCondition: 'SYSTEM_AUTOMATIC' }],
};
