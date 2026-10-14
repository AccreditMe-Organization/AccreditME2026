import { PrismaService } from '../../../prisma/prisma.service';
import { THRESHOLD, isOutOfOffice, isPastThreshold, loadRecordWorkload } from './task-workload';

// ACC-199 — a person's workload on ONE record, and when "Suggest someone" is
// offered. Plan: backend/Plans/step-199-workload-hint.md §4–§5.

const ORG = 'org-a';
const RECORD = { sourceType: 'COMMITTEE' as const, sourceId: 'cmt-1' };
const NOW = new Date('2026-10-14T09:00:00.000Z');
const SOON = new Date('2026-10-16T09:00:00.000Z');
const past = new Date('2026-10-10T09:00:00.000Z');
const nextDay = new Date('2026-10-15T09:00:00.000Z');
const later = new Date('2026-10-30T09:00:00.000Z');

type Row = { userId: string; task: { status: string; dueAt: Date | null; priority: string } };

function prismaWith(rows: Row[]) {
  const findMany = jest.fn().mockResolvedValue(rows);
  return { findMany, prisma: { taskAssignee: { findMany } } as unknown as Pick<PrismaService, 'taskAssignee'> };
}

describe('loadRecordWorkload (ACC-199)', () => {
  it('reads only active rows on the record\'s open tasks, scoped to the organisation through the task', async () => {
    const { prisma, findMany } = prismaWith([]);
    await loadRecordWorkload(prisma, ORG, RECORD, ['u1', 'u2'], { now: NOW });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ['u1', 'u2'] },
        removedAt: null,
        task: { organizationId: ORG, sourceType: 'COMMITTEE', sourceId: 'cmt-1', status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      },
      select: { userId: true, task: { select: { status: true, dueAt: true, priority: true } } },
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // TaskAssignee has no organizationId: the tenant scope is the task's, and
    // it is always present — the counts can never include another
    // organisation's tasks, whatever ids are asked for.
    const { prisma, findMany } = prismaWith([]);
    await loadRecordWorkload(prisma, 'org-b', RECORD, ['u1'], { now: NOW });
    const where = (findMany.mock.calls[0] as [{ where: { task: { organizationId: string } } }])[0].where;
    expect(where.task.organizationId).toBe('org-b');
  });

  it('leaves the task being reassigned out of everyone\'s counts', async () => {
    const { prisma, findMany } = prismaWith([]);
    await loadRecordWorkload(prisma, ORG, RECORD, ['u1'], { now: NOW, excludeTaskId: 'task-9' });
    const where = (findMany.mock.calls[0] as [{ where: { task: Record<string, unknown> } }])[0].where;
    expect(where.task['id']).toEqual({ not: 'task-9' });
  });

  it('counts: on hold is open but never overdue or due soon; overdue is past due; due soon is before the horizon; urgent is HIGH or CRITICAL', async () => {
    const { prisma } = prismaWith([
      { userId: 'u1', task: { status: 'PENDING', dueAt: past, priority: 'HIGH' } }, // open, overdue, urgent
      { userId: 'u1', task: { status: 'IN_PROGRESS', dueAt: nextDay, priority: 'LOW' } }, // open, due soon
      { userId: 'u1', task: { status: 'ON_HOLD', dueAt: past, priority: 'CRITICAL' } }, // open, on hold, urgent — NOT overdue
      { userId: 'u1', task: { status: 'PENDING', dueAt: later, priority: 'MEDIUM' } }, // open only
      { userId: 'u1', task: { status: 'PENDING', dueAt: null, priority: 'MEDIUM' } }, // open only
      { userId: 'u2', task: { status: 'REJECTED', dueAt: past, priority: 'LOW' } }, // open (ACC-65), overdue
    ]);
    const counts = await loadRecordWorkload(prisma, ORG, RECORD, ['u1', 'u2', 'u3'], { now: NOW, dueSoonBefore: SOON });
    expect(counts.get('u1')).toEqual({ open: 5, overdue: 1, dueSoon: 1, urgent: 2, onHold: 1 });
    expect(counts.get('u2')).toEqual({ open: 1, overdue: 1, dueSoon: 0, urgent: 0, onHold: 0 });
    // Nobody's rows: zeros, never missing.
    expect(counts.get('u3')).toEqual({ open: 0, overdue: 0, dueSoon: 0, urgent: 0, onHold: 0 });
  });

  it('with no horizon, nothing is due soon', async () => {
    const { prisma } = prismaWith([{ userId: 'u1', task: { status: 'PENDING', dueAt: nextDay, priority: 'LOW' } }]);
    const counts = await loadRecordWorkload(prisma, ORG, RECORD, ['u1'], { now: NOW });
    expect(counts.get('u1')!.dueSoon).toBe(0);
  });

  it('asks nothing for nobody', async () => {
    const { prisma, findMany } = prismaWith([]);
    expect((await loadRecordWorkload(prisma, ORG, RECORD, [], { now: NOW })).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('isPastThreshold (ACC-199, Q3): 50% more open tasks AND at least 3 more than the least loaded', () => {
  it('pins the rule', () => {
    expect(THRESHOLD).toEqual({ ratio: 1.5, minDifference: 3 });
  });

  it.each([
    [1, [0], false, 'the drawn rule alone would fire at 1 against 0'],
    [2, [1], false, 'one more is not overloaded'],
    [3, [2], false, '50% more, but only one more'],
    [3, [0], true, 'three more than someone with nothing'],
    [6, [4], false, 'two more'],
    [7, [4], true, '75% and three more'],
    [12, [4, 7], true, 'the drawing: 12 against the least loaded, 4'],
    [9, [6], true, 'exactly 50% more and exactly three more: both edges are inclusive'],
    [10, [7], false, 'three more, but under 50%'],
    [5, [], false, 'nobody else to suggest'],
  ])('%i against %j → %s (%s)', (chosen, others, expected) => {
    expect(isPastThreshold(chosen, others)).toBe(expected);
  });
});

describe('isOutOfOffice (ACC-199, Q6)', () => {
  it('needs both dates, with now inside them', () => {
    const from = new Date('2026-10-13T00:00:00.000Z');
    const to = new Date('2026-10-20T00:00:00.000Z');
    expect(isOutOfOffice({ outOfOfficeFrom: from, outOfOfficeTo: to }, NOW)).toBe(true);
    expect(isOutOfOffice({ outOfOfficeFrom: from, outOfOfficeTo: null }, NOW)).toBe(false);
    expect(isOutOfOffice({ outOfOfficeFrom: null, outOfOfficeTo: to }, NOW)).toBe(false);
    expect(isOutOfOffice({ outOfOfficeFrom: to, outOfOfficeTo: later }, NOW)).toBe(false);
  });
});
