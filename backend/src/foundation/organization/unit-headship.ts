import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-133 — the two questions every reader of a unit's headship asks, answered
 * one way, in one file. Lane B's ACC-244 builds on these; a new reader of
 * "who is head" or "who covers" uses them rather than writing a third copy.
 *
 * Both are scoped by organisation AND unit, always.
 */

/**
 * The unit's current head holders: ACTIVE users whose primary unit is this one
 * and whose position confers headship and is itself active.
 *
 * Usually zero or one; TWO while a successor is pending, because
 * `declareHandover()` grants the incoming person the position at once. Do not
 * assume one head: during that window both hold it.
 *
 * `position.isActive` (D13): a deactivated head position confers nothing.
 */
export function findCurrentHeadHolders(
  prisma: Pick<PrismaService, 'user'>,
  organizationId: string,
  orgUnitId: string,
) {
  return prisma.user.findMany({
    where: {
      organizationId,
      primaryOrgUnitId: orgUnitId,
      status: 'ACTIVE',
      position: { isUnitHeadPosition: true, isActive: true },
    },
    select: {
      id: true,
      name: true,
      positionId: true,
      position: { select: { nameEn: true, nameAr: true } },
    },
  });
}

/**
 * The acting cover IN FORCE on the unit right now, read from the period table
 * (`OrgUnitHeadAssignment`), never from the cached `OrgUnit.actingHeadUserId`.
 *
 * In force means: an ACTING period that nobody has ended (`endedAt` null), that
 * has started (`validFrom <= now`), and that has not lapsed on its own date
 * (`validTo` null, or after now). The same window `task-authority.service.ts`
 * uses for an absence cover, without its reason filter: a VACANCY cover is in
 * force too.
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

export async function findRunningActingCover(
  prisma: Pick<PrismaService, 'orgUnitHeadAssignment'>,
  organizationId: string,
  orgUnitId: string,
  now: Date = new Date(),
): Promise<RunningActingCover | null> {
  const row = await prisma.orgUnitHeadAssignment.findFirst({
    where: {
      organizationId,
      orgUnitId,
      kind: 'ACTING',
      endedAt: null,
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    orderBy: { validFrom: 'desc' },
    select: {
      id: true,
      userId: true,
      reason: true,
      validFrom: true,
      validTo: true,
      user: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    reason: row.reason,
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
}
