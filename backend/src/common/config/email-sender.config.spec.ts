import { PLATFORM_SENDER_MISSING, resolvePlatformSender } from './email-sender.config';

// ACC-130 — the platform's sender address: RESEND_FROM_EMAIL or nothing.
describe('resolvePlatformSender (ACC-130)', () => {
  it('returns the configured sender, trimmed', () => {
    expect(resolvePlatformSender({ RESEND_FROM_EMAIL: 'noreply@accreditme.app' })).toBe('noreply@accreditme.app');
    expect(resolvePlatformSender({ RESEND_FROM_EMAIL: '  noreply@accreditme.app  ' })).toBe('noreply@accreditme.app');
  });

  it('returns null when it is unset or blank — never a guessed address', () => {
    for (const env of [{}, { RESEND_FROM_EMAIL: '' }, { RESEND_FROM_EMAIL: '   ' }]) {
      expect(resolvePlatformSender(env)).toBeNull();
    }
  });

  it('names the variable in the refusal', () => {
    expect(PLATFORM_SENDER_MISSING).toContain('RESEND_FROM_EMAIL');
  });

  it('reads process.env by default, which is what the email processor relies on', () => {
    const saved = process.env['RESEND_FROM_EMAIL'];
    process.env['RESEND_FROM_EMAIL'] = 'noreply@accreditme.app';
    try {
      expect(resolvePlatformSender()).toBe('noreply@accreditme.app');
    } finally {
      if (saved === undefined) delete process.env['RESEND_FROM_EMAIL'];
      else process.env['RESEND_FROM_EMAIL'] = saved;
    }
  });
});
