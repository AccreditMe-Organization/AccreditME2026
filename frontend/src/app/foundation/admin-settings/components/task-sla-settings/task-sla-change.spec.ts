import { diffTaskSlaChange } from './task-sla-change';

// ACC-313 — a saved change lists only the values that moved, priority by
// priority, from the section's fields the audit row holds.
describe('diffTaskSlaChange (ACC-313)', () => {
  it('lists only the values that differ, in priority order', () => {
    const before = { LOW: { dueAfterHours: 80 }, HIGH: { dueAfterHours: 16 }, CRITICAL: { dueAfterHours: 4 } };
    const after = { LOW: { dueAfterHours: 80 }, HIGH: { dueAfterHours: 12 }, CRITICAL: { dueAfterHours: 2 } };
    expect(diffTaskSlaChange(before, after)).toEqual([
      { priority: 'HIGH', field: 'dueAfterHours', from: 16, to: 12 },
      { priority: 'CRITICAL', field: 'dueAfterHours', from: 4, to: 2 },
    ]);
  });

  it('reads the escalation fields, and ignores anything it does not name', () => {
    const before = { MEDIUM: { managerEscalationAfterHours: 24, headEscalationAfterHours: 48, other: 1 }, extra: true };
    const after = { MEDIUM: { managerEscalationAfterHours: 24, headEscalationAfterHours: 40, other: 2 } };
    expect(diffTaskSlaChange(before, after)).toEqual([{ priority: 'MEDIUM', field: 'headEscalationAfterHours', from: 48, to: 40 }]);
  });

  it('a value only one side holds is a change from or to null', () => {
    expect(diffTaskSlaChange(null, { LOW: { dueAfterHours: 8 } })).toEqual([{ priority: 'LOW', field: 'dueAfterHours', from: null, to: 8 }]);
  });

  it('nothing to compare is no change', () => {
    expect(diffTaskSlaChange(null, null)).toEqual([]);
    expect(diffTaskSlaChange({ LOW: { dueAfterHours: 'x' } }, {})).toEqual([]);
  });
});
