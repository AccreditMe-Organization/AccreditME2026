import { HttpErrorResponse } from '@angular/common/http';
import { aiRefusal } from './ai-refusal';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

const error = (status: number, body: unknown): HttpErrorResponse => new HttpErrorResponse({ status, error: body });
const formatDate = (iso: string): string => `formatted(${iso})`;

describe('aiRefusal (ACC-194)', () => {
  it('no allowance or switched off: not enabled for the organisation', () => {
    for (const reason of ['NO_ALLOWANCE', 'SWITCHED_OFF', undefined]) {
      expect(aiRefusal(error(409, { code: 'AI_NOT_ENABLED', reason }), formatDate)).toEqual({
        kind: 'notEnabled',
        messageKey: 'ai.refusal.notEnabled',
        params: {},
      });
    }
  });

  it('a feature not open to this organisation is said as such, not as AI being off', () => {
    expect(aiRefusal(error(409, { code: 'AI_NOT_ENABLED', reason: 'FEATURE_NOT_AVAILABLE' }), formatDate)?.messageKey).toBe(
      'ai.refusal.featureNotAvailable',
    );
  });

  it('credits used up carries the renewal date, formatted by the caller', () => {
    expect(aiRefusal(error(409, { code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' }), formatDate)).toEqual({
      kind: 'creditsUsedUp',
      messageKey: 'ai.refusal.creditsUsedUp',
      params: { date: 'formatted(2026-10-21T00:00:00.000Z)' },
    });
    expect(aiRefusal(error(409, { code: 'AI_CREDITS_EXHAUSTED' }), formatDate)?.params).toEqual({ date: '—' });
  });

  it('no key, a failed call and an unpriced feature all read as unavailable', () => {
    for (const code of ['AI_PROVIDER_UNAVAILABLE', 'AI_PROVIDER_FAILED', 'AI_FEATURE_NOT_PRICED']) {
      expect(aiRefusal(error(503, { code }), formatDate)?.kind).toBe('unavailable');
    }
  });

  it('anything else is not an AI refusal', () => {
    expect(aiRefusal(error(403, { code: 'FORBIDDEN' }), formatDate)).toBeNull();
    expect(aiRefusal(error(500, 'boom'), formatDate)).toBeNull();
    expect(aiRefusal(new Error('x'), formatDate)).toBeNull();
  });

  it('every key it returns exists in English and Arabic, and the date goes into {{date}}', () => {
    const refusal = (en as { ai: { refusal: Record<string, string> } }).ai.refusal;
    const refusalAr = (ar as { ai: { refusal: Record<string, string> } }).ai.refusal;
    for (const key of ['notEnabled', 'featureNotAvailable', 'creditsUsedUp', 'unavailable']) {
      expect(refusal[key]).toBeTruthy();
      expect(refusalAr[key]).toBeTruthy();
    }
    expect(refusal['creditsUsedUp']).toContain('{{date}}');
    expect(refusalAr['creditsUsedUp']).toContain('{{date}}');
  });
});
