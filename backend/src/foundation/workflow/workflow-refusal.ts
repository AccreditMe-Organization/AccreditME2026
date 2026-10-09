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
  | 'VALIDATOR_RETIRED';

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
