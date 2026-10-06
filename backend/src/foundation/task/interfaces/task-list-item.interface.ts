import { ITask } from './task.interface';
import { ITaskPoolView } from '../task-pool';

// ACC-163 — the row a task LIST returns: the task plus how much evidence it
// holds, so a list can say "Evidence required · none yet" and disable Complete
// before the server has to refuse it.
//
// One named type that BOTH list endpoints return (my-tasks directly, and
// getForSource through ITaskWithAssignees, which extends it). An optional
// field that only one endpoint fills is the ACC-74 trap: the other endpoint's
// consumers bind to it and silently render 0 forever.
export interface ITaskListItem extends ITask {
  evidenceCount: number;
  // ACC-167 — the pool the task is assigned to, named for display; null when
  // it was assigned to named people only. A row with a pool and no active
  // assignee is waiting to be picked up.
  pool: ITaskPoolView | null;
}

// ACC-167 — a row of the caller's OWN list. `pickedByMe` says the caller's
// assignment came from a pick, which is what makes Release available: a person
// the assigner chose directly rejects instead. A separate type rather than an
// optional field on ITaskListItem, for the ACC-74 reason above — only my-tasks
// can know it.
export interface IMyTaskListItem extends ITaskListItem {
  pickedByMe: boolean;
}
