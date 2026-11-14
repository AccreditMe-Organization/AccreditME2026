import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Security notices — ACC-188, shared with ACC-164.
 *
 * A security notice ("your password was changed") is an EMAIL ONLY, never a
 * Notification row: a row sits in the bell, where whoever holds the session can
 * read it and mark it read, and NotificationService.create() also copies the
 * whole body into the audit trail beside the event's own audit row.
 *
 * The request enqueues an `email-delivery` job named `security-notice` carrying
 * only who and which notice. The worker reads the person and the organisation,
 * picks the language, renders from this table and sends. Nothing secret is ever
 * in the job, the template or the email. ACC-164 adds its two notices here.
 */
export type SecurityNotice = 'password_changed' | 'mfa_disabled' | 'mfa_reset';

export const SECURITY_NOTICE_JOB = 'security-notice';

export interface SecurityNoticeJobData {
  organizationId: string;
  userId: string;
  notice: SecurityNotice;
}

interface NoticeText {
  subject: string;
  /** `{organisation}` is replaced with the organisation's name. */
  body: string;
}

export const SECURITY_NOTICES: Readonly<
  Record<SecurityNotice, { en: NoticeText; ar: NoticeText }>
> = Object.freeze({
  password_changed: {
    en: {
      subject: 'Your AccreditMe password was changed',
      body:
        'The password for your account at {organisation} was just changed, and you were signed out everywhere. ' +
        "If this wasn't you, contact your organisation's administrator now.",
    },
    ar: {
      subject: 'تم تغيير كلمة مرور AccreditMe',
      body:
        'تم تغيير كلمة المرور لحسابك في منشأة {organisation} للتو، وتم تسجيل خروجك من كل الأجهزة. ' +
        'إذا لم يكن هذا منك، فتواصل مع مسؤول النظام في منشأتك الآن.',
    },
  },
  // ACC-164 — the person turned two-step sign-in off themselves. Their other
  // sessions are NOT ended (Ahmad, 14 Nov), so the email says nothing about
  // being signed out.
  mfa_disabled: {
    en: {
      subject: 'Two-step sign-in was turned off',
      body:
        'Two-step sign-in was turned off for your account at {organisation}. Signing in now needs only your password. ' +
        "If this wasn't you, change your password and contact your organisation's administrator now.",
    },
    ar: {
      subject: 'تم إيقاف التحقق بخطوتين',
      body:
        'تم إيقاف التحقق بخطوتين لحسابك في منشأة {organisation}. يكفي الآن إدخال كلمة المرور لتسجيل الدخول. ' +
        'إذا لم يكن هذا منك، فغيّر كلمة المرور وتواصل مع مسؤول النظام في منشأتك الآن.',
    },
  },
  // ACC-164 — an administrator reset it. The administrator is not named: the
  // audit row names them, and an email naming a colleague travels further.
  mfa_reset: {
    en: {
      subject: 'Your two-step sign-in was reset',
      body:
        'An administrator at {organisation} reset two-step sign-in for your account, and you were signed out everywhere. ' +
        'Sign in with your password, then set two-step sign-in up again from your profile. ' +
        "If you didn't ask for this, contact your organisation's administrator now.",
    },
    ar: {
      subject: 'تمت إعادة ضبط التحقق بخطوتين لحسابك',
      body:
        'أعاد مسؤول في منشأة {organisation} ضبط التحقق بخطوتين لحسابك، وتم تسجيل خروجك من كل الأجهزة. ' +
        'سجّل الدخول بكلمة المرور، ثم أعد إعداد التحقق بخطوتين من ملفك الشخصي. ' +
        'إذا لم يكن الطلب منك، فتواصل مع مسؤول النظام في منشأتك الآن.',
    },
  },
});

/** The notice in one language, with the organisation's name filled in. */
export function renderSecurityNotice(
  notice: SecurityNotice,
  language: 'en' | 'ar',
  organisation: string,
): NoticeText {
  const text = SECURITY_NOTICES[notice][language];
  return { subject: text.subject, body: text.body.replace('{organisation}', organisation) };
}

/** Enqueues a security notice. Call it AFTER the change has committed. */
@Injectable()
export class SecurityNoticeService {
  constructor(@InjectQueue('email-delivery') private readonly emailQueue: Queue) {}

  async enqueue(data: SecurityNoticeJobData): Promise<void> {
    await this.emailQueue.add(SECURITY_NOTICE_JOB, data, {
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    });
  }
}
