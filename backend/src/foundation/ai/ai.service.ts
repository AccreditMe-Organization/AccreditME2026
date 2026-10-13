import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER, AiProvider, AiProviderCallError } from '../../providers/ai/ai.provider';
import { AI_FEATURES, AiFeatureKey, resolveAnthropicModel } from './ai.config';
import { AiCreditService, ReservedCredits } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';
import { AiRefusalException } from './ai-refusal';
import { AiNoticesService } from './ai-notices.service';
import { openAiFeatures } from './ai-balance';

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
  /**
   * ACC-193 (Q3) — opt-in. Called with the answer before anything is logged as
   * a success; returning false means the answer is UNUSABLE (empty, or cut short
   * by the output limit), and the gateway treats it exactly like a provider
   * failure: refunded into the same period, logged at cost 0, refused
   * AI_PROVIDER_FAILED. A feature that passes nothing is charged for any answer,
   * as before (the briefing, ACC-198).
   */
  accept?: (content: string, truncated: boolean) => boolean;
}

/** ACC-193 — the caller's accept() refused the answer. Refunded like a provider failure. */
export class AiUnusableAnswerError extends Error {
  constructor(
    readonly contentLength: number,
    readonly truncated: boolean,
    readonly inputTokens: number,
    readonly outputTokens: number,
  ) {
    super('The answer was unusable');
    this.name = 'AiUnusableAnswerError';
  }
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
 *      cost 0, refuse AI_PROVIDER_FAILED. A failed call costs nothing. An answer
 *      the caller's opt-in accept() rejects (ACC-193, Q3) is a failure too.
 *
 * The "credits used up" notice (D10) goes to the tenant admins once per credit
 * period, at the first of: a reservation that leaves less than the cheapest
 * feature open to the organisation (nothing can run any more), or the first
 * AI_CREDITS_EXHAUSTED refusal.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: AiCreditService,
    private readonly allocation: AiAllocationService,
    private readonly notices: AiNoticesService,
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
      if (request.accept && !request.accept(answer.content, answer.truncated)) {
        throw new AiUnusableAnswerError(answer.content.length, answer.truncated, answer.inputTokens, answer.outputTokens);
      }
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
      await this.noticeIfNothingCanRun(organizationId, reserved);
      return {
        content: answer.content,
        creditCost: price.creditCost,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        truncated: answer.truncated,
      };
    } catch (error) {
      const refunded = await this.credits.refund(organizationId, price.creditCost, reserved.periodStart);
      const unusable = error instanceof AiUnusableAnswerError ? error : null;
      const why =
        error instanceof AiProviderCallError
          ? `${error.status ?? 'no response'} ${error.kind}`
          : unusable
            ? `unusable answer${unusable.truncated ? ', stopped at the output limit' : ''}`
            : (error as Error).name;
      this.logger.warn(
        `AI call failed for org ${organizationId}, feature ${featureKey} (${why}); ${refunded ? 'credits refunded' : 'period already renewed, nothing to refund'}.`,
      );
      await this.log({
        organizationId,
        actorId,
        model,
        featureKey,
        promptSummary: `${featureKey} · ${request.description} · ${request.prompt.length} characters in`,
        // Counts only, as on a success: never the answer's text (D5).
        responseSummary: unusable ? `unusable: ${unusable.contentLength} characters out${unusable.truncated ? ' (stopped at the output limit)' : ''}` : null,
        durationMs: Date.now() - startedAt,
        success: false,
        creditCost: 0,
        tier: feature.tier,
        inputTokens: unusable ? unusable.inputTokens : null,
        outputTokens: unusable ? unusable.outputTokens : null,
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
    if (state.periodStart) await this.sendUsedUpNotice(organizationId, state.periodStart, state.renewsAt);
    throw new AiRefusalException('AI_CREDITS_EXHAUSTED', {
      creditCost: cost,
      creditsRemaining: Math.max(0, state.allocation - state.used),
      renewsAt: state.renewsAt.toISOString(),
    });
  }

  /** After a successful reservation: if no open feature fits in what is left, the period is spent. */
  private async noticeIfNothingCanRun(organizationId: string, reserved: ReservedCredits): Promise<void> {
    try {
      const remaining = reserved.allocation - reserved.used;
      const open = await openAiFeatures(this.prisma, organizationId);
      if (open.length === 0) return;
      const cheapest = Math.min(...open.map((f) => f.creditCost));
      if (remaining < cheapest) await this.sendUsedUpNotice(organizationId, reserved.periodStart, reserved.renewsAt);
    } catch (error) {
      this.logger.error(`The AI credits notice check failed for org ${organizationId}: ${(error as Error).message}`);
    }
  }

  /** Once per period: only the call that claims the period's stamp sends. Never throws. */
  private async sendUsedUpNotice(organizationId: string, periodStart: Date, renewsAt: Date): Promise<void> {
    try {
      if (await this.credits.claimNotice(organizationId, periodStart)) {
        await this.notices.creditsUsedUp(organizationId, renewsAt);
      }
    } catch (error) {
      this.logger.error(`The "AI credits used up" notice failed for org ${organizationId}: ${(error as Error).message}`);
    }
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
