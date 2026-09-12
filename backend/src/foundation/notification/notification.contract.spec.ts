import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-78 — the same HTTP-contract check as user.contract.spec.ts, for the
// endpoint where the identical defect was LATENT rather than live.
//
// `?status=UNREAD` returned 400 here too. Nobody saw it because both callers —
// the notification bell and the home page — pass no status at all. The first
// person to add an "Unread only" filter would have found it, and would have
// looked for the bug in their own new code.
//
// That is the argument for this spec shape existing per endpoint rather than
// once: a contract nothing currently exercises is exactly the one that breaks
// silently.
describe('NotificationController HTTP contract (ACC-78)', () => {
  let app: INestApplication;
  const getForUser = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: {
            getForUser,
            getUnreadCount: jest.fn().mockResolvedValue(0),
            markRead: jest.fn(),
            markAllRead: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => await app.close());

  beforeEach(() => {
    getForUser.mockReset();
    getForUser.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 25 });
  });

  const accepted = [
    ['the bell, which passes only a page size', '?pageSize=10'],
    ['the status filter that was latently broken', '?status=UNREAD'],
    ['status with pagination', '?status=READ&page=2&pageSize=10'],
  ];

  for (const [name, qs] of accepted) {
    it(`accepts ${name}`, async () => {
      await request(app.getHttpServer()).get(`/notifications${qs}`).expect(200);
      expect(getForUser).toHaveBeenCalled();
    });
  }

  it('rejects a status outside the allowed set', async () => {
    await request(app.getHttpServer()).get('/notifications?status=ARCHIVED').expect(400);
    expect(getForUser).not.toHaveBeenCalled();
  });

  it('rejects an undeclared parameter', async () => {
    await request(app.getHttpServer()).get('/notifications?limit=10').expect(400);
    expect(getForUser).not.toHaveBeenCalled();
  });
});
