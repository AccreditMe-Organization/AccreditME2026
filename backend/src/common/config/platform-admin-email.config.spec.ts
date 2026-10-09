import { PLATFORM_ADMIN_EMAIL_MISSING, resolvePlatformAdminEmail } from './platform-admin-email.config';

// ACC-130 — the demo seed's platform administrator address: chosen, or refused.
describe('resolvePlatformAdminEmail (ACC-130)', () => {
  it('returns the configured address, trimmed', () => {
    expect(resolvePlatformAdminEmail({ PLATFORM_ADMIN_EMAIL: 'owner@example.test' })).toBe('owner@example.test');
    expect(resolvePlatformAdminEmail({ PLATFORM_ADMIN_EMAIL: '  owner@example.test ' })).toBe('owner@example.test');
  });

  it('throws when it is unset or blank, naming the variable, rather than guess an address', () => {
    for (const env of [{}, { PLATFORM_ADMIN_EMAIL: '' }, { PLATFORM_ADMIN_EMAIL: '  ' }]) {
      expect(() => resolvePlatformAdminEmail(env)).toThrow(PLATFORM_ADMIN_EMAIL_MISSING);
    }
    expect(PLATFORM_ADMIN_EMAIL_MISSING).toContain('PLATFORM_ADMIN_EMAIL');
  });
});
