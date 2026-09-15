import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SetupHealthController } from './setup-health.controller';
import { SetupHealthService } from './setup-health.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { SETUP_PERMISSIONS } from '../../common/constants/permissions';

jest.mock('better-auth/api', () => ({ isAPIError: () => false }));

// ACC-82 — SYSTEM-REFERENCE §13.6.
describe('SetupHealthController (ACC-82)', () => {
  // Asserted on the decorator metadata directly: with the guards overridden in
  // the HTTP half below, nothing else would notice a route losing its gate.
  describe('permissions', () => {
    const reflector = new Reflector();
    const required = (handler: keyof SetupHealthController) =>
      reflector.get<string[] | undefined>(
        PERMISSIONS_KEY,
        SetupHealthController.prototype[handler],
      );

    it.each(['getHealth', 'getSummary'] as const)(
      '%s requires setup:view',
      (handler) => {
        expect(required(handler)).toEqual([SETUP_PERMISSIONS.VIEW]);
      },
    );
  });

  describe('HTTP contract', () => {
    let app: INestApplication;
    const getHealth = jest.fn();
    const getSummary = jest.fn();

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [SetupHealthController],
        providers: [
          { provide: SetupHealthService, useValue: { getHealth, getSummary } },
        ],
      })
        .overrideGuard(TenantGuard)
        .useValue({
          canActivate: (ctx: {
            switchToHttp: () => { getRequest: () => Record<string, unknown> };
          }) => {
            ctx.switchToHttp().getRequest()['tenantId'] = 'org-a';
            return true;
          },
        })
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
      getHealth.mockReset();
      getSummary.mockReset();
    });

    it('GET /setup-health returns the read model with ISO timestamps', async () => {
      getHealth.mockResolvedValue({
        open: [
          {
            id: 'sc-1',
            type: 'ORG_UNIT_WITHOUT_HEAD',
            severity: 'AT_RISK',
            objectId: 'unit-1',
            subject: { nameEn: 'Radiology' },
            openedAt: new Date('2026-09-01T08:00:00.000Z'),
            ageBasis: 'OBJECT',
            lastSeenAt: new Date('2026-09-15T11:00:00.000Z'),
            clearedAt: null,
          },
        ],
        recentlyCleared: [],
        freshness: [
          {
            type: 'ORG_UNIT_WITHOUT_HEAD',
            status: 'CURRENT',
            computedAt: new Date('2026-09-15T11:00:00.000Z'),
          },
        ],
      });

      const res = await request(app.getHttpServer())
        .get('/setup-health')
        .expect(200);

      expect(res.body.open[0].openedAt).toBe('2026-09-01T08:00:00.000Z');
      expect(res.body.freshness[0]).toEqual({
        type: 'ORG_UNIT_WITHOUT_HEAD',
        status: 'CURRENT',
        computedAt: '2026-09-15T11:00:00.000Z',
      });
    });

    it('GET /setup-health/summary returns the counts', async () => {
      getSummary.mockResolvedValue({ open: 25, blocksWork: 0 });
      const res = await request(app.getHttpServer())
        .get('/setup-health/summary')
        .expect(200);
      expect(res.body).toEqual({ open: 25, blocksWork: 0 });
    });
  });
});
