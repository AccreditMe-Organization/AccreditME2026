import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { Prisma, TaskSourceType } from '../../../generated/prisma/client';
import { TaskService, TaskViewer } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { POOL_LABEL_INCLUDE, PICKABLE_STATUSES, poolTargetOf, poolsOfUser, toPoolView } from './task-pool';
import { OPEN_REQUEST_INCLUDE, toOpenRequest } from './task-request-lifecycle';
import { taskActionsFor } from './task-actions';
import { RecordListQueryDto, RecordListSort, RecordPanelQueryDto } from './dto/record-list-query.dto';
import { ITaskRecordList, ITaskRecordListFacets, ITaskRecordPanel, ITaskRecordRow } from './interfaces/task-record-row.interface';

const PAGE = 50;

// "Open" first, then On hold (it cannot be overdue, but is not finished), then
// the closed ones (Record Tasks Panel §1, Q5). The same rank the panel's five
// and the list's "open first" use.
const RANK = Prisma.raw(
  `(CASE WHEN t.status::text IN ('COMPLETED','CANCELLED') THEN 2 WHEN t.status::text = 'ON_HOLD' THEN 1 ELSE 0 END)`,
);

interface Scope {
  sql: Prisma.Sql;
  where: Prisma.TaskWhereInput;
  kind: 'all' | 'own';
  /** Organisation-wide (All tasks): rows say which record they belong to. */
  orgWide: boolean;
}

/**
 * ACC-229 — A RECORD'S TASKS, and the organisation's: the panel's five, and
 * the All tasks list behind "See all" and at /tasks/all.
 *
 * WHO SEES WHAT is today's rule, unchanged (plan §2.3):
 *   - On a record: the record must be visible (ObjectVisibilityService, ACC-101
 *     clause a — a 403 naming the permission, or 404, before any task is read).
 *     With tasks:view, every task on it; without (Q1), only the tasks the
 *     viewer is or was on — what My tasks already shows them.
 *   - Organisation-wide: tasks:view, and only the record types the viewer may
 *     see (viewableTypes, fail closed) — GET /tasks/:id's rule, as a list.
 *
 * ORDER AND FILTERS ARE SQL, every value a bound parameter and organizationId
 * in every WHERE, so the panel's five are the five most likely to need someone
 * and "Load more" pages through one stable order. Rows are then read with
 * Prisma in batches — never a query per row — and each row's actions come from
 * taskActionsFor(), the task page's own rules.
 */
@Injectable()
export class TaskRecordListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly objectVisibility: ObjectVisibilityService,
    private readonly tasks: TaskService,
    private readonly authority: TaskAuthorityService,
    private readonly calendar: WorkingCalendarService,
  ) {}

  async panel(dto: RecordPanelQueryDto, organizationId: string, viewer: TaskViewer): Promise<ITaskRecordPanel> {
    const list = await this.run({ sourceType: dto.sourceType, sourceId: dto.sourceId, take: 5 }, organizationId, viewer, false);
    return { total: list.total, scope: list.scope, rows: list.items };
  }

  list(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer): Promise<ITaskRecordList> {
    return this.run(dto, organizationId, viewer, true);
  }

  private async run(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer, withFacets: boolean): Promise<ITaskRecordList> {
    const scope = await this.scope(dto, organizationId, viewer);
    const filters = await this.filters(dto, organizationId, viewer);
    const where = Prisma.sql`t."organizationId" = ${organizationId} ${scope.sql} ${filters}`;
    const order = orderBy(dto.sort ?? 'due', dto.dir ?? defaultDir(dto.sort ?? 'due'));
    const take = dto.take ?? PAGE;
    const skip = dto.skip ?? 0;

    const [idRows, matchingRows, total, aroundRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT t.id FROM "Task" t WHERE ${where} ORDER BY ${order} LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Task" t WHERE ${where}`,
      this.prisma.task.count({ where: scope.where }),
      dto.around
        ? this.prisma.$queryRaw<{ rn: bigint }[]>`SELECT s.rn FROM (SELECT t.id, ROW_NUMBER() OVER (ORDER BY ${order}) - 1 AS rn FROM "Task" t WHERE ${where}) s WHERE s.id = ${dto.around}`
        : Promise.resolve([]),
    ]);

    const items = await this.rows(idRows.map((r) => r.id), organizationId, viewer, scope.orgWide);
    return {
      items,
      total,
      matching: Number(matchingRows[0]?.n ?? 0),
      scope: scope.kind,
      facets: withFacets && skip === 0 ? await this.facets(scope.where) : null,
      aroundIndex: aroundRows.length ? Number(aroundRows[0]!.rn) : null,
    };
  }

  // ── Who sees which tasks ──────────────────────────────────────────────

  private async scope(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer): Promise<Scope> {
    const seesAll = viewer.permissions.includes(TASKS_PERMISSIONS.VIEW);
    if (!!dto.sourceType !== !!dto.sourceId) {
      throw new BadRequestException('Name both the record type and the record, or neither');
    }
    if (dto.sourceType && dto.sourceId) {
      // ACC-101 clause a: the request names the parent, so it is checked first.
      await this.objectVisibility.assertCanView(dto.sourceType, dto.sourceId, organizationId, viewer.permissions);
      const record = Prisma.sql`AND t."sourceType"::text = ${dto.sourceType} AND t."sourceId" = ${dto.sourceId}`;
      const recordWhere: Prisma.TaskWhereInput = { organizationId, sourceType: dto.sourceType, sourceId: dto.sourceId };
      if (seesAll) return { sql: record, where: recordWhere, kind: 'all', orgWide: false };
      return {
        sql: Prisma.sql`${record} AND EXISTS (SELECT 1 FROM "TaskAssignee" o WHERE o."taskId" = t.id AND o."userId" = ${viewer.id})`,
        where: { ...recordWhere, assignees: { some: { userId: viewer.id } } },
        kind: 'own',
        orgWide: false,
      };
    }
    if (!seesAll) throw new ForbiddenException(`Required permission: ${TASKS_PERMISSIONS.VIEW}`);
    const types = this.objectVisibility.viewableTypes(viewer.permissions);
    if (types.length === 0) {
      return { sql: Prisma.sql`AND FALSE`, where: { organizationId, id: { in: [] } }, kind: 'all', orgWide: true };
    }
    return {
      sql: Prisma.sql`AND t."sourceType"::text IN (${Prisma.join(types)})`,
      where: { organizationId, sourceType: { in: types as TaskSourceType[] } },
      kind: 'all',
      orgWide: true,
    };
  }

  // ── The toolbar's filters ─────────────────────────────────────────────

  private async filters(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer): Promise<Prisma.Sql> {
    const parts: Prisma.Sql[] = [];
    if (dto.status?.length) {
      // A row stored as OVERDUE before ACC-163's backfill is an Assigned task.
      const statuses = dto.status.flatMap((s) => (s === 'PENDING' ? ['PENDING', 'OVERDUE'] : [s]));
      parts.push(Prisma.sql`t.status::text IN (${Prisma.join(statuses)})`);
    }
    if (dto.overdue) {
      // A flag, not a status (ACC-163): open, not on hold, its due time passed.
      parts.push(Prisma.sql`t."dueAt" < now() AND t.status::text NOT IN ('COMPLETED','CANCELLED','ON_HOLD')`);
    }
    if (dto.assignee) parts.push(activeAssignee(dto.assignee));
    if (dto.mine) parts.push(activeAssignee(viewer.id));
    if (dto.pool) parts.push(poolClause(dto.pool));
    if (dto.required) {
      parts.push(Prisma.sql`t."workflowInstanceStageId" IS NOT NULL AND t."isMandatory" = ${dto.required === 'REQUIRED'}`);
    }
    if (dto.due === 'NONE') parts.push(Prisma.sql`t."dueAt" IS NULL`);
    else if (dto.due) {
      // "This week": due by the end of the seventh day from today, in the
      // TENANT's zone (ACC-94 D3) — never the server's or the browser's.
      const zone = await this.calendar.getEffectiveTimeZone(organizationId);
      const weekEnd = DateTime.now().setZone(zone).plus({ days: 6 }).endOf('day').toJSDate();
      parts.push(
        dto.due === 'THIS_WEEK'
          ? Prisma.sql`t."dueAt" IS NOT NULL AND t."dueAt" <= ${weekEnd}`
          : Prisma.sql`t."dueAt" > ${weekEnd}`,
      );
    }
    const q = dto.q?.trim();
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      parts.push(Prisma.sql`(t.title ILIKE ${pattern} ESCAPE '\\' OR COALESCE(t."titleAr", '') ILIKE ${pattern} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM "TaskAssignee" sa JOIN "User" su ON su.id = sa."userId"
                   WHERE sa."taskId" = t.id AND sa."removedAt" IS NULL AND su.name ILIKE ${pattern} ESCAPE '\\'))`);
    }
    return parts.length ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
  }

  // ── The rows ──────────────────────────────────────────────────────────

  private async rows(ids: string[], organizationId: string, viewer: TaskViewer, orgWide: boolean): Promise<ITaskRecordRow[]> {
    if (ids.length === 0) return [];
    const found = await this.prisma.task.findMany({
      where: { id: { in: ids }, organizationId },
      include: {
        assignees: {
          include: { user: { select: { id: true, name: true, position: { select: { nameEn: true, nameAr: true } } } } },
        },
        _count: { select: { evidence: { where: { deletedAt: null } } } },
        ...POOL_LABEL_INCLUDE,
        ...OPEN_REQUEST_INCLUDE,
        createdBy: { select: { id: true, name: true, status: true } },
      },
    });
    const byId = new Map(found.map((t) => [t.id, t]));
    const ordered = ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);

    // Read once per page, never per row.
    const covered = new Set([viewer.id, ...(await this.authority.creatorsCoveredBy(viewer.id, organizationId))]);
    const reassigner = viewer.permissions.includes(TASKS_PERMISSIONS.REASSIGN);
    const pools = await poolsOfUser(this.prisma, viewer.id, organizationId);
    const stillInStep = await this.stillInStep(ordered, organizationId);
    const records = orgWide ? await this.recordNames(ordered, organizationId) : null;

    const result: ITaskRecordRow[] = [];
    for (const task of ordered) {
      const active = task.assignees.filter((a) => a.removedAt === null);
      const mine = active.find((a) => a.userId === viewer.id) ?? null;
      const target = poolTargetOf(task);
      const pool = toPoolView(task);
      const openRequest = toOpenRequest(task.requests);
      const mayManage = await this.tasks.mayManage(task, viewer, organizationId, { covered });
      const inPool =
        !!target &&
        pools.some((p) =>
          target.kind === 'POSITION'
            ? p.assignedOrgUnitId === target.orgUnitId && p.assignedPositionId === target.positionId
            : p.assignedCommitteeId === target.committeeId && p.assignedCommitteeRoleValueId === target.roleValueId,
        );
      result.push({
        id: task.id,
        title: task.title,
        titleAr: task.titleAr,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt,
        onHoldUntil: task.onHoldUntil,
        completedAt: task.completedAt,
        cancelledAt: task.cancelledAt,
        cancelledReason: task.cancelledReason,
        rejectedReason: task.rejectedReason,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        requiresEvidence: task.requiresEvidence,
        requirement: task.workflowInstanceStageId ? (task.isMandatory ? 'REQUIRED' : 'OPTIONAL') : null,
        sourceType: task.sourceType,
        sourceId: task.sourceId,
        record: records ? (records.get(`${task.sourceType}:${task.sourceId}`) ?? { type: task.sourceType, id: task.sourceId, nameEn: null, nameAr: null }) : null,
        assignees: active.map((a) => ({
          id: a.user.id,
          name: a.user.name,
          positionNameEn: a.user.position?.nameEn ?? null,
          positionNameAr: a.user.position?.nameAr ?? null,
        })),
        pool,
        waitingInPool: !!target && active.length === 0 && (PICKABLE_STATUSES as readonly string[]).includes(task.status),
        pickedByViewer: !!mine?.pickedAt,
        openRequest,
        evidenceCount: task._count.evidence,
        createdBy: { id: task.createdBy.id, name: task.createdBy.name },
        createdByWorkflow: !!(task.workflowInstanceStageId || task.workflowInstanceId || task.sourceStageId),
        actions: taskActionsFor({
          status: task.status,
          requiresEvidence: task.requiresEvidence,
          evidenceCount: task._count.evidence,
          viewerId: viewer.id,
          viewerIsActiveAssignee: !!mine,
          viewerPickedIt: !!mine?.pickedAt,
          anyActiveAssignee: active.length > 0,
          hasPoolTarget: !!target,
          viewerInPool: inPool,
          openRequest,
          mayManage,
          mayDecide: reassigner || covered.has(task.createdById),
          stageEntryTask: !!task.workflowInstanceStageId,
          isMandatory: task.isMandatory,
          legacyWorkflowTask: !task.workflowInstanceStageId && !!(task.sourceStageId || task.workflowInstanceId),
          stillInStep: stillInStep.has(task.id),
        }),
      });
    }
    return result;
  }

  /** reopen()'s own question, for every Completed task on the page, in two reads. */
  private async stillInStep(
    tasks: { id: string; status: string; workflowInstanceStageId: string | null; workflowInstanceId: string | null; sourceStageId: string | null }[],
    organizationId: string,
  ): Promise<Set<string>> {
    const done = tasks.filter((t) => t.status === 'COMPLETED');
    const result = new Set(done.filter((t) => !t.workflowInstanceStageId && !t.workflowInstanceId).map((t) => t.id));
    const entryIds = done.flatMap((t) => (t.workflowInstanceStageId ? [t.workflowInstanceStageId] : []));
    const instanceIds = done.flatMap((t) => (!t.workflowInstanceStageId && t.workflowInstanceId ? [t.workflowInstanceId] : []));
    const [entries, instances] = await Promise.all([
      entryIds.length
        ? this.prisma.workflowInstanceStage.findMany({
            where: { id: { in: entryIds }, exitedAt: null, workflowInstance: { organizationId, status: { in: ['PENDING', 'IN_PROGRESS'] } } },
            select: { id: true },
          })
        : Promise.resolve([]),
      instanceIds.length
        ? this.prisma.workflowInstance.findMany({
            where: { id: { in: instanceIds }, organizationId },
            select: { id: true, status: true, currentStageId: true },
          })
        : Promise.resolve([]),
    ]);
    const openEntries = new Set(entries.map((e) => e.id));
    const instanceById = new Map(instances.map((i) => [i.id, i]));
    for (const t of done) {
      if (t.workflowInstanceStageId && openEntries.has(t.workflowInstanceStageId)) result.add(t.id);
      if (!t.workflowInstanceStageId && t.workflowInstanceId) {
        const i = instanceById.get(t.workflowInstanceId);
        if (i && (i.status === 'PENDING' || i.status === 'IN_PROGRESS') && i.currentStageId === t.sourceStageId) result.add(t.id);
      }
    }
    return result;
  }

  /** The organisation-wide list names each task's record — types the viewer may see, by construction. */
  private async recordNames(
    tasks: { sourceType: string; sourceId: string }[],
    organizationId: string,
  ): Promise<Map<string, { type: string; id: string; nameEn: string | null; nameAr: string | null }>> {
    const ids = (type: string) => [...new Set(tasks.filter((t) => t.sourceType === type).map((t) => t.sourceId))];
    const [committees, meetings] = await Promise.all([
      ids('COMMITTEE').length
        ? this.prisma.committee.findMany({ where: { id: { in: ids('COMMITTEE') }, organizationId }, select: { id: true, nameEn: true, nameAr: true } })
        : Promise.resolve([]),
      ids('MEETING').length
        ? this.prisma.meeting.findMany({ where: { id: { in: ids('MEETING') }, organizationId }, select: { id: true, title: true } })
        : Promise.resolve([]),
    ]);
    const map = new Map<string, { type: string; id: string; nameEn: string | null; nameAr: string | null }>();
    for (const c of committees) map.set(`COMMITTEE:${c.id}`, { type: 'COMMITTEE', id: c.id, nameEn: c.nameEn, nameAr: c.nameAr });
    for (const m of meetings) map.set(`MEETING:${m.id}`, { type: 'MEETING', id: m.id, nameEn: m.title, nameAr: null });
    return map;
  }

  /** The assignee and pool filters' options, over the whole scope — not the current filters. */
  private async facets(where: Prisma.TaskWhereInput): Promise<ITaskRecordListFacets> {
    const [people, pooled] = await Promise.all([
      this.prisma.taskAssignee.findMany({
        where: { removedAt: null, task: where },
        distinct: ['userId'],
        select: { user: { select: { id: true, name: true } } },
        take: 200,
      }),
      this.prisma.task.findMany({
        where: { ...where, OR: [{ assignedPositionId: { not: null } }, { assignedCommitteeId: { not: null } }] },
        distinct: ['assignedOrgUnitId', 'assignedPositionId', 'assignedCommitteeId', 'assignedCommitteeRoleValueId'],
        select: {
          assignedOrgUnitId: true,
          assignedPositionId: true,
          assignedCommitteeId: true,
          assignedCommitteeRoleValueId: true,
          ...POOL_LABEL_INCLUDE,
        },
        take: 100,
      }),
    ]);
    const pools: ITaskRecordListFacets['pools'] = [];
    for (const row of pooled) {
      const target = poolTargetOf(row);
      const view = toPoolView(row);
      if (!target || !view) continue;
      pools.push({ key: poolKey(target), pool: view });
    }
    return {
      people: people.map((p) => p.user).sort((a, b) => a.name.localeCompare(b.name)),
      pools,
    };
  }
}

function activeAssignee(userId: string): Prisma.Sql {
  return Prisma.sql`EXISTS (SELECT 1 FROM "TaskAssignee" fa WHERE fa."taskId" = t.id AND fa."userId" = ${userId} AND fa."removedAt" IS NULL)`;
}

export function poolKey(target: NonNullable<ReturnType<typeof poolTargetOf>>): string {
  return target.kind === 'POSITION'
    ? `POSITION:${target.orgUnitId}:${target.positionId}`
    : `COMMITTEE_ROLE:${target.committeeId}:${target.roleValueId}`;
}

function poolClause(key: string): Prisma.Sql {
  const [kind, a, b] = key.split(':');
  if (!a || !b) throw new BadRequestException('Unknown pool');
  if (kind === 'POSITION') return Prisma.sql`t."assignedOrgUnitId" = ${a} AND t."assignedPositionId" = ${b}`;
  if (kind === 'COMMITTEE_ROLE') return Prisma.sql`t."assignedCommitteeId" = ${a} AND t."assignedCommitteeRoleValueId" = ${b}`;
  throw new BadRequestException('Unknown pool');
}

function defaultDir(sort: RecordListSort): 'asc' | 'desc' {
  return sort === 'created' || sort === 'updated' ? 'desc' : 'asc';
}

/**
 * Every ORDER BY ends in t.id, so the order is total and Load more never
 * repeats or skips a row. Only whitelisted words reach Prisma.raw.
 */
export function orderBy(sort: RecordListSort, dir: 'asc' | 'desc'): Prisma.Sql {
  const d = Prisma.raw(dir === 'desc' ? 'DESC' : 'ASC');
  switch (sort) {
    case 'created':
      return Prisma.sql`t."createdAt" ${d}, t.id`;
    case 'updated':
      return Prisma.sql`t."updatedAt" ${d}, t.id`;
    case 'title':
      return Prisma.sql`lower(t.title) ${d}, t.id`;
    case 'status':
      return Prisma.sql`${RANK} ${d}, t.status::text ${d}, t."dueAt" ASC NULLS LAST, t.id`;
    case 'due':
    default:
      // Open first, then On hold, by due date; then the closed, most recent first.
      return Prisma.sql`${RANK} ASC, (CASE WHEN ${RANK} < 2 THEN t."dueAt" END) ${d} NULLS LAST,
        COALESCE(t."completedAt", t."cancelledAt", t."updatedAt") DESC, t.id`;
  }
}
