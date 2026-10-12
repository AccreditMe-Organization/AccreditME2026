import { PLATFORM_SIGN_IN_LABELS } from './reserved-slugs';
import { PLATFORM_ORGANIZATION_SLUG, isAtOwnAddress } from './session-address';

// ACC-204 — whether a browser session is used at its own organisation's address.
describe('session address (ACC-204)', () => {
  const PROD = { APP_BASE_DOMAIN: 'accreditme.app' };
  const LOCAL = {
    APP_BASE_DOMAIN: 'accreditme.app',
    APP_LINK_ORIGIN: 'http://localhost:4200',
  };

  it('the platform address resolves to the platform organisation (slug `platform`)', () => {
    expect(PLATFORM_ORGANIZATION_SLUG).toBe('platform');
    // The same label the sign-in screens and CreateTenantDto treat as the
    // platform's own, so the two cannot disagree.
    expect(PLATFORM_SIGN_IN_LABELS).toContain(PLATFORM_ORGANIZATION_SLUG);
    expect(
      isAtOwnAddress(
        'https://platform.accreditme.app',
        PLATFORM_ORGANIZATION_SLUG,
        PROD,
      ),
    ).toBe(true);
    expect(
      isAtOwnAddress(
        'http://platform.localhost:4200',
        PLATFORM_ORGANIZATION_SLUG,
        LOCAL,
      ),
    ).toBe(true);
  });

  it('is true only for the expected organisation’s own address', () => {
    expect(
      isAtOwnAddress('https://al-nakheel.accreditme.app', 'al-nakheel', PROD),
    ).toBe(true);
    expect(
      isAtOwnAddress('https://al-manara.accreditme.app', 'al-nakheel', PROD),
    ).toBe(false);
    expect(
      isAtOwnAddress('http://al-nakheel.localhost:4200', 'al-nakheel', LOCAL),
    ).toBe(true);
    expect(
      isAtOwnAddress('http://al-nakheel.localhost:4200', 'al-nakheel', PROD),
    ).toBe(false);
  });

  it('is false with no usable Origin', () => {
    for (const origin of [
      undefined,
      '',
      'null',
      ['https://al-nakheel.accreditme.app'],
      'https://accreditme.app',
    ]) {
      expect([origin, isAtOwnAddress(origin, 'al-nakheel', PROD)]).toEqual([
        origin,
        false,
      ]);
    }
  });
});
