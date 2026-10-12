import type { CookieOptions } from 'express';

/**
 * Every session cookie's options, in one place — ACC-186.
 *
 * ## Always Secure, and why it is not keyed off NODE_ENV
 *
 * The setters used `secure: NODE_ENV === 'production'`, and Railway runs
 * `NODE_ENV=development` (the Dockerfile's `production` is overridden by the
 * service variable), so the deployed API sent its session cookies WITHOUT
 * `Secure`. Keying the flag off the environment fails OPEN the next time any
 * environment has the wrong value; `secure: true` fails closed and depends on
 * nothing.
 *
 * Local development keeps working because browsers treat `localhost` and
 * `*.localhost` as potentially trustworthy and accept Secure cookies there over
 * plain http. That is a browser behaviour, so it is checked by hand in Chrome
 * (sign-in, reload, refresh, sign-out at `http://al-nakheel.localhost:4200`)
 * rather than assumed. If a supported dev browser ever refuses, the planned
 * fallback is an explicit `SESSION_COOKIE_SECURE` flag defaulting to true —
 * still never NODE_ENV.
 *
 * ## One place, so a clear always matches a set
 *
 * Three setters and two clearers used to write these options by hand, and the
 * clearers already disagreed with the setters (no `secure` on the clear). A
 * browser keys a cookie by name and path, and refuses to let a non-Secure
 * Set-Cookie replace a Secure one — so a clear that drifts from its set can
 * silently fail to sign anyone out. Setting and clearing both read from here.
 *
 * ## The refresh cookie's path covers refresh AND sign-out — ACC-203
 *
 * It was `/api/v1/auth/refresh`, so the browser never sent it to
 * `/api/v1/auth/logout`, and no sign-out ever revoked a refresh-token row: the
 * next visit renewed the session and the person was back in without a
 * password. It is now `/api/v1/auth`, which both routes sit under. The other
 * auth routes receive it too; none reads it, nothing logs cookies, and it stays
 * httpOnly, Secure, SameSite=Strict and host-only. A narrower shared path would
 * have meant moving both routes (backend/Plans/step-ACC-203-signout-ends-session.md).
 */

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/** Covers both routes that read the refresh token: refresh and sign-out (ACC-203). */
export const REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth';

/**
 * The path the refresh cookie had before ACC-203 — CHANGE-OVER ONLY.
 *
 * Browsers that signed in before the deploy still hold a cookie at this path.
 * Left alone it does harm: it also matches /api/v1/auth/refresh, a browser
 * sends the longer-path cookie FIRST, and cookie-parser keeps the first value —
 * so after the first refresh the server would read the old, already-rotated
 * token and sign the person out. So it is cleared on every set AND every clear.
 *
 * Written 10 Oct 2026. Remove this, and both clears that use it, once 7 days
 * (the refresh-token life) have passed since ACC-203 deployed: no browser can
 * hold a live cookie at this path after that.
 */
export const LEGACY_REFRESH_TOKEN_COOKIE_PATH = '/api/v1/auth/refresh';

const SESSION_COOKIE_BASE: Readonly<CookieOptions> = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
};

/** Options for setting the access-token cookie, which every request sends. */
export function accessTokenCookieOptions(maxAgeMs: number): CookieOptions {
  return { ...SESSION_COOKIE_BASE, path: '/', maxAge: maxAgeMs };
}

/** Options for setting the refresh-token cookie, scoped to the auth routes. */
export function refreshTokenCookieOptions(maxAgeMs: number): CookieOptions {
  return {
    ...SESSION_COOKIE_BASE,
    path: REFRESH_TOKEN_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** The same attributes as the set, without a lifetime — what a clear needs to match. */
export function accessTokenClearOptions(): CookieOptions {
  return { ...SESSION_COOKIE_BASE, path: '/' };
}

export function refreshTokenClearOptions(): CookieOptions {
  return { ...SESSION_COOKIE_BASE, path: REFRESH_TOKEN_COOKIE_PATH };
}

/** Clearing a refresh cookie left at the pre-ACC-203 path. Change-over only. */
export function legacyRefreshTokenClearOptions(): CookieOptions {
  return { ...SESSION_COOKIE_BASE, path: LEGACY_REFRESH_TOKEN_COOKIE_PATH };
}

/**
 * Clearing Better Auth's two-factor challenge cookie. Better Auth sets it
 * itself (httpOnly, `sameSite: 'lax'`, path `/`), Secure and `__Secure-`
 * prefixed since `advanced.useSecureCookies` is on — so the clear is Secure too,
 * for both of the names it may carry.
 */
export function twoFactorCookieClearOptions(): CookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/' };
}
