import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkingCalendarController } from './working-calendar.controller';
import { WorkingCalendarService } from './working-calendar.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { UpdateWorkingCalendarDto } from './dto/update-working-calendar.dto';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { UpdatePublicHolidayDto } from './dto/update-public-holiday.dto';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID  = 'org-test';
const USER_ID    = 'user-test';
const HOLIDAY_ID = 'holiday-test';
const CAL_ID     = 'cal-test';

const MOCK_CALENDAR: IWorkingCalendar = {
  id:                CAL_ID,
  organizationId:    TENANT_ID,
  timezone:          'Asia/Riyadh',
  workingDays:       [0, 1, 2, 3, 4],
  workingHoursStart: '08:00',
  workingHoursEnd:   '16:00',
  createdAt:         new Date('2026-01-01'),
  updatedAt:         new Date('2026-01-01'),
};

const MOCK_HOLIDAY: IPublicHoliday = {
  id:                HOLIDAY_ID,
  workingCalendarId: CAL_ID,
  nameEn:            'National Day',
  nameAr:            'اليوم الوطني',
  date:              new Date('2026-09-23'),
  isRecurring:       true,
  createdAt:         new Date('2026-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkingCalendarController', () => {
  let controller: WorkingCalendarController;
  let service: {
    getOrCreate:   jest.Mock;
    update:        jest.Mock;
    listHolidays:  jest.Mock;
    addHoliday:    jest.Mock;
    updateHoliday: jest.Mock;
    removeHoliday: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getOrCreate:   jest.fn().mockResolvedValue(MOCK_CALENDAR),
      update:        jest.fn().mockResolvedValue(MOCK_CALENDAR),
      listHolidays:  jest.fn().mockResolvedValue([MOCK_HOLIDAY]),
      addHoliday:    jest.fn().mockResolvedValue(MOCK_HOLIDAY),
      updateHoliday: jest.fn().mockResolvedValue(MOCK_HOLIDAY),
      removeHoliday: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkingCalendarController],
      providers: [{ provide: WorkingCalendarService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkingCalendarController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getCalendar ───────────────────────────────────────────────────────────

  describe('getCalendar', () => {
    it('delegates to workingCalendarService.getOrCreate with tenantId', async () => {
      const result = await controller.getCalendar(TENANT_ID);
      expect(service.getOrCreate).toHaveBeenCalledWith(TENANT_ID);
      expect(result.organizationId).toBe(TENANT_ID);
    });
  });

  // ── updateCalendar ────────────────────────────────────────────────────────

  describe('updateCalendar', () => {
    it('delegates to workingCalendarService.update with tenantId, dto, and actorId', async () => {
      const dto = { timezone: 'Asia/Dubai' } as UpdateWorkingCalendarDto;
      const result = await controller.updateCalendar(dto, TENANT_ID, USER_ID);
      expect(service.update).toHaveBeenCalledWith(TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(CAL_ID);
    });
  });

  // ── listHolidays ──────────────────────────────────────────────────────────

  describe('listHolidays', () => {
    it('delegates without a year when query param is absent', async () => {
      const result = await controller.listHolidays(TENANT_ID, undefined);
      expect(service.listHolidays).toHaveBeenCalledWith(TENANT_ID, undefined);
      expect(result).toHaveLength(1);
    });

    it('parses the year query param and passes an integer to the service', async () => {
      await controller.listHolidays(TENANT_ID, '2027');
      expect(service.listHolidays).toHaveBeenCalledWith(TENANT_ID, 2027);
    });
  });

  // ── addHoliday ────────────────────────────────────────────────────────────

  describe('addHoliday', () => {
    it('delegates to workingCalendarService.addHoliday with tenantId, dto, and actorId', async () => {
      const dto = { nameEn: 'National Day', nameAr: 'اليوم الوطني', date: '2026-09-23' } as CreatePublicHolidayDto;
      const result = await controller.addHoliday(dto, TENANT_ID, USER_ID);
      expect(service.addHoliday).toHaveBeenCalledWith(TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(HOLIDAY_ID);
    });
  });

  // ── updateHoliday ─────────────────────────────────────────────────────────

  describe('updateHoliday', () => {
    it('delegates to workingCalendarService.updateHoliday with id, dto, tenantId, and actorId', async () => {
      const dto = { nameEn: 'Renamed Day' } as UpdatePublicHolidayDto;
      const result = await controller.updateHoliday(HOLIDAY_ID, dto, TENANT_ID, USER_ID);
      expect(service.updateHoliday).toHaveBeenCalledWith(HOLIDAY_ID, TENANT_ID, dto, USER_ID);
      expect(result.id).toBe(HOLIDAY_ID);
    });
  });

  // ── removeHoliday ─────────────────────────────────────────────────────────

  describe('removeHoliday', () => {
    it('delegates to workingCalendarService.removeHoliday with id, tenantId, and actorId', async () => {
      const result = await controller.removeHoliday(HOLIDAY_ID, TENANT_ID, USER_ID);
      expect(service.removeHoliday).toHaveBeenCalledWith(HOLIDAY_ID, TENANT_ID, USER_ID);
      expect(result).toBeUndefined();
    });
  });
});

// ── ACC-96 — who may READ the calendar, and who may still write it ──────────
//
// These read the @Permissions() metadata and run the REAL PermissionGuard,
// because the suite above overrides both guards and therefore cannot see a
// permission change at all. The two GETs were org:view; a QUALITY_OFFICER or
// AUDITOR does not hold it, so the New Task presets and the out-of-hours
// warning 403'd for them.
//
// BOTH DIRECTIONS, deliberately: a test that only proves the reads are open
// would still pass if someone opened the writes too.

describe('WorkingCalendarController — read access (ACC-96)', () => {
  const reflector = new Reflector();

  const permissionsOn = (method: keyof WorkingCalendarController): string[] | undefined =>
    reflector.get<string[]>(PERMISSIONS_KEY, WorkingCalendarController.prototype[method]);

  // Runs the real guard against a caller holding exactly `held`.
  const guardAllows = (method: keyof WorkingCalendarController, held: string[]): boolean => {
    const guard = new PermissionGuard(reflector);
    const ctx = {
      getHandler: () => WorkingCalendarController.prototype[method],
      getClass: () => WorkingCalendarController,
      switchToHttp: () => ({ getRequest: () => ({ userPermissions: held }) }),
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  };

  // A real seeded role, not an invented one: QUALITY_OFFICER's exact set holds
  // neither org:view nor org:manage.
  const QUALITY_OFFICER_ISH = ['tasks:view', 'tasks:manage', 'documents:view'];

  it('requires no permission to read the calendar or the holidays', () => {
    expect(permissionsOn('getCalendar')).toBeUndefined();
    expect(permissionsOn('listHolidays')).toBeUndefined();
  });

  it('lets a non-admin read their own calendar and holidays', () => {
    expect(guardAllows('getCalendar', QUALITY_OFFICER_ISH)).toBe(true);
    expect(guardAllows('listHolidays', QUALITY_OFFICER_ISH)).toBe(true);
  });

  it('still refuses that same non-admin every write', () => {
    for (const method of ['updateCalendar', 'addHoliday', 'updateHoliday', 'removeHoliday'] as const) {
      expect(permissionsOn(method)).toEqual(['org:manage']);
      expect(() => guardAllows(method, QUALITY_OFFICER_ISH)).toThrow(ForbiddenException);
    }
  });

  // The gate reads the caller's OWN tenant id, which TenantGuard resolves from
  // the JWT and never from the request body. Ungating the read did not touch
  // that, and this pins it: the handler passes through whatever tenant it was
  // given, so a caller can only ever reach their own organization's row.
  it('should NOT return records belonging to a different tenant', async () => {
    const service = {
      getOrCreate: jest.fn((org: string) => Promise.resolve({ ...MOCK_CALENDAR, organizationId: org })),
      listHolidays: jest.fn(() => Promise.resolve([])),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkingCalendarController],
      providers: [{ provide: WorkingCalendarService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = module.get(WorkingCalendarController);

    const mine = await controller.getCalendar('org-a');
    const theirs = await controller.getCalendar('org-b');

    expect(mine.organizationId).toBe('org-a');
    expect(theirs.organizationId).toBe('org-b');
    expect(service.getOrCreate).toHaveBeenNthCalledWith(1, 'org-a');
    expect(service.getOrCreate).toHaveBeenNthCalledWith(2, 'org-b');
    // No call anywhere took a tenant the caller did not supply.
    expect(service.getOrCreate.mock.calls.flat()).toEqual(['org-a', 'org-b']);
  });
});
