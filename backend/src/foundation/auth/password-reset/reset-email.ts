import { RESET_LINK_TTL_MS } from './reset-link.config';

/**
 * The reset-link email, in both languages — ACC-188 (plan §4.1). Singular,
 * gender-neutral Arabic, «منشأة» for organisation (ACC-279).
 *
 * "1 hour" / «ساعة» is the link's lifetime; the spec pins it to
 * RESET_LINK_TTL_MS, so the two cannot drift apart.
 */
export const RESET_EMAIL_LIFETIME_HOURS = RESET_LINK_TTL_MS / 3_600_000;

const TEXT = {
  en: {
    subject: 'Reset your AccreditMe password',
    body:
      'We received a request to reset the password for your account at {organisation}. ' +
      'To choose a new password, open this link within 1 hour: {link}\n\n' +
      "The link works once. If you didn't ask for this, ignore this email; your password hasn't changed.",
  },
  ar: {
    subject: 'إعادة تعيين كلمة مرور AccreditMe',
    body:
      'وصل طلب لإعادة تعيين كلمة المرور لحسابك في منشأة {organisation}. ' +
      'لاختيار كلمة مرور جديدة، افتح هذا الرابط خلال ساعة: {link}\n\n' +
      'يعمل الرابط مرة واحدة فقط. إذا لم يكن الطلب منك، فتجاهل هذه الرسالة؛ كلمة المرور لم تتغير.',
  },
} as const;

export function renderResetEmail(
  language: 'en' | 'ar',
  organisation: string,
  link: string,
): { subject: string; body: string } {
  const text = TEXT[language];
  return {
    subject: text.subject,
    body: text.body.replace('{organisation}', organisation).replace('{link}', link),
  };
}
