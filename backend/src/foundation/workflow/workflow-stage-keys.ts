import type { WorkflowObjectType } from '../../../generated/prisma/client';

/**
 * ACC-233 — stable keys for SEEDED workflow stages (`WorkflowStage.key`).
 *
 * A stage's name and order belong to the tenant, who may change both, so code
 * that has to recognise a stage ("is this committee being dissolved?") reads
 * its key instead. A key is the seed's own (`workflow.seed.ts`), unique within
 * one workflow, never shown and never editable.
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

/** A committee in one of these stages is being dissolved, or has been. */
export const COMMITTEE_DISSOLVING_STAGE_KEYS: ReadonlySet<string> = new Set<CommitteeStageKey>([
  'dissolution_pending',
  'dissolved',
]);

/** Whether a stage key says the committee is dissolving or dissolved. A null key never does. */
export function isDissolvingStageKey(key: string | null | undefined): boolean {
  return !!key && COMMITTEE_DISSOLVING_STAGE_KEYS.has(key);
}

/**
 * ACC-239 — every stage of a committee change request, by the seed's key. Its
 * state IS its stage key: there is no status column (ACC-82).
 */
export const CHANGE_REQUEST_STAGE_KEYS = ['draft', 'under_review', 'returned', 'approved', 'rejected', 'withdrawn'] as const;

export type ChangeRequestStageKey = (typeof CHANGE_REQUEST_STAGE_KEYS)[number];

/** A request in one of these may be edited and submitted by its requester (Returned behaves like Draft). */
export const CHANGE_REQUEST_EDITABLE_KEYS: ReadonlySet<string> = new Set<ChangeRequestStageKey>(['draft', 'returned']);

/** A request in one of these is closed: decided, or withdrawn. */
export const CHANGE_REQUEST_CLOSED_KEYS: ReadonlySet<string> = new Set<ChangeRequestStageKey>(['approved', 'rejected', 'withdrawn']);

/**
 * Whether a request is open — anything not closed, so a stage with no key
 * counts as open (fail safe: one open request per committee is never
 * bypassed by an unrecognised stage).
 */
export function isOpenChangeRequestKey(key: string | null | undefined): boolean {
  return !key || !CHANGE_REQUEST_CLOSED_KEYS.has(key);
}

/** The committee stages in which a change request may be raised (Ahmad, 18 Oct). */
export const CHANGE_REQUEST_COMMITTEE_STAGE_KEYS: ReadonlySet<string> = new Set<CommitteeStageKey>(['active', 'suspended']);

/**
 * ACC-239 — templates whose SHAPE is fixed, because code runs them: tenants may
 * rename a stage and set its deadline, nothing else (Ahmad, 18 Oct, Q15). No
 * stage is added or removed, no transition changed, and the seeded template is
 * never replaced, switched to another default or deactivated. Added review
 * stages are ACC-245.
 */
export const PROTECTED_TEMPLATES: ReadonlySet<WorkflowObjectType> = new Set<WorkflowObjectType>(['COMMITTEE_CHANGE_REQUEST']);
