import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { resolveAppLinkConfig } from '../../common/config/app-url.config';
import {
  PLATFORM_SENDER_MISSING,
  resolvePlatformSender,
} from '../../common/config/email-sender.config';
import { renderEmailHtml } from './email-html';

export interface TransactionalEmail {
  to: string;
  subject: string;
  /** Plain text; product links in it become anchors (email-html.ts). */
  body: string;
  direction: 'ltr' | 'rtl';
}

/**
 * The one Resend sender — ACC-188. Used by the notification email worker, the
 * security notices and the reset link, so the sender address rule (ACC-130: no
 * fallback) and the HTML rendering (ACC-158) live in one place.
 *
 * It sends; it never stores. What it is given is not written anywhere by this
 * service, which is what lets the reset link pass through it.
 */
@Injectable()
export class TransactionalEmailService {
  private readonly resend = new Resend(process.env['RESEND_API_KEY']);

  async send(email: TransactionalEmail): Promise<void> {
    // ACC-130 — no fallback address. Throwing makes BullMQ record the failure.
    const from = resolvePlatformSender();
    if (!from) throw new Error(PLATFORM_SENDER_MISSING);

    const result = await this.resend.emails.send({
      from,
      to: email.to,
      subject: email.subject,
      html: renderEmailHtml(email.body, email.direction, resolveAppLinkConfig()),
    });

    // Resend resolves with { data: null, error } on an API-level error rather
    // than throwing. Re-throwing is what lets BullMQ record or retry it.
    if (result.error) {
      throw new Error(
        `Resend delivery failed: ${result.error.message ?? JSON.stringify(result.error)}`,
      );
    }
  }
}
