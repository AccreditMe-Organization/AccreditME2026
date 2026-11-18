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

  // ACC-313 PR 4 — the escalation save carries each priority's warning.
  it('reads a warning beside the escalation hours, and only one of its options', () => {
    const before = { HIGH: { managerEscalationAfterHours: 8, warnBeforeDue: 'OFF' }, LOW: { warnBeforeDue: 'H3' } };
    const after = { HIGH: { managerEscalationAfterHours: 8, warnBeforeDue: 'H2' }, LOW: { warnBeforeDue: 'H4' } };
    expect(diffTaskSlaChange(before, after)).toEqual([
      { priority: 'LOW', field: 'warnBeforeDue', from: null, to: 'H4' },
      { priority: 'HIGH', field: 'warnBeforeDue', from: 'OFF', to: 'H2' },
    ]);
  });

  // ACC-313 PR 3 — the due-date switch belongs to no priority.
  it('reads the due-date switch', () => {
    expect(diffTaskSlaChange({ notifyOnDueChange: true }, { notifyOnDueChange: false })).toEqual([
      { priority: null, field: 'notifyOnDueChange', from: true, to: false },
    ]);
    expect(diffTaskSlaChange({ notifyOnDueChange: true }, { notifyOnDueChange: true })).toEqual([]);
  });

  // ACC-313 PR 3 — a reset holds the whole policy before, and the defaults after.
  it('reads a reset’s tiers and notices: the hours, each warning and the switch', () => {
    const before = {
      tiers: { HIGH: { dueAfterHours: 24, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 } },
      notices: { warnBeforeDue: { HIGH: 'H2' }, notifyOnDueChange: false },
    };
    const after = {
      tiers: { HIGH: { dueAfterHours: 16, managerEscalationAfterHours: 8, headEscalationAfterHours: 16 } },
      notices: { warnBeforeDue: { HIGH: 'OFF' }, notifyOnDueChange: true },
    };
    expect(diffTaskSlaChange(before, after)).toEqual([
      { priority: null, field: 'notifyOnDueChange', from: false, to: true },
      { priority: 'HIGH', field: 'dueAfterHours', from: 24, to: 16 },
      { priority: 'HIGH', field: 'warnBeforeDue', from: 'H2', to: 'OFF' },
    ]);
  });
});
