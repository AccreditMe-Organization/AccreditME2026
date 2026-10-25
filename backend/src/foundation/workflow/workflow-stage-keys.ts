import type { WorkflowObjectType } from '../../../generated/prisma/client';

/**
 * ACC-233 — stable keys for SEEDED workflow stages (`WorkflowStage.key`).
 *
 * A stage's name and order belong to the tenant, who may change both, so code
 * that has to recognise a stage ("is this committee being dissolved?") reads
 * its key instead. A key is the seed's own (`workflow.seed.ts`), unique within
 * one workflow, never shown and never editable.
 *
 * Since ACC-255 PR 2 no committee rule is decided by a key; see below.
 *
 * Only the templates listed here carry keys today. The seed writes them for a
 * new organisation, and `npm run backfill:acc233-committee-stage-keys` wrote
 * them for existing ones. A template is added here when a feature first needs
 * to recognise one of its stages, together with a backfill for it.
 */
export const KEYED_SEED_TEMPLATES: ReadonlySet<WorkflowObjectType> = new Set<WorkflowObjectType>([
  'COMMITTEE',
  // ACC-239 — keyed from its first seed: code recognises every stage of it.
  'COMMITTEE_CHANGE_REQUEST',
]);

/** Every stage of the committee lifecycle, by the seed's key. */
export const COMMITTEE_STAGE_KEYS = [
  'formation',
  'terms_review',
  'active',
  'suspended',
  'dissolution_pending',
  'dissolved',
] as const;

export type CommitteeStageKey = (typeof COMMITTEE_STAGE_KEYS)[number];

// ACC-255 PR 2 — nothing decides by a COMMITTEE stage key any more. What a
// committee's stage allows, and whether it is dissolving or in force, is the
// stage's own configuration (WorkflowStageRecordAction, WorkflowStage.flags),
// read through StageRulesService. These keys remain for the seed and the
// backfills; the transition precondition (quorum out of Formation, D10) is the
// one rule still keyed. committee-stage-keys.scan.spec.ts fails on any other.

/**
 * ACC-239 — every stage of a committee change request, by the seed's key. Its
 * state IS its stage key: there is no status column (ACC-82).
 */
export const CHANGE_REQUEST_STAGE_KEYS = ['draft', 'under_review', 'returned', 'approved', 'rejected', 'withdrawn'] as const;

export type ChangeRequestStageKey = (typeof CHANGE_REQUEST_STAGE_KEYS)[number];

// What each request stage ALLOWS a change request to do (keyed: the template
// is protected, ACC-255 D7), and what the committee's stored stage rules let an
// open request do, are its policy, in one place:
// committees/change-requests/change-request-policy.ts.

/**
 * ACC-239 — templates whose SHAPE is fixed, because code runs them: tenants may
 * rename a stage and set its deadline, nothing else (Ahmad, 18 Oct, Q15). No
 * stage is added or removed, no transition changed, and the seeded template is
 * never replaced, switched to another default or deactivated. Added review
 * stages are ACC-245.
 */
export const PROTECTED_TEMPLATES: ReadonlySet<WorkflowObjectType> = new Set<WorkflowObjectType>(['COMMITTEE_CHANGE_REQUEST']);
