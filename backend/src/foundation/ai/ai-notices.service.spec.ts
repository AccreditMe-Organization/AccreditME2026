import { AiNoticesService } from './ai-notices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function setup(admins: { id: string }[]) {
  const prisma = { user: { findMany: jest.fn().mockResolvedValue(admins) } };
  const notifications = { create: jest.fn().mockResolvedValue({}) };
  const service = new AiNoticesService(prisma as unknown as PrismaService, notifications as unknown as NotificationService);
  return { service, prisma, notifications };
}

describe('AiNoticesService.creditsUsedUp (ACC-194, D10)', () => {
  it('tells every active tenant admin, in English and Arabic, with the renewal date in Latin digits', async () => {
    const { service, notifications } = setup([{ id: 'admin-1' }, { id: 'admin-2' }]);
    await service.creditsUsedUp(ORG, new Date('2026-10-21T00:00:00Z'));

    expect(notifications.create).toHaveBeenCalledTimes(2);
    const [dto, org] = notifications.create.mock.calls[0] as [Record<string, string>, string];
    expect(org).toBe(ORG);
    expect(dto).toEqual({
      userId: 'admin-1',
      titleEn: 'AI credits used up',
      titleAr: 'نفدت أرصدة الذكاء الاصطناعي',
      bodyEn: 'Your organization has used all its AI credits for this period. They renew on 21 Oct 2026.',
      bodyAr: expect.stringContaining('استخدمت مؤسستك جميع أرصدة الذكاء الاصطناعي لهذه الفترة، وتتجدد في 21 '),
      objectType: 'Organization',
      objectId: ORG,
    });
    expect(dto['bodyAr']).toContain('2026');
    expect(dto['bodyAr']).not.toMatch(/[٠-٩]/);
  });

  it('a failed send is logged and the others still go', async () => {
    const { service, notifications } = setup([{ id: 'admin-1' }, { id: 'admin-2' }]);
    notifications.create.mockRejectedValueOnce(new Error('boom'));
    await expect(service.creditsUsedUp(ORG, new Date('2026-10-21T00:00:00Z'))).resolves.toBeUndefined();
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('should NOT return records belonging to a different tenant — recipients are only this organisation’s active admins', async () => {
    const { service, prisma } = setup([]);
    await service.creditsUsedUp(ORG, new Date());
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG, status: 'ACTIVE', userRoles: { some: { role: { key: 'TENANT_ADMIN', isActive: true } } } },
      select: { id: true },
    });
    expect(JSON.stringify(prisma.user.findMany.mock.calls)).not.toContain(OTHER_ORG);
  });
});
