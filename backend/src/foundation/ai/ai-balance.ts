import { PrismaService } from '../../prisma/prisma.service';
import { activationOf, creditPeriodAt } from './ai-credit-period';
import { aiSwitchedOff } from './ai-credit.service';
import { isAiFeatureKey } from './ai.config';

/** The Organization columns an AI balance is read from (ACC-194). */
export interface AiBalanceSource {
  aiMonthlyCredits: number;
  aiPendingMonthlyCredits: number | null;
  aiCreditsUsed: number;
  aiCreditsPeriodStart: Date | null;
  aiCreditsRenewsAt: Date | null;
  bootstrappedAt: Date | null;
  createdAt: Date;
  settings: unknown;
}

/** A feature this organisation may use, and its price. */
export interface IAiFeatureOpen {
  key: string;
  creditCost: number;
}

/**
 * The AI balance as GET /tenant and the platform tenant detail show it — the
 * shape the AI credits screens already read, now from the dedicated columns
 * (ACC-194). The old settings.ai counters are ignored everywhere.
 */
export interface IAiBalance {
  /** Effective (D13): an allocation AND not switched off. */
  enabled: boolean;
  monthlyCredits: number;
  creditsUsed: number;
  creditsRemaining: number;
  /** When the current period renews (ISO), or null with no period. */
  resetDate: string | null;
  /** Always false: overage stays off (D9). Kept so existing clients do not break. */
  overageEnabled: false;
  /** A lower allocation waiting for the next renewal, or null. */
  pendingMonthlyCredits: number | null;
  /** When the current period began (ISO), or null. */
  periodStart: string | null;
}

/**
 * Read live: a period whose renewal time has passed is shown as the period
 * it renews into — nothing used, the waiting allocation applied — whether or
 * not the hourly job has stored it yet (ACC-82: what a person reads resolves
 * live).
 */
export function aiBalanceOf(org: AiBalanceSource, now: Date = new Date()): IAiBalance {
  let allocation = org.aiMonthlyCredits;
  let pending = org.aiPendingMonthlyCredits;
  let used = org.aiCreditsUsed;
  let periodStart = org.aiCreditsPeriodStart;
  let renewsAt = org.aiCreditsRenewsAt;

  if (renewsAt && renewsAt.getTime() <= now.getTime()) {
    const period = creditPeriodAt(activationOf(org), now);
    allocation = pending ?? allocation;
    pending = null;
    used = 0;
    periodStart = period.start;
    renewsAt = period.renewsAt;
  }

  return {
    enabled: allocation > 0 && !aiSwitchedOff(org.settings),
    monthlyCredits: allocation,
    creditsUsed: used,
    creditsRemaining: Math.max(0, allocation - used),
    resetDate: renewsAt ? renewsAt.toISOString() : null,
    overageEnabled: false,
    pendingMonthlyCredits: pending,
    periodStart: periodStart ? periodStart.toISOString() : null,
  };
}

/**
 * The priced features open to this organisation (D17): every feature the
 * gateway can call that is not restricted, or is restricted and lists it. A
 * tenant only ever sees its own entries, never who else a feature is open to.
 */
export async function openAiFeatures(
  prisma: Pick<PrismaService, 'aiFeatureCost'>,
  organizationId: string,
): Promise<IAiFeatureOpen[]> {
  const rows = await prisma.aiFeatureCost.findMany({
    select: { featureKey: true, creditCost: true, restricted: true, allowedOrganizationIds: true },
    orderBy: { featureKey: 'asc' },
  });
  return rows
    .filter((r) => isAiFeatureKey(r.featureKey))
    .filter((r) => !r.restricted || r.allowedOrganizationIds.includes(organizationId))
    .map((r) => ({ key: r.featureKey, creditCost: r.creditCost }));
}
