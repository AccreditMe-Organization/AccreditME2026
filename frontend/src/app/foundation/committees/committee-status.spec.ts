import { committeeListStatus, committeeStatusOf } from './committee-status';

// ACC-279 — the one status rule (ACC-256), now shared by the committees list and
// Home's My committees: the list feeds it from stageRules, Home from booleans.
describe('committee status (ACC-256, shared since ACC-279)', () => {
  it('inactive wins; then DISSOLVING over IN_FORCE; no flag is not yet in force', () => {
    expect(committeeStatusOf({ isActive: false, isDissolving: false, isInForce: true })).toBe('INACTIVE');
    expect(committeeStatusOf({ isActive: true, isDissolving: true, isInForce: true })).toBe('DISSOLVING');
    expect(committeeStatusOf({ isActive: true, isDissolving: false, isInForce: true })).toBe('IN_FORCE');
    expect(committeeStatusOf({ isActive: true, isDissolving: false, isInForce: false })).toBe('NOT_YET_IN_FORCE');
  });

  it('the list form reads the same rule from the stage\'s flags', () => {
    expect(committeeListStatus({ isActive: true, stageRules: { flags: ['IN_FORCE', 'DISSOLVING'] } })).toBe('DISSOLVING');
    expect(committeeListStatus({ isActive: true, stageRules: { flags: ['IN_FORCE'] } })).toBe('IN_FORCE');
    expect(committeeListStatus({ isActive: true, stageRules: null })).toBe('NOT_YET_IN_FORCE');
    expect(committeeListStatus({ isActive: false, stageRules: { flags: ['IN_FORCE'] } })).toBe('INACTIVE');
  });
});
