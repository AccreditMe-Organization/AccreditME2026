import {
  REFRESH_TOKEN_COOKIE_PATH,
  accessTokenClearOptions,
  accessTokenCookieOptions,
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

  it('scopes the refresh token to the one endpoint that reads it', () => {
    expect(REFRESH_TOKEN_COOKIE_PATH).toBe('/api/v1/auth/refresh');
    expect(refreshTokenCookieOptions(1000).path).toBe(
      REFRESH_TOKEN_COOKIE_PATH,
    );
    expect(accessTokenCookieOptions(1000).path).toBe('/');
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
