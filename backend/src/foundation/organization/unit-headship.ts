import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-133 — the two questions every reader of a unit's headship asks, answered
 * one way, in one file. Lane B's ACC-244 builds on these; a new reader of
 * "who is head" or "who covers" uses them rather than writing a third copy.
 *
 * ACC-120 slice 11 (PR B) — the RULES are the two filters below, and every
 * reader builds from them: the batched functions for many units (the tree, the
 * chart, the unit summary) and the single-unit functions, which call the
 * batched ones. So "who is head" cannot mean one thing on the tree and another
 * in the Headship panel.
 *
 * Every query is scoped by organisation AND unit, always.
 */

/**
 * Who counts as a unit's head holder, beside the organisation and the unit:
 * an ACTIVE user whose position confers headship and is itself active.
 *
 * `position.isActive` (D13): a deactivated head position confers nothing.
 */
export function headHolderWhere(): Prisma.UserWhereInput {
  return { status: 'ACTIVE', position: { isUnitHeadPosition: true, isActive: true } };
}

/**
 * An acting cover IN FORCE at `now`, beside the organisation and the unit: an
 * ACTING period that nobody has ended (`endedAt` null), that has started
 * (`validFrom <= now`), and that has not lapsed on its own date (`validTo`
 * null, or after now). The same window `task-authority.service.ts` uses for an
 * absence cover, without its reason filter: a VACANCY cover is in force too.
 */
export function runningActingCoverWhere(now: Date): Prisma.OrgUnitHeadAssignmentWhereInput {
  return {
    kind: 'ACTING',
    endedAt: null,
    validFrom: { lte: now },
    OR: [{ validTo: null }, { validTo: { gt: now } }],
  };
}

/**
 * One id is an equality, several are `in`. Prisma treats the two alike; the
 * equality keeps a single-unit read sending exactly the query it always sent.
 */
function unitIdFilter(orgUnitIds: string[]): string | { in: string[] } {
  return orgUnitIds.length === 1 ? orgUnitIds[0]! : { in: orgUnitIds };
}

export interface HeadHolderRow {
  id: string;
  name: string;
  positionId: string | null;
  position: { nameEn: string; nameAr: string | null } | null;
}

export interface HeadHolderInUnit extends HeadHolderRow {
  /** The unit they head; the holder rule makes it their primary unit. */
  primaryOrgUnitId: string | null;
}

/**
 * The head holders of each unit in `orgUnitIds`, in ONE query, grouped by unit.
 * A unit with no holder is absent from the map.
 *
 * Usually zero or one per unit; TWO while a successor is pending, because
 * `declareHandover()` grants the incoming person the position at once. Do not
 * assume one head: during that window both hold it.
 */
export async function findCurrentHeadHoldersForUnits(
  prisma: Pick<PrismaService, 'user'>,
  organizationId: string,
  orgUnitIds: string[],
): Promise<Map<string, HeadHolderInUnit[]>> {
  const byUnit = new Map<string, HeadHolderInUnit[]>();
  if (orgUnitIds.length === 0) return byUnit;
  const rows: HeadHolderInUnit[] = await prisma.user.findMany({
    where: { organizationId, primaryOrgUnitId: unitIdFilter(orgUnitIds), ...headHolderWhere() },
    select: {
      id: true,
      name: true,
      positionId: true,
      primaryOrgUnitId: true,
      position: { select: { nameEn: true, nameAr: true } },
    },
  });
  // With one unit, every row the equality matched is in it by construction.
  const single = orgUnitIds.length === 1 ? orgUnitIds[0]! : null;
  for (const row of rows) {
    const unitId = single ?? row.primaryOrgUnitId;
    if (!unitId) continue;
    const list = byUnit.get(unitId) ?? [];
    list.push(row);
    byUnit.set(unitId, list);
  }
  return byUnit;
}

/**
 * The unit's current head holders — `findCurrentHeadHoldersForUnits()` for one
 * unit, returning the rows it always returned.
 */
export async function findCurrentHeadHolders(
  prisma: Pick<PrismaService, 'user'>,
  organizationId: string,
  orgUnitId: string,
): Promise<HeadHolderRow[]> {
  const byUnit = await findCurrentHeadHoldersForUnits(prisma, organizationId, [orgUnitId]);
  return (byUnit.get(orgUnitId) ?? []).map(({ id, name, positionId, position }) => ({
    id,
    name,
    positionId,
    position,
  }));
}

/**
 * The acting cover in force on a unit, read from the period table
 * (`OrgUnitHeadAssignment`), never from the cached `OrgUnit.actingHeadUserId`.
 *
 * Why the cache is not enough: it is written when a cover is ARRANGED, even one
 * that starts next month, and it is cleared only when a person ends the cover.
 * A cover that lapsed on its own end date leaves it set. So the cache answers
 * "was a cover arranged and not ended by hand", which is a different question.
 *
 * The newest period wins if, against the overlap refusal, two are ever in force
 * at once.
 */
export interface RunningActingCover {
  id: string;
  userId: string;
  userName: string;
  reason: 'VACANCY' | 'ABSENCE' | null;
  validFrom: Date;
  validTo: Date | null;
}

export interface RunningActingCoverInUnit extends RunningActingCover {
  orgUnitId: string;
  /** The cover's own primary unit: an acting head may come from anywhere. */
  userPrimaryOrgUnitId: string | null;
}

/**
 * The cover in force on each unit in `orgUnitIds`, in ONE query, keyed by
 * unit. A unit with no cover in force is absent from the map.
 */
export async function findRunningActingCoversForUnits(
  prisma: Pick<PrismaService, 'orgUnitHeadAssignment'>,
  organizationId: string,
  orgUnitIds: string[],
  now: Date = new Date(),
): Promise<Map<string, RunningActingCoverInUnit>> {
  const byUnit = new Map<string, RunningActingCoverInUnit>();
  if (orgUnitIds.length === 0) return byUnit;
  const rows = await prisma.orgUnitHeadAssignment.findMany({
    where: { organizationId, orgUnitId: unitIdFilter(orgUnitIds), ...runningActingCoverWhere(now) },
    orderBy: { validFrom: 'desc' },
    select: {
      id: true,
      orgUnitId: true,
      userId: true,
      reason: true,
      validFrom: true,
      validTo: true,
      user: { select: { name: true, primaryOrgUnitId: true } },
    },
  });
  // Newest first, so the first row seen for a unit is the one that wins.
  for (const row of rows) {
    if (byUnit.has(row.orgUnitId)) continue;
    byUnit.set(row.orgUnitId, {
      id: row.id,
      orgUnitId: row.orgUnitId,
      userId: row.userId,
      userName: row.user.name,
      userPrimaryOrgUnitId: row.user.primaryOrgUnitId ?? null,
      reason: row.reason,
      validFrom: row.validFrom,
      validTo: row.validTo,
    });
  }
  return byUnit;
}

/**
 * The cover in force on one unit — `findRunningActingCoversForUnits()` for one
 * unit, returning the shape it always returned.
 */
export async function findRunningActingCover(
  prisma: Pick<PrismaService, 'orgUnitHeadAssignment'>,
  organizationId: string,
  orgUnitId: string,
  now: Date = new Date(),
): Promise<RunningActingCover | null> {
  const byUnit = await findRunningActingCoversForUnits(prisma, organizationId, [orgUnitId], now);
  const cover = byUnit.get(orgUnitId);
  if (!cover) return null;
  return {
    id: cover.id,
    userId: cover.userId,
    userName: cover.userName,
    reason: cover.reason,
    validFrom: cover.validFrom,
    validTo: cover.validTo,
  };
}
