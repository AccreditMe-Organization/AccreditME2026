import { HttpStatus } from '@nestjs/common';
import {
  AI_FEATURES,
  AI_FEATURE_KEYS,
  DEFAULT_ANTHROPIC_MODELS,
  isAiFeatureKey,
  platformAnthropicKey,
  resolveAnthropicModel,
} from './ai.config';
import { AiRefusalException } from './ai-refusal';

describe('ai.config (ACC-194)', () => {
  it('Standard runs on claude-sonnet-5-5 unless the environment overrides it (D6)', () => {
    expect(DEFAULT_ANTHROPIC_MODELS.STANDARD).toBe('claude-sonnet-5-5');
    expect(resolveAnthropicModel('STANDARD', {})).toBe('claude-sonnet-5-5');
    expect(resolveAnthropicModel('STANDARD', { ANTHROPIC_MODEL_STANDARD: ' claude-haiku-5-5 ' })).toBe('claude-haiku-5-5');
    expect(resolveAnthropicModel('STANDARD', { ANTHROPIC_MODEL_STANDARD: '   ' })).toBe('claude-sonnet-5-5');
    expect(resolveAnthropicModel('PREMIUM', {})).toBe('claude-opus-5-5');
  });

  it('the platform key is the only key, and an empty one is no key', () => {
    expect(platformAnthropicKey({})).toBeNull();
    expect(platformAnthropicKey({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
    expect(platformAnthropicKey({ ANTHROPIC_API_KEY: 'k' })).toBe('k');
  });

  it('every feature sets its effort and maximum output explicitly', () => {
    for (const key of AI_FEATURE_KEYS) {
      expect(['low', 'medium', 'high']).toContain(AI_FEATURES[key].effort);
      expect(AI_FEATURES[key].maxTokens).toBeGreaterThan(0);
    }
    expect(AI_FEATURES.document_summary.inputTokenCap).toBe(30_000);
  });

  it('knows its feature keys and nothing else', () => {
    expect(isAiFeatureKey('morning_briefing')).toBe(true);
    expect(isAiFeatureKey('rca_assistance')).toBe(false);
  });
});

describe('AiRefusalException (ACC-194)', () => {
  it.each([
    ['AI_NOT_ENABLED', HttpStatus.CONFLICT],
    ['AI_CREDITS_EXHAUSTED', HttpStatus.CONFLICT],
    ['AI_PROVIDER_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE],
    ['AI_PROVIDER_FAILED', HttpStatus.BAD_GATEWAY],
    ['AI_FEATURE_NOT_PRICED', HttpStatus.SERVICE_UNAVAILABLE],
  ] as const)('%s is %i, never a 403', (code, status) => {
    const e = new AiRefusalException(code);
    expect(e.getStatus()).toBe(status);
    expect(e.getStatus()).not.toBe(HttpStatus.FORBIDDEN);
    expect((e.getResponse() as { code: string }).code).toBe(code);
  });

  it('carries its details in the body', () => {
    const e = new AiRefusalException('AI_CREDITS_EXHAUSTED', {
      creditCost: 15,
      creditsRemaining: 3,
      renewsAt: '2026-10-21T00:00:00.000Z',
    });
    expect(e.getResponse()).toEqual(
      expect.objectContaining({ statusCode: 409, error: 'Conflict', creditCost: 15, creditsRemaining: 3, renewsAt: '2026-10-21T00:00:00.000Z' }),
    );
    expect((new AiRefusalException('AI_NOT_ENABLED', { reason: 'FEATURE_NOT_AVAILABLE' }).getResponse() as { reason: string }).reason).toBe(
      'FEATURE_NOT_AVAILABLE',
    );
  });
});
