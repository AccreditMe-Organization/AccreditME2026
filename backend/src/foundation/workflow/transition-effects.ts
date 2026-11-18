import type { WorkflowObjectType } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EngineTx } from './workflow.service';
import { MEETING_TRANSITION_EFFECTS } from '../meetings/meeting-effects';
import type { AnyTransitionEffect, TransitionEffectContext, TransitionEffectDeps } from './transition-effect.types';

export type { AnyTransitionEffect, TransitionEffect, TransitionEffectContext, TransitionEffectDeps } from './transition-effect.types';
export { transitionEffect } from './transition-effect.types';

/**
 * ACC-316 PR 3a — WHAT ENTERING A STAGE DOES TO THE RECORD, per record type,
 * keyed by a flag of the stage entered (plan step-316 §3.8.1). It rides EVERY
 * move into such a stage, a person's press, a deciding vote or the app's own,
 * because every one of them goes through prepareMove(), applyMove() and
 * finishMove(). ACC-239's `inTx` stays the app's alone: a caller still cannot
 * hand a person's move a write of its own; an effect is declared here, per
 * record type, like a precondition.
 *
 * FAIL OPEN, as TRANSITION_PRECONDITIONS is: a type with no entry has no
 * effect. An effect runs when the move ENTERS a stage with its flag from one
 * without it, once per move.
 *
 * Its three parts keep ACC-190's rules:
 *   prepare  reads only, before the transaction (prepareMove);
 *   apply    writes only, inside it, after the preconditions (applyMove), under
 *            the instance's row lock: a record row it touches is locked AFTER
 *            the instance, ACC-255's order;
 *   finish   notices and audit rows, after the commit (finishMove).
 */
export const TRANSITION_EFFECTS: Partial<Record<WorkflowObjectType, readonly AnyTransitionEffect[]>> = {
  MEETING: MEETING_TRANSITION_EFFECTS,
};

/** The effects a move runs: entering a stage with the flag from one without it. */
export function effectsFor(ctx: Pick<TransitionEffectContext, 'objectType' | 'fromStageFlags' | 'toStageFlags'>): readonly AnyTransitionEffect[] {
  return (TRANSITION_EFFECTS[ctx.objectType] ?? []).filter(
    (e) => ctx.toStageFlags.includes(e.flag) && !ctx.fromStageFlags.includes(e.flag),
  );
}

/** A move's effects with what each prepared, carried from prepareMove() to finishMove(). */
export interface PreparedTransitionEffects {
  ctx: TransitionEffectContext;
  effects: { effect: AnyTransitionEffect; prepared: unknown }[];
}

export async function prepareTransitionEffects(prisma: PrismaService, ctx: TransitionEffectContext): Promise<PreparedTransitionEffects> {
  const effects = effectsFor(ctx);
  const prepared = await Promise.all(effects.map(async (effect) => ({ effect, prepared: await effect.prepare(prisma, ctx) })));
  return { ctx, effects: prepared };
}

export async function applyTransitionEffects(tx: EngineTx, p: PreparedTransitionEffects): Promise<void> {
  for (const entry of p.effects) {
    const result = await entry.effect.apply?.(tx, p.ctx, entry.prepared);
    // What apply() read under the lock is what finish() acts on.
    if (result !== undefined) entry.prepared = result;
  }
}

export async function finishTransitionEffects(deps: TransitionEffectDeps, p: PreparedTransitionEffects): Promise<void> {
  for (const { effect, prepared } of p.effects) await effect.finish?.(deps, p.ctx, prepared);
}
