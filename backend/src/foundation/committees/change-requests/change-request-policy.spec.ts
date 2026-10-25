import { CHANGE_REQUEST_STAGE_KEYS } from '../../workflow/workflow-stage-keys';
import { SYSTEM_WORKFLOW_SEED } from '../../workflow/workflow.seed';
import { ChangeRequestRefusal } from './change-request-refusal';
import {
  ACTION_TARGET_STAGE,
  CHANGE_REQUEST_ACTIONS,
  ChangeRequestAction,
  assertCommitteeAllowsRaise,
  assertCommitteeStageAllows,
  assertRequestStageAllows,
  CommitteeStageRules,
  awaitsDecision,
  committeeAllowsRaise,
  committeeAllowsRequestMove,
  requestStagePolicy,
  stagesAllow,
} from './change-request-policy';

// ACC-239 — the stage rules of a committee change request, pinned. The
// request's own stages are a keyed map (its template is protected, ACC-255 D7);
// the committee's stage is its stored rules (ACC-255 PR 2), and the §4.2
// derivation must give, for every seeded committee stage, exactly what the old
// keyed map gave — kept below as the reference.

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

const IN_FORCE: CommitteeStageRules = { actions: { request_change: true }, flags: ['IN_FORCE'] };
const DISSOLVING: CommitteeStageRules = { actions: {}, flags: ['DISSOLVING'] };
const NOT_APPROVED: CommitteeStageRules = { actions: { edit_details: true }, flags: [] };

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

  it("the committee stages, from the seed's stored rules: where a request may be raised, and what an open one may still do", () => {
    const committee = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
    const rulesOf = (s: { actions?: readonly string[]; flags?: readonly string[] }): CommitteeStageRules => ({
      actions: Object.fromEntries((s.actions ?? []).map((a) => [a, true])),
      flags: [...(s.flags ?? [])],
    });
    const derive = (rules: CommitteeStageRules) => ({
      raise: committeeAllowsRaise(rules),
      actions: CHANGE_REQUEST_ACTIONS.filter((a) => committeeAllowsRequestMove(rules, a)),
    });
    const table = Object.fromEntries([
      ...committee.stages.map((s) => [String(s.key), derive(rulesOf(s))]),
      // No live stage (D14): nothing allowed, no flags.
      ['null', derive({ actions: {}, flags: [] })],
    ]);
    // The old keyed map's answers (ACC-239), unchanged.
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
    expect(code(() => assertCommitteeStageAllows(DISSOLVING, 'approve'))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
    expect(code(() => assertCommitteeStageAllows(NOT_APPROVED, 'submit'))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise(DISSOLVING))).toBe('CHANGE_REQUEST_COMMITTEE_DISSOLVING');
    expect(code(() => assertCommitteeAllowsRaise(NOT_APPROVED))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise({ actions: {}, flags: [] }))).toBe('CHANGE_REQUEST_STAGE_NOT_ALLOWED');
    expect(code(() => assertCommitteeAllowsRaise(IN_FORCE))).toBe('OK');
  });

  it('an action is allowed only where BOTH stages allow it', () => {
    expect(stagesAllow('under_review', IN_FORCE, 'approve')).toBe(true);
    expect(stagesAllow('under_review', DISSOLVING, 'approve')).toBe(false);
    expect(stagesAllow('under_review', DISSOLVING, 'reject')).toBe(true);
    expect(stagesAllow('draft', IN_FORCE, 'approve')).toBe(false);
  });

  it('the derivation reads the stage\'s rules, never its name or key', () => {
    // A tenant stage that raises requests and is in force behaves as Active,
    // whatever it is called; one that is not flagged IN_FORCE cannot approve.
    expect(committeeAllowsRaise({ actions: { request_change: true }, flags: [] })).toBe(true);
    expect(committeeAllowsRequestMove({ actions: { request_change: true }, flags: [] }, 'approve')).toBe(false);
    expect(committeeAllowsRequestMove({ actions: {}, flags: ['IN_FORCE', 'DISSOLVING'] }, 'edit')).toBe(false);
  });

  it('each move lands in its own stage, and only a request under review awaits a decision', () => {
    // Approve is not here: its target is the stage flagged APPLIES_APPROVED_CHANGE (§4.3).
    expect(ACTION_TARGET_STAGE).toEqual({ submit: 'under_review', withdraw: 'withdrawn', return: 'returned', reject: 'rejected' });
    expect([...CHANGE_REQUEST_STAGE_KEYS, null].filter(awaitsDecision)).toEqual(['under_review']);
  });
});
