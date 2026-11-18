/**
 * ACC-316 PR 3b — an email to someone with no user: a meeting's outside guest.
 * There is no Notification row (nothing to read in the app) and no link into
 * AccreditMe in it. The language is the ORGANISATION's (lane B, 18 Nov): an
 * outside guest has no preference of their own. The text is chosen when the job
 * is enqueued, so the worker only sends it.
 */
export const OUTSIDE_EMAIL_JOB = 'outside-email';

export interface OutsideEmailJobData {
  organizationId: string;
  to: string;
  subject: string;
  body: string;
  direction: 'ltr' | 'rtl';
}

/** The email in both languages; NotificationService.sendOutsideEmail() picks one. */
export interface OutsideEmailText {
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
}
