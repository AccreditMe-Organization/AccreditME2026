import { RESET_EMAIL_LIFETIME_HOURS, renderResetEmail } from './reset-email';
import { RESET_LINK_TTL_MS } from './reset-link.config';

describe('the reset-link email (ACC-188)', () => {
  const link = 'https://al-nakheel.accreditme.app/reset-password?token=TOKEN';

  it('says "1 hour" because a link lasts exactly one hour — change both together', () => {
    expect(RESET_LINK_TTL_MS).toBe(3_600_000);
    expect(RESET_EMAIL_LIFETIME_HOURS).toBe(1);
    expect(renderResetEmail('en', 'Al Nakheel', link).body).toContain('within 1 hour');
    expect(renderResetEmail('ar', 'النخيل', link).body).toContain('خلال ساعة');
  });

  it('names the organisation and carries the link once, in both languages', () => {
    for (const [language, org] of [['en', 'Al Nakheel'], ['ar', 'النخيل']] as const) {
      const { subject, body } = renderResetEmail(language, org, link);
      expect(subject).toBeTruthy();
      expect(body.split(link)).toHaveLength(2);
      expect(body).toContain(org);
      expect(body).not.toContain('{');
    }
    expect(renderResetEmail('ar', 'النخيل', link).body).toContain('منشأة النخيل');
  });
});
