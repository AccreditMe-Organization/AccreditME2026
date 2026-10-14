import { ITaskActionsDto } from './services/task.service';

/**
 * ACC-229 — WHERE A TASK'S ACTIONS SIT, in one place for the task page, the
 * record Tasks panel and the All tasks list.
 *
 * WHICH actions a viewer may take is the server's `actions` (task-actions.ts
 * on the backend, the rules each action's endpoint applies). This file only
 * decides how they are shown: the one next step as a button, the rest in a
 * worded menu — the viewer's own work first, then the creator's, then the
 * two that are always there (Record Tasks Panel §4).
 */
export type TaskActionId = Exclude<keyof ITaskActionsDto, 'primary' | 'completeNeedsEvidence'>;

/** Every action a row's menu can hold: the server's, and the two that are always there. */
export type TaskRowActionId = TaskActionId | 'viewEvidence' | 'open';

export const TASK_ACTION_LABELS: Record<TaskActionId, string> = {
  reviewRequest: 'taskPage.action.reviewRequest',
  pickUp: 'task.pick',
  start: 'task.start',
  complete: 'task.complete',
  resume: 'taskPage.action.resume',
  addEvidence: 'taskPage.action.addEvidence',
  edit: 'taskPage.action.edit',
  reassign: 'taskPage.action.reassign',
  requestMoreTime: 'taskPage.action.requestMoreTime',
  requestHold: 'taskPage.action.requestHold',
  withdrawRequest: 'taskPage.action.withdrawRequest',
  reject: 'taskPage.action.reject',
  release: 'taskPage.action.release',
  cancel: 'taskPage.action.cancel',
  reopen: 'taskPage.action.reopen',
};

export const PRIMARY_ACTION_ID: Record<NonNullable<ITaskActionsDto['primary']>, TaskActionId> = {
  REVIEW_REQUEST: 'reviewRequest',
  PICK_UP: 'pickUp',
  START: 'start',
  COMPLETE: 'complete',
  RESUME: 'resume',
};

// The viewer's own work on the task, in the drawing's order.
const ASSIGNEE_ORDER: TaskActionId[] = [
  'complete',
  'start',
  'resume',
  'pickUp',
  'reviewRequest',
  'addEvidence',
  'requestMoreTime',
  'requestHold',
  'withdrawRequest',
  'reject',
  'release',
];
// What the task's creator (or whoever acts for them) may do.
const CREATOR_ORDER: TaskActionId[] = ['reassign', 'edit', 'cancel', 'reopen'];

export interface TaskRowAction {
  id: TaskRowActionId;
  labelKey: string;
  /** A second, quieter line under the label. */
  subKey?: string;
  danger?: boolean;
  /** Shown, but waiting: only Complete while evidence is missing. */
  disabled?: boolean;
  /** A count the label carries, "View evidence (2)". */
  count?: number;
}

export interface TaskRowActionModel {
  primary: TaskRowAction | null;
  /** The ⋯ menu, as groups a divider separates. Never empty: Open task is always last. */
  menu: TaskRowAction[][];
}

/** One action, labelled as a row shows it. */
export function taskRowAction(id: TaskActionId, actions: ITaskActionsDto): TaskRowAction {
  return {
    id,
    labelKey: TASK_ACTION_LABELS[id],
    subKey: id === 'reject' ? 'taskActions.rejectSub' : undefined,
    danger: id === 'cancel',
    disabled: id === 'complete' && actions.completeNeedsEvidence,
  };
}

/**
 * A row's button and menu. Actions the viewer cannot take are ABSENT, never
 * disabled — the one exception is Complete waiting for evidence, which says
 * why. The main action is not repeated in the menu.
 */
export function taskRowActions(actions: ITaskActionsDto, evidenceCount: number): TaskRowActionModel {
  const primaryId = actions.primary ? PRIMARY_ACTION_ID[actions.primary] : null;
  const primary = primaryId && actions[primaryId] ? taskRowAction(primaryId, actions) : null;
  const pick = (order: TaskActionId[]) =>
    order.filter((id) => actions[id] && id !== primary?.id).map((id) => taskRowAction(id, actions));

  const always: TaskRowAction[] = [];
  if (evidenceCount > 0) always.push({ id: 'viewEvidence', labelKey: 'taskActions.viewEvidence', count: evidenceCount });
  always.push({ id: 'open', labelKey: 'taskActions.open' });

  const menu = [pick(ASSIGNEE_ORDER), pick(CREATOR_ORDER), always].filter((group) => group.length > 0);
  return { primary, menu };
}
