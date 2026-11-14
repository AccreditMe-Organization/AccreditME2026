import { STAGE_EXIT_OUTCOME, stageExitOutcome } from './workflow-vote';

// ACC-202 — the outcome a stage entry is left with, by the move's kind. One
// table, read by performTransition() for every path (a press, a deciding vote,
// a recorded decision, the app's own moves); proved on each path against a real
// database in vote-on-advance.db-spec.ts and committee-change-request.db-spec.ts.
describe('stageExitOutcome (ACC-202)', () => {
  it('records forward as APPROVED, a send-back as RETURNED and an end as EXITED', () => {
    expect(STAGE_EXIT_OUTCOME).toEqual({ ADVANCE: 'APPROVED', RETURN: 'RETURNED', EXIT: 'EXITED' });
    expect(['ADVANCE', 'RETURN', 'EXIT'].map((k) => stageExitOutcome(k as never))).toEqual(['APPROVED', 'RETURNED', 'EXITED']);
  });
});
