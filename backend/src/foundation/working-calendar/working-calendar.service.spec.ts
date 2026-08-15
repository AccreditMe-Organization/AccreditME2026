import { Test, TestingModule } from '@nestjs/testing';
import { DateTime } from 'luxon';
import { WorkingCalendarService } from './working-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';

const CAL_A = {
  id: 'cal-a',
  organizationId: ORG_A,
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4],   // Sun–Thu
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const CAL_B = {
  id: 'cal-b',
  organizationId: ORG_B,
  timezone: 'Europe/London',
  workingDays: [1, 2, 3, 4, 5],   // Mon–Fri
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const HOLIDAY_A = {
  id: 'holiday-a',
  workingCalendarId: 'cal-a',
  nameEn: 'National Day',
  nameAr: 'اليوم الوطني',
  date: new Date('2026-09-23T00:00:00.000Z'),
  isRecurring: true,
  createdAt: new Date(),
};

const HOLIDAY_B = {
  id: 'holiday-b',
  workingCalendarId: 'cal-b',
  nameEn: 'Boxing Day',
  nameAr: null,
  date: new Date('2026-12-26T00:00:00.000Z'),
  isRecurring: true,
  createdAt: new Date(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function riyadhDateTime(
  year: number, month: number, day: number,
  hour: number, minute = 0,
): DateTime {
  return DateTime.fromObject(
    { year, month, day, hour, minute },
    { zone: 'Asia/Riyadh' },
  ).toUTC();
}

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  workingCalendar: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  publicHoliday: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockAuditLog = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkingCalendarService', () => {
  let service: WorkingCalendarService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.workingCalendar.findUnique.mockImplementation(
      ({ where }: { where: { organizationId: string } }) => {
        if (where.organizationId === ORG_A) return Promise.resolve(CAL_A);
        if (where.organizationId === ORG_B) return Promise.resolve(CAL_B);
        return Promise.resolve(null);
      },
    );
    mockPrisma.publicHoliday.findMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkingCalendarService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<WorkingCalendarService>(WorkingCalendarService);
  });

  // ── getOrCreate ─────────────────────────────────────────────────────────────

  describe('getOrCreate', () => {
    it('returns existing calendar when one exists', async () => {
      const result = await service.getOrCreate(ORG_A);
      expect(result.organizationId).toBe(ORG_A);
      expect(result.timezone).toBe('Asia/Riyadh');
      expect(mockPrisma.workingCalendar.create).not.toHaveBeenCalled();
    });

    it('creates GCC default when no calendar exists', async () => {
      mockPrisma.workingCalendar.findUnique.mockResolvedValueOnce(null);
      mockPrisma.workingCalendar.create.mockResolvedValueOnce({
        ...CAL_A, timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4],
      });
      const result = await service.getOrCreate(ORG_A);
      expect(mockPrisma.workingCalendar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_A,
          timezone: 'Asia/Riyadh',
          workingDays: [0, 1, 2, 3, 4],
          workingHoursStart: '08:00',
          workingHoursEnd: '16:00',
        }),
      });
      expect(result.workingDays).toEqual([0, 1, 2, 3, 4]);
    });
  });

  // ── Public Holiday CRUD ──────────────────────────────────────────────────────

  describe('addHoliday', () => {
    it('creates a holiday scoped to the calendar resolved from organizationId', async () => {
      mockPrisma.publicHoliday.create.mockResolvedValueOnce(HOLIDAY_A);

      const result = await service.addHoliday(
        ORG_A,
        { nameEn: 'National Day', nameAr: 'اليوم الوطني', date: '2026-09-23', isRecurring: true },
        'actor-1',
      );

      expect(mockPrisma.publicHoliday.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workingCalendarId: CAL_A.id, nameEn: 'National Day' }),
      });
      expect(result.id).toBe(HOLIDAY_A.id);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, action: 'CREATE', objectType: 'PublicHoliday' }),
      );
    });

    it('throws NotFoundException when the organization has no working calendar', async () => {
      mockPrisma.workingCalendar.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.addHoliday(ORG_A, { nameEn: 'Test', date: '2026-01-01' }, 'actor-1'),
      ).rejects.toThrow('Working calendar not found');
    });
  });

  describe('updateHoliday', () => {
    it('updates only the provided fields on a holiday belonging to the tenant', async () => {
      mockPrisma.publicHoliday.findFirst.mockResolvedValueOnce(HOLIDAY_A);
      mockPrisma.publicHoliday.update.mockResolvedValueOnce({
        ...HOLIDAY_A,
        nameEn: 'Updated Name',
      });

      const result = await service.updateHoliday(
        HOLIDAY_A.id,
        ORG_A,
        { nameEn: 'Updated Name' },
        'actor-1',
      );

      expect(mockPrisma.publicHoliday.findFirst).toHaveBeenCalledWith({
        where: { id: HOLIDAY_A.id, workingCalendarId: CAL_A.id },
      });
      expect(mockPrisma.publicHoliday.update).toHaveBeenCalledWith({
        where: { id: HOLIDAY_A.id },
        data: { nameEn: 'Updated Name' },
      });
      expect(result.nameEn).toBe('Updated Name');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, action: 'UPDATE', objectType: 'PublicHoliday' }),
      );
    });

    it('throws NotFoundException when the holiday does not belong to this tenant\'s calendar', async () => {
      mockPrisma.publicHoliday.findFirst.mockResolvedValueOnce(null);
      await expect(
        service.updateHoliday(HOLIDAY_B.id, ORG_A, { nameEn: 'Hijacked' }, 'actor-1'),
      ).rejects.toThrow('Holiday not found');
      expect(mockPrisma.publicHoliday.update).not.toHaveBeenCalled();
    });
  });

  describe('removeHoliday', () => {
    it('deletes a holiday belonging to the tenant', async () => {
      mockPrisma.publicHoliday.findFirst.mockResolvedValueOnce(HOLIDAY_A);

      await service.removeHoliday(HOLIDAY_A.id, ORG_A, 'actor-1');

      expect(mockPrisma.publicHoliday.delete).toHaveBeenCalledWith({ where: { id: HOLIDAY_A.id } });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: ORG_A, action: 'DELETE', objectType: 'PublicHoliday' }),
      );
    });

    it('throws NotFoundException when the holiday does not belong to this tenant\'s calendar', async () => {
      mockPrisma.publicHoliday.findFirst.mockResolvedValueOnce(null);
      await expect(service.removeHoliday(HOLIDAY_B.id, ORG_A, 'actor-1')).rejects.toThrow(
        'Holiday not found',
      );
      expect(mockPrisma.publicHoliday.delete).not.toHaveBeenCalled();
    });
  });

  describe('listHolidays', () => {
    it('returns all holidays for the organization when no year filter is given', async () => {
      mockPrisma.publicHoliday.findMany.mockResolvedValueOnce([HOLIDAY_A]);
      const result = await service.listHolidays(ORG_A);
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(HOLIDAY_A.id);
    });

    it('returns an empty array when the organization has no working calendar', async () => {
      mockPrisma.workingCalendar.findUnique.mockResolvedValueOnce(null);
      const result = await service.listHolidays(ORG_A);
      expect(result).toEqual([]);
    });

    it('filters a non-recurring holiday out for a non-matching year, keeps a recurring one', async () => {
      const nonRecurring2025 = {
        ...HOLIDAY_A,
        id: 'holiday-2025',
        isRecurring: false,
        date: new Date('2025-09-23T00:00:00.000Z'),
      };
      mockPrisma.publicHoliday.findMany.mockResolvedValueOnce([nonRecurring2025, HOLIDAY_A]);

      const result = await service.listHolidays(ORG_A, 2026);

      expect(result.map((h) => h.id)).toEqual([HOLIDAY_A.id]);
    });
  });

  // ── calculateDeadline — GCC calendar, no holidays ────────────────────────────

  describe('calculateDeadline — GCC (Sun–Thu, 08:00–16:00, Asia/Riyadh)', () => {
    it('adds working hours within the same day', async () => {
      // Sunday 10:00 Riyadh + 2h → Sunday 12:00 Riyadh
      const start = riyadhDateTime(2026, 7, 19, 10, 0); // Sunday
      const result = await service.calculateDeadline(start, 2, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.hour).toBe(12);
      expect(local.weekday % 7).toBe(0); // Sunday
    });

    it('SLA assigned outside working hours starts next working day', async () => {
      // Thursday 17:30 Riyadh + 8h → Fri/Sat non-working → Sunday 08:00 + 8h → Sunday 16:00
      const start = riyadhDateTime(2026, 7, 16, 17, 30); // Thursday
      const result = await service.calculateDeadline(start, 8, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(0); // Sunday
      expect(local.hour).toBe(16);
      expect(local.minute).toBe(0);
    });

    it('SLA assigned on Friday skips to Sunday', async () => {
      // Friday 10:00 Riyadh (non-working) + 4h → Sunday 08:00 + 4h → Sunday 12:00
      const start = riyadhDateTime(2026, 7, 17, 10, 0); // Friday
      const result = await service.calculateDeadline(start, 4, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(0); // Sunday
      expect(local.hour).toBe(12);
    });

    it('SLA spans across GCC weekend (Thu afternoon + 4h working)', async () => {
      // Thursday 14:00 Riyadh + 4h → 2h left Thu (14:00–16:00) → 2h remaining
      // → Sunday 08:00 + 2h → Sunday 10:00
      const start = riyadhDateTime(2026, 7, 16, 14, 0); // Thursday
      const result = await service.calculateDeadline(start, 4, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(0); // Sunday
      expect(local.hour).toBe(10);
    });

    it('workingHours = 0 returns the next valid working period start', async () => {
      // Friday 10:00 Riyadh (non-working) + 0h → Sunday 08:00 Riyadh
      const start = riyadhDateTime(2026, 7, 17, 10, 0); // Friday
      const result = await service.calculateDeadline(start, 0, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(0); // Sunday
      expect(local.hour).toBe(8);
      expect(local.minute).toBe(0);
    });
  });

  // ── calculateDeadline — public holiday exclusion ──────────────────────────────

  describe('calculateDeadline — public holiday exclusion', () => {
    it('skips a non-recurring public holiday', async () => {
      // Thursday 14:00 Riyadh + 4h → 2h left Thu → weekend → Sunday is HOLIDAY
      // → skips to Monday 08:00 + 2h → Monday 10:00
      const holiday = {
        id: 'h1', workingCalendarId: 'cal-a',
        nameEn: 'National Day', nameAr: null,
        date: new Date('2026-07-19T00:00:00.000Z'), // Sunday
        isRecurring: false, createdAt: new Date(),
      };
      mockPrisma.publicHoliday.findMany.mockResolvedValue([holiday]);

      const start = riyadhDateTime(2026, 7, 16, 14, 0); // Thursday
      const result = await service.calculateDeadline(start, 4, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(1); // Monday
      expect(local.hour).toBe(10);
    });

    it('skips a recurring public holiday by month+day regardless of year', async () => {
      // Same scenario but isRecurring = true, holiday defined in 2024 — still skips 2026 date
      const holiday = {
        id: 'h2', workingCalendarId: 'cal-a',
        nameEn: 'Annual Day', nameAr: null,
        date: new Date('2024-07-19T00:00:00.000Z'), // year differs — month+day match
        isRecurring: true, createdAt: new Date(),
      };
      mockPrisma.publicHoliday.findMany.mockResolvedValue([holiday]);

      const start = riyadhDateTime(2026, 7, 16, 14, 0); // Thursday
      const result = await service.calculateDeadline(start, 4, ORG_A);
      const local = result.setZone('Asia/Riyadh');
      expect(local.weekday % 7).toBe(1); // Monday — recurring holiday still skipped in 2026
      expect(local.hour).toBe(10);
    });
  });

  // ── Tenant isolation ─────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return records belonging to a different tenant', async () => {
      const resultA = await service.getOrCreate(ORG_A);
      const resultB = await service.getOrCreate(ORG_B);
      expect(resultA.organizationId).toBe(ORG_A);
      expect(resultB.organizationId).toBe(ORG_B);
      expect(resultA.timezone).toBe('Asia/Riyadh');
      expect(resultB.timezone).toBe('Europe/London');
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // Friday 10:00 London — for Org B this IS a working day
      const start = DateTime.fromObject(
        { year: 2026, month: 7, day: 17, hour: 10, minute: 0 },
        { zone: 'Europe/London' },
      ).toUTC();
      const result = await service.calculateDeadline(start, 2, ORG_B);
      const local = result.setZone('Europe/London');
      // Friday is working for Org B → deadline is Friday 12:00
      expect(local.weekday).toBe(5); // Friday in Luxon (1=Mon, 5=Fri)
      expect(local.hour).toBe(12);
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // Mock branches on workingCalendarId exactly like a real Postgres
      // query would — Org A's holiday and Org B's holiday genuinely live
      // behind different calendar ids, so this proves the service's own
      // scoping (not the mock) is what keeps them apart.
      mockPrisma.publicHoliday.findMany.mockImplementation(
        ({ where }: { where: { workingCalendarId: string } }) => {
          if (where.workingCalendarId === CAL_A.id) return Promise.resolve([HOLIDAY_A]);
          if (where.workingCalendarId === CAL_B.id) return Promise.resolve([HOLIDAY_B]);
          return Promise.resolve([]);
        },
      );

      const resultA = await service.listHolidays(ORG_A);
      const resultB = await service.listHolidays(ORG_B);

      expect(resultA.map((h) => h.id)).toEqual([HOLIDAY_A.id]);
      expect(resultB.map((h) => h.id)).toEqual([HOLIDAY_B.id]);
      expect(resultA.some((h) => h.id === HOLIDAY_B.id)).toBe(false);
      expect(resultB.some((h) => h.id === HOLIDAY_A.id)).toBe(false);
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // A holiday that genuinely belongs to Org B's calendar
      mockPrisma.publicHoliday.findFirst.mockImplementation(
        ({ where }: { where: { id: string; workingCalendarId: string } }) => {
          if (where.workingCalendarId === CAL_B.id && where.id === HOLIDAY_B.id) {
            return Promise.resolve(HOLIDAY_B);
          }
          return Promise.resolve(null);
        },
      );

      // Org A attempting to update Org B's holiday must be rejected —
      // the tenant-scoped findFirst (id + workingCalendarId resolved from
      // ORG_A) never matches HOLIDAY_B's real workingCalendarId (cal-b).
      await expect(
        service.updateHoliday(HOLIDAY_B.id, ORG_A, { nameEn: 'Hijacked' }, 'actor-1'),
      ).rejects.toThrow('Holiday not found');
      expect(mockPrisma.publicHoliday.update).not.toHaveBeenCalled();

      // Org B updating its own holiday succeeds
      mockPrisma.publicHoliday.update.mockResolvedValueOnce({ ...HOLIDAY_B, nameEn: 'Renamed' });
      const result = await service.updateHoliday(
        HOLIDAY_B.id,
        ORG_B,
        { nameEn: 'Renamed' },
        'actor-1',
      );
      expect(result.nameEn).toBe('Renamed');
    });
  });
});
