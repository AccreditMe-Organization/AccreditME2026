/**
 * ACC-126 — every session ends 12 hours after sign-in, however active the
 * person is (Ahmad, 13 Nov 2026). The same for everyone; nothing is set per
 * organisation. The 30-minute idle sign-out (ACC-122) is a separate rule and is
 * unchanged.
 *
 * THE ONE PLACE THE RULE LIVES. Everything that mints a session credential asks
 * here for its lifetime:
 *
 *   - the access token's `exp` is min(now + its TTL, start + 12h), so nobody
 *     keeps working past the cap until the next renewal — enforced by
 *     verifyJwt()'s existing in-memory expiry check, with no database read;
 *   - a refresh-token row's `expiresAt` is min(now + 7 days, start + 12h);
 *   - refresh() refuses past start + 12h with SESSION_TIME_LIMIT.
 *
 * "Start" is the moment the session was issued (after the MFA code, when there
 * is one). It is written on the RefreshToken row and copied UNCHANGED onto every
 * row a rotation writes (`sessionStartedAt`), and carried in the access token as
 * the signed claim `sst`.
 *
 * There is deliberately NO override for the 12 hours. A variable that could
 * lengthen it on a deployed environment is the trap ACC-122's TTL override was
 * clamped to avoid.
 */

export const SESSION_MAX_LENGTH_SECONDS = 12 * 60 * 60;

/** The refresh token's own lifetime ("Refresh token expiry: 7 days"). */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** When a session that started at `start` must end. */
export function sessionEndsAt(start: Date): Date {
  return new Date(start.getTime() + SESSION_MAX_LENGTH_SECONDS * 1000);
}

/** True once the session that started at `start` has reached its limit. */
export function isPastSessionLimit(start: Date, now: Date = new Date()): boolean {
  return now.getTime() >= sessionEndsAt(start).getTime();
}

/**
 * Where a row's session started. A row written before ACC-126 has no start; its
 * own `createdAt` stands in — the earliest moment this session is known to have
 * existed, so the fallback can never end a session early (plan §c).
 */
export function sessionStartOf(row: {
  sessionStartedAt: Date | null;
  createdAt: Date;
}): Date {
  return row.sessionStartedAt ?? row.createdAt;
}

/** The access token's `exp`, in epoch seconds: min(now + ttl, start + 12h). */
export function accessTokenExp(
  now: Date,
  start: Date,
  ttlSeconds: number,
): number {
  const byTtl = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const byLimit = Math.floor(sessionEndsAt(start).getTime() / 1000);
  return Math.min(byTtl, byLimit);
}

/** A refresh-token row's `expiresAt`: min(now + 7 days, start + 12h). */
export function refreshRowExpiresAt(now: Date, start: Date): Date {
  return new Date(
    Math.min(
      now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
      sessionEndsAt(start).getTime(),
    ),
  );
}

/** Milliseconds a cookie should live to end at `expiresAt`; never negative. */
export function cookieMaxAgeMs(expiresAt: Date, now: Date = new Date()): number {
  return Math.max(0, expiresAt.getTime() - now.getTime());
}
