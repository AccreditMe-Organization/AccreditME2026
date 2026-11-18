import { renderEmailHtml } from '../notification/email-html';
import { outsideCancelledEmail, outsideInvitationEmail, outsideRescheduledEmail } from './meeting-notices';

/**
 * ACC-316 PR 3b — an outside guest's email is built from text people typed (the
 * title, the place, the online link, a reason) and rendered by the one email
 * renderer, which escapes first and links only AccreditMe's own URLs (ACC-158).
 * Lane B's review, fix 5: prove a typed tag stays text, and a link is never ours.
 */
describe("an outside guest's email", () => {
  const links = { baseDomain: 'accreditme.app', devOrigin: null };
  const when = { en: '1 Dec 2026, 09:00', ar: '1 ديسمبر 2026، 09:00' };
  const org = { en: 'Al Nakheel', ar: 'النخيل' };
  const hostile = '<a href="https://evil.example/x">Click</a><script>alert(1)</script>';

  it.each([
    ['invitation', outsideInvitationEmail(hostile, org, when, { location: hostile, meetingUrl: 'https://teams.example/join/1' })],
    ['reschedule', outsideRescheduledEmail(hostile, org, when, hostile)],
    ['cancellation', outsideCancelledEmail(hostile, org, hostile)],
  ])('%s: a tag typed in the title, place or reason is escaped, in both languages', (_name, text) => {
    for (const [body, direction] of [
      [text.bodyEn, 'ltr'],
      [text.bodyAr, 'rtl'],
    ] as const) {
      const html = renderEmailHtml(body, direction, links);
      expect(html).not.toContain('<a href="https://evil.example');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;a href=');
      expect(html).toContain('&lt;script&gt;');
    }
  });

  it("the meeting's online link is text, never an anchor: it is not an AccreditMe link", () => {
    const text = outsideInvitationEmail('Board', org, when, { location: null, meetingUrl: 'https://teams.example/join/1' });
    const html = renderEmailHtml(text.bodyEn, 'ltr', links);
    expect(html).toContain('https://teams.example/join/1');
    expect(html).not.toContain('<a ');
  });
});
