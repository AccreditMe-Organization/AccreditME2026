import { DateTime } from 'luxon';
import { WorkingCalendarService } from './working-calendar.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskService } from '../task/task.service';
import type { TenantService } from '../tenant/tenant.service';

/**
 * ACC-175 — a start BEFORE opening time on a working day counts that day.
 * calculateDeadline() used to move such a start to the NEXT working day's
 * opening, so a task created Monday 07:30 with a 2-hour SLA was due Tuesday
 * 10:00. Plan: backend/Plans/step-175-deadline-before-opening.md (§3).
 *
 * Every case is built and read in the calendar's own zone, never UTC. The
 * calendar is real; only Prisma is faked.
 */

const RIYADH = 'org-riyadh'; // Sun–Thu, 08:00–16:00, Asia/Riyadh
const DUBAI = 'org-dubai'; // Sun–Thu, 09:00–17:00, Asia/Dubai (UTC+4, no DST)

const CALENDARS: Record<string, object> = {
  [RIYADH]: {
    id: 'cal-riyadh',
    organizationId: RIYADH,
    timezone: 'Asia/Riyadh',
    workingDays: [0, 1, 2, 3, 4],
    workingHoursStart: '08:00',
    workingHoursEnd: '16:00',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  [DUBAI]: {
    id: 'cal-dubai',
    organizationId: DUBAI,
    timezone: 'Asia/Dubai',
    workingDays: [0, 1, 2, 3, 4],
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

// July 2026: Thu 16, Fri 17, Sat 18, Sun 19, Mon 20, Tue 21.
const MONDAY_20_HOLIDAY = {
  id: 'h-mon',
  workingCalendarId: 'cal-riyadh',
  nameEn: 'Holiday',
  nameAr: null,
  date: new Date('2026-07-20T00:00:00.000Z'),
  isRecurring: false,
  createdAt: new Date(),
};

let holidays: object[] = [];
const prisma = {
  workingCalendar: {
    findUnique: jest.fn(({ where }: { where: { organizationId: string } }) =>
      Promise.resolve(CALENDARS[where.organizationId] ?? null),
    ),
  },
  publicHoliday: { findMany: jest.fn(() => Promise.resolve(holidays)) },
  organization: {
    findFirst: jest.fn(() => Promise.resolve({ settings: null })),
  },
};
const calendar = new WorkingCalendarService(
  prisma as unknown as PrismaService,
  {} as AuditLogService,
);

/** A wall-clock moment in a zone, as the instant the callers pass in. */
const at = (zone: string, day: number, hour: number, minute = 0): DateTime =>
  DateTime.fromObject(
    { year: 2026, month: 7, day, hour, minute },
    { zone },
  ).toUTC();
/** An instant read back in a zone: "Mon 2026-07-20 10:00". */
const read = (zone: string, dt: DateTime | Date): string =>
  (dt instanceof Date ? DateTime.fromJSDate(dt) : dt)
    .setZone(zone)
    .toFormat('ccc yyyy-MM-dd HH:mm');
const riyadh = (day: number, hour: number, minute = 0) =>
  at('Asia/Riyadh', day, hour, minute);
const deadline = async (start: DateTime, hours: number, org = RIYADH) => {
  const zone = org === DUBAI ? 'Asia/Dubai' : 'Asia/Riyadh';
  return read(zone, await calendar.calculateDeadline(start, hours, org));
};

beforeEach(() => {
  holidays = [];
});

describe('calculateDeadline — a start before opening counts that day (ACC-175)', () => {
  it.each([
    [
      'before opening, working day (Mon 07:30 + 2 h)',
      riyadh(20, 7, 30),
      2,
      'Mon 2026-07-20 10:00',
    ],
    [
      'before opening, spilling into the next day (Mon 07:30 + 10 h)',
      riyadh(20, 7, 30),
      10,
      'Tue 2026-07-21 10:00',
    ],
    [
      'at opening (Mon 08:00 + 2 h)',
      riyadh(20, 8, 0),
      2,
      'Mon 2026-07-20 10:00',
    ],
    ['mid-day (Mon 13:00 + 2 h)', riyadh(20, 13, 0), 2, 'Mon 2026-07-20 15:00'],
    [
      'exactly at closing (Mon 16:00 + 2 h)',
      riyadh(20, 16, 0),
      2,
      'Tue 2026-07-21 10:00',
    ],
    [
      'after closing (Mon 17:30 + 2 h)',
      riyadh(20, 17, 30),
      2,
      'Tue 2026-07-21 10:00',
    ],
    [
      'on a weekend day (Fri 10:00 + 2 h)',
      riyadh(17, 10, 0),
      2,
      'Sun 2026-07-19 10:00',
    ],
    [
      'before opening on a weekend day (Sat 07:00 + 2 h)',
      riyadh(18, 7, 0),
      2,
      'Sun 2026-07-19 10:00',
    ],
  ] as const)('%s, Riyadh', async (_name, start, hours, expected) => {
    expect(await deadline(start, hours)).toBe(expected);
  });

  it('a holiday is skipped even before its opening time', async () => {
    holidays = [MONDAY_20_HOLIDAY];
    expect(await deadline(riyadh(20, 7, 30), 2)).toBe('Tue 2026-07-21 10:00');
  });

  it('on a holiday eve, after closing, the next working day is past the holiday', async () => {
    holidays = [MONDAY_20_HOLIDAY];
    expect(await deadline(riyadh(19, 17, 0), 2)).toBe('Tue 2026-07-21 10:00');
  });

  describe('zero hours: the next working moment', () => {
    it('inside working hours, the start itself', async () => {
      expect(await deadline(riyadh(20, 13, 0), 0)).toBe('Mon 2026-07-20 13:00');
    });
    it('before opening on a working day, that day’s opening (was the next day’s)', async () => {
      expect(await deadline(riyadh(20, 7, 30), 0)).toBe('Mon 2026-07-20 08:00');
    });
    it('after closing, the next working day’s opening (documented, unchanged)', async () => {
      expect(await deadline(riyadh(16, 16, 0), 0)).toBe('Sun 2026-07-19 08:00');
    });
  });

  it("reads the calendar's own zone and opening time (Asia/Dubai, 09:00)", async () => {
    expect(await deadline(at('Asia/Dubai', 20, 8, 30), 2, DUBAI)).toBe(
      'Mon 2026-07-20 11:00',
    );
  });

  it('stays the inverse of workingHoursBetween() for a start before opening', async () => {
    const cases: [DateTime, string][] = [
      [riyadh(20, 7, 30), RIYADH],
      [riyadh(18, 7, 0), RIYADH],
      [at('Asia/Dubai', 20, 8, 30), DUBAI],
    ];
    for (const [start, org] of cases) {
      for (const hours of [2, 10, 13.5]) {
        const end = await calendar.calculateDeadline(start, hours, org);
        expect([
          org,
          read('UTC', start),
          hours,
          await calendar.workingHoursBetween(start, end, org),
        ]).toEqual([org, read('UTC', start), hours, hours]);
      }
    }
    holidays = [MONDAY_20_HOLIDAY];
    const end = await calendar.calculateDeadline(riyadh(20, 7, 30), 2, RIYADH);
    expect(
      await calendar.workingHoursBetween(riyadh(20, 7, 30), end, RIYADH),
    ).toBe(2);
  });
});

describe('the callers that pass a before-opening start (ACC-175)', () => {
  const sla = new TaskSlaService(prisma as unknown as PrismaService, calendar);

  it('a task priority SLA (windowFrom): created Monday 07:30, Critical (4 h) is due Monday 12:00', async () => {
    expect(
      read(
        'Asia/Riyadh',
        await sla.windowFrom(riyadh(20, 7, 30).toJSDate(), 'CRITICAL', RIYADH),
      ),
    ).toBe('Mon 2026-07-20 12:00');
  });

  it('the pool clock with 0 escalation hours, after closing, escalates at the next opening', async () => {
    type PoolClock = (
      priority: string,
      organizationId: string,
      from: Date,
    ) => Promise<{ poolEscalateAt: Date }>;
    const poolClock = (
      TaskService.prototype as unknown as { poolClock: PoolClock }
    ).poolClock;
    const tenantService = {
      getTaskSla: () =>
        Promise.resolve({
          HIGH: {
            dueAfterHours: 16,
            managerEscalationAfterHours: 0,
            headEscalationAfterHours: 16,
          },
        }),
    } as unknown as TenantService;
    const clock = await poolClock.call(
      { tenantService, workingCalendar: calendar },
      'HIGH',
      RIYADH,
      riyadh(16, 17, 0).toJSDate(),
    );
    expect(read('Asia/Riyadh', clock.poolEscalateAt)).toBe(
      'Sun 2026-07-19 08:00',
    );
    // Before opening on a working day, the same day's opening.
    const early = await poolClock.call(
      { tenantService, workingCalendar: calendar },
      'HIGH',
      RIYADH,
      riyadh(20, 7, 0).toJSDate(),
    );
    expect(read('Asia/Riyadh', early.poolEscalateAt)).toBe(
      'Mon 2026-07-20 08:00',
    );
  });

  it('the hold shift: a due date a person set before opening moves by the held working hours from that day', async () => {
    // Approved Sunday 14:00, held until Monday's opening: 2 working hours held
    // (Sunday 14:00–16:00), the same two calls TaskRequestService makes.
    const heldHours = await calendar.workingHoursBetween(
      riyadh(19, 14, 0),
      riyadh(20, 8, 0),
      RIYADH,
    );
    expect(heldHours).toBe(2);
    const dueAt = riyadh(20, 7, 0).toJSDate(); // a person picked Monday 07:00
    expect(read('Asia/Riyadh', await sla.shift(dueAt, heldHours, RIYADH))).toBe(
      'Mon 2026-07-20 10:00',
    );
  });
});
