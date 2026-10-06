import { ITaskDto } from './services/task.service';

// ACC-163 — how a task's status is SHOWN, in one place. Home, My tasks, the
// committee record and the all-tasks list each used to map statuses on their
// own, and drifted: one coloured OVERDUE red, one did not know UNASSIGNED.
//
// Three rules live here and nowhere else:
//
//   1. PENDING is shown as "Assigned" — a rename in the UI only (decision 1).
//      The rename is the translation (task.status.pending), not a mapping.
//
//   2. A legacy OVERDUE row is shown as Assigned. OVERDUE is no longer written
//      (Q8), and OVERDUE was only ever written over PENDING, so every such row
//      is an Assigned task past its due time — which rule 3 still says.
//
//   3. Overdue is a FLAG beside the status, never a status: an OPEN task whose
//      due time has passed. "Open" is the server's own definition (not
//      COMPLETED, not CANCELLED) — the stage gate's — so a rejected task past
//      its due date is overdue too, because the work is still owed.
//
//   4. ACC-173 — an ON_HOLD task is open (it still holds its stage) but never
//      overdue: its SLA is paused, and its due date moves forward when it
//      resumes.

type TaskStatusLike = Pick<ITaskDto, 'status'>;
type DueTask = Pick<ITaskDto, 'dueAt' | 'status'>;

export type TaskStatusSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary';

export function displayStatus(status: string): string {
  return status === 'OVERDUE' ? 'PENDING' : status;
}

export function taskStatusLabelKey(task: TaskStatusLike): string {
  return `task.status.${displayStatus(task.status).toLowerCase()}`;
}

// Colour is spent on what someone has to act on. Assigned and Cancelled are
// unremarkable; In progress is information; Rejected and Unassigned both wait
// on someone other than the assignee; Completed is done.
export function taskStatusSeverity(task: TaskStatusLike): TaskStatusSeverity {
  switch (displayStatus(task.status)) {
    case 'COMPLETED':
      return 'success';
    case 'IN_PROGRESS':
    case 'ON_HOLD':
      return 'info';
    case 'REJECTED':
    case 'UNASSIGNED':
      return 'warn';
    default:
      return 'secondary';
  }
}

export function isTaskOpen(task: TaskStatusLike): boolean {
  return task.status !== 'COMPLETED' && task.status !== 'CANCELLED';
}

// Compares instants, so it is correct in any time zone.
export function isTaskOverdue(task: DueTask, now: Date = new Date()): boolean {
  if (!task.dueAt || !isTaskOpen(task) || task.status === 'ON_HOLD') return false;
  return new Date(task.dueAt).getTime() < now.getTime();
}
