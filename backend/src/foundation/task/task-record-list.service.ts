import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { Prisma } from '../../../generated/prisma/client';
import { TaskService, TaskViewer } from './task.service';
import { POOL_LABEL_INCLUDE, PICKABLE_STATUSES, poolTargetOf, toPoolView } from './task-pool';
import { holdsTaskKey, taskKeysOf, TASK_RECORD_TYPES } from './task-record-types';
import { TaskVisibilityService } from './task-visibility.service';
import { taskVisibleSql, TaskVisibilityContext, unassignedSql, unitScopeSql, viewAllSql } from './task-visibility';
import { OPEN_REQUEST_INCLUDE, toOpenRequest } from './task-request-lifecycle';
import { taskActionsFor } from './task-actions';
import { RecordListQueryDto, RecordListSort, RecordPanelQueryDto } from './dto/record-list-query.dto';
import { ITaskRecordList, ITaskRecordListFacets, ITaskRecordPanel, ITaskRecordRow, ITaskViews } from './interfaces/task-record-row.interface';

const PAGE = 50;

// "Open" first, then On hold (it cannot be overdue, but is not finished), then
// the closed ones (Record Tasks Panel §1, Q5). The same rank the panel's five
// and the list's "open first" use.
const RANK = Prisma.raw(
  `(CASE WHEN t.status::text IN ('COMPLETED','CANCELLED') THEN 2 WHEN t.status::text = 'ON_HOLD' THEN 1 ELSE 0 END)`,
);

interface Scope {
  sql: Prisma.Sql;
  kind: 'all' | 'own';
  view: 'record' | 'all' | 'unit' | 'unassigned';
  /** Organisation-wide: rows say which record they belong to. */
  orgWide: boolean;
  ctx: TaskVisibilityContext;
}

/**
 * ACC-229 — A RECORD'S TASKS, and the organisation's: the panel's five, and
 * the All tasks list behind "See all" and at /tasks/all.
 *
 * WHO SEES WHAT is THE task visibility rule (ACC-244, task-visibility.ts),
 * the same condition the task page asks for one row:
 *   - On a record: the record must be visible (ObjectVisibilityService, ACC-101
 *     clause a — a 403 naming the permission, or 404, before any task is read),
 *     then the tasks on it the rule admits. `scope` says 'all' when the viewer
 *     sees every task on it (View all tasks on its type, or unit scope over it).
 *   - Organisation-wide, a saved view (`view`): All tasks (View all tasks, the
 *     types held), Unit tasks (unit scope), Unassigned (Manage tasks, no
 *     actionable owner). Each is also ANDed with the rule itself, so a view can
 *     never show what the page would refuse. A view the viewer has no way into
 *     is 403 naming the keys.
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
    private readonly visibility: TaskVisibilityService,
    private readonly calendar: WorkingCalendarService,
  ) {}

  async panel(dto: RecordPanelQueryDto, organizationId: string, viewer: TaskViewer): Promise<ITaskRecordPanel> {
    const list = await this.run({ sourceType: dto.sourceType, sourceId: dto.sourceId, take: 5 }, organizationId, viewer, false);
    // ACC-244 — New task on the record's own panel: Create tasks on its type
    // (the record is visible: run() refused it otherwise).
    return {
      total: list.total,
      scope: list.scope,
      rows: list.items,
      canCreate: holdsTaskKey(viewer.permissions, dto.sourceType, 'CREATE'),
    };
  }

  list(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer): Promise<ITaskRecordList> {
    return this.run(dto, organizationId, viewer, true);
  }

  /**
   * ACC-244 — which saved views this viewer gets: the same context the lists
   * filter with, so a view offered here is never one its list refuses.
   * Self-scoped: it describes the caller and reads no task.
   */
  async views(organizationId: string, viewer: TaskViewer): Promise<ITaskViews> {
    const ctx = await this.visibility.contextFor(viewer, organizationId);
    const rootIds = [...new Set(ctx.unitRoots.map((r) => r.orgUnitId))];
    const names = rootIds.length
      ? await this.prisma.orgUnit.findMany({
          where: { id: { in: rootIds }, organizationId },
          select: { id: true, nameEn: true, nameAr: true },
        })
      : [];
    const byId = new Map(names.map((n) => [n.id, n]));
    const unitTypes = [...new Set(ctx.unitScope.map((s) => s.type))];
    const units = ctx.unitRoots
      .filter((r) => byId.has(r.orgUnitId))
      .map((r) => ({ ...byId.get(r.orgUnitId)!, via: r.via }))
      .sort((a, b) => a.nameEn.localeCompare(b.nameEn));
    return {
      mine: true,
      all: ctx.viewAllTypes.length ? { types: ctx.viewAllTypes } : null,
      unassigned: ctx.manageTypes.length ? { types: ctx.manageTypes } : null,
      unit: unitTypes.length && units.length ? { types: unitTypes, units } : null,
      create: { types: ctx.createTypes },
    };
  }

  private async run(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer, withFacets: boolean): Promise<ITaskRecordList> {
    const scope = await this.scope(dto, organizationId, viewer);
    const filters = await this.filters(dto, organizationId, viewer);
    const where = Prisma.sql`t."organizationId" = ${organizationId} ${scope.sql} ${filters}`;
    const order = orderBy(dto.sort ?? 'due', dto.dir ?? defaultDir(dto.sort ?? 'due'));
    const take = dto.take ?? PAGE;
    const skip = dto.skip ?? 0;

    const scoped = Prisma.sql`t."organizationId" = ${organizationId} ${scope.sql}`;
    const [idRows, matchingRows, totalRows, aroundRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`SELECT t.id FROM "Task" t WHERE ${where} ORDER BY ${order} LIMIT ${take} OFFSET ${skip}`,
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Task" t WHERE ${where}`,
      // Every task the viewer can see here before the toolbar's filters — the
      // same scope as the rows, in SQL like them (ACC-244).
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Task" t WHERE ${scoped}`,
      dto.around
        ? this.prisma.$queryRaw<{ rn: bigint }[]>`SELECT s.rn FROM (SELECT t.id, ROW_NUMBER() OVER (ORDER BY ${order}) - 1 AS rn FROM "Task" t WHERE ${where}) s WHERE s.id = ${dto.around}`
        : Promise.resolve([]),
    ]);

    const items = await this.rows(idRows.map((r) => r.id), organizationId, viewer, scope);
    return {
      items,
      total: Number(totalRows[0]?.n ?? 0),
      matching: Number(matchingRows[0]?.n ?? 0),
      scope: scope.kind,
      view: scope.view,
      facets: withFacets && skip === 0 ? await this.facets(scoped, scope) : null,
      aroundIndex: aroundRows.length ? Number(aroundRows[0]!.rn) : null,
    };
  }

  // ── Who sees which tasks ──────────────────────────────────────────────

  private async scope(dto: RecordListQueryDto, organizationId: string, viewer: TaskViewer): Promise<Scope> {
    if (!!dto.sourceType !== !!dto.sourceId) {
      throw new BadRequestException('Name both the record type and the record, or neither');
    }
    if (dto.sourceType && dto.sourceId) {
      if (dto.view) throw new BadRequestException('A view is for the organisation-wide list, not one record');
      // ACC-101 clause a: the request names the parent, so it is checked first.
      await this.objectVisibility.assertCanView(dto.sourceType, dto.sourceId, organizationId, viewer.permissions);
      const ctx = await this.visibility.contextFor(viewer, organizationId);
      const seesAll = await this.visibility.seesWholeRecord(ctx, dto.sourceType, dto.sourceId);
      return {
        sql: Prisma.sql`AND t."sourceType"::text = ${dto.sourceType} AND t."sourceId" = ${dto.sourceId} AND ${taskVisibleSql(ctx)}`,
        kind: seesAll ? 'all' : 'own',
        view: 'record',
        orgWide: false,
        ctx,
      };
    }
    const ctx = await this.visibility.contextFor(viewer, organizationId);
    const view = dto.view ?? 'all';
    const viewSql =
      view === 'all'
        ? ctx.viewAllTypes.length ? viewAllSql(ctx) : null
        : view === 'unit'
          ? ctx.unitScope.length ? unitScopeSql(ctx) : null
          : ctx.manageTypes.length ? unassignedSql(ctx) : null;
    if (!viewSql) {
      // Decided from the viewer alone, before any task is read.
      const keys =
        view === 'all' ? taskKeysOf('VIEW_ALL') : view === 'unassigned' ? taskKeysOf('MANAGE') : ['unit headship', ...taskKeysOf('VIEW_UNIT')];
      throw new ForbiddenException(`Required permission: ${keys.join(' or ')}`);
    }
    return {
      // The view's own condition AND the rule: a view never lists a task the
      // task page would refuse.
      sql: Prisma.sql`AND ${viewSql} AND ${taskVisibleSql(ctx)}`,
      kind: 'all',
      view,
      orgWide: true,
      ctx,
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
    if (dto.recordType) parts.push(Prisma.sql`t."sourceType"::text = ${dto.recordType}`);
    if (dto.unit) {
      // The record's owning unit, for the types that have one. A unit outside
      // the viewer's scope matches nothing: the view's own condition still holds.
      const owned = Object.entries(TASK_RECORD_TYPES)
        .filter(([, e]) => !!e.ownerUnitSql)
        .map(([type, e]) => Prisma.sql`(t."sourceType"::text = ${type} AND ${e.ownerUnitSql!} = ${dto.unit})`);
      parts.push(owned.length ? Prisma.sql`(${Prisma.join(owned, ' OR ')})` : Prisma.sql`FALSE`);
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

  private async rows(ids: string[], organizationId: string, viewer: TaskViewer, scope: Scope): Promise<ITaskRecordRow[]> {
    const orgWide = scope.orgWide;
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

    // Read once per page, never per row: the visibility context already holds
    // who the viewer acts for and which pools they are in.
    const covered = new Set(scope.ctx.coveredCreatorIds);
    const pools = scope.ctx.pools;
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
          p.kind === 'POSITION' && target.kind === 'POSITION'
            ? p.orgUnitId === target.orgUnitId && p.positionId === target.positionId
            : p.kind === 'COMMITTEE_ROLE' &&
              target.kind === 'COMMITTEE_ROLE' &&
              p.committeeId === target.committeeId &&
              p.roleValueId === target.roleValueId,
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
          mayDecide: holdsTaskKey(viewer.permissions, task.sourceType, 'MANAGE') || covered.has(task.createdById),
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

  /**
   * The filters' options, over the whole scope — not the current filters. In
   * SQL like the rows (ACC-244): the people on tasks in scope, the pools, the
   * record types present and, for the unit view, the owning units present.
   */
  private async facets(scoped: Prisma.Sql, scope: Scope): Promise<ITaskRecordListFacets> {
    const ownerUnit = Object.entries(TASK_RECORD_TYPES)
      .filter(([, e]) => !!e.ownerUnitSql)
      .map(([type, e]) => Prisma.sql`WHEN t."sourceType"::text = ${type} THEN ${e.ownerUnitSql!}`);
    const [people, poolReps, types, units] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT DISTINCT u.id, u.name FROM "Task" t
          JOIN "TaskAssignee" a ON a."taskId" = t.id AND a."removedAt" IS NULL
          JOIN "User" u ON u.id = a."userId" AND u."organizationId" = t."organizationId"
         WHERE ${scoped} LIMIT 200`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT ON (t."assignedOrgUnitId", t."assignedPositionId", t."assignedCommitteeId", t."assignedCommitteeRoleValueId") t.id
          FROM "Task" t
         WHERE ${scoped} AND (t."assignedPositionId" IS NOT NULL OR t."assignedCommitteeId" IS NOT NULL)
         LIMIT 100`,
      this.prisma.$queryRaw<{ type: string }[]>`SELECT DISTINCT t."sourceType"::text AS type FROM "Task" t WHERE ${scoped}`,
      scope.view === 'unit' && ownerUnit.length
        ? this.prisma.$queryRaw<{ id: string; nameEn: string; nameAr: string | null }[]>`
            SELECT ou.id, ou."nameEn", ou."nameAr" FROM "OrgUnit" ou
             WHERE ou."organizationId" = ${scope.ctx.organizationId}
               AND ou.id IN (SELECT CASE ${Prisma.join(ownerUnit, ' ')} END FROM "Task" t WHERE ${scoped})
             ORDER BY ou."nameEn"`
        : Promise.resolve([] as { id: string; nameEn: string; nameAr: string | null }[]),
    ]);
    const pooled = poolReps.length
      ? await this.prisma.task.findMany({
          where: { id: { in: poolReps.map((r) => r.id) }, organizationId: scope.ctx.organizationId },
          select: {
            assignedOrgUnitId: true,
            assignedPositionId: true,
            assignedCommitteeId: true,
            assignedCommitteeRoleValueId: true,
            ...POOL_LABEL_INCLUDE,
          },
        })
      : [];
    const pools: ITaskRecordListFacets['pools'] = [];
    for (const row of pooled) {
      const target = poolTargetOf(row);
      const view = toPoolView(row);
      if (!target || !view) continue;
      pools.push({ key: poolKey(target), pool: view });
    }
    return {
      people: [...people].sort((a, b) => a.name.localeCompare(b.name)),
      pools,
      recordTypes: types.map((t) => t.type).sort(),
      units,
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
