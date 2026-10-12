import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

/**
 * ACC-194 — "AI credits used up", in-app, English and Arabic, to the
 * organisation's ACTIVE holders of an active TENANT_ADMIN role. Modelled on
 * StorageNoticesService.storageAlmostFull(). Sent at most once per credit
 * period: the caller only calls this after AiCreditService.claimNotice()
 * returned true. A notice that fails to send is logged and never undoes or
 * blocks anything.
 *
 * It is a bell EVENT (ACC-82): running out is the expected end of a period,
 * not a standing configuration gap, so there is no Setup health condition.
 * The date is server-built text — ACC-95's known limitation — written in
 * UTC with Latin digits, like every date the product shows.
 */
@Injectable()
export class AiNoticesService {
  private readonly logger = new Logger(AiNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async creditsUsedUp(organizationId: string, renewsAt: Date): Promise<void> {
    const when = DateTime.fromJSDate(renewsAt, { zone: 'utc' });
    const dateEn = when.setLocale('en-GB').toFormat('d LLL yyyy');
    const dateAr = when.setLocale('ar').reconfigure({ numberingSystem: 'latn' }).toFormat('d LLLL yyyy');

    const admins = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'TENANT_ADMIN', isActive: true } } },
      },
      select: { id: true },
    });
    for (const admin of admins) {
      try {
        await this.notifications.create(
          {
            userId: admin.id,
            titleEn: 'AI credits used up',
            titleAr: 'نفدت أرصدة الذكاء الاصطناعي',
            bodyEn: `Your organization has used all its AI credits for this period. They renew on ${dateEn}.`,
            bodyAr: `استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لهذه الفترة، وتتجدد في ${dateAr}.`,
            objectType: 'Organization',
            objectId: organizationId,
          },
          organizationId,
        );
      } catch (error) {
        this.logger.error(`The "AI credits used up" notice to user ${admin.id} could not be sent: ${(error as Error).message}`);
      }
    }
  }
}
