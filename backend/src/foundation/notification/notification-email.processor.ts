import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveAppLinkConfig } from '../../common/config/app-url.config';
import {
  PLATFORM_SENDER_MISSING,
  resolvePlatformSender,
} from '../../common/config/email-sender.config';
import { renderEmailHtml } from './email-html';

interface EmailDeliveryJobData {
  notificationId: string;
  organizationId: string;
}

// First real call to the `resend` package in the codebase (present in
// package.json since scaffold, never used) — mirrors how Step 6 was the
// first real activation of BullMQ.
@Processor('email-delivery')
export class NotificationEmailProcessor extends WorkerHost {
  private readonly resend = new Resend(process.env['RESEND_API_KEY']);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<EmailDeliveryJobData>): Promise<void> {
    const { notificationId, organizationId } = job.data;

    // Scoped by id AND organizationId together, like every tenant read. The job
    // carries both because NotificationService.create() enqueues both; reading
    // by id alone trusted the queue to name a row of the right tenant.
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, organizationId },
      include: { user: true },
    });
    if (!notification) return; // notification was removed since the job was enqueued

    const useArabic =
      notification.user.language === 'ar' && !!notification.bodyAr;
    const subject = useArabic
      ? (notification.titleAr ?? notification.titleEn)
      : notification.titleEn;
    const body = useArabic
      ? (notification.bodyAr ?? notification.bodyEn)
      : notification.bodyEn;

    // ACC-130 — no fallback address: the old one was on accreditme.com, which
    // is not ours. Throwing makes BullMQ record the failure and leaves sentAt
    // null, the same signal as a refused send (see email-sender.config.ts).
    const from = resolvePlatformSender();
    if (!from) throw new Error(PLATFORM_SENDER_MISSING);

    const result = await this.resend.emails.send({
      from,
      to: notification.user.email,
      subject,
      // ACC-158 — escaped, with the product's own links as anchors, and an
      // Arabic body marked right-to-left. See email-html.ts.
      html: renderEmailHtml(
        body,
        useArabic ? 'rtl' : 'ltr',
        resolveAppLinkConfig(),
      ),
    });

    if (result.error) {
      // Resend does not throw on an API-level error — it resolves with
      // { data: null, error }. Re-throwing here is what makes BullMQ's own
      // retry (attempts + backoff, configured in QueueModule) actually fire;
      // without this, a failed send would be silently treated as complete.
      throw new Error(
        `Resend delivery failed: ${result.error.message ?? JSON.stringify(result.error)}`,
      );
    }

    // Only stamped on confirmed success — a null sentAt on an EMAIL/BOTH row
    // after its job should have completed is the failure indicator (see plan
    // Business Rules — "Why Email Delivery Has No Execution-Log Table").
    await this.prisma.notification.updateMany({
      where: { id: notificationId, organizationId },
      data: { sentAt: new Date() },
    });
  }
}
