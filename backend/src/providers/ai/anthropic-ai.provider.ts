import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  decryptTenantConfig,
  getEncryptionKey,
} from '../../common/utils/tenant-config-crypto';
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

interface DecryptedAiConfig {
  apiKey?: string;
}

const PROMPT_SUMMARY_LENGTH = 200;
const RESPONSE_SUMMARY_LENGTH = 200;

@Injectable()
export class AnthropicAiProvider implements AiProvider {
  private readonly defaultModel = 'claude-sonnet-4-6';
  private readonly apiUrl = 'https://api.anthropic.com/v1/messages';
  private readonly encryptionKey = getEncryptionKey();

  constructor(private readonly prisma: PrismaService) {}

  async complete(
    prompt: string,
    organizationId: string,
    options: AiCompletionOptions = {},
  ): Promise<AiCompletionResult> {
    const model = options.model ?? this.defaultModel;
    const feature = options.feature ?? 'unknown';
    const startedAt = Date.now();

    try {
      const apiKey = await this.resolveApiKey(organizationId);

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
          'x-api-key': apiKey,
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

      const result: AiCompletionResult = {
        content: text,
        model: data.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      };

      await this.logInteraction({
        organizationId,
        actorId: options.actorId,
        model: data.model,
        feature,
        promptSummary: prompt.slice(0, PROMPT_SUMMARY_LENGTH),
        responseSummary: text.slice(0, RESPONSE_SUMMARY_LENGTH),
        durationMs: Date.now() - startedAt,
        success: true,
      });

      return result;
    } catch (error) {
      await this.logInteraction({
        organizationId,
        actorId: options.actorId,
        model,
        feature,
        promptSummary: prompt.slice(0, PROMPT_SUMMARY_LENGTH),
        responseSummary: null,
        durationMs: Date.now() - startedAt,
        success: false,
      });
      throw error;
    }
  }

  // Tenant's own key (from encrypted aiConfig) takes priority; falls back to
  // the shared platform key when the tenant has not configured their own.
  private async resolveApiKey(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: { aiConfig: true },
    });

    if (org?.aiConfig) {
      const decrypted = decryptTenantConfig(org.aiConfig, this.encryptionKey);
      const config = JSON.parse(decrypted) as DecryptedAiConfig;
      if (config.apiKey) return config.apiKey;
    }

    return process.env['ANTHROPIC_API_KEY'] ?? '';
  }

  private async logInteraction(entry: {
    organizationId: string;
    actorId?: string;
    model: string;
    feature: string;
    promptSummary: string;
    responseSummary: string | null;
    durationMs: number;
    success: boolean;
  }): Promise<void> {
    await this.prisma.aiInteractionLog.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId ?? null,
        model: entry.model,
        feature: entry.feature,
        promptSummary: entry.promptSummary,
        responseSummary: entry.responseSummary,
        durationMs: entry.durationMs,
        success: entry.success,
      },
    });
  }
}
