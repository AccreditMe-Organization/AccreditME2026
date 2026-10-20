import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-133 — the acting cover IN FORCE on a unit right now, read from the period
 * table (`OrgUnitHeadAssignment`), never from the cached
 * `OrgUnit.actingHeadUserId`.
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
 * One exported helper so every reader asks the same question the same way
 * (ACC-244 reuses it). Scoped by organisation AND unit, always. The newest
 * period wins if, against the overlap refusal, two are ever in force at once.
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
