import { PrismaService } from '../../prisma/prisma.service';
import { aiBalanceOf, openAiFeatures } from './ai-balance';
import type { AiNotEnabledReason } from './ai-refusal';
import type { AiFeatureKey } from './ai.config';

/**
 * ACC-197 — "may this organisation use this AI feature right now?", asked
 * BEFORE a person presses anything, so a screen can hide a trigger it could
 * only refuse. One function: the document summary (ACC-193) and the briefing
 * (ACC-198) each carried a private copy, and task drafting would have been the
 * third.
 *
 * It decides exactly what the gateway decides before it reserves
 * (AiService.run): the feature is open to the organisation, there is an
 * allowance, and AI is not switched off. It does NOT look at the balance: a
 * feature whose credits have run out is still "available", and the press
 * answers AI_CREDITS_EXHAUSTED with the renewal date.
 *
 * `creditCost` is the feature's price whenever its row is open to the
 * organisation, available or not; null when it is not.
 */
export type AiFeatureAvailability =
  | { available: true; creditCost: number }
  | { available: false; reason: AiNotEnabledReason; creditCost: number | null };

export async function aiFeatureAvailability(
  prisma: Pick<PrismaService, 'organization' | 'aiFeatureCost'>,
  organizationId: string,
  featureKey: AiFeatureKey,
): Promise<AiFeatureAvailability> {
  return (await aiFeaturesAvailability(prisma, organizationId, [featureKey]))[featureKey];
}

/**
 * ACC-322 — the same answer for several features at once, in a FIXED number of
 * queries whatever the number of keys: one organisation read and one
 * openAiFeatures(). A page offering several AI features (the meeting page) asks
 * once, never once per feature. The single-key form above calls this.
 */
export async function aiFeaturesAvailability<K extends AiFeatureKey>(
  prisma: Pick<PrismaService, 'organization' | 'aiFeatureCost'>,
  organizationId: string,
  featureKeys: readonly K[],
): Promise<Record<K, AiFeatureAvailability>> {
  const [org, features] = await Promise.all([
    prisma.organization.findFirst({
      where: { id: organizationId },
      select: {
        aiMonthlyCredits: true,
        aiPendingMonthlyCredits: true,
        aiCreditsUsed: true,
        aiCreditsPeriodStart: true,
        aiCreditsRenewsAt: true,
        bootstrappedAt: true,
        createdAt: true,
        settings: true,
      },
    }),
    openAiFeatures(prisma, organizationId),
  ]);
  const balance = org ? aiBalanceOf(org) : null;
  const out = {} as Record<K, AiFeatureAvailability>;
  for (const key of featureKeys) {
    const feature = features.find((f) => f.key === key);
    if (!balance || !feature) out[key] = { available: false, reason: 'FEATURE_NOT_AVAILABLE', creditCost: null };
    else if (!balance.enabled) out[key] = { available: false, reason: balance.monthlyCredits > 0 ? 'SWITCHED_OFF' : 'NO_ALLOWANCE', creditCost: feature.creditCost };
    else out[key] = { available: true, creditCost: feature.creditCost };
  }
  return out;
}
