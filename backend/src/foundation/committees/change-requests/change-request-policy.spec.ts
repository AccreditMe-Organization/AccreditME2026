import { CHANGE_REQUEST_STAGE_KEYS, COMMITTEE_STAGE_KEYS } from '../../workflow/workflow-stage-keys';
import { ChangeRequestRefusal } from './change-request-refusal';
import {
  ACTION_TARGET_STAGE,
  CHANGE_REQUEST_ACTIONS,
  ChangeRequestAction,
  assertCommitteeAllowsRaise,
  assertCommitteeStageAllows,
  assertRequestStageAllows,
  awaitsDecision,
  committeeStagePolicy,
  requestStagePolicy,
  stagesAllow,
} from './change-request-policy';

// ACC-239 — the stage rules of a committee change request, pinned. The policy
// maps are the one place they live; when a workflow-engine step makes stage
// permissions configurable, the configuration must give these same answers.

const code = (fn: () => void): string => {
  try {
    fn();
    return 'OK';
  } catch (e) {
    return (e as ChangeRequestRefusal).code;
  }
};
const allowed = (key: string | null, of: (k: string | null) => { actions: ReadonlySet<ChangeRequestAction> }) =>
  CHANGE_REQUEST_ACTIONS.filter((a) => of(key).actions.has(a));

describe('change-request policy (ACC-239)', () => {
  it('the request stages: what each allows, and whether it is open', () => {
    const table = Object.fromEntries(
      [...CHANGE_REQUEST_STAGE_KEYS, null].map((k) => [String(k), { open: requestStagePolicy(k).open, actions: allowed(k, requestStagePolicy) }]),
    );
    expect(table).toEqual({
      draft: { open: true, actions: ['edit', 'submit', 'withdraw'] },
      returned: { open: true, actions: ['edit', 'submit', 'withdraw'] },
      under_review: { open: true, actions: ['withdraw', 'approve', 'return', 'reject'] },
      approved: { open: false, actions: [] },
      rejected: { open: false, actions: [] },
      withdrawn: { open: false, actions: [] },
      // A stage with no key counts as open, and allows only the requester's withdraw.
      null: { open: true, actions: ['withdraw'] },
    });
    expect(requestStagePolicy('a-stage-nobody-knows')).toBe(requestStagePolicy(null));
  });

  it('only a draft or a returned request may be withdrawn by someone other than its requester', () => {
    expect([...CHANGE_REQUEST_STAGE_KEYS, null].filter((k) => requestStagePolicy(k).othersMayWithdraw)).toEqual(['draft', 'returned']);
  });

  it('the committee stages: where a request may be raised, and what an open one may still do', () => {
    const table = Object.fromEntries(
      [...COMMITTEE_STAGE_KEYS, null].map((k) => [String(k), { raise: committeeStagePolicy(k).raise, actions: allowed(k, committeeStagePolicy) }]),
    );
    expect(table).toEqual({
      formation: { raise: false, actions: ['edit', 'withdraw', 'reject'] },
      terms_review: { raise: false, actions: ['edit', 'withdraw', 'reject'] },
      active: { raise: true, actions: [...CHANGE_REQUEST_ACTIONS] },
      suspended: { raise: true, actions: [...CHANGE_REQUEST_ACTIONS] },
      // Dissolution Pending and Dissolved: an open request can only be rejected or withdrawn.
      dissolution_pending: { raise: false, actions: ['withdraw', 'reject'] },
      dissolved: { raise: false, actions: ['withdraw', 'reject'] },
      null: { raise: false, actions: ['edit', 'withdraw', 'reject'] },
    });
  });

  it('each refusal names its reason', () => {
    expect(code(() => assertRequestStageAllows('under_review', 'edit'))).toBe('CHANGE_REQUEST_NOT_EDITABLE');
    expect(code(() => assertRequestStageAllows('draft', 'approve'))).toBe('CHANGE_REQUEST_NOT_UNDER_REVIEW');
    expect(code(() => assertRequestStageAllows('approved', 'withdraw'))).toBe('CHANGE_REQUEST_NOT_OPEN');
    expect(code(() => assertCommitteeStageAllows('dissolution_pending', 'approve'))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
    expect(code(() => assertCommitteeStageAllows('formation', 'submit'))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise('dissolved'))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
    expect(code(() => assertCommitteeAllowsRaise('terms_review'))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise(null))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise('active'))).toBe('OK');
  });

  it('an action is allowed only where BOTH stages allow it', () => {
    expect(stagesAllow('under_review', 'active', 'approve')).toBe(true);
    expect(stagesAllow('under_review', 'dissolution_pending', 'approve')).toBe(false);
    expect(stagesAllow('under_review', 'dissolution_pending', 'reject')).toBe(true);
    expect(stagesAllow('draft', 'active', 'approve')).toBe(false);
  });

  it('each move lands in its own stage, and only a request under review awaits a decision', () => {
    expect(ACTION_TARGET_STAGE).toEqual({ submit: 'under_review', withdraw: 'withdrawn', approve: 'approved', return: 'returned', reject: 'rejected' });
    expect([...CHANGE_REQUEST_STAGE_KEYS, null].filter(awaitsDecision)).toEqual(['under_review']);
  });
});
