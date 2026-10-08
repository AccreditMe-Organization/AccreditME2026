import { HttpErrorResponse } from '@angular/common/http';
import { refusalBody, refusalCode } from '../../../../core/http/refusal';

/**
 * What Sign in says for each way a sign-in is refused — ACC-120 slice 9d.
 *
 * One branch per code the backend sends (`auth-refusal.ts`, plus ACC-129's
 * RATE_LIMITED), so every refusal has its own sentence and nothing is folded
 * into "invalid credentials". A pure function of the error, the step and the
 * clock, so each branch is pinned by its own spec.
 *
 * The time a lock or a rate limit ends is carried as an instant (`until`) and
 * rendered by the component through the formatting layer's relative(), so it
 * follows a language switch. It is rounded UP to whole minutes, minimum 1, so it
 * never reads "in 0 minutes". A missing or unparsable time gives the sentence
 * without one ("Try again later.").
 */

/** PrimeNG message severities, by meaning: error is the one the person can fix by retyping. */
export type RefusalLook = 'error' | 'warn' | 'secondary' | 'info';

export type SignInStep = 'password' | 'mfa';

export interface SignInRefusal {
  /** The sentence, as a translation key. */
  readonly key: string;
  readonly look: RefusalLook;
  /** When the refusal ends, already rounded up; null when the sentence names no time. */
  readonly until: Date | null;
  /** The moment the refusal arrived, which `until` is measured from. */
  readonly at: Date;
  /** MFA_INVALID: the sentence belongs on the code field, not in the message slot. */
  readonly onCodeField: boolean;
  /** MFA_INVALID with 1 or 2 attempts left: how many. Otherwise null — 3+ is noise. */
  readonly attemptsLeft: number | null;
}

export const SIGN_IN_REFUSAL_KEYS = {
  invalidCredentials: 'auth.signIn.errors.invalidCredentials',
  locked: 'auth.signIn.errors.locked',
  lockedNoTime: 'auth.signIn.errors.lockedNoTime',
  // The MFA step's lock is Better Auth's, and a code tried while it is on does
  // NOT move it later (assertTwoFactorNotLocked() throws before a failure is
  // counted, two-factor/totp/index.mjs:137). So its sentence does not say
  // "each attempt extends the lock", which is true only of the password step
  // (login-attempt.service.ts:102).
  mfaLocked: 'auth.signIn.errors.mfaLocked',
  mfaLockedNoTime: 'auth.signIn.errors.mfaLockedNoTime',
  inactive: 'auth.signIn.errors.inactive',
  organizationUnavailable: 'auth.signIn.errors.organizationUnavailable',
  rateLimited: 'auth.signIn.errors.rateLimited',
  rateLimitedNoTime: 'auth.signIn.errors.rateLimitedNoTime',
  mfaInvalid: 'auth.signIn.errors.mfaInvalid',
  mfaExpired: 'auth.signIn.errors.mfaExpired',
  unreachable: 'auth.signIn.errors.unreachable',
  generic: 'auth.signIn.errors.generic',
} as const;

const MINUTE_MS = 60_000;

/** `until`, moved up to the next whole minute after `now`, and never less than one minute away. */
export function roundUpToMinute(until: Date, now: Date): Date {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / MINUTE_MS));
  return new Date(now.getTime() + minutes * MINUTE_MS);
}

function instant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function secondsFrom(now: Date, value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return new Date(now.getTime() + value * 1000);
}

export function describeSignInRefusal(err: unknown, step: SignInStep, now: Date = new Date()): SignInRefusal {
  const say = (
    key: string,
    look: RefusalLook,
    extra: Partial<Pick<SignInRefusal, 'until' | 'onCodeField' | 'attemptsLeft'>> = {},
  ): SignInRefusal => ({
    key,
    look,
    at: now,
    until: extra.until ? roundUpToMinute(extra.until, now) : null,
    onCodeField: extra.onCodeField ?? false,
    attemptsLeft: extra.attemptsLeft ?? null,
  });
  const K = SIGN_IN_REFUSAL_KEYS;
  const body = refusalBody(err);

  switch (refusalCode(err)) {
    case 'INVALID_CREDENTIALS':
      return say(K.invalidCredentials, 'error');
    case 'ACCOUNT_LOCKED': {
      const until = instant(body?.['lockedUntil']);
      if (step === 'mfa') return say(until ? K.mfaLocked : K.mfaLockedNoTime, 'warn', { until });
      return say(until ? K.locked : K.lockedNoTime, 'warn', { until });
    }
    case 'ACCOUNT_INACTIVE':
      return say(K.inactive, 'secondary');
    case 'ORGANIZATION_UNAVAILABLE':
      return say(K.organizationUnavailable, 'secondary');
    case 'RATE_LIMITED': {
      const until = secondsFrom(now, body?.['retryAfterSeconds']);
      return say(until ? K.rateLimited : K.rateLimitedNoTime, 'warn', { until });
    }
    case 'MFA_INVALID': {
      const left = body?.['attemptsRemaining'];
      return say(K.mfaInvalid, 'error', {
        onCodeField: true,
        attemptsLeft: left === 1 || left === 2 ? left : null,
      });
    }
    case 'MFA_EXPIRED':
      return say(K.mfaExpired, 'warn');
  }

  // No code we know. Nothing reached the API, or it failed: nothing was
  // checked, so this must not read as a wrong password.
  if (err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500)) {
    return say(K.unreachable, 'info');
  }
  return say(K.generic, 'error');
}
