import { ITask } from './task.interface';

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
}
