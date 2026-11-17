import { TaskDueWarningService, DUE_WARNING_SOURCE } from './task-due-warning.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { GCC_DEFAULT_CALENDAR, LoadedCalendar } from '../working-calendar/working-time';
import { DEFAULT_TASK_SLA_SETTINGS } from '../tenant/task-sla-settings';
import { useFixedClock } from '../../common/testing/fixed-clock';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CURRENT_ACTIVE_ASSIGNEE } from './task-pool';

// ACC-313 PR 4 — the due-soon reminder sweep: once per due time, in working
// hours, to whoever holds the task or, while it waits, to its pool. The claim's
// once-only property is proved against a real Postgres in
// task-due-warning.db-spec.ts; these specs pin what is read, claimed and sent.

// Tuesday 17 Nov 2026, 10:00 in Riyadh (07:00 UTC): a working moment.
const NOW = new Date('2026-11-17T07:00:00.000Z');
const GCC: LoadedCalendar = { calendar: GCC_DEFAULT_CALENDAR, holidays: [] };
const OFF = { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' };

function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?').replace(/\s+/g, ' '), values };
}

const NO_POOL = { assignedOrgUnitId: null, assignedPositionId: null, assignedCommitteeId: null, assignedCommitteeRoleValueId: null };
const held = (id: string, userIds: string[], over: Record<string, unknown> = {}) => ({
  id,
  title: 'Collect the audit sample',
  dueAt: new Date('2026-11-17T08:00:00.000Z'), // 11:00 Riyadh
  ...NO_POOL,
  assignees: userIds.map((userId) => ({ userId })),
  ...over,
});

describe('TaskDueWarningService (ACC-313)', () => {
  let service: TaskDueWarningService;
  let prisma: {
    $queryRaw: jest.Mock;
    task: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
    committeeMember: { findMany: jest.Mock };
  };
  let calendar: { loadCalendar: jest.Mock };
  let notifications: { createInAppMany: jest.Mock };

  /** The organisations the first read finds, then the ids each claim takes. */
  function organisations(rows: { id: string; warn: Record<string, string>; taskSla?: unknown }[], ...claims: string[][]): void {
    prisma.$queryRaw.mockResolvedValueOnce(
      rows.map((r) => ({ id: r.id, taskSla: r.taskSla ?? DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { warnBeforeDue: r.warn, notifyOnDueChange: true } })),
    );
    for (const ids of claims) prisma.$queryRaw.mockResolvedValueOnce(ids.map((id) => ({ id })));
  }
  const claimCall = (n = 1) => sqlOf(prisma.$queryRaw.mock.calls[n] as unknown[]);
  const taskWhere = () => (prisma.task.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
  const sent = () => (notifications.createInAppMany.mock.calls[0]?.[0] ?? []) as { userId: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string; objectType: string; objectId: string }[];

  beforeEach(() => {
    useFixedClock(NOW);
    prisma = {
      $queryRaw: jest.fn(),
      task: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      committeeMember: { findMany: jest.fn().mockResolvedValue([]) },
    };
    calendar = { loadCalendar: jest.fn().mockResolvedValue(GCC) };
    notifications = { createInAppMany: jest.fn().mockResolvedValue(1) };
    service = new TaskDueWarningService(
      prisma as unknown as PrismaService,
      calendar as unknown as WorkingCalendarService,
      notifications as unknown as NotificationService,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('reads only organisations with a warning that is not Off', async () => {
    organisations([]);

    await service.sweep(NOW);

    const { text } = sqlOf(prisma.$queryRaw.mock.calls[0] as unknown[]);
    expect(text).toContain(`jsonb_typeof(settings->'taskSlaNotices'->'warnBeforeDue') = 'object'`);
    expect(text).toContain(`w.value <> 'OFF'`);
    expect(calendar.loadCalendar).not.toHaveBeenCalled();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('outside working hours, nothing is read or sent', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }]);

    // 20:00 Riyadh: after the close.
    await service.sweep(new Date('2026-11-17T17:00:00.000Z'));

    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(notifications.createInAppMany).not.toHaveBeenCalled();
  });

  it('asks for open, unstamped tasks due inside each priority’s own window, someone to tell, in one query', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2', LOW: 'WORKING_DAY' } }]);

    await service.sweep(NOW);

    expect(prisma.task.findMany).toHaveBeenCalledTimes(1);
    const where = taskWhere();
    expect(where['organizationId']).toBe('org-a');
    expect(where['dueWarnedAt']).toBeNull();
    expect(where['status']).toEqual({ in: ['PENDING', 'IN_PROGRESS'] });
    const [windows, someone] = where['AND'] as { OR: unknown[] }[];
    expect(windows!.OR).toEqual([
      // LOW: one working day (8 hours) from 10:00 Tuesday is 10:00 Wednesday.
      { priority: 'LOW', dueAt: { gt: NOW, lte: new Date('2026-11-18T07:00:00.000Z') } },
      // HIGH: two working hours from 10:00 is 12:00.
      { priority: 'HIGH', dueAt: { gt: NOW, lte: new Date('2026-11-17T09:00:00.000Z') } },
    ]);
    expect(someone!.OR).toEqual([
      { assignees: { some: { removedAt: null, user: { status: 'ACTIVE' } } } },
      { assignedPositionId: { not: null } },
      { assignedCommitteeId: { not: null } },
    ]);
  });

  it('reads "someone is on it" from ACC-86’s one definition, in the where and in the select, never a copy', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }]);

    await service.sweep(NOW);

    const [, someone] = taskWhere()['AND'] as { OR: { assignees?: { some: unknown } }[] }[];
    expect(someone!.OR[0]!.assignees!.some).toBe(CURRENT_ACTIVE_ASSIGNEE);
    const select = (prisma.task.findMany.mock.calls[0][0] as { select: { assignees: { where: unknown; select: unknown } } }).select;
    expect(select.assignees.where).toBe(CURRENT_ACTIVE_ASSIGNEE);
    expect(select.assignees.select).toEqual({ userId: true });
  });

  it('a warning a calendar change made too long for its limit is treated as Off', async () => {
    // Critical's limit is 4 working hours; "1 working day" is 8.
    organisations([{ id: 'org-a', warn: { ...OFF, CRITICAL: 'WORKING_DAY' } }]);

    await service.sweep(NOW);

    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('claims each task with one conditional write, then tells the people on it, once, in both languages', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], ['task-1']);
    // The select returns only the rows that put someone on the task.
    prisma.task.findMany.mockResolvedValue([held('task-1', ['u-1'])]);

    await service.sweep(NOW);

    const claim = claimCall();
    expect(claim.text).toContain('UPDATE "Task" SET "dueWarnedAt" = ?');
    expect(claim.text).toContain('"dueWarnedAt" IS NULL RETURNING id');
    expect(claim.values).toEqual([NOW, 'org-a', ['task-1']]);
    expect(notifications.createInAppMany).toHaveBeenCalledTimes(1);
    expect(notifications.createInAppMany.mock.calls[0][1]).toBe('org-a');
    expect(notifications.createInAppMany.mock.calls[0][2]).toBe(DUE_WARNING_SOURCE);
    expect(sent()).toEqual([
      {
        userId: 'u-1',
        titleEn: 'Task due soon',
        titleAr: 'اقترب موعد استحقاق مهمة',
        bodyEn: '"Collect the audit sample" is due 17 Nov 2026, 11:00.',
        bodyAr: 'يحين موعد استحقاق المهمة "Collect the audit sample" في 17 نوفمبر 2026، 11:00.',
        objectType: 'Task',
        objectId: 'task-1',
      },
    ]);
    // The claim is written before any notice.
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(notifications.createInAppMany.mock.invocationCallOrder[0]!);
  });

  it('a task another worker claimed first is not told again', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], []);
    prisma.task.findMany.mockResolvedValue([held('task-1', ['u-1'])]);

    await service.sweep(NOW);

    expect(notifications.createInAppMany).not.toHaveBeenCalled();
  });

  it('a task still waiting in its pool reminds the pool’s members, resolved in one batch', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], ['pos-task', 'seat-task']);
    prisma.task.findMany.mockResolvedValue([
      held('pos-task', [], { assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-1' }),
      held('seat-task', [], { assignedCommitteeId: 'com-1', assignedCommitteeRoleValueId: 'seat-1' }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'holder-1', positionId: 'pos-1', primaryOrgUnitId: 'unit-1' },
      { id: 'holder-2', positionId: 'pos-1', primaryOrgUnitId: 'unit-1' },
    ]);
    prisma.committeeMember.findMany.mockResolvedValue([{ userId: 'member-1', committeeId: 'com-1', roleValueId: 'seat-1' }]);

    await service.sweep(NOW);

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { organizationId: 'org-a', status: 'ACTIVE', OR: [{ primaryOrgUnitId: 'unit-1', positionId: 'pos-1' }] } }),
    );
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    expect(sent().map((r) => [r.objectId, r.userId])).toEqual([
      ['pos-task', 'holder-1'],
      ['pos-task', 'holder-2'],
      ['seat-task', 'member-1'],
    ]);
  });

  it('a task someone has picked from its pool tells only them, not the pool', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], ['task-1']);
    prisma.task.findMany.mockResolvedValue([
      held('task-1', ['picker'], { assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-1' }),
    ]);

    await service.sweep(NOW);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(sent().map((r) => r.userId)).toEqual(['picker']);
  });

  it('a notice that fails is logged and not retried: the claim stands', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], ['task-1']);
    prisma.task.findMany.mockResolvedValue([held('task-1', ['u-1'])]);
    notifications.createInAppMany.mockRejectedValueOnce(new Error('boom'));

    await expect(service.sweep(NOW)).resolves.toBeUndefined();

    expect(notifications.createInAppMany).toHaveBeenCalledTimes(1);
  });

  it('one organisation that fails does not keep the others from being reminded, and the step still fails', async () => {
    organisations(
      [
        { id: 'org-a', warn: { ...OFF, HIGH: 'H2' } },
        { id: 'org-b', warn: { ...OFF, HIGH: 'H2' } },
      ],
      ['task-b'],
    );
    calendar.loadCalendar.mockRejectedValueOnce(new Error('calendar down')).mockResolvedValueOnce(GCC);
    prisma.task.findMany.mockResolvedValue([held('task-b', ['u-b'])]);

    await expect(service.sweep(NOW)).rejects.toThrow('Due-soon reminders failed for 1 organisation(s): org-a');

    expect(notifications.createInAppMany).toHaveBeenCalledWith(expect.any(Array), 'org-b', DUE_WARNING_SOURCE);
  });

  itEnforcesTenantIsolation('the due-soon sweep reads, claims and notifies within one organisation at a time', async () => {
    organisations([{ id: 'org-a', warn: { ...OFF, HIGH: 'H2' } }], ['task-1']);
    prisma.task.findMany.mockResolvedValue([held('task-1', [], { assignedOrgUnitId: 'unit-1', assignedPositionId: 'pos-1' })]);
    prisma.user.findMany.mockResolvedValue([{ id: 'holder-1', positionId: 'pos-1', primaryOrgUnitId: 'unit-1' }]);

    await service.sweep(NOW);

    expect(calendar.loadCalendar).toHaveBeenCalledWith('org-a');
    expect(taskWhere()['organizationId']).toBe('org-a');
    expect(claimCall().text).toContain('WHERE "organizationId" = ? AND id = ANY(?::text[])');
    expect(claimCall().values[1]).toBe('org-a');
    expect((prisma.user.findMany.mock.calls[0][0] as { where: { organizationId: string } }).where.organizationId).toBe('org-a');
    expect(notifications.createInAppMany.mock.calls[0][1]).toBe('org-a');
  });
});
