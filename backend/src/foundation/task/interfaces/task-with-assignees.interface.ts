import { ITask } from './task.interface';
import { IResolvedDelegation } from '../../../common/services/delegation-label.interface';

// ACC-76 — the shape a task-list surface needs, as distinct from ITask.
//
// ITask deliberately carries no assignees: it is the row, not the row plus its
// relations. Before this ticket NO list endpoint in the product returned
// assignee data at all (getForSource/getMyTasks/listUnassigned are all bare
// findMany calls), so "who is this assigned to" was unanswerable in any UI —
// the defect ACC-58 tracked.
//
// Kept as a separate interface rather than making `assignees` optional on
// ITask, because an optional field that is populated on exactly one endpoint
// is the same trap IRole.permissions fell into (ACC-74): role-list bound to
// `permissions?.length` and silently rendered 0 for every role, forever. A
// distinct return type makes the two cases impossible to confuse at a call
// site.
export interface ITaskAssigneeView {
  userId: string;
  // Resolved from User.name at query time. Not cached on TaskAssignee — a
  // renamed user should read correctly on the next load, unlike
  // TaskEvidence.refDisplay, which caches deliberately for a different
  // reason (the referenced object may become unreachable).
  userName: string;
  // Non-null only when this assignment came via delegation. See
  // IResolvedDelegation for why the label is resolved here and not by the
  // client.
  delegation: IResolvedDelegation | null;
}

export interface ITaskWithAssignees extends ITask {
  // ACTIVE assignees only (removedAt: null) — the same definition of
  // "assigned" getMyTasks() already uses. TaskAssignee rows are never
  // deleted: complete() stamps removedAt on everyone who did not complete
  // the task, so returning every row would make a completed task appear
  // assigned to everyone who was ever on it.
  assignees: ITaskAssigneeView[];
}
