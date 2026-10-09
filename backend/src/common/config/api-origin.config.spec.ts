import {
  API_ORIGIN_MISSING,
  API_ORIGIN_NOT_AN_ORIGIN,
  resolveApiOrigin,
} from './api-origin.config';

// ACC-148 — the API's own origin, Better Auth's base URL. Required, and exactly
// an origin.
describe('resolveApiOrigin (ACC-148)', () => {
  it('returns the origin, trimmed and without a trailing slash', () => {
    for (const [value, expected] of [
      ['https://api.accreditme.app', 'https://api.accreditme.app'],
      [
        'https://accreditme2026-production.up.railway.app/',
        'https://accreditme2026-production.up.railway.app',
      ],
      ['  http://localhost:3000  ', 'http://localhost:3000'],
      ['http://localhost:3001', 'http://localhost:3001'],
    ]) {
      expect(resolveApiOrigin({ API_ORIGIN: value })).toBe(expected);
    }
  });

  it('throws when it is absent or blank, naming the variable', () => {
    for (const env of [{}, { API_ORIGIN: '' }, { API_ORIGIN: '   ' }]) {
      expect(() => resolveApiOrigin(env)).toThrow(API_ORIGIN_MISSING);
    }
    expect(API_ORIGIN_MISSING).toContain('API_ORIGIN');
  });

  it('refuses anything that is not an origin over https, or http on localhost', () => {
    for (const value of [
      'http://api.accreditme.app', // plain http off localhost
      'http://127.0.0.1:3000', // http only for "localhost" itself
      'https://api.accreditme.app/api/v1', // a path
      'api.accreditme.app', // no scheme
      'ftp://api.accreditme.app',
      'not a url',
    ]) {
      // Named in the assertion, since Jest has no withContext.
      let message = '';
      try {
        resolveApiOrigin({ API_ORIGIN: value });
      } catch (err) {
        message = (err as Error).message;
      }
      expect([value, message]).toEqual([value, API_ORIGIN_NOT_AN_ORIGIN]);
    }
  });

  it('reads process.env by default, which is what main.ts relies on', () => {
    const saved = process.env['API_ORIGIN'];
    process.env['API_ORIGIN'] = 'https://api.accreditme.app';
    try {
      expect(resolveApiOrigin()).toBe('https://api.accreditme.app');
    } finally {
      if (saved === undefined) delete process.env['API_ORIGIN'];
      else process.env['API_ORIGIN'] = saved;
    }
  });
});
