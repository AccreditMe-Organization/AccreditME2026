import { Injectable } from '@nestjs/common';
import {
  AiCompletionOptions,
  AiCompletionResult,
  AiProvider,
} from './ai.provider';

interface AnthropicMessage {
  id: string;
  model: string;
  content: Array<{ type: string; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

@Injectable()
export class AnthropicAiProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly defaultModel = 'claude-sonnet-4-6';
  private readonly apiUrl = 'https://api.anthropic.com/v1/messages';

  constructor() {
    this.apiKey = process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  async complete(
    prompt: string,
    options: AiCompletionOptions = {},
  ): Promise<AiCompletionResult> {
    const model = options.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      max_tokens: options.maxTokens ?? 4096,
      messages: [{ role: 'user', content: prompt }],
    };

    if (options.systemPrompt) {
      body['system'] = options.systemPrompt;
    }
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${error}`);
    }

    const data = (await response.json()) as AnthropicMessage;
    const text = data.content.find((c) => c.type === 'text')?.text ?? '';

    return {
      content: text,
      model: data.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    };
  }
}
