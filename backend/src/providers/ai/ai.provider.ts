// AiProvider — the contract every model provider satisfies (ACC-194).
//
// A provider ONLY makes the call. It knows nothing about tenants, credits,
// logging or which model a feature should use: the gateway
// (foundation/ai/ai.service.ts) decides all of that, and is the only thing
// allowed to inject AI_PROVIDER (enforced by `npm run check:ai-gateway`).
// Keeping this contract provider-neutral is what lets a customer-hosted,
// OpenAI-compatible provider slot in later without touching the gateway
// (ACC-194 plan §16).
//
// Pattern: AI suggests → human reviews → human approves → recorded in audit
// trail. The caller presents the result to a human; nothing is auto-saved.

/** How much the model may think and write (Anthropic `output_config.effort`). */
export type AiEffort = 'low' | 'medium' | 'high';

/** The provider values of the AiProvider enum (schema.prisma). */
export type AiProviderName = 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';

export interface AiProviderRequest {
  model: string;
  prompt: string;
  system?: string;
  /** Thinking plus the answer: a hard limit on output. */
  maxTokens: number;
  effort: AiEffort;
}

export interface AiProviderResult {
  content: string;
  /** The model the provider reports it used. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The answer stopped at maxTokens. */
  truncated: boolean;
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** Whether a call can be made at all (a platform key exists). Checked before credits are reserved. */
  isConfigured(): boolean;
  complete(request: AiProviderRequest): Promise<AiProviderResult>;
}

/**
 * A provider call that did not produce an answer. Carries the HTTP status and
 * the provider's error TYPE only — never its response body, which may echo
 * what was sent.
 */
export class AiProviderCallError extends Error {
  constructor(
    readonly status: number | null,
    readonly kind: string,
  ) {
    super(`AI provider call failed (${status ?? 'no response'}: ${kind})`);
    this.name = 'AiProviderCallError';
  }
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
