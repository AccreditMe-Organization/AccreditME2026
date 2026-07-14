// AiProvider interface — all AI implementations must satisfy this contract.
//
// Pattern: AI suggests → human reviews → human approves → recorded in audit trail.
// The caller always receives AiCompletionResult to present to a human for review.
// AI output is NEVER auto-saved or acted upon without explicit human approval.
// Every call site must log: actor, model, prompt summary, response summary, timestamp.

export interface AiCompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AiCompletionResult {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  complete(
    prompt: string,
    options?: AiCompletionOptions,
  ): Promise<AiCompletionResult>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
