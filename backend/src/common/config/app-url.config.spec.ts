import {
  APP_BASE_DOMAIN_MISSING,
  APP_BASE_DOMAIN_NOT_A_HOST,
  APP_LINK_ORIGIN_NOT_LOOPBACK,
  buildTenantUrl,
  resolveAppLinkConfig,
} from './app-url.config';

/**
 * ACC-158 — the link configuration and the builder.
 *
 * The defect this closes was a link with no host, so every test here asserts a
 * whole URL — scheme, host and path — never a substring of one.
 */
const BASE = { APP_BASE_DOMAIN: 'accreditme.app' };

describe('resolveAppLinkConfig (ACC-158)', () => {
  it('throws when APP_BASE_DOMAIN is absent, naming the variable', () => {
    expect(() => resolveAppLinkConfig({})).toThrow(APP_BASE_DOMAIN_MISSING);
    expect(APP_BASE_DOMAIN_MISSING).toContain('APP_BASE_DOMAIN');
  });

  it('throws when it is blank or whitespace', () => {
    for (const value of ['', '   ', '\t\n']) {
      expect(() => resolveAppLinkConfig({ APP_BASE_DOMAIN: value })).toThrow(
        APP_BASE_DOMAIN_MISSING,
      );
    }
  });

  // Pasting a URL where a host belongs would otherwise build
  // https://acme.https://accreditme.app/… — refused at boot instead.
  it('refuses anything that is not a bare host', () => {
    for (const value of [
      'https://accreditme.app',
      'accreditme.app/',
      'accreditme.app:443',
      'Accreditme.app',
      'accreditme app',
      'localhost',
    ]) {
      expect(() => resolveAppLinkConfig({ APP_BASE_DOMAIN: value })).toThrow(
        APP_BASE_DOMAIN_NOT_A_HOST,
      );
    }
  });

  it('returns the base domain, trimmed, and no override by default', () => {
    expect(
      resolveAppLinkConfig({ APP_BASE_DOMAIN: '  accreditme.app  ' }),
    ).toEqual({
      baseDomain: 'accreditme.app',
      devOrigin: null,
    });
  });

  it('accepts a loopback APP_LINK_ORIGIN, without a trailing slash', () => {
    for (const [value, expected] of [
      ['http://localhost:4200', 'http://localhost:4200'],
      ['http://localhost:4200/', 'http://localhost:4200'],
      ['http://127.0.0.1:4200', 'http://127.0.0.1:4200'],
      ['http://al-nakheel.localhost:4200', 'http://al-nakheel.localhost:4200'],
    ]) {
      expect(
        resolveAppLinkConfig({ ...BASE, APP_LINK_ORIGIN: value }).devOrigin,
      ).toBe(expected);
    }
  });

  // The guard keys off the VALUE, because the environment cannot say whether
  // this is development: Railway runs NODE_ENV=development.
  it('refuses an APP_LINK_ORIGIN that is not loopback, or not an origin', () => {
    for (const value of [
      'https://evil.example',
      'https://localhost.evil.example',
      'http://localhost:4200/accept-invitation',
      'ftp://localhost',
      'localhost:4200',
    ]) {
      expect(() =>
        resolveAppLinkConfig({ ...BASE, APP_LINK_ORIGIN: value }),
      ).toThrow(APP_LINK_ORIGIN_NOT_LOOPBACK);
    }
  });

  it('treats a blank APP_LINK_ORIGIN as unset', () => {
    expect(
      resolveAppLinkConfig({ ...BASE, APP_LINK_ORIGIN: '  ' }).devOrigin,
    ).toBeNull();
  });

  it('reads process.env by default, which is what main.ts relies on', () => {
    const saved = {
      b: process.env['APP_BASE_DOMAIN'],
      o: process.env['APP_LINK_ORIGIN'],
    };
    process.env['APP_BASE_DOMAIN'] = 'accreditme.app';
    delete process.env['APP_LINK_ORIGIN'];
    try {
      expect(resolveAppLinkConfig()).toEqual({
        baseDomain: 'accreditme.app',
        devOrigin: null,
      });
    } finally {
      if (saved.b === undefined) delete process.env['APP_BASE_DOMAIN'];
      else process.env['APP_BASE_DOMAIN'] = saved.b;
      if (saved.o === undefined) delete process.env['APP_LINK_ORIGIN'];
      else process.env['APP_LINK_ORIGIN'] = saved.o;
    }
  });
});

describe('buildTenantUrl (ACC-158)', () => {
  it("builds an absolute https URL on the tenant's own subdomain", () => {
    expect(
      buildTenantUrl('al-nakheel', '/accept-invitation?token=abc', BASE),
    ).toBe('https://al-nakheel.accreditme.app/accept-invitation?token=abc');
  });

  it('uses the development origin verbatim, without the slug, when it is set', () => {
    expect(
      buildTenantUrl('al-nakheel', '/accept-invitation?token=abc', {
        ...BASE,
        APP_LINK_ORIGIN: 'http://localhost:4200',
      }),
    ).toBe('http://localhost:4200/accept-invitation?token=abc');
  });

  it('refuses a path without a leading slash', () => {
    expect(() =>
      buildTenantUrl('al-nakheel', 'accept-invitation', BASE),
    ).toThrow(/must start with "\/"/);
  });

  it('refuses something that is not a slug', () => {
    for (const slug of [
      '',
      'Al-Nakheel',
      'al.nakheel',
      'evil.example/x',
      'a b',
    ]) {
      expect(() => buildTenantUrl(slug, '/x', BASE)).toThrow(
        /is not a tenant slug/,
      );
    }
  });

  // RegExp.test() coerces: the string "undefined" is a valid slug, so a
  // missing slug would otherwise build https://undefined.accreditme.app/….
  it('refuses a missing slug rather than writing "undefined" into the host', () => {
    expect(() =>
      buildTenantUrl(undefined as unknown as string, '/x', BASE),
    ).toThrow(/is not a tenant slug/);
  });

  it('refuses to build anything when the base domain is missing', () => {
    expect(() => buildTenantUrl('al-nakheel', '/x', {})).toThrow(
      APP_BASE_DOMAIN_MISSING,
    );
  });
});
