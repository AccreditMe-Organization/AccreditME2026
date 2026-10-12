import { Injectable } from '@nestjs/common';
import { platformAnthropicKey } from '../../foundation/ai/ai.config';
import { AiProvider, AiProviderCallError, AiProviderRequest, AiProviderResult } from './ai.provider';

interface AnthropicMessage {
  model: string;
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 120_000;

/**
 * Anthropic's Messages API — ACC-194.
 *
 * Only AccreditMe's platform key (ANTHROPIC_API_KEY) is ever used. Tenants
 * never bring a key (CLAUDE.md, AI Providers Per Tenant); the per-tenant
 * fallback that read Organization.aiConfig was removed with ACC-194, because a
 * tenant key would also have bypassed metering. The column is left untouched
 * (no organisation had one) and is dropped in a later contract step.
 *
 * The request follows Anthropic's documentation as confirmed on 12 Oct 2026
 * (see foundation/ai/ai.config.ts): effort is `output_config.effort`; no
 * `thinking` field is sent (it is on by default and Sonnet 5.5 rejects
 * `disabled`); no `temperature`, `top_p` or `top_k` is sent (a non-default
 * value is a 400 on Sonnet 5.5). Thinking blocks come back with empty text and
 * are skipped; the answer is the text blocks joined.
 */
@Injectable()
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'ANTHROPIC' as const;

  isConfigured(): boolean {
    return platformAnthropicKey() !== null;
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResult> {
    const apiKey = platformAnthropicKey();
    if (!apiKey) throw new AiProviderCallError(null, 'not_configured');

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: { effort: request.effort },
    };
    if (request.system) body['system'] = request.system;

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new AiProviderCallError(null, (error as Error).name === 'TimeoutError' ? 'timeout' : 'network');
    }

    if (!response.ok) {
      // The error TYPE only (e.g. rate_limit_error, overloaded_error) — never
      // the body text.
      let kind = 'http_error';
      try {
        const parsed = (await response.json()) as { error?: { type?: unknown } };
        if (typeof parsed.error?.type === 'string') kind = parsed.error.type;
      } catch {
        /* not JSON */
      }
      throw new AiProviderCallError(response.status, kind);
    }

    const data = (await response.json()) as AnthropicMessage;
    if (data.stop_reason === 'refusal') throw new AiProviderCallError(response.status, 'refusal');

    const content = data.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');

    return {
      content,
      model: data.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      truncated: data.stop_reason === 'max_tokens',
    };
  }
}
