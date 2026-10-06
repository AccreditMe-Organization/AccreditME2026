import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { TaskSlaService, TaskSlaFields, latest } from './task-sla.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { DEFAULT_TASK_SLA_SETTINGS, taskSlaFromSettings } from '../tenant/task-sla-settings';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-174 — the SLA limit, in one place. The calendar is mocked as "N working
// hours is N clock hours"; the working-time arithmetic is
// WorkingCalendarService's own spec's business.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const HOUR = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);
const plusHours = (d: Date, h: number) => new Date(d.getTime() + h * HOUR);

const mockPrisma = { organization: { findFirst: jest.fn() } };
const mockCalendar = {
  calculateDeadline: jest.fn(async (start: DateTime, hours: number) => start.plus({ hours })),
  getEffectiveTimeZone: jest.fn(async () => 'Asia/Riyadh'),
};

const fields = (overrides: Partial<TaskSlaFields> = {}): TaskSlaFields => ({
  priority: 'MEDIUM',
  createdAt: at('2026-10-05T06:00:00Z'),
  dueAt: null,
  slaStartAt: null,
  slaLimitAt: null,
  slaExtendedTo: null,
  ...overrides,
});

describe('TaskSlaService (ACC-174)', () => {
  let sla: TaskSlaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.organization.findFirst.mockResolvedValue({ settings: {} });
    const module = await Test.createTestingModule({
      providers: [
        TaskSlaService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WorkingCalendarService, useValue: mockCalendar },
      ],
    }).compile();
    sla = module.get(TaskSlaService);
  });

  describe('the tenant SLA', () => {
    it("reads the tenant's own tier", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        settings: { taskSla: { ...DEFAULT_TASK_SLA_SETTINGS, HIGH: { ...DEFAULT_TASK_SLA_SETTINGS.HIGH, dueAfterHours: 12 } } },
      });
      await expect(sla.dueAfterHours('HIGH', ORG_A)).resolves.toBe(12);
    });

    it('falls back to the platform defaults when the tenant saved none — the same reading TenantService uses', async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({ settings: null });
      await expect(sla.dueAfterHours('MEDIUM', ORG_A)).resolves.toBe(40);
      expect(taskSlaFromSettings(null)).toBe(DEFAULT_TASK_SLA_SETTINGS);
      expect(taskSlaFromSettings({ taskSla: undefined })).toBe(DEFAULT_TASK_SLA_SETTINGS);
    });

    itEnforcesTenantIsolation("TaskSlaService reads only the caller's tenant's SLA", async () => {
      await sla.dueAfterHours('LOW', ORG_B);
      expect(mockPrisma.organization.findFirst).toHaveBeenCalledWith({
        where: { id: ORG_B },
        select: { settings: true },
      });
    });
  });

  describe('the window and the limit', () => {
    it('counts the priority SLA in working hours from the start', async () => {
      const start = at('2026-10-06T06:00:00Z');
      await expect(sla.windowFrom(start, 'HIGH', ORG_A)).resolves.toEqual(plusHours(start, 16));
      expect(mockCalendar.calculateDeadline).toHaveBeenCalledWith(DateTime.fromJSDate(start), 16, ORG_A);
    });

    it('a zero shift moves nothing — calculateDeadline() would normalise the date (ACC-175)', async () => {
      const date = at('2026-10-06T18:00:00Z');
      await expect(sla.shift(date, 0, ORG_A)).resolves.toBe(date);
      expect(mockCalendar.calculateDeadline).not.toHaveBeenCalled();
    });

    it('reads slaLimitAt when it is set', async () => {
      const limit = at('2026-10-09T10:00:00Z');
      await expect(sla.limitOf(fields({ slaLimitAt: limit }), ORG_A)).resolves.toBe(limit);
      expect(mockCalendar.calculateDeadline).not.toHaveBeenCalled();
    });

    it('before the backfill: the priority SLA from createdAt, raised to the due date and any extension', async () => {
      const created = at('2026-10-05T06:00:00Z');
      // Computed: created + 40h. A later manual due date raises it.
      const later = plusHours(created, 60);
      await expect(sla.limitOf(fields({ dueAt: later }), ORG_A)).resolves.toEqual(later);
      // An earlier due date does not lower it.
      const earlier = plusHours(created, 10);
      await expect(sla.limitOf(fields({ dueAt: earlier }), ORG_A)).resolves.toEqual(plusHours(created, 40));
      // Nor does it ignore an approved extension.
      const extended = plusHours(created, 90);
      await expect(sla.limitOf(fields({ slaExtendedTo: extended }), ORG_A)).resolves.toEqual(extended);
    });

    it('the SLA start is slaStartAt, or createdAt on a row the backfill has not reached', () => {
      const start = at('2026-10-06T06:00:00Z');
      expect(sla.startOf(fields({ slaStartAt: start }))).toBe(start);
      expect(sla.startOf(fields())).toEqual(at('2026-10-05T06:00:00Z'));
    });

    it('a priority change recomputes from the SLA start; the limit never drops below an approved extension', async () => {
      const start = at('2026-10-06T06:00:00Z');
      const window = await sla.windowForPriority(fields({ slaStartAt: start }), 'CRITICAL', ORG_A);
      expect(window).toEqual({ dueAt: plusHours(start, 4), limitAt: plusHours(start, 4) });

      const extended = plusHours(start, 30);
      const withExtension = await sla.windowForPriority(
        fields({ slaStartAt: start, slaExtendedTo: extended }),
        'CRITICAL',
        ORG_A,
      );
      expect(withExtension).toEqual({ dueAt: plusHours(start, 4), limitAt: extended });
    });

    it('previews every priority from a start, with an optional floor', async () => {
      const start = at('2026-10-06T06:00:00Z');
      const floor = plusHours(start, 30);
      const preview = await sla.preview(start, ORG_A, floor);
      expect(Object.keys(preview)).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
      expect(preview['CRITICAL']).toEqual({ dueAt: plusHours(start, 4), limitAt: floor });
      expect(preview['LOW']).toEqual({ dueAt: plusHours(start, 80), limitAt: plusHours(start, 80) });
    });
  });

  describe('a due date a person sets', () => {
    const now = at('2026-10-06T08:00:00Z');
    const limit = at('2026-10-08T13:00:00Z');

    it('is accepted at or before the limit, in the future', async () => {
      await expect(sla.assertPersonDueDate(limit, limit, 'MEDIUM', ORG_A, now)).resolves.toBeUndefined();
      await expect(sla.assertPersonDueDate(plusHours(now, 1), limit, 'MEDIUM', ORG_A, now)).resolves.toBeUndefined();
    });

    it('is refused in the past (400)', async () => {
      const error = await sla.assertPersonDueDate(now, limit, 'MEDIUM', ORG_A, now).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe('The due date must be in the future');
    });

    it('is refused past the limit (400), naming the limit in the tenant zone and the priority as a word', async () => {
      const error = await sla
        .assertPersonDueDate(plusHours(limit, 1), limit, 'HIGH', ORG_A, now)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      // 13:00Z is 16:00 in Riyadh.
      expect((error as BadRequestException).message).toBe(
        "The due date can't be later than 8 Oct 2026, 16:00, the SLA limit for High priority",
      );
    });
  });

  it('formats a date for server text in both languages, Latin digits, in the tenant zone', async () => {
    await expect(sla.forPeople(at('2026-10-14T10:00:00Z'), ORG_A)).resolves.toEqual({
      en: '14 Oct 2026, 13:00',
      ar: '14 أكتوبر 2026، 13:00',
    });
    expect(mockCalendar.getEffectiveTimeZone).toHaveBeenCalledWith(ORG_A);
  });

  it('latest() ignores nulls', () => {
    const a = at('2026-10-06T00:00:00Z');
    const b = at('2026-10-07T00:00:00Z');
    expect(latest(a, null, undefined)).toBe(a);
    expect(latest(a, b, null)).toBe(b);
    expect(latest(b, a)).toBe(b);
  });
});
