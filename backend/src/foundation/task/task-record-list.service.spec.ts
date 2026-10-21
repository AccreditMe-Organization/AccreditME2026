import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TaskRecordListService } from './task-record-list.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskVisibilityService } from './task-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

// ACC-229 / ACC-244 — a record's panel and the organisation-wide views. Who
// sees which tasks is THE task visibility rule (task-visibility.ts): its
// meaning is proved on real rows in task-visibility.db-spec.ts, the order and
// filters in task-record-list.db-spec.ts. This file pins what the list does
// with the rule: refusals before any read, the rule in every statement, every
// statement and read scoped by organisation, and the views' own refusals.
//
// The REAL TaskVisibilityService runs here, over the mocked Prisma below.

const RECORD = { sourceType: 'COMMITTEE' as const, sourceId: 'cmt-1' };
const VIEW_ALL = ['committees:view_all_tasks', 'committees:view'];
const COMMITTEE_ONLY = ['committees:view'];
const MANAGER = ['committees:manage_tasks', 'committees:view'];

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

function setup(opts: { ids?: string[]; rows?: ReturnType<typeof task>[]; refuse?: Error; headOf?: string | null } = {}) {
  const ids = opts.ids ?? ['t2', 't1'];
  const prisma = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values).sql;
      if (sql.includes('WITH RECURSIVE')) return Promise.resolve(opts.headOf ? [{ id: opts.headOf }] : []);
      if (sql.includes('AS hit')) return Promise.resolve([{ hit: true }]);
      if (sql.includes('COUNT(*)')) return Promise.resolve([{ n: BigInt(ids.length) }]);
      if (sql.includes('ROW_NUMBER')) return Promise.resolve([{ rn: BigInt(1) }]);
      if (sql.includes('DISTINCT')) return Promise.resolve([]);
      if (sql.includes('"OrgUnit" ou')) return Promise.resolve([]);
      return Promise.resolve(ids.map((id) => ({ id })));
    }),
    task: { findMany: jest.fn().mockResolvedValue(opts.rows ?? ids.map((id) => task(id)).reverse()) },
    user: {
      findFirst: jest.fn(async ({ where }: { where: { position?: unknown } }) =>
        // findUnitHeadedBy asks with the holder rule; poolTargetsOfUser without.
        where.position ? (opts.headOf ? { primaryOrgUnitId: opts.headOf } : null) : { positionId: null, primaryOrgUnitId: null },
      ),
    },
    committeeMember: { findMany: jest.fn().mockResolvedValue([]) },
    orgUnitHeadAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    committee: { findMany: jest.fn().mockResolvedValue([{ id: 'cmt-1', nameEn: 'Quality', nameAr: null }]) },
    meeting: { findMany: jest.fn().mockResolvedValue([]) },
    workflowInstanceStage: { findMany: jest.fn().mockResolvedValue([]) },
    workflowInstance: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const objectVisibility = {
    assertCanView: opts.refuse ? jest.fn().mockRejectedValue(opts.refuse) : jest.fn().mockResolvedValue(undefined),
  };
  const tasks = { mayManage: jest.fn().mockResolvedValue(false) };
  const authority = { creatorsCoveredBy: jest.fn().mockResolvedValue([]) };
  const calendar = { getEffectiveTimeZone: jest.fn().mockResolvedValue('Asia/Riyadh') };
  const visibility = new TaskVisibilityService(prisma as unknown as PrismaService, authority as unknown as TaskAuthorityService);
  const service = new TaskRecordListService(
    prisma as unknown as PrismaService,
    objectVisibility as unknown as ObjectVisibilityService,
    tasks as unknown as TaskService,
    visibility,
    calendar as unknown as WorkingCalendarService,
  );
  return { service, prisma, objectVisibility, tasks, authority, calendar };
}

const sqlOf = (prisma: ReturnType<typeof setup>['prisma']) =>
  prisma.$queryRaw.mock.calls.map((c) => statement(c)).filter((s) => s.text.includes('FROM "Task" t'));

describe('TaskRecordListService', () => {
  describe('on a record', () => {
    it('checks the record BEFORE reading any task, and a refusal reads nothing', async () => {
      const { service, prisma, objectVisibility } = setup({ refuse: new ForbiddenException('Required permission: committees:view') });
      await expect(service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: ['committees:view_all_tasks'] })).rejects.toThrow(
        'Required permission: committees:view',
      );
      expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', 'org-a', ['committees:view_all_tasks']);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('refuses a record type without a record, a record without a type, and a view on a record', async () => {
      const { service, prisma } = setup();
      const viewer = { id: 'u1', permissions: VIEW_ALL };
      await expect(service.list({ sourceType: 'COMMITTEE' }, 'org-a', viewer)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.list({ sourceId: 'cmt-1' }, 'org-a', viewer)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.list({ ...RECORD, view: 'all' }, 'org-a', viewer)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('with View all tasks on the type: scope all, and every statement carries the rule', async () => {
      const { service, prisma } = setup();
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(result.scope).toBe('all');
      expect(result.view).toBe('record');
      for (const s of sqlOf(prisma)) {
        expect(s.text).toContain('t."sourceType"::text = $');
        // The rule's relationship clause, and View all on committees — whose
        // record must be this organisation's (rc."organizationId").
        expect(s.text).toContain('t."createdById" = ANY(');
        expect(s.text).toContain('rc."organizationId" = t."organizationId"');
      }
    });

    it('without View all tasks: scope own, and the rule still decides each row (no View all clause)', async () => {
      const { service, prisma } = setup();
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: COMMITTEE_ONLY });
      expect(result.scope).toBe('own');
      for (const s of sqlOf(prisma)) {
        expect(s.text).toContain('t."createdById" = ANY(');
        expect(s.text).toContain('va."userId" = $');
        expect(s.text).not.toContain('rc."organizationId"');
      }
    });

    it('a head whose unit owns the record: scope all, through unit scope', async () => {
      const { service } = setup({ headOf: 'unit-q' });
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: COMMITTEE_ONLY });
      expect(result.scope).toBe('all');
    });

    it('the panel asks for five, carries no filter options, and says whether New task is open', async () => {
      const { service, prisma } = setup();
      const panel = await service.panel({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(panel.total).toBe(2);
      expect(sqlOf(prisma)[0]!.values).toContain(5);
      expect(panel.canCreate).toBe(false);
      const creator = await service.panel({ ...RECORD }, 'org-a', { id: 'u1', permissions: ['committees:view', 'committees:create_tasks'] });
      expect(creator.canCreate).toBe(true);
    });
  });

  describe('organisation-wide views', () => {
    it.each([
      ['all', COMMITTEE_ONLY, 'Required permission: committees:view_all_tasks'],
      ['all', ['committees:view_all_tasks'], 'Required permission: committees:view_all_tasks'], // rule 1: the record type first
      ['unassigned', COMMITTEE_ONLY, 'Required permission: committees:manage_tasks'],
      ['unit', COMMITTEE_ONLY, 'Required permission: unit headship or committees:view_unit_tasks'],
    ] as const)('%s without a way in — 403 naming the keys, and no task read', async (view, permissions, message) => {
      const { service, prisma } = setup();
      await expect(service.list({ view }, 'org-a', { id: 'u1', permissions: [...permissions] })).rejects.toThrow(message);
      expect(sqlOf(prisma)).toEqual([]);
    });

    it('All tasks (the default view) lists the types View all tasks is held on, and names each task\'s record', async () => {
      const { service, prisma } = setup({ ids: ['t1'] });
      const result = await service.list({}, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(result.view).toBe('all');
      const page = sqlOf(prisma)[0]!;
      expect(page.text).toContain('rc."organizationId" = t."organizationId"');
      expect(page.values).toContain('COMMITTEE');
      expect(result.items[0]!.record).toEqual({ type: 'COMMITTEE', id: 'cmt-1', nameEn: 'Quality', nameAr: null });
    });

    it('Unassigned lists the unowned tasks on the managed types, ANDed with the rule', async () => {
      const { service, prisma } = setup({ ids: [] });
      const result = await service.list({ view: 'unassigned' }, 'org-a', { id: 'u1', permissions: MANAGER });
      expect(result.view).toBe('unassigned');
      const page = sqlOf(prisma)[0]!;
      expect(page.text).toContain(`t.status::text = 'UNASSIGNED'`);
      expect(page.text).toContain('t."createdById" = ANY(');
    });

    it('Unit tasks for a head: the unit scope clause over the record\'s owning unit, and the unit facet', async () => {
      const { service, prisma } = setup({ headOf: 'unit-q', ids: [] });
      const result = await service.list({ view: 'unit' }, 'org-a', { id: 'u1', permissions: COMMITTEE_ONLY });
      expect(result.view).toBe('unit');
      const page = sqlOf(prisma)[0]!;
      expect(page.text).toContain('oc."orgUnitId"');
      expect(page.values).toEqual(expect.arrayContaining([['unit-q']]));
      expect(result.facets).toEqual(expect.objectContaining({ units: [] }));
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
      const { service, authority, tasks } = setup({ ids: ['t1', 't2', 't3'] });
      await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(authority.creatorsCoveredBy).toHaveBeenCalledTimes(1);
      // mayManage gets the covered set, so it reads nothing itself.
      for (const call of tasks.mayManage.mock.calls) expect((call[3] as { covered: Set<string> }).covered.has('u1')).toBe(true);
    });

    it('a Manage tasks holder on the type may decide a request on a row', async () => {
      const asked = task('t1', {
        assignees: [{ userId: 'a1', removedAt: null, pickedAt: null, user: { id: 'a1', name: 'A', position: null } }],
        requests: [{ id: 'r1', type: 'EXTENSION', requestedDueAt: new Date(), holdUntil: null, requestedById: 'a1', reason: 'x', createdAt: new Date(), requestedBy: { name: 'A' } }],
      });
      const { service } = setup({ ids: ['t1'], rows: [asked] });
      const result = await service.list({ ...RECORD }, 'org-a', { id: 'u1', permissions: MANAGER });
      expect(result.items[0]!.actions.reviewRequest).toBe(true);
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
      expect(sqlOf(prisma)[0]!.values).toEqual(expect.arrayContaining(['PENDING', 'OVERDUE']));
    });

    it('"This week" ends at the close of the seventh day in the TENANT\'s zone', async () => {
      const { service, prisma, calendar } = setup();
      await service.list({ ...RECORD, due: 'THIS_WEEK' }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      expect(calendar.getEffectiveTimeZone).toHaveBeenCalledWith('org-a');
      const weekEnd = sqlOf(prisma)[0]!.values.find((v) => v instanceof Date) as Date;
      // 23:59:59.999 in Riyadh is 20:59:59.999 UTC.
      expect(weekEnd.toISOString()).toMatch(/T20:59:59\.999Z$/);
    });

    it('the Record type and Unit filters bind their values', async () => {
      const { service, prisma } = setup();
      await service.list({ recordType: 'COMMITTEE', unit: 'unit-x' }, 'org-a', { id: 'u1', permissions: VIEW_ALL });
      const page = sqlOf(prisma)[0]!;
      expect(page.values).toEqual(expect.arrayContaining(['COMMITTEE', 'unit-x']));
    });

    it('refuses a pool it cannot read', async () => {
      const { service, prisma } = setup();
      await expect(service.list({ ...RECORD, pool: 'ROLE:x:y' }, 'org-a', { id: 'u1', permissions: VIEW_ALL })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(sqlOf(prisma)).toEqual([]);
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    // Another organisation asks: the record is checked in THEIR organisation,
    // every statement is bound to it, and every Prisma read is scoped by it.
    const { service, prisma, objectVisibility } = setup();
    await service.list({ ...RECORD, around: 't1' }, 'org-b', { id: 'u1', permissions: VIEW_ALL });
    expect(objectVisibility.assertCanView).toHaveBeenCalledWith('COMMITTEE', 'cmt-1', 'org-b', VIEW_ALL);
    const statements = sqlOf(prisma);
    expect(statements.length).toBeGreaterThanOrEqual(4);
    for (const s of statements) {
      expect(s.text).toContain('t."organizationId" = $1');
      expect(s.values[0]).toBe('org-b');
    }
    expect(prisma.task.findMany.mock.calls[0]![0].where.organizationId).toBe('org-b');
    for (const call of prisma.user.findFirst.mock.calls as unknown as [{ where: { organizationId: string } }][]) {
      expect(call[0].where.organizationId).toBe('org-b');
    }
  });
});
