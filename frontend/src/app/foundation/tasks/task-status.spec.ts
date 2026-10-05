import { displayStatus, isTaskOpen, isTaskOverdue, taskStatusLabelKey, taskStatusSeverity } from './task-status';

// ACC-163 — the one place a task status is shown from. Three rules: PENDING
// reads as Assigned (by its translation), a legacy OVERDUE row reads as
// Assigned, and overdue is a flag computed from the due time, never a status.
describe('task-status (ACC-163)', () => {
  const NOW = new Date('2026-10-05T12:00:00.000Z');
  const PAST = '2026-10-05T11:59:00.000Z';
  const FUTURE = '2026-10-05T12:01:00.000Z';

  it('shows a legacy OVERDUE row as PENDING (Assigned), and every other status as itself', () => {
    expect(displayStatus('OVERDUE')).toBe('PENDING');
    for (const status of ['PENDING', 'IN_PROGRESS', 'REJECTED', 'COMPLETED', 'CANCELLED', 'UNASSIGNED']) {
      expect(displayStatus(status)).toBe(status);
    }
  });

  it('labels a status by its own key, and a legacy OVERDUE row by the Assigned key', () => {
    expect(taskStatusLabelKey({ status: 'OVERDUE' })).toBe('task.status.pending');
    expect(taskStatusLabelKey({ status: 'IN_PROGRESS' })).toBe('task.status.in_progress');
    expect(taskStatusLabelKey({ status: 'REJECTED' })).toBe('task.status.rejected');
  });

  it('spends colour on what someone has to act on', () => {
    expect(taskStatusSeverity({ status: 'PENDING' })).toBe('secondary');
    expect(taskStatusSeverity({ status: 'OVERDUE' })).toBe('secondary');
    expect(taskStatusSeverity({ status: 'IN_PROGRESS' })).toBe('info');
    expect(taskStatusSeverity({ status: 'REJECTED' })).toBe('warn');
    expect(taskStatusSeverity({ status: 'UNASSIGNED' })).toBe('warn');
    expect(taskStatusSeverity({ status: 'COMPLETED' })).toBe('success');
    expect(taskStatusSeverity({ status: 'CANCELLED' })).toBe('secondary');
  });

  it('treats everything but COMPLETED and CANCELLED as open — the server\'s definition', () => {
    for (const status of ['PENDING', 'OVERDUE', 'IN_PROGRESS', 'REJECTED', 'UNASSIGNED']) {
      expect(isTaskOpen({ status })).withContext(status).toBe(true);
    }
    expect(isTaskOpen({ status: 'COMPLETED' })).toBe(false);
    expect(isTaskOpen({ status: 'CANCELLED' })).toBe(false);
  });

  // Q8 — a flag on any open task, whatever its status.
  it('is overdue for an open task past its due time, whatever its status', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'REJECTED', 'OVERDUE']) {
      expect(isTaskOverdue({ status, dueAt: PAST }, NOW)).withContext(status).toBe(true);
    }
  });

  it('is not overdue before the due time, without one, or once closed', () => {
    expect(isTaskOverdue({ status: 'PENDING', dueAt: FUTURE }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: 'PENDING', dueAt: null }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: 'COMPLETED', dueAt: PAST }, NOW)).toBe(false);
    expect(isTaskOverdue({ status: 'CANCELLED', dueAt: PAST }, NOW)).toBe(false);
  });
});
