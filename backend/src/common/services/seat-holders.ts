import type { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-159 — who holds a seat, and who holds a position. ONE rule, used by every
 * count that decides either:
 *
 *   - the seat limit: UserService.assertSeatAvailable() (invite, reactivate),
 *     seatPosition() below (the invite form), Home's seats line;
 *   - a position's holders: UserService.validateSingleAssigneeCap(),
 *     OrgPositionService.hasAnyHeadConferringHolder() and
 *     listAvailablePositionsForUser().
 *
 * An ACTIVE person holds one, and so does a pending invitation while its link
 * can still be used. An invitation past its expiry can't be accepted
 * (open-invitation.ts), so it holds neither: the seat frees itself by not being
 * counted, with no sweep. A missing expiry counts as expired, exactly as
 * isOpenInvitation() reads it.
 *
 * Spread into a `where` beside `organizationId` and the count's own fields. It
 * owns the `OR` key, so the `where` it joins must not set one. Never write a
 * second copy of this test.
 */
export function holdsSeatWhere(now: Date): Prisma.UserWhereInput {
  return {
    OR: [{ status: 'ACTIVE' }, { status: 'INVITED', invitationExpiresAt: { gte: now } }],
  };
}

/** The seats in use and the limit the invite refusal enforces (Organization.maxUsers). */
export interface SeatPosition {
  occupied: number;
  maxUsers: number;
}

/**
 * The organisation's limit and its seat holders: the same two reads the
 * refusal always made, now in parallel, the count by holdsSeatWhere(). Null
 * when the organisation does not exist.
 */
export async function seatPosition(
  prisma: Pick<PrismaService, 'organization' | 'user'>,
  organizationId: string,
  now: Date,
): Promise<SeatPosition | null> {
  const [organization, occupied] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { maxUsers: true } }),
    prisma.user.count({ where: { organizationId, ...holdsSeatWhere(now) } }),
  ]);
  if (!organization) return null;
  return { occupied, maxUsers: organization.maxUsers };
}
