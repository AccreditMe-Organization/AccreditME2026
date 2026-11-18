import { DEFAULT_TASK_SLA_NOTICES, taskSlaNoticesFromSettings } from './task-sla-settings';

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
