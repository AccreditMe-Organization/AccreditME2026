/**
 * ACC-194 — the ONE place a model is named, and the one table of how each AI
 * feature calls it.
 *
 * Confirmed against Anthropic's documentation on 12 Oct 2026
 * (platform.claude.com/docs: models overview, effort, thinking, the Sonnet 5.5
 * migration guide):
 *   - Claude Sonnet 5.5 is `claude-sonnet-5-5` ($2 / $10 per MTok), Opus 5.5
 *     `claude-opus-5-5`. The old hard-coded `claude-sonnet-4-6` is legacy.
 *   - Effort is `output_config.effort` (low | medium | high | xhigh | max), GA,
 *     no beta header. Sonnet 5.5 defaults to `high`, so every feature sets it.
 *   - Thinking is ON by default on the 5.x models, is billed as output and
 *     counts against `max_tokens`. Sonnet 5.5 rejects `thinking: disabled`, so
 *     no `thinking` field is sent; effort is the control.
 *   - A non-default `temperature`, `top_p` or `top_k` is a 400 on Sonnet 5.5,
 *     so none is ever sent.
 *   - `anthropic-version: 2023-06-01` is still the header.
 *
 * A caller picks a FEATURE, never a model: the feature has a tier, and the tier
 * a model (CLAUDE.md, AI Providers Per Tenant). Changing a model is an
 * environment variable, not code.
 */

import type { AiEffort } from '../../providers/ai/ai.provider';

export type { AiEffort };
export type AiTier = 'STANDARD' | 'PREMIUM';

/** Every feature that may call the model. A cost row alone is not enough. */
export const AI_FEATURE_KEYS = ['task_description_drafting', 'document_summary', 'morning_briefing'] as const;
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number];

export interface AiFeatureCallConfig {
  tier: AiTier;
  effort: AiEffort;
  /** Thinking plus the answer: a hard limit on output. */
  maxTokens: number;
  /** The input the feature may send. Enforced by the feature (ACC-193 for summaries). */
  inputTokenCap?: number;
}

export const AI_FEATURES: Readonly<Record<AiFeatureKey, AiFeatureCallConfig>> = {
  // ACC-197 — the input is bounded by construction: a note of at most 2,000
  // characters, a title, a record's name and 500 characters of its purpose.
  // draft-answer.spec.ts builds the worst case in Arabic and asserts it fits.
  task_description_drafting: { tier: 'STANDARD', effort: 'low', maxTokens: 2000, inputTokenCap: 3000 },
  document_summary: { tier: 'STANDARD', effort: 'medium', maxTokens: 4000, inputTokenCap: 30_000 },
  // ACC-198 (D13) — 4000, up from 3000: the answer is JSON (the lead plus up
  // to three focus picks with reasons), thinking counts against the same
  // limit, and a truncated JSON answer is unusable. Only a ceiling: the credit
  // price is flat.
  morning_briefing: { tier: 'STANDARD', effort: 'low', maxTokens: 4000 },
};

export const DEFAULT_ANTHROPIC_MODELS: Readonly<Record<AiTier, string>> = {
  STANDARD: 'claude-sonnet-5-5',
  PREMIUM: 'claude-opus-5-5',
};

const MODEL_ENV: Readonly<Record<AiTier, string>> = {
  STANDARD: 'ANTHROPIC_MODEL_STANDARD',
  PREMIUM: 'ANTHROPIC_MODEL_PREMIUM',
};

/** The model a tier runs on: the environment's override, else the default. */
export function resolveAnthropicModel(tier: AiTier, env: NodeJS.ProcessEnv = process.env): string {
  const override = env[MODEL_ENV[tier]]?.trim();
  return override ? override : DEFAULT_ANTHROPIC_MODELS[tier];
}

/**
 * AccreditMe's own platform key, or null. Tenants never bring a key (CLAUDE.md,
 * AI Providers Per Tenant); ACC-194 removed the per-tenant fallback. Null is
 * AI_PROVIDER_UNAVAILABLE — an empty key is never sent.
 */
export function platformAnthropicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env['ANTHROPIC_API_KEY']?.trim();
  return key ? key : null;
}

export function isAiFeatureKey(value: string): value is AiFeatureKey {
  return (AI_FEATURE_KEYS as readonly string[]).includes(value);
}
