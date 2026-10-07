import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const GIB = 1024 ** 3;

/**
 * ACC-177 — the two storage notices, both in-app, English and Arabic, and both
 * sent AFTER the change that caused them has committed. A notice that fails to
 * send is logged and never undoes the change.
 *
 *   - "storage almost full" → the organisation's ACTIVE tenant admins;
 *   - "a storage change was requested" → every ACTIVE platform admin of
 *     AccreditMe's platform organisation (isPlatformOrg AND PLATFORM_ADMIN —
 *     the same pair PlatformGuard requires).
 */
@Injectable()
export class StorageNoticesService {
  private readonly logger = new Logger(StorageNoticesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async storageAlmostFull(organizationId: string, usedBytes: number, limitBytes: number): Promise<void> {
    const percent = Math.floor((usedBytes / limitBytes) * 100);
    const used = (usedBytes / GIB).toFixed(1);
    const limit = (limitBytes / GIB).toFixed(0);
    const admins = await this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'TENANT_ADMIN', isActive: true } } },
      },
      select: { id: true },
    });
    for (const admin of admins) {
      await this.send(
        {
          userId: admin.id,
          titleEn: 'File storage almost full',
          titleAr: 'مساحة تخزين الملفات توشك على الامتلاء',
          bodyEn: `Your organization has used ${percent}% of its file storage (${used} GB of ${limit} GB). Deleted files count until they are purged from the recycle bin.`,
          bodyAr: `استخدمت مؤسستك ${percent}٪ من مساحة تخزين الملفات (${used} من ${limit} غيغابايت). تُحتسب الملفات المحذوفة إلى أن تُحذف نهائيًا من سلة المحذوفات.`,
          objectType: 'Organization',
          objectId: organizationId,
        },
        organizationId,
      );
    }
  }

  async storageChangeRequested(organizationId: string, requesterId: string, at: Date, message: string | null): Promise<void> {
    const [org, requester, admins] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: organizationId }, select: { name: true, nameAr: true } }),
      this.prisma.user.findFirst({ where: { id: requesterId, organizationId }, select: { name: true } }),
      this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          organization: { isPlatformOrg: true },
          userRoles: { some: { role: { key: 'PLATFORM_ADMIN', isActive: true } } },
        },
        select: { id: true, organizationId: true },
      }),
    ]);
    if (!org || !requester) return;
    // UTC and labelled: a platform admin reads requests from tenants in many zones.
    const when = DateTime.fromJSDate(at, { zone: 'utc' });
    const whenEn = `${when.setLocale('en').toFormat('d LLL yyyy, HH:mm')} UTC`;
    const whenAr = `${when.setLocale('ar').reconfigure({ numberingSystem: 'latn' }).toFormat('d LLLL yyyy، HH:mm')} UTC`;
    const quotedEn = message ? ` Their message: “${message}”` : ' They left no message.';
    const quotedAr = message ? ` رسالته: «${message}»` : ' لم يترك رسالة.';
    for (const admin of admins) {
      await this.send(
        {
          userId: admin.id,
          titleEn: 'Storage change requested',
          titleAr: 'طلب تغيير مكان تخزين الملفات',
          bodyEn: `${org.name} asked to change where its files are stored. Asked by ${requester.name} on ${whenEn}.${quotedEn}`,
          bodyAr: `طلبت ${org.nameAr ?? org.name} تغيير مكان تخزين ملفاتها. الطلب من ${requester.name} في ${whenAr}.${quotedAr}`,
          objectType: 'Organization',
          objectId: organizationId,
        },
        admin.organizationId,
      );
    }
  }

  private async send(dto: Parameters<NotificationService['create']>[0], organizationId: string): Promise<void> {
    try {
      await this.notifications.create(dto, organizationId);
    } catch (error) {
      this.logger.error(`A storage notice to user ${dto.userId} could not be sent: ${(error as Error).message}`);
    }
  }
}
