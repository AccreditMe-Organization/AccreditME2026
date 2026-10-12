import { AiFeatureKey } from './ai.config';

/**
 * ACC-194 — the three priced AI features for users' first features (Ahmad,
 * 12 Oct, D4), and the organisation the morning briefing is restricted to.
 * Applied by `npm run seed:ai-feature-costs` (prisma/seed-ai-feature-costs.ts),
 * AFTER the deploy, dry run first.
 */
export interface AiFeatureCostSeed {
  featureKey: AiFeatureKey;
  creditCost: number;
  description: string;
  /** Restricted to the organisation with this slug (D17). Absent = open to every organisation. */
  restrictedToSlug?: string;
}

export const AI_FEATURE_COST_SEED: readonly AiFeatureCostSeed[] = [
  {
    featureKey: 'task_description_drafting',
    creditCost: 2,
    description: 'AI drafts a task description from a short note (ACC-197).',
  },
  {
    featureKey: 'document_summary',
    creditCost: 15,
    description: 'AI summary of an attached document; input capped at 30,000 tokens (ACC-193).',
  },
  {
    featureKey: 'morning_briefing',
    creditCost: 5,
    description: 'AI morning briefing, on demand from a tenant admin, per run (ACC-198). al-nakheel only, for demos.',
    restrictedToSlug: 'al-nakheel',
  },
];

export type AiFeatureCostSeedAction =
  | { kind: 'keep'; featureKey: string; reason: string }
  | {
      kind: 'create';
      featureKey: string;
      creditCost: number;
      description: string;
      restricted: boolean;
      allowedOrganizationIds: string[];
      warning?: string;
    };

/**
 * What the seed would do. It CREATES a row only when none exists and NEVER
 * overwrites one (D12): an edited cost or restriction stays as someone set it.
 * A restricted feature whose organisation cannot be found is still created
 * restricted, with an empty list — open to nobody — never unrestricted.
 */
export function planAiFeatureCostSeed(
  existingKeys: ReadonlySet<string>,
  organizationIdBySlug: ReadonlyMap<string, string>,
  seed: readonly AiFeatureCostSeed[] = AI_FEATURE_COST_SEED,
): AiFeatureCostSeedAction[] {
  return seed.map((row): AiFeatureCostSeedAction => {
    if (existingKeys.has(row.featureKey)) {
      return { kind: 'keep', featureKey: row.featureKey, reason: 'a row exists; the seed never overwrites it' };
    }
    if (!row.restrictedToSlug) {
      return { kind: 'create', featureKey: row.featureKey, creditCost: row.creditCost, description: row.description, restricted: false, allowedOrganizationIds: [] };
    }
    const id = organizationIdBySlug.get(row.restrictedToSlug);
    return {
      kind: 'create',
      featureKey: row.featureKey,
      creditCost: row.creditCost,
      description: row.description,
      restricted: true,
      allowedOrganizationIds: id ? [id] : [],
      ...(id ? {} : { warning: `organisation "${row.restrictedToSlug}" not found — created restricted and open to nobody` }),
    };
  });
}
