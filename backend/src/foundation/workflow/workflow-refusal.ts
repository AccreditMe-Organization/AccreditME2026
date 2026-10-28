import { HttpException, HttpStatus } from '@nestjs/common';

// ACC-190 — the refusals stage task definitions and the stage gate send, in
// the storage refusals' shape (ACC-177): { statusCode, message, error, code }
// plus details, so a screen can switch on `code` and name what blocked it.

export type WorkflowRefusalCode =
  | 'STAGE_TASK_ROUTE_INCOMPLETE'
  | 'STAGE_TASK_ROUTE_NOT_AVAILABLE'
  | 'STAGE_TASK_UNIT_NOT_FOUND'
  | 'STAGE_TASK_POSITION_NOT_FOUND'
  | 'STAGE_TASK_COMMITTEE_NOT_FOUND'
  | 'STAGE_TASK_ROLE_NOT_FOUND'
  | 'STAGE_TASK_USER_NOT_IN_POSITION'
  | 'STAGE_TASK_ON_FINAL_STAGE'
  | 'STAGE_TASK_ORDER_MISMATCH'
  | 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE'
  | 'STAGE_DEADLINE_BEFORE_TASKS'
  | 'TASK_SLA_EXCEEDS_STAGE_DEADLINES'
  | 'STAGE_TASKS_OPEN'
  | 'ACTION_TYPE_RETIRED'
  | 'VALIDATOR_RETIRED'
  // ACC-238 — a transition precondition (transition-preconditions.ts).
  | 'COMMITTEE_QUORUM_NOT_SET'
  // ACC-239 — an edit to a template whose shape code relies on (PROTECTED_TEMPLATES).
  | 'WORKFLOW_TEMPLATE_PROTECTED'
  // ACC-255 — stage rules: what a stage allows (StageRulesService) and what a stage save may name.
  | 'STAGE_ACTION_NOT_ALLOWED'
  | 'STAGE_ACTION_UNKNOWN'
  | 'STAGE_FLAG_UNKNOWN'
  | 'STAGE_FLAG_EXACTLY_ONE'
  // ACC-271 — who works a converted stage (StagePoolService).
  | 'STAGE_HAS_NO_ONE'
  | 'NOT_IN_STAGE_POOL';

const STATUS: Record<WorkflowRefusalCode, HttpStatus> = {
  STAGE_TASK_ROUTE_INCOMPLETE: HttpStatus.BAD_REQUEST,
  STAGE_TASK_ROUTE_NOT_AVAILABLE: HttpStatus.BAD_REQUEST,
  STAGE_TASK_UNIT_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAGE_TASK_POSITION_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAGE_TASK_COMMITTEE_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAGE_TASK_ROLE_NOT_FOUND: HttpStatus.NOT_FOUND,
  STAGE_TASK_USER_NOT_IN_POSITION: HttpStatus.BAD_REQUEST,
  STAGE_TASK_ON_FINAL_STAGE: HttpStatus.BAD_REQUEST,
  STAGE_TASK_ORDER_MISMATCH: HttpStatus.BAD_REQUEST,
  STAGE_TASK_DUE_AFTER_STAGE_DEADLINE: HttpStatus.CONFLICT,
  STAGE_DEADLINE_BEFORE_TASKS: HttpStatus.CONFLICT,
  TASK_SLA_EXCEEDS_STAGE_DEADLINES: HttpStatus.CONFLICT,
  STAGE_TASKS_OPEN: HttpStatus.CONFLICT,
  ACTION_TYPE_RETIRED: HttpStatus.BAD_REQUEST,
  VALIDATOR_RETIRED: HttpStatus.BAD_REQUEST,
  COMMITTEE_QUORUM_NOT_SET: HttpStatus.CONFLICT,
  WORKFLOW_TEMPLATE_PROTECTED: HttpStatus.CONFLICT,
  STAGE_ACTION_NOT_ALLOWED: HttpStatus.CONFLICT,
  STAGE_ACTION_UNKNOWN: HttpStatus.BAD_REQUEST,
  STAGE_FLAG_UNKNOWN: HttpStatus.BAD_REQUEST,
  STAGE_FLAG_EXACTLY_ONE: HttpStatus.CONFLICT,
  STAGE_HAS_NO_ONE: HttpStatus.CONFLICT,
  NOT_IN_STAGE_POOL: HttpStatus.FORBIDDEN,
};

export const WORKFLOW_REFUSAL_MESSAGES: Record<WorkflowRefusalCode, string> = {
  STAGE_TASK_ROUTE_INCOMPLETE: 'Choose where the task goes: the fields this assignment needs are missing, or one it does not use was sent',
  STAGE_TASK_ROUTE_NOT_AVAILABLE: "This kind of record has no unit or committee of its own yet, so the record's unit or committee cannot be used",
  STAGE_TASK_UNIT_NOT_FOUND: 'Org unit not found',
  STAGE_TASK_POSITION_NOT_FOUND: 'Position not found',
  STAGE_TASK_COMMITTEE_NOT_FOUND: 'Committee not found',
  STAGE_TASK_ROLE_NOT_FOUND: 'Committee role not found',
  STAGE_TASK_USER_NOT_IN_POSITION: 'The chosen person does not hold that position in that unit',
  STAGE_TASK_ON_FINAL_STAGE: 'A final stage cannot create tasks: the record is complete the moment it arrives',
  STAGE_TASK_ORDER_MISMATCH: "The new order must list every task of this stage, once each",
  STAGE_TASK_DUE_AFTER_STAGE_DEADLINE: "This task's due time is longer than the stage's deadline. Raise the stage deadline or choose a higher priority",
  STAGE_DEADLINE_BEFORE_TASKS: "The stage's deadline can't be shorter than the longest task defined on it",
  TASK_SLA_EXCEEDS_STAGE_DEADLINES: 'This would make some workflow stages end before the tasks defined on them are due',
  STAGE_TASKS_OPEN: 'Finish the required tasks of this stage before moving the record forward',
  ACTION_TYPE_RETIRED: 'Create task is no longer an action. Add tasks to the destination stage instead',
  VALIDATOR_RETIRED: "\"All previous stage tasks complete\" is no longer a validator: a stage's required tasks always hold its forward moves",
  COMMITTEE_QUORUM_NOT_SET: 'Set a quorum of at least 1 before submitting this committee for approval',
  WORKFLOW_TEMPLATE_PROTECTED:
    'The committee change request workflow is fixed: its stages can be renamed and given deadlines, and nothing else changed',
  STAGE_ACTION_NOT_ALLOWED: "This can't be done while the record is at its current stage",
  STAGE_ACTION_UNKNOWN: 'This kind of record has no such action',
  STAGE_FLAG_UNKNOWN: 'This kind of record has no such stage meaning',
  STAGE_FLAG_EXACTLY_ONE: 'Exactly one stage of this workflow must carry this meaning',
  STAGE_HAS_NO_ONE: "Nobody works this stage yet, so the record can't move from it. Ask an administrator to choose who works it",
  NOT_IN_STAGE_POOL: 'Only whoever works this stage can do this',
};

export class WorkflowRefusalException extends HttpException {
  constructor(
    readonly code: WorkflowRefusalCode,
    details: Record<string, unknown> = {},
  ) {
    const status = STATUS[code];
    super(
      {
        statusCode: status,
        message: WORKFLOW_REFUSAL_MESSAGES[code],
        error: HttpStatus[status]
          .toLowerCase()
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        code,
        ...details,
      },
      status,
    );
  }
}

/**
 * ACC-239 — what a tenant tried to do to a protected template, and the sentence
 * that says why it can't (Ahmad, 18 Oct, Q15: the committee change request's
 * six keyed stages are fixed; rename them and set their deadlines). Added
 * review stages are ACC-245.
 */
const PROTECTED_REFUSALS = {
  CREATE_TEMPLATE:
    'There is already a committee change request workflow, and there can be only one. Rename its stages or set their deadlines instead.',
  REPLACE_DEFAULT: 'The committee change request workflow cannot be replaced by another workflow.',
  DEACTIVATE: 'The committee change request workflow cannot be switched off: changes to approved committees depend on it.',
  CHANGE_TYPE: 'A workflow cannot be changed to or from the committee change request type.',
  ADD_STAGE: 'Stages cannot be added to the committee change request workflow. You can rename its stages and set their deadlines.',
  REMOVE_STAGE: 'This stage is part of how a committee change request is decided, so it cannot be deleted.',
  STAGE_FIELD:
    "In the committee change request workflow only a stage's names, description and deadline can be changed.",
  TRANSITION:
    'The moves of a committee change request are fixed, so they cannot be added, changed or removed.',
  STAGE_TASKS:
    "Tasks cannot be added to the committee change request workflow's stages: its moves are made by the request itself.",
} as const;
export type ProtectedEdit = keyof typeof PROTECTED_REFUSALS;

export function refuseProtected(edit: ProtectedEdit): never {
  throw new WorkflowRefusalException('WORKFLOW_TEMPLATE_PROTECTED', { message: PROTECTED_REFUSALS[edit], edit });
}
