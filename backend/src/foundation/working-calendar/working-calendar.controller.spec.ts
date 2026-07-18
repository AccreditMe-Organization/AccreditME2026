import { Test, TestingModule } from '@nestjs/testing';
import { WorkingCalendarController } from './working-calendar.controller';
import { WorkingCalendarService } from './working-calendar.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { UpdateWorkingCalendarDto } from './dto/update-working-calendar.dto';
import { CreatePublicHolidayDto } from './dto/create-public-holiday.dto';
import { IWorkingCalendar } from './interfaces/working-calendar.interface';
import { IPublicHoliday } from './interfaces/public-holiday.interface';

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
    removeHoliday: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getOrCreate:   jest.fn().mockResolvedValue(MOCK_CALENDAR),
      update:        jest.fn().mockResolvedValue(MOCK_CALENDAR),
      listHolidays:  jest.fn().mockResolvedValue([MOCK_HOLIDAY]),
      addHoliday:    jest.fn().mockResolvedValue(MOCK_HOLIDAY),
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

  // ── removeHoliday ─────────────────────────────────────────────────────────

  describe('removeHoliday', () => {
    it('delegates to workingCalendarService.removeHoliday with id, tenantId, and actorId', async () => {
      const result = await controller.removeHoliday(HOLIDAY_ID, TENANT_ID, USER_ID);
      expect(service.removeHoliday).toHaveBeenCalledWith(HOLIDAY_ID, TENANT_ID, USER_ID);
      expect(result).toBeUndefined();
    });
  });
});
