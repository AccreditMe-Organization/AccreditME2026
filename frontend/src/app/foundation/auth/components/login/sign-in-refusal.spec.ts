import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting/format.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { SIGN_IN_REFUSAL_KEYS as K, describeSignInRefusal, roundUpToMinute } from './sign-in-refusal';

// ACC-120 slice 9d — one sentence per way a sign-in is refused.
describe('describeSignInRefusal (ACC-120 slice 9d)', () => {
  const NOW = new Date('2026-10-08T10:00:00.000Z');
  const refused = (body: Record<string, unknown>, status = 401) =>
    new HttpErrorResponse({ error: { statusCode: status, ...body }, status });
  const minutesAhead = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

  /** The `{{when}}` the screen renders for a refusal, in a language. */
  function when(until: Date | null, language: 'en' | 'ar'): string {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.tick();
    return TestBed.inject(FormatService).relative(until!, NOW);
  }

  it('INVALID_CREDENTIALS → the neutral sentence, as an error', () => {
    const r = describeSignInRefusal(refused({ code: 'INVALID_CREDENTIALS' }), 'password', NOW);
    expect([r.key, r.look, r.until, r.onCodeField]).toEqual([K.invalidCredentials, 'error', null, false]);
  });

  describe('ACCOUNT_LOCKED', () => {
    it('on the password step says when it lifts, and that attempts extend it', () => {
      const r = describeSignInRefusal(refused({ code: 'ACCOUNT_LOCKED', lockedUntil: minutesAhead(14) }), 'password', NOW);
      expect([r.key, r.look]).toEqual([K.locked, 'warn']);
      expect(when(r.until, 'en')).toBe('in 14 minutes');
      expect(when(r.until, 'ar')).toBe('خلال 14 دقيقة');
      // Non-vacuity guard: the key is the one whose text carries the sentence.
      expect(en.auth.signIn.errors.locked).toContain('extends the lock');
    });

    it('rounds part of a minute UP, so 30 seconds reads "in 1 minute"', () => {
      const r = describeSignInRefusal(
        refused({ code: 'ACCOUNT_LOCKED', lockedUntil: new Date(NOW.getTime() + 30_000).toISOString() }),
        'password',
        NOW,
      );
      expect(when(r.until, 'en')).toBe('in 1 minute');
    });

    it('never says "in 0 minutes" for a lock that has already lifted', () => {
      const r = describeSignInRefusal(refused({ code: 'ACCOUNT_LOCKED', lockedUntil: minutesAhead(-3) }), 'password', NOW);
      expect(when(r.until, 'en')).toBe('in 1 minute');
    });

    it('a missing or malformed lockedUntil gives the sentence without a time', () => {
      for (const lockedUntil of [undefined, 'not a date', 42, null]) {
        const r = describeSignInRefusal(refused({ code: 'ACCOUNT_LOCKED', lockedUntil }), 'password', NOW);
        expect([String(lockedUntil), r.key, r.until]).toEqual([String(lockedUntil), K.lockedNoTime, null]);
      }
    });

    it('on the MFA step uses the sentence WITHOUT "extends", because a code tried while locked does not move it', () => {
      const r = describeSignInRefusal(refused({ code: 'ACCOUNT_LOCKED', lockedUntil: minutesAhead(10) }), 'mfa', NOW);
      expect(r.key).toBe(K.mfaLocked);
      expect(en.auth.signIn.errors.mfaLocked).not.toContain('extend');
      const noTime = describeSignInRefusal(refused({ code: 'ACCOUNT_LOCKED' }), 'mfa', NOW);
      expect(noTime.key).toBe(K.mfaLockedNoTime);
    });
  });

  it('ACCOUNT_INACTIVE → its own sentence, neutral', () => {
    const r = describeSignInRefusal(refused({ code: 'ACCOUNT_INACTIVE' }), 'password', NOW);
    expect([r.key, r.look]).toEqual([K.inactive, 'secondary']);
  });

  it('ORGANIZATION_UNAVAILABLE → its own sentence, neutral', () => {
    const r = describeSignInRefusal(refused({ code: 'ORGANIZATION_UNAVAILABLE' }), 'password', NOW);
    expect([r.key, r.look]).toEqual([K.organizationUnavailable, 'secondary']);
  });

  describe('RATE_LIMITED', () => {
    it('says when to try again, from retryAfterSeconds', () => {
      const r = describeSignInRefusal(refused({ code: 'RATE_LIMITED', retryAfterSeconds: 60 }, 429), 'password', NOW);
      expect([r.key, r.look]).toEqual([K.rateLimited, 'warn']);
      expect(when(r.until, 'en')).toBe('in 1 minute');
      expect(when(r.until, 'ar')).toBe('خلال دقيقة واحدة');
    });

    it('a missing or malformed retryAfterSeconds gives the sentence without a time', () => {
      for (const retryAfterSeconds of [undefined, 'soon', -5, Number.NaN]) {
        const r = describeSignInRefusal(refused({ code: 'RATE_LIMITED', retryAfterSeconds }, 429), 'password', NOW);
        expect([String(retryAfterSeconds), r.key, r.until]).toEqual([String(retryAfterSeconds), K.rateLimitedNoTime, null]);
      }
    });
  });

  describe('MFA_INVALID', () => {
    it('belongs on the code field', () => {
      const r = describeSignInRefusal(refused({ code: 'MFA_INVALID', attemptsRemaining: 4 }), 'mfa', NOW);
      expect([r.key, r.look, r.onCodeField]).toEqual([K.mfaInvalid, 'error', true]);
    });

    it('names the attempts left at 1 and 2, and not at 3 or more', () => {
      const left = (n: number) =>
        describeSignInRefusal(refused({ code: 'MFA_INVALID', attemptsRemaining: n }), 'mfa', NOW).attemptsLeft;
      expect([left(1), left(2), left(3), left(5), left(0)]).toEqual([1, 2, null, null, null]);
    });
  });

  it('MFA_EXPIRED → "reload and sign in again"', () => {
    const r = describeSignInRefusal(refused({ code: 'MFA_EXPIRED' }), 'mfa', NOW);
    expect([r.key, r.look]).toEqual([K.mfaExpired, 'warn']);
  });

  it('no answer, or a server failure, says the API did not respond — never a wrong password', () => {
    for (const status of [0, 500, 502, 503]) {
      const r = describeSignInRefusal(new HttpErrorResponse({ status, error: null }), 'password', NOW);
      expect([status, r.key, r.look]).toEqual([status, K.unreachable, 'info']);
    }
  });

  it('anything else is the generic sentence', () => {
    for (const err of [
      refused({ code: 'SOMETHING_NEW' }),
      refused({ message: 'no code' }),
      new HttpErrorResponse({ status: 400, error: { message: 'bad' } }),
      new Error('This address names no organisation.'),
    ]) {
      expect(describeSignInRefusal(err, 'password', NOW).key).toBe(K.generic);
    }
  });

  it('roundUpToMinute rounds up and keeps at least one minute', () => {
    expect(roundUpToMinute(new Date(NOW.getTime() + 61_000), NOW).getTime() - NOW.getTime()).toBe(120_000);
    expect(roundUpToMinute(new Date(NOW.getTime() + 60_000), NOW).getTime() - NOW.getTime()).toBe(60_000);
    expect(roundUpToMinute(NOW, NOW).getTime() - NOW.getTime()).toBe(60_000);
  });
});
