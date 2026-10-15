import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TaskRecordListService } from './task-record-list.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

// ACC-229 — who sees which tasks on a record's panel and the All tasks list.
// The order and the filters are proved on real rows in
// task-record-list.db-spec.ts; this file pins the access rule and the scoping
// every query carries.

const RECORD = { sourceType: 'COMMITTEE' as const, sourceId: 'cmt-1' };
const VIEW_ALL = ['tasks:view', 'committees:view'];
const COMMITTEE_ONLY = ['committees:view'];

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    titleAr: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    dueAt: null,
    onHoldUntil: null,
    completedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    rejectedReason: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    requiresEvidence: false,
    sourceType: 'COMMITTEE',
    sourceId: 'cmt-1',
    createdById: 'creator',
    createdBy: { id: 'creator', name: 'Creator', status: 'ACTIVE' },
    workflowInstanceStageId: null,
    workflowInstanceId: null,
    sourceStageId: null,
    isMandatory: false,
    assignedOrgUnitId: null,
    assignedPositionId: null,
    assignedCommitteeId: null,
    assignedCommitteeRoleValueId: null,
    assignedOrgUnit: null,
    assignedPosition: null,
    assignedCommittee: null,
    assignedCommitteeRoleValue: null,
    assignees: [],
    requests: [],
    _count: { evidence: 0 },
    ...over,
  };
}

/** A tagged-template call to $queryRaw, rebuilt as the statement Postgres receives. */
function statement(call: unknown[]): Prisma.Sql {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
}

function setup(opts: { ids?: string[]; rows?: ReturnType<typeof task>[]; refuse?: Error; types?: string[] } = {}) {
  const ids = opts.ids ?? ['t2', 't1'];
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values).sql;
      if (sql.includes('COUNT(*)')) return Promise.resolve([{ n: BigInt(ids.length) }]);
      if (sql.includes('ROW_NUMBER')) return Promise.resolve([{ rn: BigInt(1) }]);
      return Promise.resolve(ids.map((id) => ({ id })));
    }),
    task: {
      count: jest.fn().mockResolvedValue(7),
      findMany: jest.fn().mockResolvedValue(opts.rows ?? ids.map((id) => task(id)).reverse()),
    },
    taskAssignee: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findFirst: jest.fn().mockResolvedValue({ positionId: null, primaryOrgUnitId: null }) },
    committeeMember: { findMany: jest.fn().mockResolvedValue([]) },
    committee: { findMany: jest.fn().mockResolvedValue([{ id: 'cmt-1', nameEn: 'Quality', nameAr: null }]) },
    meeting: { findMany: jest.fn().mockResolvedValue([]) },
    workflowInstanceStage: { findMany: jest.fn().mockResolvedValue([]) },
    workflowInstance: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const objectVisibility = {
    assertCanView: opts.refuse ? jest.fn().mockRejectedValue(opts.refuse) : jest.fn().mockResolvedValue(undefined),
    viewableTypes: jest.fn().mockReturnValue(opts.types ?? ['COMMITTEE']),
  };
  const tasks = { mayManage: jest.fn().mockResolvedValue(false) };
  const authority = { creatorsCoveredBy: jest.fn().mockResolvedValue([]) };
  const calendar = { getEffectiveTimeZone: jest.fn().mockResolvedValue('Asia/Riyadh') };
  const service = new TaskRecordListService(
    prisma as unknown as PrismaService,
    objectVisibility as unknown as ObjectVisibilityService,
    tasks as unknown as TaskService,
    authority as unknown as TaskAuthorityService,
    calendar as unknown as WorkingCalendarService,
  );
  return { service, prisma, objectVisibility, tasks, authority, calendar };
}

const sqlOf = (prisma: ReturnType<typeof setup>['prisma']) => prisma.$queryRaw.mock.calls.map((c) => statement(c));

describe('TaskRecordListService', () => {
  describe('on a record', () => {
    it('checks the record BEFORE reading any task, and a refusal reads nothing', async () => {
      const { service, prisma, objectVisibility } = setup({ refuse: new ForbiddenException('Required permission: committees:view') });
      await expect(service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: ['tasks:view'] })).rejects.toThrow(
        'Required permission: committees:view',
      );
      expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', 'org-a', ['tasks:view']);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.task.count).not.toHaveBeenCalled();
    });

    it('refuses a record type without a record, and a record without a type', async () => {
      const { service, prisma } = setup();
      await expect(service.list({ sourceType: 'COMMITTEE' }, 'org-a', { id: 'u1', permissions: VIEW_ALL })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.list({ sourceId: 'cmt-1' }, 'org-a', { id: 'u1', permissions: VIEW_ALL })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('with tasks:view, every task on the record', async () => {
      const { service, prisma } = setup();
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(result.scope).toBe('all');
      const page = sqlOf(prisma)[0]!;
      expect(page.text).toContain('"sourceType"::text = $');
      expect(page.text).not.toContain('o."userId"');
      expect(prisma.task.count).toHaveBeenCalledWith({ where: { organizationId: 'org-a', sourceType: 'COMMITTEE', sourceId: 'cmt-1' } });
    });

    it('without tasks:view (Q1), only the tasks the viewer is or was on, or created', async () => {
      const { service, prisma } = setup();
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: COMMITTEE_ONLY });
      expect(result.scope).toBe('own');
      for (const s of sqlOf(prisma)) {
        expect(s.text).toContain('t."createdById" = $');
        expect(s.text).toContain('o."userId" = $');
        expect(s.values.filter((v) => v === 'u1').length).toBe(2);
      }
      expect(prisma.task.count).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-a',
          sourceType: 'COMMITTEE',
          sourceId: 'cmt-1',
          OR: [{ createdById: 'u1' }, { assignees: { some: { userId: 'u1' } } }],
        },
      });
    });

    it('the panel asks for five and carries no filter options', async () => {
      const { service, prisma } = setup();
      const panel = await service.panel({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(panel.total).toBe(7);
      expect(sqlOf(prisma)[0]!.values).toContain(5);
      expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
    });
  });

  describe('organisation-wide (All tasks)', () => {
    it('needs tasks:view — 403 naming it, and nothing read', async () => {
      const { service, prisma } = setup();
      await expect(service.list({}, 'org-a', { id: 'u1', permissions: COMMITTEE_ONLY })).rejects.toThrow(
        'Required permission: tasks:view',
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('lists only the record types the viewer may see, and names each task\'s record', async () => {
      const { service, prisma, objectVisibility } = setup({ ids: ['t1'] });
      const result = await service.list({}, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(objectVisibility.viewableTypes).toHaveBeenCalledWith(VIEW_ALL);
      const page = sqlOf(prisma)[0]!;
      expect(page.text).toContain('"sourceType"::text IN ($');
      expect(page.values).toContain('COMMITTEE');
      expect(result.items[0]!.record).toEqual({ type: 'COMMITTEE', id: 'cmt-1', nameEn: 'Quality', nameAr: null });
    });

    it('a viewer who may see no record type gets no tasks (fail closed)', async () => {
      const { service, prisma } = setup({ types: [], ids: [] });
      await service.list({}, 'org-a', { id: 'u1', permissions: ['tasks:view'] });
      expect(sqlOf(prisma)[0]!.text).toContain('AND FALSE');
      expect(prisma.task.count).toHaveBeenCalledWith({ where: { organizationId: 'org-a', id: { in: [] } } });
    });
  });

  describe('rows', () => {
    it('come back in the order the query chose, with the task page\'s own actions', async () => {
      const mine = task('t2', { assignees: [{ userId: 'u1', removedAt: null, pickedAt: null, user: { id: 'u1', name: 'Me', position: null } }] });
      const { service } = setup({ ids: ['t2', 't1'], rows: [task('t1'), mine] });
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(result.items.map((r) => r.id)).toEqual(['t2', 't1']);
      expect(result.items[0]!.actions.primary).toBe('START');
      expect(result.items[1]!.actions.primary).toBeNull();
      expect(result.items[0]!.record).toBeNull();
    });

    it('reads the viewer\'s cover and pools once per page, never per row', async () => {
      const { service, authority, prisma, tasks } = setup({ ids: ['t1', 't2', 't3'] });
      await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(authority.creatorsCoveredBy).toHaveBeenCalledTimes(1);
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      // mayManage gets the covered set, so it reads nothing itself.
      for (const call of tasks.mayManage.mock.calls) expect((call[3] as { covered: Set<string> }).covered.has('u1')).toBe(true);
    });
  });

  describe('filters', () => {
    it('search escapes the LIKE wildcards a person typed', async () => {
      const { service, prisma } = setup();
      await service.list({ ...RECORD, q: '50%_done' }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(sqlOf(prisma)[0]!.values).toContain('%50\\%\\_done%');
    });

    it('Assigned includes a row still stored as OVERDUE (ACC-163)', async () => {
      const { service, prisma } = setup();
      await service.list({ ...RECORD, status: ['PENDING'] }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      const values = sqlOf(prisma)[0]!.values;
      expect(values).toEqual(expect.arrayContaining(['PENDING', 'OVERDUE']));
    });

    it('"This week" ends at the close of the seventh day in the TENANT\'s zone', async () => {
      const { service, prisma, calendar } = setup();
      await service.list({ ...RECORD, due: 'THIS_WEEK' }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(calendar.getEffectiveTimeZone).toHaveBeenCalledWith('org-a');
      const weekEnd = sqlOf(prisma)[0]!.values.find((v) => v instanceof Date) as Date;
      // 23:59:59.999 in Riyadh is 20:59:59.999 UTC.
      expect(weekEnd.toISOString()).toMatch(/T20:59:59\.999Z$/);
    });

    it('refuses a pool it cannot read', async () => {
      const { service, prisma } = setup();
      await expect(service.list({ ...RECORD, pool: 'ROLE:x:y' }, 'org-a', { id: 'u1', permissions: VIEW_ALL })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Another organisation asks: the record is checked in THEIR organisation,
    // every statement is bound to it, and every Prisma read is scoped by it.
    const { service, prisma, objectVisibility } = setup();
    await service.list({ ...RECORD, around: 't1' }, 'org-b', { id: 'u1', permissions: VIEW_ALL });
    expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', 'org-b', VIEW_ALL);
    const statements = sqlOf(prisma);
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s.text).toContain('t."organizationId" = $1');
      expect(s.values[0]).toBe('org-b');
    }
    expect(prisma.task.count.mock.calls[0]![0].where.organizationId).toBe('org-b');
    expect(prisma.task.findMany.mock.calls[0]![0].where.organizationId).toBe('org-b');
    expect(prisma.taskAssignee.findMany.mock.calls[0]![0].where.task.organizationId).toBe('org-b');
  });
});
