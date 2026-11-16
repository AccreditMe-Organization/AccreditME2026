import {
  SECURITY_NOTICES,
  SECURITY_NOTICE_JOB,
  SecurityNoticeService,
  renderSecurityNotice,
} from './security-notice';

describe('security notices (ACC-188, shared with ACC-164)', () => {
  it('enqueues an email-delivery job carrying only who and which notice', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    await new SecurityNoticeService(queue as never).enqueue({
      organizationId: 'org-a',
      userId: 'u-a',
      notice: 'password_changed',
    });
    expect(queue.add).toHaveBeenCalledWith(
      SECURITY_NOTICE_JOB,
      { organizationId: 'org-a', userId: 'u-a', notice: 'password_changed' },
      { removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
    );
  });

  it('has every notice in both languages, Arabic with «منشأة», and no link', () => {
    for (const notice of Object.keys(SECURITY_NOTICES) as (keyof typeof SECURITY_NOTICES)[]) {
      const en = renderSecurityNotice(notice, 'en', 'Al Nakheel');
      const ar = renderSecurityNotice(notice, 'ar', 'النخيل');
      expect(en.body).toContain('Al Nakheel');
      expect(ar.body).toContain('منشأة النخيل');
      expect(ar.subject).toMatch(/[؀-ۿ]/);
      expect(`${en.body}${ar.body}`).not.toMatch(/https?:/);
    }
  });
});
