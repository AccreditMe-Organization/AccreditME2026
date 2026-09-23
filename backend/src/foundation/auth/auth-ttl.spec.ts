// ACC-122 — the access-token lifetime override can only ever SHORTEN.
//
// Its own module reads process.env at import time, so each case re-imports
// the module with the variable already set. jest.isolateModules gives a fresh
// module registry per case; without it the first import would be cached and
// every later assertion would read the first value.
// better-auth's ESM-only entry points break Jest for any spec that
// transitively loads them — this one reaches them through auth.service ->
// better-auth.config. The established mitigation (CLAUDE.md: recurred in
// ACC-25, ACC-27 and again here). The config itself is irrelevant to this
// spec, which only reads an exported constant.
jest.mock('better-auth/api', () => ({ isAPIError: () => false }));
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: () => ({}),
}));

describe('ACCESS_TOKEN_TTL_SECONDS (ACC-122)', () => {
  const DEFAULT = 15 * 60;
  const original = process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'];

  const loadWith = (value: string | undefined): number => {
    if (value === undefined) delete process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'];
    else process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'] = value;

    let ttl = 0;
    jest.isolateModules(() => {
      ttl = (require('./auth.service') as { ACCESS_TOKEN_TTL_SECONDS: number })
        .ACCESS_TOKEN_TTL_SECONDS;
    });
    return ttl;
  };

  afterAll(() => {
    if (original === undefined) delete process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'];
    else process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'] = original;
  });

  it('is the documented 15 minutes when unset — every deployed environment', () => {
    expect(loadWith(undefined)).toBe(DEFAULT);
  });

  it('honours a shorter value, which is what the browser pass needs', () => {
    expect(loadWith('30')).toBe(30);
  });

  // THE POINT. A stray variable on Railway must not be able to hand out
  // day-long access tokens. A test-only affordance that can make production
  // less safe is not test-only.
  it('CLAMPS a longer value down to the default', () => {
    expect(loadWith(String(60 * 60 * 24))).toBe(DEFAULT);
    expect(loadWith('901')).toBe(DEFAULT);
  });

  it('falls back to the default on a value that is not a positive integer', () => {
    for (const bad of ['0', '-5', 'abc', '12.5', '']) {
      expect(loadWith(bad)).toBe(DEFAULT);
    }
  });
});
