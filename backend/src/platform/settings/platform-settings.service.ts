// PlatformSettingsService — deliberately minimal (ACC-13, step-12-admin-portal.md
// Section 3 Commit 7). No new model — the platform-wide announcement banner is
// stored under the one isPlatformOrg: true Organization row's own settings
// JSON, same pattern every other tenant already uses for its own settings.
// Expand only when a second real platform-setting need appears.

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { UpdatePlatformSettingsDto } from './dto/update-platform-settings.dto';
import { IPlatformAnnouncement, IPlatformSettings } from './interfaces/platform-settings.interface';

interface PlatformOrgSettings {
  platformAnnouncement?: IPlatformAnnouncement;
  [key: string]: unknown;
}

@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Read by any authenticated user (the frontend needs the active
  // announcement regardless of role) — no PlatformGuard on this method's
  // controller endpoint.
  async getSettings(): Promise<IPlatformSettings> {
    const platformOrg = await this.prisma.organization.findFirst({ where: { isPlatformOrg: true } });
    const settings = (platformOrg?.settings as PlatformOrgSettings | null) ?? {};
    return { announcement: settings.platformAnnouncement ?? null };
  }

  async updateSettings(dto: UpdatePlatformSettingsDto, actorId: string): Promise<void> {
    const platformOrg = await this.prisma.organization.findFirst({ where: { isPlatformOrg: true } });
    if (!platformOrg) throw new NotFoundException('Platform organization not found');

    const settings = (platformOrg.settings as PlatformOrgSettings | null) ?? {};
    const announcement: IPlatformAnnouncement = {
      message: dto.message,
      severity: dto.severity,
      activeFrom: dto.activeFrom ?? null,
      activeUntil: dto.activeUntil ?? null,
    };

    await this.prisma.organization.update({
      where: { id: platformOrg.id },
      data: {
        // IPlatformAnnouncement has no index signature, so it doesn't
        // structurally satisfy Prisma's recursive InputJsonValue check on
        // its own (unlike Record<string, boolean>-shaped merges elsewhere in
        // this codebase) — the values are still plain JSON-safe data.
        settings: { ...settings, platformAnnouncement: announcement } as unknown as Prisma.InputJsonValue,
      },
    });

    await this.auditLog.log({
      tenantId: platformOrg.id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: platformOrg.id,
      metadata: { event: 'platform_settings_updated' },
    });
  }
}
