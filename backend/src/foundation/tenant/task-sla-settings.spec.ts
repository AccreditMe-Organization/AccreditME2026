import { DEFAULT_TASK_SLA_NOTICES, taskSlaNoticesFromSettings, warnHours, warningFitsLimit } from './task-sla-settings';

// ACC-313 — the ONE reading of settings.taskSlaNotices. A missing key is the
// defaults, so no organisation needs a backfill; a value that is not one the
// API writes falls back to its default, so it can never turn a notice off.
describe('taskSlaNoticesFromSettings (ACC-313)', () => {
  it.each([
    ['no settings', null],
    ['settings with no notices', { taskSla: {} }],
    ['notices stored as null', { taskSlaNotices: null }],
  ])('%s reads the defaults: every reminder Off, due-date notices on', (_case, settings) => {
    expect(taskSlaNoticesFromSettings(settings)).toEqual({
      warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' },
      notifyOnDueChange: true,
    });
    expect(taskSlaNoticesFromSettings(settings)).toEqual(DEFAULT_TASK_SLA_NOTICES);
  });

  it('reads what is stored', () => {
    const stored = {
      warnBeforeDue: { LOW: 'WORKING_DAY', MEDIUM: 'H8', HIGH: 'H2', CRITICAL: 'H1' },
      notifyOnDueChange: false,
    };
    expect(taskSlaNoticesFromSettings({ taskSlaNotices: stored })).toEqual(stored);
  });

  it('completes a partly stored value from the defaults, value by value', () => {
    expect(taskSlaNoticesFromSettings({ taskSlaNotices: { warnBeforeDue: { HIGH: 'H4' } } })).toEqual({
      warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'H4', CRITICAL: 'OFF' },
      notifyOnDueChange: true,
    });
  });

  it('a value the API never writes falls back to its default', () => {
    expect(
      taskSlaNoticesFromSettings({ taskSlaNotices: { warnBeforeDue: { LOW: 'H3', HIGH: 2 }, notifyOnDueChange: 'false' } }),
    ).toEqual(DEFAULT_TASK_SLA_NOTICES);
  });
});

// ACC-313 PR 4 — a warning in working hours, and the rule that it is shorter than the limit (Q2).
describe('warnHours and the warning rule (ACC-313)', () => {
  it.each([
    ['OFF', 0],
    ['H1', 1],
    ['H2', 2],
    ['H4', 4],
    ['H8', 8],
    ['WORKING_DAY', 7.5],
  ] as const)('%s is %s working hours on a 7.5-hour working day', (option, hours) => {
    expect(warnHours(option, 7.5)).toBe(hours);
  });

  it('Off always fits; a warning fits only when strictly shorter than the limit', () => {
    expect(warningFitsLimit('OFF', 1, 8)).toBe(true);
    expect(warningFitsLimit('H2', 4, 8)).toBe(true);
    expect(warningFitsLimit('H4', 4, 8)).toBe(false);
    expect(warningFitsLimit('H8', 4, 8)).toBe(false);
  });

  it('1 working day fits a 16-hour limit on an 8-hour day, and not on a 16-hour day', () => {
    expect(warningFitsLimit('WORKING_DAY', 16, 8)).toBe(true);
    expect(warningFitsLimit('WORKING_DAY', 16, 16)).toBe(false);
  });
});
