import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { recordTypesVisibleTo } from '../../common/services/object-visibility.service';
import { findUnitHeadedBy, findUnitSubtreeIds, findUnitsCoveredBy } from '../organization/unit-headship';
import type { TaskAuthorityService } from './task-authority.service';
import { PoolTarget, poolTargetsOfUser } from './task-pool';
import { holdsTaskKey, TASK_RECORD_TYPES, typesHolding } from './task-record-types';

/**
 * ACC-244 — WHO SEES WHICH TASKS: ONE RULE, as one SQL condition over a task
 * row `t`. Every list, panel, count, the task page and every path to a task's
 * files answer from it; admit() asks it for a single row. There is no second
 * copy in JavaScript, so a list and the page cannot disagree.
 *
 *   RELATIONSHIPS — always count, with NO permission and NO record check
 *   (Ahmad, 20 Oct, Q1: "keep today's way"):
 *     the creator, or someone acting for them now (canActForCreator's rule, as
 *     the covered-creator set); anyone ever on the task; a member of its pool
 *     while it waits.
 *   PERMISSIONS — each needs the RECORD visible first (rule 1); the types
 *   below are already filtered to visible record types:
 *     View all tasks on the type;
 *     Manage tasks on the type, for a task with an open request, a departed
 *       creator, or no actionable owner (Unassigned);
 *     unit scope: a record of a type with an owning unit, owned by a unit in
 *       the viewer's scope, sub-units included — the unit they head or cover
 *       now (any type with an owning unit), or their primary unit where they
 *       hold View unit tasks on the type.
 *
 * Filtering happens in the WHERE clause, before ORDER BY / LIMIT, so pages,
 * counts and facets agree. organizationId is the caller's own first condition;
 * every subquery here is also scoped through t."organizationId".
 */
export interface TaskVisibilityViewer {
  id: string;
  permissions: readonly string[];
}

export type UnitScopeVia = 'HEAD' | 'ACTING' | 'PERMISSION';

export interface TaskVisibilityContext {
  organizationId: string;
  viewerId: string;
  now: Date;
  /** The viewer and every creator they act for now. */
  coveredCreatorIds: string[];
  pools: PoolTarget[];
  /** Record types whose records the viewer may see. */
  recordTypes: string[];
  viewAllTypes: string[];
  manageTypes: string[];
  createTypes: string[];
  /** Per type, the units (sub-units included) whose records' tasks the viewer sees. */
  unitScope: { type: string; unitIds: string[] }[];
  /** The roots of that scope, for the views API. */
  unitRoots: { orgUnitId: string; via: UnitScopeVia; types: string[] }[];
}

type VisibilityClient = Pick<PrismaService, 'user' | 'committeeMember' | 'task' | 'orgUnitHeadAssignment' | '$queryRaw'>;

/** Everything the rule needs about the viewer, read once per request. */
export async function buildTaskVisibilityContext(
  client: VisibilityClient,
  authority: Pick<TaskAuthorityService, 'creatorsCoveredBy'>,
  viewer: TaskVisibilityViewer,
  organizationId: string,
  now: Date = new Date(),
): Promise<TaskVisibilityContext> {
  const recordTypes = recordTypesVisibleTo(viewer.permissions);
  const unitTypes = Object.entries(TASK_RECORD_TYPES)
    .filter(([type, entry]) => !!entry.ownerUnitSql && recordTypes.includes(type))
    .map(([type]) => type);
  const permissionUnitTypes = unitTypes.filter((type) => holdsTaskKey(viewer.permissions, type, 'VIEW_UNIT'));

  const [covered, pools, headed, coveredUnits, primary] = await Promise.all([
    authority.creatorsCoveredBy(viewer.id, organizationId, now),
    poolTargetsOfUser(client, viewer.id, organizationId),
    unitTypes.length ? findUnitHeadedBy(client, organizationId, viewer.id) : Promise.resolve(null),
    unitTypes.length ? findUnitsCoveredBy(client, organizationId, viewer.id, now) : Promise.resolve([] as string[]),
    permissionUnitTypes.length
      ? client.user.findFirst({ where: { id: viewer.id, organizationId, status: 'ACTIVE' }, select: { primaryOrgUnitId: true } })
      : Promise.resolve(null),
  ]);

  const unitRoots: TaskVisibilityContext['unitRoots'] = [];
  if (headed) unitRoots.push({ orgUnitId: headed, via: 'HEAD', types: unitTypes });
  for (const id of coveredUnits) unitRoots.push({ orgUnitId: id, via: 'ACTING', types: unitTypes });
  if (primary?.primaryOrgUnitId) unitRoots.push({ orgUnitId: primary.primaryOrgUnitId, via: 'PERMISSION', types: permissionUnitTypes });

  // One walk per distinct set of roots: the headship roots reach every unit
  // type, a View unit tasks root only the types it is held on.
  const headshipRoots = unitRoots.filter((r) => r.via !== 'PERMISSION').map((r) => r.orgUnitId);
  const permissionRoots = unitRoots.filter((r) => r.via === 'PERMISSION').map((r) => r.orgUnitId);
  const [headshipUnits, permissionUnits] = await Promise.all([
    findUnitSubtreeIds(client, organizationId, headshipRoots),
    findUnitSubtreeIds(client, organizationId, permissionRoots),
  ]);
  const unitScope = unitTypes
    .map((type) => ({
      type,
      unitIds: [...new Set([...headshipUnits, ...(permissionUnitTypes.includes(type) ? permissionUnits : [])])].sort(),
    }))
    .filter((s) => s.unitIds.length > 0);

  return {
    organizationId,
    viewerId: viewer.id,
    now,
    coveredCreatorIds: [...new Set([viewer.id, ...covered])],
    pools,
    recordTypes,
    viewAllTypes: typesHolding(viewer.permissions, 'VIEW_ALL'),
    manageTypes: typesHolding(viewer.permissions, 'MANAGE'),
    createTypes: typesHolding(viewer.permissions, 'CREATE'),
    unitScope,
    unitRoots: unitRoots.filter((r) => r.types.length > 0),
  };
}

const sqlArray = (values: readonly string[]) => Prisma.sql`${[...values]}::text[]`;

/**
 * "The task is on a record of one of these types, and that record is this
 * organisation's" — the shape every permission-based clause takes (rule 1).
 */
function onRecordsOf(types: readonly string[]): Prisma.Sql {
  const parts = types
    .filter((type) => !!TASK_RECORD_TYPES[type])
    .map((type) => Prisma.sql`(t."sourceType"::text = ${type} AND ${TASK_RECORD_TYPES[type]!.recordInOrgSql})`);
  return parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`;
}

/** Has a pool and nobody active on it, in a status a pick can take. */
export const WAITING_IN_POOL_SQL = Prisma.sql`(t.status::text IN ('PENDING','OVERDUE','UNASSIGNED')
  AND (t."assignedPositionId" IS NOT NULL OR t."assignedCommitteeId" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "TaskAssignee" wa WHERE wa."taskId" = t.id AND wa."removedAt" IS NULL))`;

/**
 * No actionable owner: UNASSIGNED, or waiting (PENDING / OVERDUE) in a pool
 * nobody is in right now — findEmptyPoolTasks()' rule, in SQL. The Unassigned
 * view, and what Manage tasks reaches besides requests and departed creators.
 */
export const UNOWNED_SQL = Prisma.sql`(t.status::text = 'UNASSIGNED'
  OR (t.status::text IN ('PENDING','OVERDUE')
      AND (t."assignedPositionId" IS NOT NULL OR t."assignedCommitteeId" IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM "TaskAssignee" ua WHERE ua."taskId" = t.id AND ua."removedAt" IS NULL)
      AND CASE WHEN t."assignedPositionId" IS NOT NULL
        THEN NOT EXISTS (SELECT 1 FROM "User" pu WHERE pu."organizationId" = t."organizationId" AND pu.status::text = 'ACTIVE'
                          AND pu."positionId" = t."assignedPositionId" AND pu."primaryOrgUnitId" = t."assignedOrgUnitId")
        ELSE NOT EXISTS (SELECT 1 FROM "CommitteeMember" cm JOIN "User" cu ON cu.id = cm."userId"
                          WHERE cm."organizationId" = t."organizationId" AND cm."isActive" AND cu.status::text = 'ACTIVE'
                            AND cm."committeeId" = t."assignedCommitteeId" AND cm."roleValueId" = t."assignedCommitteeRoleValueId")
      END))`;

const OPEN_REQUEST_SQL = Prisma.sql`EXISTS (SELECT 1 FROM "TaskRequest" vr WHERE vr."taskId" = t.id AND vr.status::text = 'PENDING')`;
const CREATOR_GONE_SQL = Prisma.sql`EXISTS (SELECT 1 FROM "User" vc WHERE vc.id = t."createdById" AND vc."organizationId" = t."organizationId" AND vc.status::text <> 'ACTIVE')`;

function poolMatchSql(pools: readonly PoolTarget[]): Prisma.Sql | null {
  if (pools.length === 0) return null;
  const parts = pools.map((p) =>
    p.kind === 'POSITION'
      ? Prisma.sql`(t."assignedOrgUnitId" = ${p.orgUnitId} AND t."assignedPositionId" = ${p.positionId})`
      : Prisma.sql`(t."assignedCommitteeId" = ${p.committeeId} AND t."assignedCommitteeRoleValueId" = ${p.roleValueId})`,
  );
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

/** The unit-scope clause alone: the unit view's own condition. FALSE without scope. */
export function unitScopeSql(ctx: TaskVisibilityContext): Prisma.Sql {
  const parts = ctx.unitScope.map(
    (s) => Prisma.sql`(t."sourceType"::text = ${s.type} AND ${TASK_RECORD_TYPES[s.type]!.ownerUnitSql!} = ANY(${sqlArray(s.unitIds)}))`,
  );
  return parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`;
}

/** THE RULE: may the viewer see task `t`? */
export function taskVisibleSql(ctx: TaskVisibilityContext): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`t."createdById" = ANY(${sqlArray(ctx.coveredCreatorIds)})`,
    Prisma.sql`EXISTS (SELECT 1 FROM "TaskAssignee" va WHERE va."taskId" = t.id AND va."userId" = ${ctx.viewerId})`,
  ];
  const pool = poolMatchSql(ctx.pools);
  if (pool) parts.push(Prisma.sql`(${WAITING_IN_POOL_SQL} AND ${pool})`);
  if (ctx.viewAllTypes.length) parts.push(onRecordsOf(ctx.viewAllTypes));
  if (ctx.manageTypes.length) {
    parts.push(Prisma.sql`(${onRecordsOf(ctx.manageTypes)} AND (${OPEN_REQUEST_SQL} OR ${CREATOR_GONE_SQL} OR ${UNOWNED_SQL}))`);
  }
  if (ctx.unitScope.length) parts.push(unitScopeSql(ctx));
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

/** The Unassigned view's own condition: unowned, on a type the viewer manages. FALSE without Manage. */
export function unassignedSql(ctx: TaskVisibilityContext): Prisma.Sql {
  return ctx.manageTypes.length ? Prisma.sql`(${onRecordsOf(ctx.manageTypes)} AND ${UNOWNED_SQL})` : Prisma.sql`FALSE`;
}

/** The All tasks view's own condition: the types the viewer holds View all tasks on. */
export function viewAllSql(ctx: TaskVisibilityContext): Prisma.Sql {
  return ctx.viewAllTypes.length ? onRecordsOf(ctx.viewAllTypes) : Prisma.sql`FALSE`;
}

/** Does unit scope reach this record? For a record's panel and the picker counts. */
export async function unitScopeCoversRecord(
  client: Pick<PrismaService, '$queryRaw'>,
  ctx: TaskVisibilityContext,
  sourceType: string,
  sourceId: string,
): Promise<boolean> {
  const scope = ctx.unitScope.find((s) => s.type === sourceType);
  const ownerUnitSql = TASK_RECORD_TYPES[sourceType]?.ownerUnitSql;
  if (!scope || !ownerUnitSql) return false;
  const rows = await client.$queryRaw<{ hit: boolean }[]>`
    SELECT (${ownerUnitSql} = ANY(${sqlArray(scope.unitIds)})) AS hit
      FROM (SELECT ${sourceId}::text AS "sourceId", ${ctx.organizationId}::text AS "organizationId") t`;
  return !!rows[0]?.hit;
}

/** May the viewer see EVERY task on this record? View all on its type, or unit scope over it. */
export async function seesWholeRecord(
  client: Pick<PrismaService, '$queryRaw'>,
  ctx: TaskVisibilityContext,
  sourceType: string,
  sourceId: string,
): Promise<boolean> {
  if (!ctx.recordTypes.includes(sourceType)) return false;
  if (ctx.viewAllTypes.includes(sourceType)) return true;
  return unitScopeCoversRecord(client, ctx, sourceType, sourceId);
}
