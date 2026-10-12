import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER, AiProvider, AiProviderCallError } from '../../providers/ai/ai.provider';
import { AI_FEATURES, AiFeatureKey, resolveAnthropicModel } from './ai.config';
import { AiCreditService, ReservedCredits } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';
import { AiRefusalException } from './ai-refusal';

export interface AiRunContext {
  organizationId: string;
  actorId?: string;
}

export interface AiRunRequest {
  prompt: string;
  system?: string;
  /**
   * A short description WRITTEN BY THE CALLER for the log — what was asked, of
   * which record — e.g. "StoredFile cmv… summary". Never the customer's text:
   * the log keeps no prompt or answer (ACC-194, D5).
   */
  description: string;
}

export interface AiRunResult {
  content: string;
  creditCost: number;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
}

/**
 * ACC-194 — THE gateway. Every AI call in the product goes through run(); it
 * is the only consumer of AI_PROVIDER (`npm run check:ai-gateway`), so no
 * feature can call a model without being priced, switched on and metered.
 *
 * The order, and why each step sits where it does:
 *   1. The feature's cost row. None → AI_FEATURE_NOT_PRICED: an unpriced
 *      feature is never free.
 *   2. The feature switch (D17). A restricted feature this organisation is not
 *      listed for → AI_NOT_ENABLED / FEATURE_NOT_AVAILABLE.
 *   3. The provider is configured (a platform key). Checked BEFORE reserving,
 *      so a call that cannot happen costs nothing (Railway today).
 *   4. Reserve the credits — one conditional UPDATE. A due period is renewed
 *      inline and the reservation retried once, so the decision never waits
 *      for the hourly job (ACC-82: what a person's request decides on
 *      resolves live).
 *   5. Call the provider.
 *   6. Success: log with the cost.
 *   7. Failure: refund — only into the period the credits came from — log with
 *      cost 0, refuse AI_PROVIDER_FAILED. A failed call costs nothing.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: AiCreditService,
    private readonly allocation: AiAllocationService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async run(featureKey: AiFeatureKey, context: AiRunContext, request: AiRunRequest): Promise<AiRunResult> {
    const { organizationId, actorId } = context;
    const feature = AI_FEATURES[featureKey];

    const price = await this.prisma.aiFeatureCost.findUnique({ where: { featureKey } });
    if (!price) {
      this.logger.error(`AI feature "${featureKey}" has no AiFeatureCost row; refused (org ${organizationId}).`);
      throw new AiRefusalException('AI_FEATURE_NOT_PRICED', { feature: featureKey });
    }
    if (price.restricted && !price.allowedOrganizationIds.includes(organizationId)) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: 'FEATURE_NOT_AVAILABLE', feature: featureKey });
    }
    if (!this.provider.isConfigured()) {
      throw new AiRefusalException('AI_PROVIDER_UNAVAILABLE');
    }

    const now = new Date();
    const reserved = await this.reserve(organizationId, price.creditCost, now, featureKey);

    const model = resolveAnthropicModel(feature.tier);
    const startedAt = Date.now();
    try {
      const answer = await this.provider.complete({
        model,
        prompt: request.prompt,
        system: request.system,
        maxTokens: feature.maxTokens,
        effort: feature.effort,
      });
      await this.log({
        organizationId,
        actorId,
        model: answer.model,
        featureKey,
        promptSummary: `${featureKey} · ${request.description} · ${request.prompt.length} characters in`,
        responseSummary: `${answer.content.length} characters out${answer.truncated ? ' (stopped at the output limit)' : ''}`,
        durationMs: Date.now() - startedAt,
        success: true,
        creditCost: price.creditCost,
        tier: feature.tier,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
      });
      return {
        content: answer.content,
        creditCost: price.creditCost,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        truncated: answer.truncated,
      };
    } catch (error) {
      const refunded = await this.credits.refund(organizationId, price.creditCost, reserved.periodStart);
      const why = error instanceof AiProviderCallError ? `${error.status ?? 'no response'} ${error.kind}` : (error as Error).name;
      this.logger.warn(
        `AI call failed for org ${organizationId}, feature ${featureKey} (${why}); ${refunded ? 'credits refunded' : 'period already renewed, nothing to refund'}.`,
      );
      await this.log({
        organizationId,
        actorId,
        model,
        featureKey,
        promptSummary: `${featureKey} · ${request.description} · ${request.prompt.length} characters in`,
        responseSummary: null,
        durationMs: Date.now() - startedAt,
        success: false,
        creditCost: 0,
        tier: feature.tier,
        inputTokens: null,
        outputTokens: null,
      });
      throw new AiRefusalException('AI_PROVIDER_FAILED');
    }
  }

  private async reserve(organizationId: string, cost: number, now: Date, featureKey: AiFeatureKey): Promise<ReservedCredits> {
    let reserved = await this.credits.reserve(organizationId, cost, now);
    if (!reserved) {
      const state = await this.credits.state(organizationId);
      if (state?.renewsAt && state.renewsAt.getTime() <= now.getTime()) {
        await this.allocation.renewIfDue(organizationId, now);
        reserved = await this.credits.reserve(organizationId, cost, now);
      }
    }
    if (reserved) return reserved;

    const state = await this.credits.state(organizationId);
    if (!state || state.allocation <= 0) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: 'NO_ALLOWANCE', feature: featureKey });
    }
    if (state.switchedOff) {
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: 'SWITCHED_OFF', feature: featureKey });
    }
    if (!state.renewsAt) {
      // An allocation with no period should not exist (setAllocation always
      // sets one up). Refuse as no allowance rather than guess.
      this.logger.warn(`Org ${organizationId} has an AI allocation but no credit period; refused.`);
      throw new AiRefusalException('AI_NOT_ENABLED', { reason: 'NO_ALLOWANCE', feature: featureKey });
    }
    throw new AiRefusalException('AI_CREDITS_EXHAUSTED', {
      creditCost: cost,
      creditsRemaining: Math.max(0, state.allocation - state.used),
      renewsAt: state.renewsAt.toISOString(),
    });
  }

  /** Writes the log row. A failure to log is reported and never fails the call. */
  private async log(entry: {
    organizationId: string;
    actorId?: string;
    model: string;
    featureKey: AiFeatureKey;
    promptSummary: string;
    responseSummary: string | null;
    durationMs: number;
    success: boolean;
    creditCost: number;
    tier: string;
    inputTokens: number | null;
    outputTokens: number | null;
  }): Promise<void> {
    try {
      await this.prisma.aiInteractionLog.create({
        data: {
          organizationId: entry.organizationId,
          actorId: entry.actorId ?? null,
          model: entry.model,
          feature: entry.featureKey,
          promptSummary: entry.promptSummary,
          responseSummary: entry.responseSummary,
          durationMs: entry.durationMs,
          success: entry.success,
          creditCost: entry.creditCost,
          provider: this.provider.name,
          tier: entry.tier,
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
        },
      });
    } catch (error) {
      this.logger.error(`AiInteractionLog write failed for org ${entry.organizationId}: ${(error as Error).message}`);
    }
  }
}
