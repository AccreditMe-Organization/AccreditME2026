import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable codes for every AI refusal a person can see — ACC-194.
 *
 * Same shape as StorageRefusalException: the code travels in the body
 * HttpExceptionFilter already sends, `{ statusCode, message, error, code,
 * ...details }`. The frontend maps the CODE to its own words
 * (core/ai/ai-refusal.ts); the message is English, fixed per code, for a log.
 *
 * The statuses follow the storage precedents, so the two families agree:
 * "not set up for you" and "used up" are 409 (never 403, which in this app
 * means a missing permission), "not configured" is 503, "the call failed" 502.
 */
export type AiRefusalCode =
  | 'AI_NOT_ENABLED'
  | 'AI_CREDITS_EXHAUSTED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_FAILED'
  | 'AI_FEATURE_NOT_PRICED';

/** Why AI_NOT_ENABLED: no allocation, switched off, or a feature this organisation can't use. */
export type AiNotEnabledReason = 'NO_ALLOWANCE' | 'SWITCHED_OFF' | 'FEATURE_NOT_AVAILABLE';

const STATUS: Readonly<Record<AiRefusalCode, HttpStatus>> = {
  AI_NOT_ENABLED: HttpStatus.CONFLICT,
  AI_CREDITS_EXHAUSTED: HttpStatus.CONFLICT,
  AI_PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  AI_PROVIDER_FAILED: HttpStatus.BAD_GATEWAY,
  AI_FEATURE_NOT_PRICED: HttpStatus.SERVICE_UNAVAILABLE,
};

export const AI_REFUSAL_MESSAGES: Readonly<Record<AiRefusalCode, string>> = {
  AI_NOT_ENABLED: 'AI is not enabled for this organization',
  AI_CREDITS_EXHAUSTED: 'This organization has used its AI credits for this period',
  AI_PROVIDER_UNAVAILABLE: 'AI is not available right now',
  AI_PROVIDER_FAILED: 'The AI request failed. No credits were used',
  AI_FEATURE_NOT_PRICED: 'This AI feature is not available right now',
};

export interface AiRefusalDetails {
  /** AI_NOT_ENABLED */
  reason?: AiNotEnabledReason;
  /** AI_NOT_ENABLED, AI_FEATURE_NOT_PRICED */
  feature?: string;
  /** AI_CREDITS_EXHAUSTED */
  creditCost?: number;
  creditsRemaining?: number;
  /** AI_CREDITS_EXHAUSTED — when the period renews (ISO). */
  renewsAt?: string;
}

export class AiRefusalException extends HttpException {
  constructor(
    readonly code: AiRefusalCode,
    readonly details: AiRefusalDetails = {},
  ) {
    const status = STATUS[code];
    super(
      {
        statusCode: status,
        message: AI_REFUSAL_MESSAGES[code],
        error: HttpStatus[status]
          .toLowerCase()
          .split('_')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
        code,
        ...details,
      },
      status,
    );
  }
}
