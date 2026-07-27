import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';

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
    const { notificationId } = job.data;

    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: true },
    });
    if (!notification) return; // notification was removed since the job was enqueued

    const useArabic = notification.user.language === 'ar' && !!notification.bodyAr;
    const subject = useArabic ? (notification.titleAr ?? notification.titleEn) : notification.titleEn;
    const body = useArabic ? (notification.bodyAr ?? notification.bodyEn) : notification.bodyEn;

    const result = await this.resend.emails.send({
      from: process.env['RESEND_FROM_EMAIL'] || 'noreply@accreditme.com',
      to: notification.user.email,
      subject,
      html: `<p>${body}</p>`,
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
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { sentAt: new Date() },
    });
  }
}
