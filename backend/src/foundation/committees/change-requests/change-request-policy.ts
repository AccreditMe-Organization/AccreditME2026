import { CommitteeStageKey, ChangeRequestStageKey, isDissolvingStageKey } from '../../workflow/workflow-stage-keys';
import { ChangeRequestRefusal, ChangeRequestRefusalCode } from './change-request-refusal';

/**
 * ACC-239 — EVERY STAGE RULE OF A COMMITTEE CHANGE REQUEST, IN ONE PLACE.
 *
 * Two maps, both keyed by stage key (`WorkflowStage.key`, ACC-233):
 *
 *   REQUEST_STAGE_POLICY    the request's own stage: whether it is open, what it
 *                           allows, and whether someone other than the requester
 *                           may withdraw it;
 *   COMMITTEE_STAGE_POLICY  the committee's stage: whether a request may be
 *                           raised, and what an open request may still do.
 *
 * An action is allowed when BOTH maps allow it. WHO may take it (the requester,
 * a `committees:approve` holder, never the requester deciding their own) is not
 * a stage rule and stays in the service.
 *
 * A later workflow-engine step makes stage permissions configurable (each stage
 * lists the record actions it allows). That step replaces these two maps with
 * configuration, here and only here: nothing else in the module names a stage.
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

/** Where each move takes the request (the seeded SYSTEM_AUTOMATIC transition into that stage). */
export const ACTION_TARGET_STAGE: Readonly<Record<Exclude<ChangeRequestAction, 'edit'>, ChangeRequestStageKey>> = {
  submit: 'under_review',
  withdraw: 'withdrawn',
  approve: 'approved',
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

export interface CommitteeStagePolicy {
  /** A new request may be raised (only an Active or Suspended committee, Ahmad, 18 Oct). */
  raise: boolean;
  /** What an OPEN request may still do while the committee stands here. */
  actions: ReadonlySet<ChangeRequestAction>;
}

const RAISED_HERE: CommitteeStagePolicy = { raise: true, actions: allow(...CHANGE_REQUEST_ACTIONS) };
// Not yet approved: no request is raised; one already open may be edited,
// withdrawn or rejected, but not submitted or decided.
const NOT_APPROVED: CommitteeStagePolicy = { raise: false, actions: allow('edit', 'withdraw', 'reject') };
// Being dissolved, or dissolved: an open request can only be rejected or withdrawn.
const DISSOLVING: CommitteeStagePolicy = { raise: false, actions: allow('withdraw', 'reject') };

export const COMMITTEE_STAGE_POLICY: Readonly<Record<CommitteeStageKey, CommitteeStagePolicy>> = {
  formation: NOT_APPROVED,
  terms_review: NOT_APPROVED,
  active: RAISED_HERE,
  suspended: RAISED_HERE,
  dissolution_pending: DISSOLVING,
  dissolved: DISSOLVING,
};

/** A committee stage with no key: treated as not approved — nothing raised, nothing decided. */
export const UNKEYED_COMMITTEE_STAGE: CommitteeStagePolicy = NOT_APPROVED;

export function committeeStagePolicy(key: string | null | undefined): CommitteeStagePolicy {
  return (key && COMMITTEE_STAGE_POLICY[key as CommitteeStageKey]) || UNKEYED_COMMITTEE_STAGE;
}

/**
 * The refusal when the committee's stage does not allow something: "being
 * dissolved" names the reason for those two stages; any other stage is "not
 * while the committee is in this stage". Which stages are dissolving stays
 * ACC-233's one definition (`isDissolvingStageKey`), shared with the reference
 * checks and the lists.
 */
function committeeStageRefusal(key: string | null | undefined): ChangeRequestRefusalCode {
  return isDissolvingStageKey(key) ? 'CHANGE_REQUEST_COMMITTEE_DISSOLVING' : 'CHANGE_REQUEST_STAGE_NOT_ALLOWED';
}

// ── The checks the service runs ───────────────────────────────────────────────

export function assertRequestStageAllows(stageKey: string | null | undefined, action: ChangeRequestAction): void {
  if (!requestStagePolicy(stageKey).actions.has(action)) throw new ChangeRequestRefusal(REQUEST_STAGE_REFUSAL[action]);
}

export function assertCommitteeStageAllows(committeeStageKey: string | null | undefined, action: ChangeRequestAction): void {
  if (!committeeStagePolicy(committeeStageKey).actions.has(action)) {
    throw new ChangeRequestRefusal(committeeStageRefusal(committeeStageKey));
  }
}

export function assertCommitteeAllowsRaise(committeeStageKey: string | null | undefined): void {
  if (!committeeStagePolicy(committeeStageKey).raise) throw new ChangeRequestRefusal(committeeStageRefusal(committeeStageKey));
}

/** Both maps allow the action — what each response's `actions` flags read, before who is asking. */
export function stagesAllow(
  requestStageKey: string | null | undefined,
  committeeStageKey: string | null | undefined,
  action: ChangeRequestAction,
): boolean {
  return requestStagePolicy(requestStageKey).actions.has(action) && committeeStagePolicy(committeeStageKey).actions.has(action);
}
