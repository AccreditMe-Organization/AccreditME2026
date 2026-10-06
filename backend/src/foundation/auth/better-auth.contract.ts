/**
 * What this codebase relies on INSIDE Better Auth — ACC-120 slice 9b.
 *
 * Better Auth's public API does not expose these facts, so they were read from
 * the installed library (1.6.22) and are copied here, in one place.
 * `better-auth.contract.spec.ts` reads the installed library's own source and
 * asserts every one of them, so an upgrade that changes any of them fails CI
 * instead of quietly breaking a sign-in outcome.
 *
 * Do not use any of these values anywhere else by retyping them: import them.
 */

/**
 * Better Auth's code for a refused email/password pair, on both "no such user"
 * and "wrong password" (it hashes a dummy password for an unknown user, so the
 * two also cost the same). The ONLY sign-in refusal that counts as a failed
 * attempt.
 */
export const BETTER_AUTH_INVALID_CREDENTIALS = 'INVALID_EMAIL_OR_PASSWORD';

// ---------------------------------------------------------------------------
// The sign-in MFA challenge (plugins/two-factor).
//
// After a correct password for an account with MFA on, Better Auth writes TWO
// AuthVerification rows and a signed cookie, all expiring together:
//   `2fa-<random>`           value: the AuthUser id     (the challenge)
//   `2fa-attempts-<random>`  value: codes tried so far   (its attempt counter)
//   cookie `better-auth.two_factor` = encodeURIComponent(`2fa-<random>.<sig>`)
// where <sig> is base64(HMAC-SHA256(BETTER_AUTH_SECRET, `2fa-<random>`)).
// ---------------------------------------------------------------------------

/** The challenge cookie's name; `__Secure-` is prepended over https. */
export const TWO_FACTOR_COOKIE_NAME = 'better-auth.two_factor';
export const SECURE_COOKIE_PREFIX = '__Secure-';

/** Prefix of the challenge row's identifier. */
export const TWO_FACTOR_CHALLENGE_PREFIX = '2fa-';
/** Prefix of the attempt-counter row, followed by the challenge identifier. */
export const TWO_FACTOR_ATTEMPTS_PREFIX = '2fa-attempts-';

/** Codes one challenge accepts before it is spent (`beginAttempt(5)`). */
export const TWO_FACTOR_ATTEMPTS_PER_CHALLENGE = 5;
/** Failed codes, across challenges, before the user's MFA locks. */
export const TWO_FACTOR_MAX_FAILURES_PER_USER = 10;
/** How long a challenge lives, in seconds (`twoFactorCookieMaxAge ?? 600`). */
export const TWO_FACTOR_CHALLENGE_SECONDS = 600;

/** Better Auth's verifyTOTP refusal codes. */
export const BETTER_AUTH_TWO_FACTOR_CODES = {
  /** A wrong code — the challenge is still live. */
  INVALID_CODE: 'INVALID_CODE',
  /** No challenge: the cookie is missing, tampered with, or expired. */
  INVALID_TWO_FACTOR_COOKIE: 'INVALID_TWO_FACTOR_COOKIE',
  /** The challenge's five attempts are spent; it is gone. */
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
  /** The user's MFA is locked after ten failures. */
  ACCOUNT_LOCKED: 'ACCOUNT_TEMPORARILY_LOCKED',
} as const;

// ---------------------------------------------------------------------------
// Sign-up password refusals — accept-invitation, ACC-120 slice 9e.
//
// accept calls signUpEmail() WITHOUT asResponse, so a refusal is THROWN, as an
// error whose `name` is 'APIError' and whose `body` carries Better Auth's
// `{ message, code }`. The breach check runs inside password hashing
// (plugins/haveibeenpwned), so it throws from the same call.
// ---------------------------------------------------------------------------

/** The `name` every Better Auth APIError carries (better-call's own class). */
export const BETTER_AUTH_API_ERROR_NAME = 'APIError';

/** Better Auth's codes for a password sign-up refuses. */
export const BETTER_AUTH_PASSWORD_CODES = {
  /** haveIBeenPwned found the password in a breach (400). */
  COMPROMISED: 'PASSWORD_COMPROMISED',
  /** Shorter than minPasswordLength, 8 (400). */
  TOO_SHORT: 'PASSWORD_TOO_SHORT',
  /** Longer than maxPasswordLength, 128 (400). */
  TOO_LONG: 'PASSWORD_TOO_LONG',
} as const;

/**
 * The breach check could not reach pwnedpasswords.com. It carries NO code — a
 * 500 whose message starts with this, in both of the plugin's outage throws.
 */
export const BETTER_AUTH_PASSWORD_CHECK_FAILED = 'Failed to check password.';
