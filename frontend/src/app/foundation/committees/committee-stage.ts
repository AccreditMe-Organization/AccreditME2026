/**
 * ACC-238 — what the committee page's header offers, by the committee's
 * current stage KEY (`WorkflowStage.key`, ACC-233), never by a stage name,
 * which the tenant may change. The server gives the key on
 * GET /committees/:id; a stage a tenant added has none and is offered nothing.
 *
 *   formation           Edit (the three-tab dialog), with committees:edit_details.
 *   terms_review        No Edit. Holders of committees:edit_details see the
 *                       locked line; Revise Terms (a seeded RETURN transition)
 *                       sends the committee back to Formation.
 *   active, suspended   No Edit. "Request a change" arrives with ACC-240.
 *   dissolution_pending,
 *   dissolved, or none  Nothing new.
 *
 * The header's transition buttons are not decided here: they stay as the live
 * workflow renders them (WorkflowTransitionActionsComponent).
 *
 * Until ACC-241 the API still accepts a direct edit in any stage; this is the
 * screens' half of the rule only.
 */


/**
 * The seeded committee lifecycle's keys, as the backend's workflow-stage-keys.ts
 * lists them — for specs that walk every stage. Nothing in the app branches on
 * this list to decide anything; a screen asks committeeHeaderOffers().
 */
export const COMMITTEE_STAGE_KEYS_FOR_TEST = [
  'formation',
  'terms_review',
  'active',
  'suspended',
  'dissolution_pending',
  'dissolved',
] as const;

export interface CommitteeHeaderOffers {
  /** The Edit button. */
  edit: boolean;
  /** "Locked while the terms are under review. Revise Terms to change it." */
  lockedLine: boolean;
}

type CommitteeStageKey = (typeof COMMITTEE_STAGE_KEYS_FOR_TEST)[number];

/**
 * ACC-239 — THE header rule, as one map keyed by stage key: what each stage
 * offers to a holder of committees:edit_details. A stage not listed here, or
 * one with no key, offers nothing. A later workflow-engine step makes stage
 * permissions configurable; it replaces this map, and nothing else on the
 * screens names a committee stage.
 */
export const COMMITTEE_HEADER_POLICY: Readonly<Partial<Record<CommitteeStageKey, Partial<CommitteeHeaderOffers>>>> = {
  formation: { edit: true },
  terms_review: { lockedLine: true },
};

export function committeeHeaderOffers(stageKey: string | null | undefined, canEditDetails: boolean): CommitteeHeaderOffers {
  const offers = (stageKey && COMMITTEE_HEADER_POLICY[stageKey as CommitteeStageKey]) || {};
  return {
    edit: canEditDetails && !!offers.edit,
    lockedLine: canEditDetails && !!offers.lockedLine,
  };
}
