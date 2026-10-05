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
