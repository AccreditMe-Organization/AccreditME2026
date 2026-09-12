import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  user: {
    findFirst: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };
const mockQueue = { add: jest.fn() };

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: userId belongs to the org create() is called with — matches
    // every existing test's fixtures (USER_A/ORG_A). A test can override
    // this per-case to exercise the cross-tenant rejection path.
    mockPrisma.user.findFirst.mockResolvedValue({ id: USER_A, organizationId: ORG_A });

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

    // ACC-17 — the actual root-cause fix. dto.userId is now re-validated
    // against organizationId before the write; a caller passing a real
    // user id that belongs to a DIFFERENT org must be rejected, not
    // silently create a Notification row spanning two tenants.
    it('throws NotFoundException when userId does not belong to organizationId', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ userId: USER_B, titleEn: 'Title', bodyEn: 'Body' }, ORG_A),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: USER_B, organizationId: ORG_A },
      });
      expect(mockPrisma.notification.create).not.toHaveBeenCalled();
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

      // ACC-78 — returns the { data, total, page, pageSize } envelope now, not
      // a bare array.
      expect(results.data).toHaveLength(1);
      expect(results.data.every((n) => n.organizationId === ORG_A)).toBe(true);
    });

    // ── ACC-78: the envelope contract ──────────────────────────────────────

    it('returns the full envelope, not a bare array', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([BASE_NOTIFICATION]);
      mockPrisma.notification.count.mockResolvedValue(57);

      const result = await service.getForUser(USER_A, ORG_A, { page: 2, pageSize: 10 });

      expect(result).toEqual({
        data: [BASE_NOTIFICATION],
        total: 57,
        page: 2,
        pageSize: 10,
      });
    });

    // `total` is the field the old limit/offset paging lacked, and the reason
    // nothing could render a paginator against it. It must come from count(),
    // NOT from data.length — which would only ever report the page size.
    it('takes total from count(), not from the length of the page', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([BASE_NOTIFICATION]);
      mockPrisma.notification.count.mockResolvedValue(57);

      const result = await service.getForUser(USER_A, ORG_A, {});

      expect(result.total).toBe(57);
      expect(result.data).toHaveLength(1);
    });

    // The count must match the page's filter exactly. If they diverge, a
    // paginator offers pages that come back empty — and the status filter is
    // where that would happen first.
    it('counts against the same where clause as the page, including the status filter', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getForUser(USER_A, ORG_A, { status: 'UNREAD' });

      const findWhere = mockPrisma.notification.findMany.mock.calls[0]![0].where;
      const countWhere = mockPrisma.notification.count.mock.calls[0]![0].where;
      expect(countWhere).toEqual(findWhere);
      expect(countWhere).toMatchObject({ status: 'UNREAD' });
    });

    it('translates page/pageSize into skip/take', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getForUser(USER_A, ORG_A, { page: 3, pageSize: 15 });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 30, take: 15 }),
      );
    });

    it('defaults to the inbox page size of 20 when none is given', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      const result = await service.getForUser(USER_A, ORG_A, {});

      expect(result.pageSize).toBe(20);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    // ── ACC-78: the sort whitelist, wired through ──────────────────────────

    it('orders newest-first by default — an inbox is newest-first by nature', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getForUser(USER_A, ORG_A, {});

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
    });

    it('accepts a whitelisted sort column', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);
      mockPrisma.notification.count.mockResolvedValue(0);

      await service.getForUser(USER_A, ORG_A, { sortBy: 'status', sortDir: 'asc' });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { status: 'asc' } }),
      );
    });

    // The security half, asserted at the endpoint rather than only on the
    // utility: an unwhitelisted column must never reach Prisma's orderBy.
    // Ordering by a scalar the endpoint never returns is a weak oracle over
    // hidden values, and a relation field turns a typo into a 500.
    it('rejects an unwhitelisted sort column and never queries', async () => {
      await expect(
        service.getForUser(USER_A, ORG_A, { sortBy: 'userId' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.notification.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.notification.count).not.toHaveBeenCalled();
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
