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
export const KEYED_SEED_TEMPLATES: ReadonlySet<WorkflowObjectType> = new Set<WorkflowObjectType>(['COMMITTEE']);

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
