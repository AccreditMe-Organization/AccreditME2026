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
  // ACC-313 — a priority's warning must be shorter than its limit, from both sides.
  | 'TASK_SLA_WARNING_NOT_BEFORE_DUE'
  | 'TASK_SLA_LIMIT_NOT_AFTER_WARNING'
  | 'STAGE_TASKS_OPEN'
  | 'ACTION_TYPE_RETIRED'
  | 'VALIDATOR_RETIRED'
  // ACC-238 — a transition precondition (transition-preconditions.ts).
  | 'COMMITTEE_QUORUM_NOT_SET'
  // ACC-286 — a committee goes live only with its quorum of members and every required seat filled.
  | 'COMMITTEE_MEMBERS_BELOW_QUORUM'
  | 'COMMITTEE_REQUIRED_SEATS_EMPTY'
  // ACC-239 — an edit to a template whose shape code relies on (PROTECTED_TEMPLATES).
  | 'WORKFLOW_TEMPLATE_PROTECTED'
  // ACC-255 — stage rules: what a stage allows (StageRulesService) and what a stage save may name.
  | 'STAGE_ACTION_NOT_ALLOWED'
  | 'STAGE_ACTION_UNKNOWN'
  | 'STAGE_FLAG_UNKNOWN'
  | 'STAGE_FLAG_EXACTLY_ONE'
  // ACC-271 — who works a converted stage (StagePoolService).
  | 'STAGE_HAS_NO_ONE'
  | 'NOT_IN_STAGE_POOL'
  // ACC-271 PR 6b — a move with no mover (none exist): nobody can make it.
  | 'MOVE_HAS_NO_MOVER'
  // ACC-284 — a recorded decision (submitApproval) needs exactly one move of its kind.
  | 'VOTE_MOVE_AMBIGUOUS'
  // ACC-271 PR 3 — a stage save's `who` (stage-who.ts).
  | 'WHO_MODE_UNKNOWN'
  | 'WHO_ENTRIES_REQUIRED'
  | 'WHO_ENTRY_DUPLICATE'
  | 'WHO_KIND_NOT_ALLOWED'
  | 'WHO_ENTRY_INCOMPLETE'
  | 'WHO_ENTRY_FIELD_NOT_USED'
  | 'WHO_RECORD_ROUTE_NOT_AVAILABLE'
  | 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE'
  | 'WHO_REFERENCE_NOT_FOUND'
  | 'WHO_USER_NOT_ACTIVE'
  // ACC-271 PR 6a — a new stage must say who works it.
  | 'WHO_REQUIRED'
  // ACC-57 — a template's starting and final stages (workflow-start-end.ts).
  | 'STAGE_INITIAL_REQUIRED'
  | 'STAGE_INITIAL_NOT_UNIQUE'
  | 'STAGE_INITIAL_AND_FINAL'
  // ACC-191 — removing something a record has used.
  | 'STAGE_HAS_TRANSITIONS'
  | 'STAGE_IN_USE'
  // ACC-245 — a committee change request's added review stages (review-stages.ts).
  | 'REVIEW_STAGE_LIMIT'
  | 'REVIEW_STAGE_POSITION'
  | 'REVIEW_STAGE_ANY_ONE'
  | 'REVIEW_STAGE_NO_CREATOR'
  | 'TRANSITION_ACTION_IN_USE'
  | 'TRANSITION_IN_USE'
  // ACC-303 — exactly one default template per record type (workflow-default.ts).
  | 'DEFAULT_NEEDS_STAGES'
  | 'DEFAULT_TEMPLATE_TYPE_CHANGE'
  | 'DEFAULT_TEMPLATE_REQUIRED'
  | 'DEFAULT_TEMPLATE_INACTIVE'
  // ACC-316 PR 3a — a move into a stage that needs a reason, pressed with none (move-reasons.ts).
  | 'REASON_REQUIRED'
  // ACC-316 PR 4 — what holds Approve Minutes (meeting-minutes-rules.ts).
  | 'MEETING_REVIEW_OPEN'
  | 'MEETING_SUGGESTION_OPEN'
  | 'MEETING_ACTION_PAST_DUE'
  | 'MEETING_ACTION_PAST_SLA_LIMIT';

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
  TASK_SLA_WARNING_NOT_BEFORE_DUE: HttpStatus.BAD_REQUEST,
  TASK_SLA_LIMIT_NOT_AFTER_WARNING: HttpStatus.BAD_REQUEST,
  STAGE_TASKS_OPEN: HttpStatus.CONFLICT,
  ACTION_TYPE_RETIRED: HttpStatus.BAD_REQUEST,
  VALIDATOR_RETIRED: HttpStatus.BAD_REQUEST,
  COMMITTEE_QUORUM_NOT_SET: HttpStatus.CONFLICT,
  COMMITTEE_MEMBERS_BELOW_QUORUM: HttpStatus.CONFLICT,
  COMMITTEE_REQUIRED_SEATS_EMPTY: HttpStatus.CONFLICT,
  WORKFLOW_TEMPLATE_PROTECTED: HttpStatus.CONFLICT,
  STAGE_ACTION_NOT_ALLOWED: HttpStatus.CONFLICT,
  STAGE_ACTION_UNKNOWN: HttpStatus.BAD_REQUEST,
  STAGE_FLAG_UNKNOWN: HttpStatus.BAD_REQUEST,
  STAGE_FLAG_EXACTLY_ONE: HttpStatus.CONFLICT,
  STAGE_HAS_NO_ONE: HttpStatus.CONFLICT,
  NOT_IN_STAGE_POOL: HttpStatus.FORBIDDEN,
  MOVE_HAS_NO_MOVER: HttpStatus.CONFLICT,
  VOTE_MOVE_AMBIGUOUS: HttpStatus.CONFLICT,
  WHO_MODE_UNKNOWN: HttpStatus.BAD_REQUEST,
  WHO_ENTRIES_REQUIRED: HttpStatus.BAD_REQUEST,
  WHO_ENTRY_DUPLICATE: HttpStatus.BAD_REQUEST,
  WHO_KIND_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  WHO_ENTRY_INCOMPLETE: HttpStatus.BAD_REQUEST,
  WHO_ENTRY_FIELD_NOT_USED: HttpStatus.BAD_REQUEST,
  WHO_RECORD_ROUTE_NOT_AVAILABLE: HttpStatus.BAD_REQUEST,
  COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE: HttpStatus.BAD_REQUEST,
  // Another organisation's id reads exactly like an invented one.
  WHO_REFERENCE_NOT_FOUND: HttpStatus.NOT_FOUND,
  WHO_USER_NOT_ACTIVE: HttpStatus.BAD_REQUEST,
  WHO_REQUIRED: HttpStatus.BAD_REQUEST,
  STAGE_INITIAL_REQUIRED: HttpStatus.CONFLICT,
  STAGE_INITIAL_NOT_UNIQUE: HttpStatus.CONFLICT,
  STAGE_INITIAL_AND_FINAL: HttpStatus.BAD_REQUEST,
  STAGE_HAS_TRANSITIONS: HttpStatus.CONFLICT,
  STAGE_IN_USE: HttpStatus.CONFLICT,
  REVIEW_STAGE_LIMIT: HttpStatus.CONFLICT,
  REVIEW_STAGE_POSITION: HttpStatus.BAD_REQUEST,
  REVIEW_STAGE_ANY_ONE: HttpStatus.BAD_REQUEST,
  REVIEW_STAGE_NO_CREATOR: HttpStatus.BAD_REQUEST,
  TRANSITION_ACTION_IN_USE: HttpStatus.CONFLICT,
  TRANSITION_IN_USE: HttpStatus.CONFLICT,
  DEFAULT_NEEDS_STAGES: HttpStatus.CONFLICT,
  DEFAULT_TEMPLATE_TYPE_CHANGE: HttpStatus.CONFLICT,
  DEFAULT_TEMPLATE_REQUIRED: HttpStatus.CONFLICT,
  DEFAULT_TEMPLATE_INACTIVE: HttpStatus.CONFLICT,
  REASON_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_REVIEW_OPEN: HttpStatus.CONFLICT,
  MEETING_SUGGESTION_OPEN: HttpStatus.CONFLICT,
  MEETING_ACTION_PAST_DUE: HttpStatus.CONFLICT,
  MEETING_ACTION_PAST_SLA_LIMIT: HttpStatus.CONFLICT,
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
  TASK_SLA_WARNING_NOT_BEFORE_DUE: "A priority's warning must be shorter than its time limit",
  TASK_SLA_LIMIT_NOT_AFTER_WARNING: "A priority's time limit must be longer than its warning",
  STAGE_TASKS_OPEN: 'Finish the required tasks of this stage before moving the record forward',
  ACTION_TYPE_RETIRED: 'Create task is no longer an action. Add tasks to the destination stage instead',
  VALIDATOR_RETIRED: "\"All previous stage tasks complete\" is no longer a validator: a stage's required tasks always hold its forward moves",
  COMMITTEE_QUORUM_NOT_SET: 'Set a quorum of at least 1 before submitting this committee for approval',
  COMMITTEE_MEMBERS_BELOW_QUORUM: 'Add members first: this committee has fewer members than its quorum',
  COMMITTEE_REQUIRED_SEATS_EMPTY: 'Fill the required seats first',
  WORKFLOW_TEMPLATE_PROTECTED:
    'The committee change request workflow is fixed: its stages can be renamed and given deadlines, and nothing else changed',
  STAGE_ACTION_NOT_ALLOWED: "This can't be done while the record is at its current stage",
  STAGE_ACTION_UNKNOWN: 'This kind of record has no such action',
  STAGE_FLAG_UNKNOWN: 'This kind of record has no such stage meaning',
  STAGE_FLAG_EXACTLY_ONE: 'Exactly one stage of this workflow must carry this meaning',
  STAGE_HAS_NO_ONE: "Nobody works this stage yet, so the record can't move from it. Ask an administrator to choose who works it",
  NOT_IN_STAGE_POOL: 'Only whoever works this stage can do this',
  MOVE_HAS_NO_MOVER: "Nobody is set to make this move, so the record can't move this way. Ask an administrator",
  VOTE_MOVE_AMBIGUOUS: "This stage doesn't have exactly one move for this decision, so it can't be recorded. Press the move itself instead",
  WHO_MODE_UNKNOWN: 'Choose how the people of this stage decide',
  WHO_ENTRIES_REQUIRED: 'A stage needs at least one assignee',
  WHO_ENTRY_DUPLICATE: 'This entry is already in the list',
  WHO_KIND_NOT_ALLOWED: "A stage of this kind of record can't be worked by this kind of assignee",
  WHO_ENTRY_INCOMPLETE: 'This assignee is missing something it needs',
  WHO_ENTRY_FIELD_NOT_USED: "This kind of assignee doesn't use one of the values sent",
  WHO_RECORD_ROUTE_NOT_AVAILABLE: "This kind of record has no unit or committee of its own yet, so the record's unit or committee cannot be used",
  COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE: 'A committee vote needs exactly one assignee, and it must be a committee',
  WHO_REFERENCE_NOT_FOUND: 'One of the chosen people, positions, units, committees or roles was not found',
  WHO_USER_NOT_ACTIVE: "A deactivated person can't work a stage",
  WHO_REQUIRED: 'Choose who works this stage',
  STAGE_INITIAL_REQUIRED: 'A workflow needs a starting stage. Mark another stage as the starting stage instead',
  STAGE_INITIAL_NOT_UNIQUE: 'Only one stage can be the starting stage',
  STAGE_INITIAL_AND_FINAL: "A stage can't be both the starting stage and a final stage",
  STAGE_HAS_TRANSITIONS: 'Remove the transitions into and out of this stage first',
  STAGE_IN_USE: "Records have entered this stage, so it can't be removed. You can rename it",
  REVIEW_STAGE_LIMIT: 'A committee change request can have at most 9 review stages',
  REVIEW_STAGE_POSITION: 'A review stage goes after Draft or after another review stage',
  REVIEW_STAGE_ANY_ONE: 'A review stage is decided by any one of its people',
  REVIEW_STAGE_NO_CREATOR: "A review stage can't be given to whoever raised the request: nobody decides their own change request",
  TRANSITION_ACTION_IN_USE: "This action has run, so it can't be removed. You can turn it off",
  TRANSITION_IN_USE: "This transition has been used, so it can't be removed. You can rename it",
  DEFAULT_NEEDS_STAGES: 'Add a starting stage, then set this template as the default.',
  DEFAULT_TEMPLATE_TYPE_CHANGE: "The default workflow's record type can't be changed. Make another template the default first.",
  DEFAULT_TEMPLATE_REQUIRED: 'This is the default workflow for its record type. Make another template the default first.',
  DEFAULT_TEMPLATE_INACTIVE: "A deactivated workflow can't be the default.",
  REASON_REQUIRED: 'Give a reason for this move: the people told about it read it.',
  MEETING_REVIEW_OPEN: "The review is still open: wait for every present member's answer or for the review date to pass.",
  MEETING_SUGGESTION_OPEN: 'Apply or decline every open suggestion first.',
  MEETING_ACTION_PAST_DUE: 'An action item is due in the past. Give it a later due date first.',
  MEETING_ACTION_PAST_SLA_LIMIT: "An action item is due after its task's time limit. Give it an earlier due date first.",
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
