import {
  LEGACY_REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE_PATH,
  accessTokenClearOptions,
  accessTokenCookieOptions,
  legacyRefreshTokenClearOptions,
  refreshTokenClearOptions,
  refreshTokenCookieOptions,
  twoFactorCookieClearOptions,
} from './session-cookies';

// ACC-186 — one place decides every session cookie's options.
describe('session cookie options (ACC-186)', () => {
  const savedNodeEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = savedNodeEnv;
  });

  it('is Secure, httpOnly and strict whatever NODE_ENV says', () => {
    for (const nodeEnv of ['development', 'test', 'production', '']) {
      process.env['NODE_ENV'] = nodeEnv;
      for (const options of [
        accessTokenCookieOptions(1000),
        refreshTokenCookieOptions(1000),
        accessTokenClearOptions(),
        refreshTokenClearOptions(),
        legacyRefreshTokenClearOptions(),
      ]) {
        expect([nodeEnv, options]).toEqual([
          nodeEnv,
          expect.objectContaining({
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
          }),
        ]);
      }
    }
  });

  // ACC-203 — the refresh cookie must reach sign-out as well as refresh, or
  // no sign-out can revoke the session.
  it('scopes the refresh token to the auth routes, which both refresh and sign-out sit under', () => {
    expect(REFRESH_TOKEN_COOKIE_PATH).toBe('/api/v1/auth');
    expect(refreshTokenCookieOptions(1000).path).toBe(
      REFRESH_TOKEN_COOKIE_PATH,
    );
    for (const route of ['/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      expect([
        route,
        route.startsWith(`${REFRESH_TOKEN_COOKIE_PATH}/`),
      ]).toEqual([route, true]);
    }
    expect(accessTokenCookieOptions(1000).path).toBe('/');
  });

  it('clears the pre-ACC-203 path during the change-over, with the same attributes', () => {
    expect(LEGACY_REFRESH_TOKEN_COOKIE_PATH).toBe('/api/v1/auth/refresh');
    expect(legacyRefreshTokenClearOptions()).toEqual({
      ...refreshTokenClearOptions(),
      path: LEGACY_REFRESH_TOKEN_COOKIE_PATH,
    });
  });

  it('clears with exactly what it set, apart from the lifetime', () => {
    const { maxAge: a, ...access } = accessTokenCookieOptions(1000);
    const { maxAge: r, ...refresh } = refreshTokenCookieOptions(1000);
    // Non-vacuity guard: the set really carried a lifetime.
    expect([a, r]).toEqual([1000, 1000]);
    expect(accessTokenClearOptions()).toEqual(access);
    expect(refreshTokenClearOptions()).toEqual(refresh);
  });

  it('clears Better Auth’s challenge cookie Secure, on its own lax, root-path terms', () => {
    expect(twoFactorCookieClearOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });
});
