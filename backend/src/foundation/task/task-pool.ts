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
 * AND status ACTIVE — exactly the engine's POSITION_FIXED query (SYSTEM-
 * REFERENCE §2.5). It deliberately does NOT include an out-of-office holder's
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

/** The where-clause for "has a pool target and nobody has picked it up", in one tenant. */
export function waitingInPoolWhere(organizationId: string): Prisma.TaskWhereInput {
  return {
    organizationId,
    status: { in: [...PICKABLE_STATUSES] },
    OR: [{ assignedPositionId: { not: null } }, { assignedCommitteeId: { not: null } }],
    assignees: { none: { removedAt: null } },
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
  const me = await client.user.findFirst({
    where: { id: userId, organizationId, status: 'ACTIVE' },
    select: { positionId: true, primaryOrgUnitId: true },
  });
  if (!me) return [];

  const pools: Prisma.TaskWhereInput[] = [];
  if (me.positionId && me.primaryOrgUnitId) {
    pools.push({ assignedOrgUnitId: me.primaryOrgUnitId, assignedPositionId: me.positionId });
  }
  const memberships = await client.committeeMember.findMany({
    where: { organizationId, userId, isActive: true },
    select: { committeeId: true, roleValueId: true },
  });
  for (const m of memberships) {
    pools.push({ assignedCommitteeId: m.committeeId, assignedCommitteeRoleValueId: m.roleValueId });
  }
  return pools;
}

export interface EmptyPoolTask {
  id: string;
  title: string;
  sourceType: string;
  sourceId: string;
  dueAt: Date | null;
}

/**
 * Open tasks waiting in a pool that nobody is in right now — nobody can pick
 * them up. A Setup health condition (TASK_WITHOUT_OWNER) and a row on the
 * Unassigned tasks screen, beside UNASSIGNED tasks: both are work with no
 * actionable owner.
 *
 * Three queries per tenant however many tasks: the waiting tasks, then one
 * grouped count per pool kind.
 */
export async function findEmptyPoolTasks(
  client: PoolClient,
  organizationId: string,
): Promise<EmptyPoolTask[]> {
  const waiting = await client.task.findMany({
    where: { ...waitingInPoolWhere(organizationId), status: { in: ['PENDING', 'OVERDUE'] } },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceId: true,
      dueAt: true,
      assignedOrgUnitId: true,
      assignedPositionId: true,
      assignedCommitteeId: true,
      assignedCommitteeRoleValueId: true,
    },
  });
  if (waiting.length === 0) return [];

  const positionPairs = waiting.flatMap((t) =>
    t.assignedOrgUnitId && t.assignedPositionId
      ? [{ primaryOrgUnitId: t.assignedOrgUnitId, positionId: t.assignedPositionId }]
      : [],
  );
  const committeePairs = waiting.flatMap((t) =>
    t.assignedCommitteeId && t.assignedCommitteeRoleValueId
      ? [{ committeeId: t.assignedCommitteeId, roleValueId: t.assignedCommitteeRoleValueId }]
      : [],
  );

  const staffed = new Set<string>();
  if (positionPairs.length > 0) {
    const holders = await client.user.findMany({
      where: { organizationId, status: 'ACTIVE', OR: positionPairs },
      select: { positionId: true, primaryOrgUnitId: true },
      distinct: ['positionId', 'primaryOrgUnitId'],
    });
    for (const h of holders) staffed.add(`P:${h.primaryOrgUnitId}:${h.positionId}`);
  }
  if (committeePairs.length > 0) {
    const members = await client.committeeMember.findMany({
      where: { organizationId, isActive: true, user: { status: 'ACTIVE' }, OR: committeePairs },
      select: { committeeId: true, roleValueId: true },
      distinct: ['committeeId', 'roleValueId'],
    });
    for (const m of members) staffed.add(`C:${m.committeeId}:${m.roleValueId}`);
  }

  return waiting
    .filter((t) =>
      t.assignedPositionId
        ? !staffed.has(`P:${t.assignedOrgUnitId}:${t.assignedPositionId}`)
        : !staffed.has(`C:${t.assignedCommitteeId}:${t.assignedCommitteeRoleValueId}`),
    )
    .map(({ id, title, sourceType, sourceId, dueAt }) => ({ id, title, sourceType, sourceId, dueAt }));
}

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
