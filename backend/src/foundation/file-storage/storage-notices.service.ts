import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const GIB = 1024 ** 3;

/** ACC-185 — why the customer's SharePoint can no longer be reached. */
export type SharePointAccessLostReason = 'SECRET_INVALID' | 'CONSENT_REVOKED' | 'GRANT_REMOVED' | 'LIBRARY_GONE';

const ACCESS_LOST_WORDS: Readonly<Record<SharePointAccessLostReason, { en: string; ar: string }>> = {
  SECRET_INVALID: { en: 'the client secret is invalid or has expired', ar: 'سرّ العميل غير صالح أو انتهت صلاحيته' },
  CONSENT_REVOKED: {
    en: "the app's permission was removed in your Microsoft tenant, or the app was disabled or deleted",
    ar: 'أُزيل إذن التطبيق في مستأجر Microsoft لديكم، أو عُطّل التطبيق أو حُذف',
  },
  GRANT_REMOVED: { en: 'the app no longer has access to the library', ar: 'لم يعد للتطبيق وصول إلى المكتبة' },
  LIBRARY_GONE: { en: 'the library no longer exists', ar: 'لم تعد المكتبة موجودة' },
};

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

  /**
   * ACC-185 — the customer's SharePoint can no longer be reached. Sent ONCE per
   * loss: only the call that stamps storageAccessLostAt sends it.
   */
  async sharePointAccessLost(organizationId: string, reason: SharePointAccessLostReason, libraryName: string | null): Promise<void> {
    const why = ACCESS_LOST_WORDS[reason];
    const library = libraryName ? ` (${libraryName})` : '';
    for (const admin of await this.tenantAdmins(organizationId)) {
      await this.send(
        {
          userId: admin.id,
          titleEn: "SharePoint storage can't be reached",
          titleAr: 'تعذّر الوصول إلى تخزين SharePoint',
          bodyEn: `AccreditMe can no longer reach your SharePoint library${library}: ${why.en}. Uploads and downloads of files stored there are paused until your Microsoft administrator restores access. Nothing is lost.`,
          bodyAr: `لم يعد بإمكان AccreditMe الوصول إلى مكتبة SharePoint لديكم${library}: ${why.ar}. رفع الملفات المخزّنة هناك وتنزيلها متوقفان إلى أن يعيد مسؤول Microsoft لديكم الوصول. لم يُفقد شيء.`,
          objectType: 'Organization',
          objectId: organizationId,
        },
        organizationId,
      );
    }
  }

  /** ACC-185 — the SharePoint client secret expires within 30 days. Sent once per date. */
  async sharePointSecretExpiring(organizationId: string, expiresOn: string): Promise<void> {
    const date = DateTime.fromISO(expiresOn, { zone: 'utc' });
    const onEn = date.setLocale('en').toFormat('d LLL yyyy');
    const onAr = date.setLocale('ar').reconfigure({ numberingSystem: 'latn' }).toFormat('d LLLL yyyy');
    for (const admin of await this.tenantAdmins(organizationId)) {
      await this.send(
        {
          userId: admin.id,
          titleEn: 'SharePoint client secret expires soon',
          titleAr: 'سرّ عميل SharePoint ينتهي قريبًا',
          bodyEn: `The client secret AccreditMe uses for your SharePoint library expires on ${onEn}. Ask your Microsoft administrator for a new secret and enter it under Replace secret before then, or uploads and downloads will pause.`,
          bodyAr: `ينتهي سرّ العميل الذي يستخدمه AccreditMe لمكتبة SharePoint لديكم في ${onAr}. اطلبوا من مسؤول Microsoft سرًّا جديدًا وأدخلوه في «استبدال السر» قبل ذلك، وإلا توقف رفع الملفات وتنزيلها.`,
          objectType: 'Organization',
          objectId: organizationId,
        },
        organizationId,
      );
    }
  }

  private tenantAdmins(organizationId: string): Promise<Array<{ id: string }>> {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'TENANT_ADMIN', isActive: true } } },
      },
      select: { id: true },
    });
  }

  private async send(dto: Parameters<NotificationService['create']>[0], organizationId: string): Promise<void> {
    try {
      await this.notifications.create(dto, organizationId);
    } catch (error) {
      this.logger.error(`A storage notice to user ${dto.userId} could not be sent: ${(error as Error).message}`);
    }
  }
}
