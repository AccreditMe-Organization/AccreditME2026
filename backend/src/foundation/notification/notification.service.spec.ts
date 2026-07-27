import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const USER_A = 'user-a-id';
const USER_B = 'user-b-id';

const BASE_NOTIFICATION = {
  id: 'notification-1',
  organizationId: ORG_A,
  userId: USER_A,
  titleEn: 'Title',
  titleAr: null as string | null,
  bodyEn: 'Body',
  bodyAr: null as string | null,
  channel: 'IN_APP',
  status: 'UNREAD',
  objectType: null as string | null,
  objectId: null as string | null,
  sentAt: null as Date | null,
  readAt: null as Date | null,
  createdAt: new Date(),
};

const mockPrisma = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockQueue = { add: jest.fn() };

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: getQueueToken('email-delivery'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  describe('create', () => {
    it('creates the notification row with organizationId from the parameter, not the dto', async () => {
      mockPrisma.notification.create.mockResolvedValue({ ...BASE_NOTIFICATION, channel: 'IN_APP' });

      await service.create({ userId: USER_A, titleEn: 'Title', bodyEn: 'Body' }, ORG_A);

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('does NOT enqueue an email job when channel is IN_APP (default)', async () => {
      mockPrisma.notification.create.mockResolvedValue({ ...BASE_NOTIFICATION, channel: 'IN_APP' });

      await service.create({ userId: USER_A, titleEn: 'Title', bodyEn: 'Body' }, ORG_A);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('creates the row AND enqueues exactly one email-delivery job when channel is EMAIL', async () => {
      mockPrisma.notification.create.mockResolvedValue({ ...BASE_NOTIFICATION, channel: 'EMAIL' });

      const result = await service.create(
        { userId: USER_A, titleEn: 'Title', bodyEn: 'Body', channel: 'EMAIL' },
        ORG_A,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith('send-email', {
        notificationId: result.id,
        organizationId: ORG_A,
      });
    });

    it('creates the row AND enqueues exactly one email-delivery job when channel is BOTH', async () => {
      mockPrisma.notification.create.mockResolvedValue({ ...BASE_NOTIFICATION, channel: 'BOTH' });

      const result = await service.create(
        { userId: USER_A, titleEn: 'Title', bodyEn: 'Body', channel: 'BOTH' },
        ORG_A,
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith('send-email', {
        notificationId: result.id,
        organizationId: ORG_A,
      });
    });

    it('logs to audit trail on creation', async () => {
      mockPrisma.notification.create.mockResolvedValue(BASE_NOTIFICATION);

      await service.create({ userId: USER_A, titleEn: 'Title', bodyEn: 'Body' }, ORG_A);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'Notification', tenantId: ORG_A }),
      );
    });
  });

  describe('getForUser', () => {
    it('scopes the query by both userId and organizationId', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([BASE_NOTIFICATION]);

      await service.getForUser(USER_A, ORG_A, {});

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: USER_A, organizationId: ORG_A }) }),
      );
    });

    // MANDATORY — tenant isolation test
    it('should NOT return records belonging to a different tenant', async () => {
      mockPrisma.notification.findMany.mockImplementation(({ where }) => {
        const all = [
          BASE_NOTIFICATION,
          { ...BASE_NOTIFICATION, id: 'notification-2', organizationId: ORG_B, userId: USER_B },
        ];
        return Promise.resolve(
          all.filter((n) => n.organizationId === where.organizationId && n.userId === where.userId),
        );
      });

      const results = await service.getForUser(USER_A, ORG_A, {});

      expect(results).toHaveLength(1);
      expect(results.every((n) => n.organizationId === ORG_A)).toBe(true);
    });
  });

  describe('getUnreadCount', () => {
    it('only counts UNREAD rows for the exact user', async () => {
      mockPrisma.notification.count.mockResolvedValue(3);

      const count = await service.getUnreadCount(USER_A, ORG_A);

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: USER_A, organizationId: ORG_A, status: 'UNREAD' },
      });
      expect(count).toBe(3);
    });
  });

  describe('markRead', () => {
    it('marks the notification as read when owned by the calling user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(BASE_NOTIFICATION);
      mockPrisma.notification.update.mockResolvedValue({ ...BASE_NOTIFICATION, status: 'READ' });

      const result = await service.markRead('notification-1', USER_A, ORG_A);

      expect(result.status).toBe('READ');
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'UPDATE' }));
    });

    it('throws NotFoundException when the notification belongs to a different user in the SAME organization', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('notification-1', USER_B, ORG_A)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a notification belonging to a different tenant', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(service.markRead('notification-1', USER_A, ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllRead', () => {
    it('only touches the calling user\'s own UNREAD rows and returns the count', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      const result = await service.markAllRead(USER_A, ORG_A);

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: USER_A, organizationId: ORG_A, status: 'UNREAD' },
        data: expect.objectContaining({ status: 'READ' }),
      });
      expect(result).toEqual({ count: 5 });
    });

    it('logs one summary audit entry, not one per row', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllRead(USER_A, ORG_A);

      expect(mockAuditLog.log).toHaveBeenCalledTimes(1);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { bulkMarkAllRead: true, count: 5 } }),
      );
    });
  });
});
