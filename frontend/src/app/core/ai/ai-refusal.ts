import { refusalBody, refusalCode } from '../http/refusal';
import type { FormatService } from '../formatting/format.service';

/**
 * ACC-194 — the ONE reading of an AI refusal, so every AI feature (document
 * summaries, task drafting, the morning briefing) says the same thing, in
 * English and Arabic. Built on refusalCode()/refusalBody(): a screen maps the
 * CODE to its own words, never the API's English message.
 *
 * Three things a person can be told, decided by the backend's code and reason
 * (backend/src/foundation/ai/ai-refusal.ts):
 *   - not enabled — no allowance or switched off for the organisation, or this
 *     one feature is not open to it;
 *   - credits used up — with the date they renew;
 *   - unavailable — no platform key, the call failed (refunded), or the feature
 *     is not priced: none of which the person can do anything about but retry.
 *
 * Anything else is not an AI refusal: null, and the caller shows its usual
 * error.
 */
export type AiRefusalKind = 'notEnabled' | 'featureNotAvailable' | 'creditsUsedUp' | 'unavailable';

export interface AiRefusal {
  kind: AiRefusalKind;
  /** The translation key to show (ai.refusal.*). */
  messageKey: string;
  /** Interpolation params for the key ({{date}} for creditsUsedUp). */
  params: Record<string, string>;
}

const MESSAGE_KEYS: Readonly<Record<AiRefusalKind, string>> = {
  notEnabled: 'ai.refusal.notEnabled',
  featureNotAvailable: 'ai.refusal.featureNotAvailable',
  creditsUsedUp: 'ai.refusal.creditsUsedUp',
  unavailable: 'ai.refusal.unavailable',
};

/**
 * @param format the caller's FormatService (or anything with its `date`), so
 *   the renewal date follows ACC-94: Latin digits, the user's calendar, the
 *   tenant's zone.
 */
export function aiRefusal(err: unknown, format: Pick<FormatService, 'date'>): AiRefusal | null {
  const code = refusalCode(err);
  const body = refusalBody(err);
  const of = (kind: AiRefusalKind, params: Record<string, string> = {}): AiRefusal => ({ kind, messageKey: MESSAGE_KEYS[kind], params });

  switch (code) {
    case 'AI_NOT_ENABLED':
      return of(body?.['reason'] === 'FEATURE_NOT_AVAILABLE' ? 'featureNotAvailable' : 'notEnabled');
    case 'AI_CREDITS_EXHAUSTED': {
      const renewsAt = body?.['renewsAt'];
      return of('creditsUsedUp', { date: typeof renewsAt === 'string' ? format.date(renewsAt) : '—' });
    }
    case 'AI_PROVIDER_UNAVAILABLE':
    case 'AI_PROVIDER_FAILED':
    case 'AI_FEATURE_NOT_PRICED':
      return of('unavailable');
    default:
      return null;
  }
}
