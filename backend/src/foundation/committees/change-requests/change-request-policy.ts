import { ChangeRequestStageKey } from '../../workflow/workflow-stage-keys';
import { COMMITTEE_ACTIONS, STAGE_FLAG } from '../../workflow/record-registry';
import type { StageRules } from '../../workflow/stage-rules.service';
import { ChangeRequestRefusal, ChangeRequestRefusalCode } from './change-request-refusal';

/**
 * ACC-239 — EVERY STAGE RULE OF A COMMITTEE CHANGE REQUEST, IN ONE PLACE.
 *
 * Two inputs:
 *
 *   REQUEST_STAGE_POLICY    the request's own stage, by its key: whether it is
 *                           open, what it allows, and whether someone other than
 *                           the requester may withdraw it. Keyed on purpose: the
 *                           change request template is protected and its six
 *                           stages are fixed (ACC-255 D7).
 *   the committee's stage   ACC-255 PR 2: the engine's answer for the committee's
 *                           current stage (StageRulesService) — the actions it
 *                           allows and its flags, configured per tenant. No
 *                           committee stage key is read here any more.
 *
 * An action is allowed when BOTH allow it. WHO may take it (the requester, a
 * `committees:approve` holder, never the requester deciding their own) is not a
 * stage rule and stays in the service.
 */

export const CHANGE_REQUEST_ACTIONS = ['edit', 'submit', 'withdraw', 'approve', 'return', 'reject'] as const;
export type ChangeRequestAction = (typeof CHANGE_REQUEST_ACTIONS)[number];

const allow = (...actions: ChangeRequestAction[]): ReadonlySet<ChangeRequestAction> => new Set(actions);

export interface RequestStagePolicy {
  /** Counts toward "one open request per committee". */
  open: boolean;
  /** What a request in this stage allows. */
  actions: ReadonlySet<ChangeRequestAction>;
  /** A `committees:approve` holder other than the requester may withdraw it — a draft left behind. */
  othersMayWithdraw: boolean;
}

const CLOSED: RequestStagePolicy = { open: false, actions: allow(), othersMayWithdraw: false };

export const REQUEST_STAGE_POLICY: Readonly<Record<ChangeRequestStageKey, RequestStagePolicy>> = {
  draft: { open: true, actions: allow('edit', 'submit', 'withdraw'), othersMayWithdraw: true },
  // Returned behaves like Draft (Ahmad, 18 Oct).
  returned: { open: true, actions: allow('edit', 'submit', 'withdraw'), othersMayWithdraw: true },
  under_review: { open: true, actions: allow('approve', 'return', 'reject', 'withdraw'), othersMayWithdraw: false },
  approved: CLOSED,
  rejected: CLOSED,
  withdrawn: CLOSED,
};

/**
 * A stage with no key (or one this map does not know). It counts as OPEN, so one
 * open request per committee is never bypassed by an unrecognised stage, and
 * only its requester may withdraw it.
 */
export const UNKEYED_REQUEST_STAGE: RequestStagePolicy = { open: true, actions: allow('withdraw'), othersMayWithdraw: false };

export function requestStagePolicy(key: string | null | undefined): RequestStagePolicy {
  return (key && REQUEST_STAGE_POLICY[key as ChangeRequestStageKey]) || UNKEYED_REQUEST_STAGE;
}

/**
 * Where each move takes the request (the seeded SYSTEM_AUTOMATIC transition into
 * that stage). Approve is not here: its target is the one stage of the
 * request's template flagged APPLIES_APPROVED_CHANGE (ACC-255 §4.3), found by
 * the service.
 */
export const ACTION_TARGET_STAGE: Readonly<Record<Exclude<ChangeRequestAction, 'edit' | 'approve'>, ChangeRequestStageKey>> = {
  submit: 'under_review',
  withdraw: 'withdrawn',
  return: 'returned',
  reject: 'rejected',
};

/** A request awaits a decision when its stage allows one. */
export function awaitsDecision(key: string | null | undefined): boolean {
  return requestStagePolicy(key).actions.has('approve');
}

/** The refusal when the request's stage does not allow an action. */
const REQUEST_STAGE_REFUSAL: Readonly<Record<ChangeRequestAction, ChangeRequestRefusalCode>> = {
  edit: 'CHANGE_REQUEST_NOT_EDITABLE',
  submit: 'CHANGE_REQUEST_NOT_EDITABLE',
  withdraw: 'CHANGE_REQUEST_NOT_OPEN',
  approve: 'CHANGE_REQUEST_NOT_UNDER_REVIEW',
  return: 'CHANGE_REQUEST_NOT_UNDER_REVIEW',
  reject: 'CHANGE_REQUEST_NOT_UNDER_REVIEW',
};

/**
 * ACC-255 PR 2 — what the committee's current stage says, from the engine
 * (StageRulesService.currentStageRules): the record actions it allows and its
 * flags. A committee with no live stage answers nothing allowed, no flags (D14).
 */
export type CommitteeStageRules = Pick<StageRules, 'actions' | 'flags'>;

/**
 * What an OPEN request may still do while the committee stands here — the
 * plan's §4.2 derivation, identical to the old map for every seeded stage:
 * submit, approve and return need a committee in force (IN_FORCE); editing is
 * refused once it is being dissolved (DISSOLVING); withdrawing and rejecting
 * are always possible, so a request can always be closed.
 */
export function committeeAllowsRequestMove(stage: CommitteeStageRules, action: ChangeRequestAction): boolean {
  switch (action) {
    case 'submit':
    case 'approve':
    case 'return':
      return stage.flags.includes(STAGE_FLAG.IN_FORCE);
    case 'edit':
      return !stage.flags.includes(STAGE_FLAG.DISSOLVING);
    case 'withdraw':
    case 'reject':
      return true;
  }
}

/** May a new request be raised while the committee stands here? Its stage must allow `request_change`. */
export function committeeAllowsRaise(stage: CommitteeStageRules): boolean {
  return stage.actions[COMMITTEE_ACTIONS.REQUEST_CHANGE] === true;
}

/**
 * The refusal when the committee's stage does not allow something: "being
 * dissolved" when the stage is flagged DISSOLVING; any other stage is "not
 * while the committee is in this stage". The codes are unchanged (ACC-239).
 */
function committeeStageRefusal(stage: CommitteeStageRules): ChangeRequestRefusalCode {
  return stage.flags.includes(STAGE_FLAG.DISSOLVING) ? 'CHANGE_REQUEST_COMMITTEE_DISSOLVING' : 'CHANGE_REQUEST_STAGE_NOT_ALLOWED';
}

// ── The checks the service runs ───────────────────────────────────────────────

export function assertRequestStageAllows(stageKey: string | null | undefined, action: ChangeRequestAction): void {
  if (!requestStagePolicy(stageKey).actions.has(action)) throw new ChangeRequestRefusal(REQUEST_STAGE_REFUSAL[action]);
}

export function assertCommitteeStageAllows(stage: CommitteeStageRules, action: ChangeRequestAction): void {
  if (!committeeAllowsRequestMove(stage, action)) throw new ChangeRequestRefusal(committeeStageRefusal(stage));
}

export function assertCommitteeAllowsRaise(stage: CommitteeStageRules): void {
  if (!committeeAllowsRaise(stage)) throw new ChangeRequestRefusal(committeeStageRefusal(stage));
}

/** Both allow the action — what each response's `actions` flags read, before who is asking. */
export function stagesAllow(
  requestStageKey: string | null | undefined,
  committeeStage: CommitteeStageRules,
  action: ChangeRequestAction,
): boolean {
  return requestStagePolicy(requestStageKey).actions.has(action) && committeeAllowsRequestMove(committeeStage, action);
}
