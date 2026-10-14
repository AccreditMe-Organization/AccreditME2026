import { ITaskListItem } from './task-list-item.interface';
import { IResolvedDelegation } from '../../../common/services/delegation-label.interface';

/**
 * ACC-228 — what the viewer may do on one task, decided by the server from the
 * same rules each action's endpoint applies (task-actions.ts). The task page
 * reads it; ACC-229's record panel will read it per row.
 */
export interface ITaskActions {
  start: boolean;
  complete: boolean;
  /** Complete is offered but waits for evidence: shown disabled, with the reason. */
  completeNeedsEvidence: boolean;
  reject: boolean;
  release: boolean;
  pickUp: boolean;
  requestMoreTime: boolean;
  requestHold: boolean;
  withdrawRequest: boolean;
  reviewRequest: boolean;
  resume: boolean;
  addEvidence: boolean;
  reassign: boolean;
  edit: boolean;
  cancel: boolean;
  reopen: boolean;
  /** The one next step the page and the row show as their main button, or none. */
  primary: TaskPrimaryAction | null;
}

export type TaskPrimaryAction = 'REVIEW_REQUEST' | 'PICK_UP' | 'START' | 'COMPLETE' | 'RESUME';

export interface ITaskPagePerson {
  id: string;
  name: string;
  positionNameEn: string | null;
  positionNameAr: string | null;
  orgUnitNameEn: string | null;
  orgUnitNameAr: string | null;
}

export interface ITaskPageAssignee extends ITaskPagePerson {
  /** Set when this person took the task from its pool. */
  pickedAt: Date | null;
  /** The ACC-101 qualifier ("covering for …"), only for a viewer entitled to it. */
  delegation: IResolvedDelegation | null;
}

/**
 * ACC-228 — the task page's view model: the task as a list row (so every
 * existing dialog takes it unchanged), plus the names and relations a list
 * row does not carry.
 */
export interface ITaskPageView {
  task: ITaskListItem;
  /** The record the task is about. The name only when the viewer may open the record. */
  record: {
    type: string;
    id: string;
    canOpen: boolean;
    nameEn: string | null;
    nameAr: string | null;
  };
  /** The workflow step that created it (ACC-190), when there is one. */
  stage: { nameEn: string; nameAr: string | null } | null;
  /** Active assignees; empty while the task waits in its pool or is unassigned. */
  assignees: ITaskPageAssignee[];
  /** How many people can pick it up, while it waits in its pool; otherwise null. */
  poolMemberCount: number | null;
  createdBy: ITaskPagePerson;
  /** True when a workflow stage created it, not a person by hand. */
  createdByWorkflow: boolean;
  completedBy: { id: string; name: string } | null;
  rejectedBy: { id: string; name: string } | null;
  cancelledBy: { id: string; name: string } | null;
  reopenedBy: { id: string; name: string } | null;
  actions: ITaskActions;
}

/**
 * One line of the task's history, worded by the frontend from `kind`. Built
 * from the audit trail; never the stored before/after.
 */
export interface ITaskHistoryEvent {
  at: Date;
  actorName: string | null;
  kind: TaskHistoryKind;
  reason: string | null;
  requestType: 'EXTENSION' | 'ON_HOLD' | null;
  evidenceType: string | null;
}

export type TaskHistoryKind =
  | 'created'
  | 'started'
  | 'completed'
  | 'rejected'
  | 'reassigned'
  | 'picked'
  | 'released'
  | 'edited'
  | 'cancelled'
  | 'cancelled_by_workflow'
  | 'reopened'
  | 'escalated'
  | 'escalation_skipped'
  | 'returned_to_pool'
  | 'handed_on'
  | 'stage_recovery'
  | 'request_made'
  | 'request_withdrawn'
  | 'request_approved'
  | 'request_declined'
  | 'request_cancelled'
  | 'hold_started'
  | 'resumed'
  | 'evidence_added'
  | 'evidence_removed'
  | 'changed';
