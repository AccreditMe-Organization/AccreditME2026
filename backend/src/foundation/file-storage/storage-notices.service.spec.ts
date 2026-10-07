import { StorageNoticesService } from './storage-notices.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const GIB = 1024 ** 3;

describe('StorageNoticesService (ACC-177)', () => {
  const prisma = {
    user: { findMany: jest.fn(), findFirst: jest.fn() },
    organization: { findFirst: jest.fn() },
  };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new StorageNoticesService(prisma as unknown as PrismaService, notifications as unknown as NotificationService);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findFirst.mockResolvedValue({ name: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' });
    prisma.user.findFirst.mockResolvedValue({ name: 'Dr. Hessa Al-Dosari' });
  });

  it("tells each of the organisation's active tenant admins that storage is almost full, in both languages", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
    await service.storageAlmostFull('org-a', 9.2 * GIB, 10 * GIB);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a', status: 'ACTIVE', userRoles: { some: { role: { key: 'TENANT_ADMIN', isActive: true } } } },
      select: { id: true },
    });
    expect(notifications.create).toHaveBeenCalledTimes(2);
    const [dto, org] = notifications.create.mock.calls[0] as [Record<string, string>, string];
    expect(org).toBe('org-a');
    expect(dto['bodyEn']).toContain('92%');
    expect(dto['bodyEn']).toContain('9.2 GB of 10 GB');
    expect(dto['bodyAr']).toContain('92٪');
  });

  it('tells every active platform admin of the platform organisation about a change request — who, when, the message', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'pa-1', organizationId: 'platform-org' }]);
    await service.storageChangeRequested('org-a', 'admin-1', new Date('2026-10-07T05:12:00Z'), 'Move us to our MinIO');

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: {
        status: 'ACTIVE',
        organization: { isPlatformOrg: true },
        userRoles: { some: { role: { key: 'PLATFORM_ADMIN', isActive: true } } },
      },
      select: { id: true, organizationId: true },
    });
    const [dto, org] = notifications.create.mock.calls[0] as [Record<string, string>, string];
    // Written into the PLATFORM admin's own organisation, never the tenant's.
    expect(org).toBe('platform-org');
    expect(dto['bodyEn']).toBe(
      'Al Nakheel Specialist Hospital asked to change where its files are stored. Asked by Dr. Hessa Al-Dosari on 7 Oct 2026, 05:12 UTC. Their message: “Move us to our MinIO”',
    );
    expect(dto['bodyAr']).toContain('مستشفى النخيل التخصصي');
    expect(dto['bodyAr']).toContain('«Move us to our MinIO»');
  });

  it('a notice that cannot be sent is logged and never throws', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    notifications.create.mockRejectedValueOnce(new Error('down'));
    await expect(service.storageAlmostFull('org-a', 9 * GIB, 10 * GIB)).resolves.toBeUndefined();
  });

  itEnforcesTenantIsolation("the requester is read from the requesting organisation only", async () => {
    prisma.user.findMany.mockResolvedValue([]);
    await service.storageChangeRequested('org-b', 'admin-1', new Date(), null);
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: 'admin-1', organizationId: 'org-b' }, select: { name: true } });
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { id: 'org-b' }, select: { name: true, nameAr: true } });
  });
});
