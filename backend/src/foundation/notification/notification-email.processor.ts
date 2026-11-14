import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionalEmailService } from './transactional-email.service';
import {
  SECURITY_NOTICE_JOB,
  SecurityNoticeJobData,
  renderSecurityNotice,
} from './security-notice';

interface EmailDeliveryJobData {
  notificationId: string;
  organizationId: string;
}

// First real call to the `resend` package in the codebase (present in
// package.json since scaffold, never used) — mirrors how Step 6 was the
// first real activation of BullMQ. ACC-188 moved the Resend call itself into
// TransactionalEmailService, which this worker and the security notices share.
@Processor('email-delivery')
export class NotificationEmailProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
  ) {
    super();
  }

  async process(job: Job<EmailDeliveryJobData | SecurityNoticeJobData>): Promise<void> {
    if (job.name === SECURITY_NOTICE_JOB) {
      await this.sendSecurityNotice(job.data as SecurityNoticeJobData);
      return;
    }
    const { notificationId, organizationId } = job.data as EmailDeliveryJobData;

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

    // ACC-158 — escaped, with the product's own links as anchors, and an
    // Arabic body marked right-to-left (TransactionalEmailService). A failed
    // send throws, which is what makes BullMQ's retry fire.
    await this.email.send({
      to: notification.user.email,
      subject,
      body,
      direction: useArabic ? 'rtl' : 'ltr',
    });

    // Only stamped on confirmed success — a null sentAt on an EMAIL/BOTH row
    // after its job should have completed is the failure indicator (see plan
    // Business Rules — "Why Email Delivery Has No Execution-Log Table").
    await this.prisma.notification.updateMany({
      where: { id: notificationId, organizationId },
      data: { sentAt: new Date() },
    });
  }

  // ACC-188 — a security notice: an email only, never a Notification row
  // (security-notice.ts). The language is the person's, else the
  // organisation's, else English — the same rule as sign-in.
  private async sendSecurityNotice(data: SecurityNoticeJobData): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: data.userId, organizationId: data.organizationId },
      select: {
        email: true,
        language: true,
        organization: { select: { name: true, nameAr: true, language: true } },
      },
    });
    if (!user) return;

    const language =
      (user.language ?? user.organization.language) === 'ar' ? 'ar' : 'en';
    const organisation =
      language === 'ar'
        ? (user.organization.nameAr ?? user.organization.name)
        : user.organization.name;
    const { subject, body } = renderSecurityNotice(data.notice, language, organisation);

    await this.email.send({
      to: user.email,
      subject,
      body,
      direction: language === 'ar' ? 'rtl' : 'ltr',
    });
  }
}
