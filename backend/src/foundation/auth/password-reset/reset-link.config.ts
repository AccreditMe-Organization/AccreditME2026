import { createHash, randomBytes } from 'crypto';

/**
 * The reset link's fixed facts — ACC-188 (Ahmad, 14 Nov; lane B's review).
 */

/** A link lasts one hour. The email says "within 1 hour"; a spec pins both. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Ended or expired links are kept this long, so a used or replaced link still
 * gets its own answer, then deleted by the next issuing transaction for that
 * person (plan §7.2). There is no sweep.
 */
export const RESET_LINK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** 32 random bytes, base64url: exactly 43 characters from this alphabet. */
export const RESET_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A new token. Lives only in the email and the person's browser. */
export function newResetToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the ledger stores: a plain SHA-256 of the token text, hex. */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
