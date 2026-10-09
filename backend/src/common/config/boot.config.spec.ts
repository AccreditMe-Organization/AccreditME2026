import { validateBootConfig } from './boot.config';
import { FRONTEND_URL_MISSING } from './cors.config';
import {
  APP_BASE_DOMAIN_MISSING,
  APP_LINK_ORIGIN_NOT_LOOPBACK,
} from './app-url.config';
import { API_ORIGIN_MISSING } from './api-origin.config';

/**
 * ACC-158 — the boot check, proven by a test rather than by reading main.ts.
 *
 * main.ts calls validateBootConfig() before NestFactory.create(), so whatever
 * this function refuses, the API refuses to start with.
 */
const VALID = {
  FRONTEND_URL: 'http://localhost:4200',
  APP_BASE_DOMAIN: 'accreditme.app',
  API_ORIGIN: 'http://localhost:3000',
};

describe('validateBootConfig (ACC-158)', () => {
  // Guard first: a complete environment passes. Without this, the refusals
  // below could pass against a function that throws on everything.
  it('returns the resolved configuration when everything required is set', () => {
    expect(validateBootConfig(VALID)).toEqual({
      frontendOrigin: 'http://localhost:4200',
      appLinks: { baseDomain: 'accreditme.app', devOrigin: null },
      apiOrigin: 'http://localhost:3000',
    });
  });

  it('refuses to boot without APP_BASE_DOMAIN', () => {
    expect(() =>
      validateBootConfig({ FRONTEND_URL: VALID.FRONTEND_URL }),
    ).toThrow(APP_BASE_DOMAIN_MISSING);
  });

  it('refuses to boot with a non-loopback APP_LINK_ORIGIN', () => {
    expect(() =>
      validateBootConfig({ ...VALID, APP_LINK_ORIGIN: 'https://evil.example' }),
    ).toThrow(APP_LINK_ORIGIN_NOT_LOOPBACK);
  });

  it('still refuses to boot without FRONTEND_URL (ACC-128)', () => {
    expect(() =>
      validateBootConfig({
        APP_BASE_DOMAIN: VALID.APP_BASE_DOMAIN,
        API_ORIGIN: VALID.API_ORIGIN,
      }),
    ).toThrow(FRONTEND_URL_MISSING);
  });

  it('refuses to boot without API_ORIGIN (ACC-148)', () => {
    expect(() =>
      validateBootConfig({
        FRONTEND_URL: VALID.FRONTEND_URL,
        APP_BASE_DOMAIN: VALID.APP_BASE_DOMAIN,
      }),
    ).toThrow(API_ORIGIN_MISSING);
  });
});
