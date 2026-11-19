import { APP_MOVES, appMoveFor, REVIEW_STAGE_MOVE_KEY } from './app-moves';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

/**
 * ACC-271 PR 3 — every move the app runs has its one line, and every line is
 * for a move the app runs. An APP transition with no entry is caught here, so
 * the template read never has to say nothing about one.
 */
describe('APP_MOVES (ACC-271 PR 3)', () => {
  const appTransitions = SYSTEM_WORKFLOW_SEED.flatMap((wf) =>
    wf.transitions
      .filter((t) => t.mover === 'APP')
      .map((t) => ({ objectType: wf.objectType, from: t.fromStageKey, to: t.toStageKey, label: t.labelEn })),
  );

  it('the seed has app-run moves to check (non-vacuity)', () => {
    expect(appTransitions.length).toBe(10); // the change request's eight; ACC-316: Distribute and Return for Correction
  });

  it.each(appTransitions.map((t) => [`${t.objectType} ${t.from} → ${t.to} (${t.label})`, t] as const))('%s has an entry', (_name, t) => {
    expect(appMoveFor(t.objectType, t.from, t.to)).toEqual(expect.objectContaining({ key: expect.any(String) }));
  });

  // ACC-245 PR 3a — the entries for an added review stage's moves are checked below:
  // the seed writes none of them.
  const isReviewEntry = (m: { fromStageKey: string; toStageKey: string }) =>
    m.fromStageKey === REVIEW_STAGE_MOVE_KEY || m.toStageKey === REVIEW_STAGE_MOVE_KEY;

  it('every entry is for a move the seed gives the app, once', () => {
    for (const move of APP_MOVES.filter((m) => !isReviewEntry(m))) {
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

  it('the review-stage entries are exactly the moves review-stages.ts creates and re-points', () => {
    const R = REVIEW_STAGE_MOVE_KEY;
    const made = [
      ['draft', R], // Submit, re-pointed to the first review stage
      ['returned', R], // Submit again, re-pointed likewise
      [R, R], // Approve, to the next review stage
      [R, 'under_review'], // Approve, from the last one
      [R, 'returned'],
      [R, 'rejected'],
      [R, 'withdrawn'],
    ];
    const entries = APP_MOVES.filter(isReviewEntry).map((m) => [m.fromStageKey, m.toStageKey]);
    expect(entries.sort()).toEqual(made.sort());
    for (const [from, to] of made) expect(appMoveFor('COMMITTEE_CHANGE_REQUEST', from, to)).toBeDefined();
  });

  it('a person-pressed move has no entry', () => {
    expect(appMoveFor('COMMITTEE', 'formation', 'terms_review')).toBeUndefined();
  });
});
