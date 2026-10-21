import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { TaskAssignmentService } from '../task-assignment.service';
import { IAssignableHolder } from '../interfaces/task-assignment.interface';
import { TaskVisibilityService } from '../task-visibility.service';
import type { TaskVisibilityContext } from '../task-visibility';
import { recordTypesVisibleTo } from '../../../common/services/object-visibility.service';
import { typesHolding } from '../task-record-types';
import { TaskWorkloadService } from './task-workload.service';

// ACC-199 — the picker's people with their counts on the record (Q4): exactly
// whoever could already see the record's task list sees them, and nobody else.

const ORG = 'org-a';
const RECORD = { sourceType: 'COMMITTEE' as const, sourceId: 'cmt-1' };
// ACC-244 — the task visibility rule's context, from the viewer's own keys
// (no unit scope here: that path is proved on real rows in
// task-visibility.db-spec.ts). Counts need the whole record: View all tasks.
const ruleStub = {
  contextFor: async (v: { id: string; permissions: readonly string[] }) =>
    ({
      viewerId: v.id,
      recordTypes: recordTypesVisibleTo(v.permissions),
      viewAllTypes: typesHolding(v.permissions, 'VIEW_ALL'),
      unitScope: [],
    }) as unknown as TaskVisibilityContext,
  seesWholeRecord: async (ctx: TaskVisibilityContext, type: string) => ctx.viewAllTypes.includes(type),
};
const CAN_SEE = { id: 'assigner', permissions: ['committees:create_tasks', 'committees:view_all_tasks', 'committees:view'] };

const holder = (id: string, name: string): IAssignableHolder => ({
  id,
  name,
  positionNameEn: 'Quality Officer',
  positionNameAr: null,
  workload: null,
});
const HOLDERS = [holder('nora', 'Nora Al-Otaibi'), holder('sara', 'Sara Al-Mutairi'), holder('khalid', 'Khalid Al-Zahrani')];

function setup(options: { rows?: { userId: string; status?: string }[]; away?: string[]; visibility?: Error | null } = {}) {
  const rows = (options.rows ?? []).map((r) => ({
    userId: r.userId,
    task: { status: r.status ?? 'PENDING', dueAt: null, priority: 'MEDIUM' },
  }));
  const prisma = {
    taskAssignee: { findMany: jest.fn().mockResolvedValue(rows) },
    user: {
      findMany: jest.fn().mockResolvedValue(
        HOLDERS.map((h) => ({
          id: h.id,
          outOfOfficeFrom: options.away?.includes(h.id) ? new Date(Date.now() - 86_400_000) : null,
          outOfOfficeTo: options.away?.includes(h.id) ? new Date(Date.now() + 86_400_000) : null,
        })),
      ),
    },
  };
  const assignment = {
    listHolders: jest.fn().mockResolvedValue(HOLDERS.map((h) => ({ ...h }))),
    listCommitteeMembers: jest.fn().mockResolvedValue(HOLDERS.map((h) => ({ ...h }))),
  };
  const objectVisibility = {
    assertCanView: jest.fn().mockImplementation(() => (options.visibility ? Promise.reject(options.visibility) : Promise.resolve())),
  };
  const workingCalendar = {
    getOrCreate: jest.fn().mockResolvedValue({ workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
    calculateDeadline: jest.fn().mockResolvedValue(DateTime.fromISO('2099-01-01T00:00:00Z')),
  };
  const service = new TaskWorkloadService(
    prisma as unknown as PrismaService,
    assignment as unknown as TaskAssignmentService,
    objectVisibility as unknown as ObjectVisibilityService,
    workingCalendar as unknown as WorkingCalendarService,
    ruleStub as unknown as TaskVisibilityService,
  );
  return { service, prisma, assignment, objectVisibility, workingCalendar };
}

const rowsFor = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([userId, n]) => Array.from({ length: n }, () => ({ userId })));

describe('TaskWorkloadService (ACC-199)', () => {
  it('with no record named: the list as the picker gives it, no counts, nothing counted', async () => {
    const { service, prisma, objectVisibility } = setup();
    const list = await service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1' });
    expect(list.map((h) => h.workload)).toEqual([null, null, null]);
    expect(objectVisibility.assertCanView).not.toHaveBeenCalled();
    expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
  });

  it('without View all tasks (and no unit scope): no counts, and the record is not even read', async () => {
    const { service, prisma, objectVisibility } = setup();
    const list = await service.listHolders({ id: 'x', permissions: ['committees:create_tasks', 'committees:view'] }, ORG, {
      orgUnitId: 'u1',
      positionId: 'p1',
      record: RECORD,
    });
    expect(list.every((h) => h.workload === null)).toBe(true);
    expect(objectVisibility.assertCanView).not.toHaveBeenCalled();
    expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['403 (no committees:view)', new ForbiddenException('Required permission: committees:view')],
    ['404 (not this organisation\'s)', new NotFoundException('COMMITTEE not found')],
  ])('the record\'s task list not visible, %s: no counts — and the picker still answers', async (_label, refusal) => {
    const { service, prisma } = setup({ visibility: refusal });
    const list = await service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1', record: RECORD });
    expect(list).toHaveLength(3);
    expect(list.every((h) => h.workload === null)).toBe(true);
    expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
  });

  it('any other failure of the check is not swallowed into "no counts"', async () => {
    const { service } = setup({ visibility: new Error('connection reset') });
    await expect(service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1', record: RECORD })).rejects.toThrow(
      'connection reset',
    );
  });

  it('visible: each person carries open and overdue on the record, and whether choosing them offers a suggestion', async () => {
    const { service, objectVisibility } = setup({ rows: rowsFor({ nora: 12, sara: 4, khalid: 7 }) });
    const list = await service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1', record: RECORD });
    expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', ORG, CAN_SEE.permissions);
    expect(list.map((h) => [h.id, h.workload])).toEqual([
      ['nora', { openCount: 12, overdueCount: 0, canSuggest: true }],
      ['sara', { openCount: 4, overdueCount: 0, canSuggest: false }],
      ['khalid', { openCount: 7, overdueCount: 0, canSuggest: true }], // 7 ≥ 6 and 3 more than Sara
    ]);
  });

  it('someone out of office is never the comparison (Q6), but still listed with counts', async () => {
    const { service } = setup({ rows: rowsFor({ nora: 12, sara: 0, khalid: 11 }), away: ['sara'] });
    const list = await service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1', record: RECORD });
    // Without Sara, Nora's 12 is compared with Khalid's 11: not overloaded.
    expect(list.find((h) => h.id === 'nora')!.workload).toEqual({ openCount: 12, overdueCount: 0, canSuggest: false });
    expect(list.find((h) => h.id === 'sara')!.workload).toEqual({ openCount: 0, overdueCount: 0, canSuggest: false });
  });

  it('Reassign: the task itself is left out of the counts', async () => {
    const { service, prisma } = setup();
    await service.listCommitteeMembers(CAN_SEE, ORG, { committeeId: 'cmt-1', roleValueId: 'r1', taskId: 'task-9', record: RECORD });
    const where = (prisma.taskAssignee.findMany.mock.calls[0] as [{ where: { task: Record<string, unknown> } }])[0].where;
    expect(where.task['id']).toEqual({ not: 'task-9' });
  });

  it('the lists never compute "due soon" — only the press does, through the working calendar', async () => {
    const { service, workingCalendar } = setup();
    await service.listHolders(CAN_SEE, ORG, { orgUnitId: 'u1', positionId: 'p1', record: RECORD });
    expect(workingCalendar.calculateDeadline).not.toHaveBeenCalled();

    await service.people(ORG, HOLDERS, RECORD, { withDueSoon: true });
    // Two working days of 8 hours each, from now, in the tenant's calendar.
    expect(workingCalendar.calculateDeadline).toHaveBeenCalledWith(expect.anything(), 16, ORG);
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Another organisation asks about this committee: the record check is
    // made in THEIR organisation, and the counts read is scoped by it too.
    const { service, prisma, objectVisibility } = setup({ rows: rowsFor({ nora: 3 }) });
    await service.listHolders(CAN_SEE, 'org-b', { orgUnitId: 'u1', positionId: 'p1', record: RECORD });
    expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', 'org-b', CAN_SEE.permissions);
    const where = (prisma.taskAssignee.findMany.mock.calls[0] as [{ where: { task: { organizationId: string } } }])[0].where;
    expect(where.task.organizationId).toBe('org-b');
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-b' }) }));
  });
});
