import {
  REFRESH_TOKEN_TTL_SECONDS,
  SESSION_MAX_LENGTH_SECONDS,
  accessTokenExp,
  cookieMaxAgeMs,
  isPastSessionLimit,
  refreshRowExpiresAt,
  sessionEndsAt,
  sessionStartOf,
} from './session-limit';

// ACC-126 — the 12-hour rule, in the one file that holds it.
describe('session limit (ACC-126)', () => {
  const START = new Date('2026-11-13T06:00:00.000Z');
  const at = (hours: number, minutes = 0, seconds = 0) =>
    new Date(START.getTime() + ((hours * 60 + minutes) * 60 + seconds) * 1000);
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);

  it('is exactly 12 hours, and the refresh token 7 days (pinned by reading them)', () => {
    expect(SESSION_MAX_LENGTH_SECONDS).toBe(12 * 60 * 60);
    expect(REFRESH_TOKEN_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it('ends a session 12 hours after its start', () => {
    expect(sessionEndsAt(START).toISOString()).toBe('2026-11-13T18:00:00.000Z');
  });

  it('is past the limit AT 12 hours, not a second before', () => {
    expect(isPastSessionLimit(START, at(11, 59, 59))).toBe(false);
    expect(isPastSessionLimit(START, at(12))).toBe(true);
    expect(isPastSessionLimit(START, at(13))).toBe(true);
  });

  it("takes a row's own start, and a row written before ACC-126 its createdAt", () => {
    const created = at(3);
    expect(sessionStartOf({ sessionStartedAt: START, createdAt: created })).toBe(START);
    expect(sessionStartOf({ sessionStartedAt: null, createdAt: created })).toBe(created);
  });

  describe('the access token expiry: min(now + TTL, start + 12h)', () => {
    it('is now + 15 minutes while the limit is far off', () => {
      expect(accessTokenExp(at(2), START, 15 * 60)).toBe(sec(at(2, 15)));
    });

    it('is exactly start + 12h when that comes first', () => {
      expect(accessTokenExp(at(11, 55), START, 15 * 60)).toBe(sec(at(12)));
    });

    it('is never later than start + 12h', () => {
      for (const minutes of [0, 30, 60 * 6, 60 * 11 + 50, 60 * 11 + 59]) {
        expect(accessTokenExp(at(0, minutes), START, 15 * 60)).toBeLessThanOrEqual(sec(at(12)));
      }
    });
  });

  describe('the refresh row expiry: min(now + 7 days, start + 12h)', () => {
    it('is start + 12h for any session (12 hours is under 7 days)', () => {
      expect(refreshRowExpiresAt(at(0), START).toISOString()).toBe(sessionEndsAt(START).toISOString());
      expect(refreshRowExpiresAt(at(11), START).toISOString()).toBe(sessionEndsAt(START).toISOString());
    });

    it('would be now + 7 days if the limit were later (the min is real)', () => {
      const longAgo = new Date(START.getTime() - 3 * 24 * 3600 * 1000);
      const farFuture = new Date(START.getTime() + 30 * 24 * 3600 * 1000);
      // A start in the future only to exercise the other arm of the min.
      expect(refreshRowExpiresAt(longAgo, farFuture).getTime()).toBe(
        longAgo.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000,
      );
    });
  });

  it('gives a cookie the time left, and never a negative age', () => {
    expect(cookieMaxAgeMs(at(12), at(11, 55))).toBe(5 * 60 * 1000);
    expect(cookieMaxAgeMs(at(12), at(13))).toBe(0);
  });
});
