import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-167 — THE POOL RULES, written once.
 *
 * A task can be assigned to a POOL instead of named people: a position in an
 * org unit, or a committee member role. Who is in the pool is resolved at READ
 * time from the task's target columns, never snapshotted, so someone who joins
 * the position later sees the task and someone who leaves stops seeing it.
 *
 * These are plain functions over a Prisma client rather than a service, because
 * four places need them and not all of them can import TaskModule:
 *   - TaskService (create, reassign, pick, release, the departure flow)
 *   - TaskAssignmentService (the picker endpoints)
 *   - SlaMonitorProcessor (the pick-up escalation sweep)
 *   - SetupConditionDetectors (a pool nobody is in), whose module imports
 *     only Prisma — pulling TaskModule in would drag the Tenant/Workflow
 *     forwardRef cycle with it.
 * One copy, so "who is in the pool" cannot drift between them — the shape
 * CLAUDE.md records three times (ACC-120's four last-admin checks).
 *
 * ## The holder rule (decision 3), and who it leaves out
 *
 * A position pool is the users with positionId = P AND primaryOrgUnitId = U
 * AND status ACTIVE — the same rule as a stage's POSITION_IN_UNIT who entry
 * (StagePoolService; SYSTEM-REFERENCE §2.19). It deliberately does NOT include an out-of-office holder's
 * acting user, a unit's acting head, or a user acting in the unit through
 * User.actingOrgUnitId. A committee pool is the active members holding the
 * role, whose user is ACTIVE.
 */

export type PoolTarget =
  | { kind: 'POSITION'; orgUnitId: string; positionId: string }
  | { kind: 'COMMITTEE_ROLE'; committeeId: string; roleValueId: string };

/**
 * Where a newly assigned task lands. `pooled` false with a target means the
 * task went to named people (chosen, or a single-holder position's holder) but
 * still remembers its pool — so a departure can return it there.
 */
export interface PoolPlacement {
  target: PoolTarget;
  pooled: boolean;
}

export interface PoolTargetColumns {
  assignedOrgUnitId: string | null;
  assignedPositionId: string | null;
  assignedCommitteeId: string | null;
  assignedCommitteeRoleValueId: string | null;
}

/**
 * The subset of a Prisma client these rules read. Picked off PrismaService —
 * an EXTENDED client, whose delegates are not Prisma.TransactionClient's —
 * and satisfied by its transaction client too. A type-only import, so this
 * file still pulls in no Nest module.
 */
export type PoolClient = Pick<PrismaService, 'user' | 'committeeMember' | 'task'>;

export const NO_POOL_TARGET: PoolTargetColumns = {
  assignedOrgUnitId: null,
  assignedPositionId: null,
  assignedCommitteeId: null,
  assignedCommitteeRoleValueId: null,
};

export function toPoolColumns(target: PoolTarget | null): PoolTargetColumns {
  if (!target) return NO_POOL_TARGET;
  return target.kind === 'POSITION'
    ? { ...NO_POOL_TARGET, assignedOrgUnitId: target.orgUnitId, assignedPositionId: target.positionId }
    : {
        ...NO_POOL_TARGET,
        assignedCommitteeId: target.committeeId,
        assignedCommitteeRoleValueId: target.roleValueId,
      };
}

export function poolTargetOf(task: PoolTargetColumns): PoolTarget | null {
  if (task.assignedOrgUnitId && task.assignedPositionId) {
    return { kind: 'POSITION', orgUnitId: task.assignedOrgUnitId, positionId: task.assignedPositionId };
  }
  if (task.assignedCommitteeId && task.assignedCommitteeRoleValueId) {
    return { kind: 'COMMITTEE_ROLE', committeeId: task.assignedCommitteeId, roleValueId: task.assignedCommitteeRoleValueId };
  }
  return null;
}

/**
 * Statuses in which a task can sit in its pool waiting to be picked up.
 * UNASSIGNED is included for one case: a single-holder position with no holder
 * creates an UNASSIGNED task that remembers its target, and a holder who
 * appears later can pick it up — which is the pool resolving at read time.
 */
export const PICKABLE_STATUSES = ['PENDING', 'OVERDUE', 'UNASSIGNED'] as const;

// ACC-86 — WHO IS ON A TASK: a current row (removedAt null) held by an ACTIVE
// user. A row left current by someone who has since become INACTIVE (a
// departure that stopped partway, or a co-assignee who left first) puts nobody
// on the task. This is the ONE definition, in Prisma and in SQL; every reader of
// "nobody is on it" (waiting in a pool, ownerless, the Setup health condition)
// and every writer's "is anyone else still on it?" uses it. Never a third copy.

/** A TaskAssignee row that puts someone on the task: current, and held by an ACTIVE user. */
export const CURRENT_ACTIVE_ASSIGNEE = {
  removedAt: null,
  user: { status: 'ACTIVE' },
} as const satisfies Prisma.TaskAssigneeWhereInput;

/**
 * Its complement among CURRENT rows: still current, but held by a user who is no longer
 * ACTIVE. Such a row puts nobody on the task; the writers end it when the task goes back
 * to its pool, to nobody, or to a new picker (ACC-86, Q-1).
 */
export const STALE_CURRENT_ASSIGNEE = {
  removedAt: null,
  user: { status: { not: 'ACTIVE' } },
} as const satisfies Prisma.TaskAssigneeWhereInput;

/** SQL: the task aliased `t` has someone on it (CURRENT_ACTIVE_ASSIGNEE). The user is joined by its primary key. */
export const HAS_CURRENT_ACTIVE_ASSIGNEE_SQL = Prisma.sql`EXISTS (SELECT 1 FROM "TaskAssignee" xa
  JOIN "User" xu ON xu.id = xa."userId" AND xu."organizationId" = t."organizationId"
  WHERE xa."taskId" = t.id AND xa."removedAt" IS NULL AND xu.status::text = 'ACTIVE')`;

const IS_POOL_TASK_SQL = Prisma.sql`(t."assignedPositionId" IS NOT NULL OR t."assignedCommitteeId" IS NOT NULL)`;

/** SQL: the pool of the task aliased `t` has an ACTIVE member right now (resolvePoolMemberIds()' rule). */
export const POOL_HAS_ACTIVE_MEMBER_SQL = Prisma.sql`(CASE WHEN t."assignedPositionId" IS NOT NULL
  THEN EXISTS (SELECT 1 FROM "User" pu WHERE pu."organizationId" = t."organizationId" AND pu.status::text = 'ACTIVE'
                AND pu."positionId" = t."assignedPositionId" AND pu."primaryOrgUnitId" = t."assignedOrgUnitId")
  ELSE EXISTS (SELECT 1 FROM "CommitteeMember" cm JOIN "User" cu ON cu.id = cm."userId"
                WHERE cm."organizationId" = t."organizationId" AND cm."isActive" AND cu.status::text = 'ACTIVE'
                  AND cm."committeeId" = t."assignedCommitteeId" AND cm."roleValueId" = t."assignedCommitteeRoleValueId")
  END)`;

/** SQL: has a pool and nobody on it, in a status a pick can take (waitingInPoolWhere(), in SQL). */
export const WAITING_IN_POOL_SQL = Prisma.sql`(t.status::text IN ('PENDING','OVERDUE','UNASSIGNED')
  AND ${IS_POOL_TASK_SQL} AND NOT ${HAS_CURRENT_ACTIVE_ASSIGNEE_SQL})`;

/**
 * ACC-86 — OWNERLESS: an open task nobody can act on, resolved live (ACC-82's
 * rule; no status is kept true by writers). The Unassigned view, Manage tasks'
 * reach (ACC-244) and Setup health's TASK_WITHOUT_OWNER all read this:
 *   - UNASSIGNED, as always;
 *   - PENDING or OVERDUE with nobody on it, unless it waits in a pool that has an
 *     ACTIVE member (then the pool owns it, and its members can pick it);
 *   - IN_PROGRESS or ON_HOLD with nobody on it (Q-2: a held task nobody can
 *     resume), pool or not: a pick cannot take a task in these statuses.
 * REJECTED is not here: it is its creator's to reassign, and a departed creator
 * is Manage tasks' own clause.
 */
export const OWNERLESS_SQL = Prisma.sql`(t.status::text = 'UNASSIGNED'
  OR (t.status::text IN ('PENDING','OVERDUE') AND NOT ${HAS_CURRENT_ACTIVE_ASSIGNEE_SQL}
      AND NOT (${IS_POOL_TASK_SQL} AND ${POOL_HAS_ACTIVE_MEMBER_SQL}))
  OR (t.status::text IN ('IN_PROGRESS','ON_HOLD') AND NOT ${HAS_CURRENT_ACTIVE_ASSIGNEE_SQL}))`;

/** The where-clause for "has a pool target and nobody is on it", in one tenant. */
export function waitingInPoolWhere(organizationId: string): Prisma.TaskWhereInput {
  return {
    organizationId,
    status: { in: [...PICKABLE_STATUSES] },
    OR: [{ assignedPositionId: { not: null } }, { assignedCommitteeId: { not: null } }],
    assignees: { none: CURRENT_ACTIVE_ASSIGNEE },
  };
}

export async function resolvePoolMemberIds(
  client: PoolClient,
  target: PoolTarget,
  organizationId: string,
): Promise<string[]> {
  if (target.kind === 'POSITION') {
    const holders = await client.user.findMany({
      where: {
        organizationId,
        positionId: target.positionId,
        primaryOrgUnitId: target.orgUnitId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return holders.map((h) => h.id);
  }
  const members = await client.committeeMember.findMany({
    where: {
      organizationId,
      committeeId: target.committeeId,
      roleValueId: target.roleValueId,
      isActive: true,
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function isPoolMember(
  client: PoolClient,
  userId: string,
  target: PoolTarget,
  organizationId: string,
): Promise<boolean> {
  if (target.kind === 'POSITION') {
    const count = await client.user.count({
      where: {
        id: userId,
        organizationId,
        positionId: target.positionId,
        primaryOrgUnitId: target.orgUnitId,
        status: 'ACTIVE',
      },
    });
    return count > 0;
  }
  const count = await client.committeeMember.count({
    where: {
      organizationId,
      userId,
      committeeId: target.committeeId,
      roleValueId: target.roleValueId,
      isActive: true,
      user: { status: 'ACTIVE' },
    },
  });
  return count > 0;
}

/**
 * Every pool the user is in right now, as Task where-clauses. Empty when they
 * are in none — the caller then has nothing to look up.
 */
export async function poolsOfUser(
  client: PoolClient,
  userId: string,
  organizationId: string,
): Promise<Prisma.TaskWhereInput[]> {
  return (await poolTargetsOfUser(client, userId, organizationId)).map((t) =>
    t.kind === 'POSITION'
      ? { assignedOrgUnitId: t.orgUnitId, assignedPositionId: t.positionId }
      : { assignedCommitteeId: t.committeeId, assignedCommitteeRoleValueId: t.roleValueId },
  );
}

/**
 * The same pools as poolsOfUser, as targets — what the task visibility rule
 * (ACC-244) binds into SQL. One membership rule, two shapes.
 */
export async function poolTargetsOfUser(
  client: PoolClient,
  userId: string,
  organizationId: string,
): Promise<PoolTarget[]> {
  const me = await client.user.findFirst({
    where: { id: userId, organizationId, status: 'ACTIVE' },
    select: { positionId: true, primaryOrgUnitId: true },
  });
  if (!me) return [];

  const pools: PoolTarget[] = [];
  if (me.positionId && me.primaryOrgUnitId) {
    pools.push({ kind: 'POSITION', orgUnitId: me.primaryOrgUnitId, positionId: me.positionId });
  }
  const memberships = await client.committeeMember.findMany({
    where: { organizationId, userId, isActive: true },
    select: { committeeId: true, roleValueId: true },
  });
  for (const m of memberships) {
    pools.push({ kind: 'COMMITTEE_ROLE', committeeId: m.committeeId, roleValueId: m.roleValueId });
  }
  return pools;
}

// ACC-86 — findEmptyPoolTasks() is gone: TASK_WITHOUT_OWNER now reads OWNERLESS_SQL
// (above), the same definition as the Unassigned view, so the two cannot disagree.

/** The relations a list row needs to SAY what pool a task is in. */
export const POOL_LABEL_INCLUDE = {
  assignedOrgUnit: { select: { nameEn: true, nameAr: true } },
  assignedPosition: { select: { nameEn: true, nameAr: true } },
  assignedCommittee: { select: { nameEn: true, nameAr: true } },
  assignedCommitteeRoleValue: {
    select: { labelEn: true, labelAr: true, labelOverrideEn: true, labelOverrideAr: true },
  },
} as const;

export interface PoolLabelRelations {
  assignedOrgUnit: { nameEn: string; nameAr: string | null } | null;
  assignedPosition: { nameEn: string; nameAr: string | null } | null;
  assignedCommittee: { nameEn: string; nameAr: string | null } | null;
  assignedCommitteeRoleValue: {
    labelEn: string;
    labelAr: string | null;
    labelOverrideEn: string | null;
    labelOverrideAr: string | null;
  } | null;
}

/**
 * The pool a task is in, as the names a screen shows. Arabic names are
 * nullable (ACC-160): the client falls back to English, so null passes through.
 */
export interface ITaskPoolView {
  kind: 'POSITION' | 'COMMITTEE_ROLE';
  positionNameEn: string | null;
  positionNameAr: string | null;
  orgUnitNameEn: string | null;
  orgUnitNameAr: string | null;
  roleLabelEn: string | null;
  roleLabelAr: string | null;
  committeeNameEn: string | null;
  committeeNameAr: string | null;
}

export function toPoolView(row: PoolLabelRelations): ITaskPoolView | null {
  if (row.assignedPosition && row.assignedOrgUnit) {
    return {
      kind: 'POSITION',
      positionNameEn: row.assignedPosition.nameEn,
      positionNameAr: row.assignedPosition.nameAr,
      orgUnitNameEn: row.assignedOrgUnit.nameEn,
      orgUnitNameAr: row.assignedOrgUnit.nameAr,
      roleLabelEn: null,
      roleLabelAr: null,
      committeeNameEn: null,
      committeeNameAr: null,
    };
  }
  if (row.assignedCommittee && row.assignedCommitteeRoleValue) {
    const role = row.assignedCommitteeRoleValue;
    return {
      kind: 'COMMITTEE_ROLE',
      positionNameEn: null,
      positionNameAr: null,
      orgUnitNameEn: null,
      orgUnitNameAr: null,
      roleLabelEn: role.labelOverrideEn ?? role.labelEn,
      roleLabelAr: role.labelOverrideAr ?? role.labelAr,
      committeeNameEn: row.assignedCommittee.nameEn,
      committeeNameAr: row.assignedCommittee.nameAr,
    };
  }
  return null;
}

/** "Quality Officer, Pharmacy" / "Secretary, Quality Committee" — for server-built notification text. */
export function poolLabel(view: ITaskPoolView): { en: string; ar: string } {
  if (view.kind === 'POSITION') {
    return {
      en: `${view.positionNameEn}, ${view.orgUnitNameEn}`,
      ar: `${view.positionNameAr ?? view.positionNameEn}، ${view.orgUnitNameAr ?? view.orgUnitNameEn}`,
    };
  }
  return {
    en: `${view.roleLabelEn}, ${view.committeeNameEn}`,
    ar: `${view.roleLabelAr ?? view.roleLabelEn}، ${view.committeeNameAr ?? view.committeeNameEn}`,
  };
}
