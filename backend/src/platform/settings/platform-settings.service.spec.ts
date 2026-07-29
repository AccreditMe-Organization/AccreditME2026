import { NotFoundException } from '@nestjs/common';
import { PlatformSettingsService } from './platform-settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

const PLATFORM_ORG_ID = 'platform-org';
const ACTOR_ID = 'platform-admin-1';

describe('PlatformSettingsService', () => {
  let service: PlatformSettingsService;
  let mockPrisma: { organization: { findFirst: jest.Mock; update: jest.Mock } };
  let mockAuditLog: { log: jest.Mock };

  beforeEach(() => {
    mockPrisma = { organization: { findFirst: jest.fn(), update: jest.fn() } };
    mockAuditLog = { log: jest.fn() };
    service = new PlatformSettingsService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
    );
  });

  describe('getSettings', () => {
    it('returns null announcement when no platform org or announcement exists', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      const result = await service.getSettings();
      expect(result).toEqual({ announcement: null });
    });

    it('returns the stored announcement', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        id: PLATFORM_ORG_ID,
        settings: { platformAnnouncement: { message: 'Maintenance', severity: 'warning', activeFrom: null, activeUntil: null } },
      });
      const result = await service.getSettings();
      expect(result.announcement?.message).toBe('Maintenance');
    });
  });

  describe('updateSettings', () => {
    it('throws NotFoundException when no platform org exists', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue(null);
      await expect(
        service.updateSettings({ message: 'Hi', severity: 'info' }, ACTOR_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('merges the announcement into settings without clobbering other keys and logs', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        id: PLATFORM_ORG_ID,
        settings: { taskSla: { CRITICAL: 4 } },
      });

      await service.updateSettings({ message: 'Hi', severity: 'info' }, ACTOR_ID);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: PLATFORM_ORG_ID },
        data: {
          settings: {
            taskSla: { CRITICAL: 4 },
            platformAnnouncement: { message: 'Hi', severity: 'info', activeFrom: null, activeUntil: null },
          },
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PLATFORM_ORG_ID, actorId: ACTOR_ID, action: 'UPDATE' }),
      );
    });
  });
});
