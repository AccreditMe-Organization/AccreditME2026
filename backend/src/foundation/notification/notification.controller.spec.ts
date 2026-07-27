import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { INotification } from './interfaces/notification.interface';

const TENANT_ID = 'tenant-test';
const USER_ID = 'user-test';

const MOCK_NOTIFICATION: INotification = {
  id: 'notification-1',
  organizationId: TENANT_ID,
  userId: USER_ID,
  titleEn: 'Title',
  titleAr: null,
  bodyEn: 'Body',
  bodyAr: null,
  channel: 'IN_APP',
  status: 'UNREAD',
  objectType: null,
  objectId: null,
  sentAt: null,
  readAt: null,
  createdAt: new Date('2026-01-01'),
};

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: {
    getForUser: jest.Mock;
    getUnreadCount: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getForUser: jest.fn().mockResolvedValue([MOCK_NOTIFICATION]),
      getUnreadCount: jest.fn().mockResolvedValue(2),
      markRead: jest.fn().mockResolvedValue({ ...MOCK_NOTIFICATION, status: 'READ' }),
      markAllRead: jest.fn().mockResolvedValue({ count: 2 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationController);
  });

  afterEach(() => jest.clearAllMocks());

  it('getForUser delegates to the service, scoped by tenant and current user', async () => {
    const result = await controller.getForUser(TENANT_ID, USER_ID, 'UNREAD', '10', '0');

    expect(service.getForUser).toHaveBeenCalledWith(USER_ID, TENANT_ID, {
      status: 'UNREAD',
      limit: 10,
      offset: 0,
    });
    expect(result).toEqual([MOCK_NOTIFICATION]);
  });

  it('getUnreadCount delegates to the service and wraps the result', async () => {
    const result = await controller.getUnreadCount(TENANT_ID, USER_ID);

    expect(service.getUnreadCount).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    expect(result).toEqual({ count: 2 });
  });

  it('markRead delegates to the service with id, current user, and tenant', async () => {
    const result = await controller.markRead('notification-1', TENANT_ID, USER_ID);

    expect(service.markRead).toHaveBeenCalledWith('notification-1', USER_ID, TENANT_ID);
    expect(result.status).toBe('READ');
  });

  it('markAllRead delegates to the service, scoped by tenant and current user', async () => {
    const result = await controller.markAllRead(TENANT_ID, USER_ID);

    expect(service.markAllRead).toHaveBeenCalledWith(USER_ID, TENANT_ID);
    expect(result).toEqual({ count: 2 });
  });
});
