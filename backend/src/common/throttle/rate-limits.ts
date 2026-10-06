/**
 * Every rate limit the API enforces — ACC-129. One place, pinned by
 * `rate-limits.spec.ts`, and described in CLAUDE.md "Rate Limiting".
 *
 * WHO IS COUNTED decides most of these numbers. A hospital puts its whole staff
 * behind one shared internet address, so a per-address limit on signed-in
 * traffic would throttle the entire hospital at once. Signed-in traffic is
 * therefore counted per USER; only what arrives without a valid session is
 * counted per address (see throttle-identity.ts).
 *
 * Sign-in limits are deliberately generous: the per-account lockout (5 wrong
 * passwords in 15 minutes, LoginAttemptService) is what stops password
 * guessing. A tight per-address sign-in limit would lock a hospital out at
 * shift change and add nothing the lockout does not already do.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const RATE_LIMITS = {
  /** Every route, unless it states its own. */
  default: {
    ttl: MINUTE,
    /** Per signed-in user. */
    signedIn: 600,
    /** Per address, for anything without a valid session. */
    anonymous: 300,
  },
  /** Public auth routes, per address. */
  login: { limit: 60, ttl: MINUTE },
  mfaVerify: { limit: 60, ttl: MINUTE },
  refresh: { limit: 300, ttl: MINUTE },
  invitationLookup: { limit: 30, ttl: MINUTE },
  acceptInvitation: { limit: 20, ttl: MINUTE },
  /** Per address. The per-email limit below applies as well. */
  forgotPassword: { limit: 20, ttl: HOUR },
  /**
   * Per organisation + email, so nobody can flood one inbox — or our Resend
   * quota — from many addresses.
   */
  forgotPasswordPerEmail: { limit: 3, ttl: HOUR },
  resetPassword: { limit: 20, ttl: HOUR },
} as const;

/** The second named throttler: counts password-reset requests per email. */
export const RESET_EMAIL_THROTTLER = 'reset-email';
