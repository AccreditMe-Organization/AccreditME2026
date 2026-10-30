import { APP_MOVES, appMoveFor } from './app-moves';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { moverForTrigger } from './workflow-who';

/**
 * ACC-271 PR 3 — every move the app runs has its one line, and every line is
 * for a move the app runs. An APP transition with no entry is caught here, so
 * the template read never has to say nothing about one.
 */
describe('APP_MOVES (ACC-271 PR 3)', () => {
  const appTransitions = SYSTEM_WORKFLOW_SEED.flatMap((wf) =>
    wf.transitions
      .filter((t) => moverForTrigger(t.triggerCondition) === 'APP')
      .map((t) => ({ objectType: wf.objectType, from: t.fromStageKey, to: t.toStageKey, label: t.labelEn })),
  );

  it('the seed has app-run moves to check (non-vacuity)', () => {
    expect(appTransitions.length).toBe(8);
  });

  it.each(appTransitions.map((t) => [`${t.objectType} ${t.from} → ${t.to} (${t.label})`, t] as const))('%s has an entry', (_name, t) => {
    expect(appMoveFor(t.objectType, t.from, t.to)).toEqual(expect.objectContaining({ key: expect.any(String) }));
  });

  it('every entry is for a move the seed gives the app, once', () => {
    for (const move of APP_MOVES) {
      expect(appTransitions.filter((t) => t.objectType === move.objectType && t.from === move.fromStageKey && t.to === move.toStageKey)).toHaveLength(1);
    }
  });

  it('keys are unique, and every line is written in both languages', () => {
    expect(new Set(APP_MOVES.map((m) => m.key)).size).toBe(APP_MOVES.length);
    for (const move of APP_MOVES) {
      expect(move.en.trim()).not.toBe('');
      expect(move.ar.trim()).not.toBe('');
    }
  });

  it('a person-pressed move has no entry', () => {
    expect(appMoveFor('COMMITTEE', 'formation', 'terms_review')).toBeUndefined();
  });
});
