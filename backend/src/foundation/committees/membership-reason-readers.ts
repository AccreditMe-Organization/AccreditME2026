import type { PrismaService } from '../../prisma/prisma.service';
import { CommitteeViewer, overseesCommittee, seesEveryCommittee } from '../../common/services/committee-membership';
import { OFFICER_SEAT_KEYS } from './committee-audience';

/**
 * ACC-301 (Ahmad, 19 Nov) — WHO READS THE REASON on a committee's Membership
 * history. The one place this is decided; the screen only renders what it gets.
 *
 * A reason (a removal's, required since ACC-298) may be personal. It is shown to
 * the people who oversee committees and to this committee's officers only:
 *
 *   1. committees:view — oversight of every committee. No query.
 *   2. an ACTIVE user who holds, through an active membership of this active
 *      committee, one of its officer seats: Chairman or Secretary, identified by
 *      the committee_member_role lookup KEYS (OFFICER_SEAT_KEYS), never a label.
 *      One indexed query.
 *   3. a head holder or acting cover in force whose oversight covers this
 *      committee — the existing oversight clause, overseesCommittee() in
 *      committee-membership.ts. Asked only when 1 and 2 said no.
 *
 * Everyone else who may read the history (its other members) gets each row with
 * its reason null and `reasonWithheld` set, so the screen can say "Reason not
 * shown". The decision is made ONCE per read, never per row.
 */
export async function mayReadMembershipReasons(
  client: Pick<PrismaService, 'committeeMember' | 'committee' | 'user' | 'orgUnitHeadAssignment' | '$queryRaw'>,
  committeeId: string,
  organizationId: string,
  viewer: CommitteeViewer,
  /** The committee_member_role values with this organisation's ids, as the history read already loads them. */
  seats: readonly { id: string; key: string }[],
  now: Date = new Date(),
): Promise<boolean> {
  if (seesEveryCommittee(viewer.permissions)) return true;
  const officerSeatIds = seats.filter((s) => OFFICER_SEAT_KEYS.includes(s.key)).map((s) => s.id);
  if (officerSeatIds.length > 0) {
    const officer = await client.committeeMember.findFirst({
      where: {
        committeeId,
        organizationId,
        userId: viewer.id,
        isActive: true,
        roleValueId: { in: officerSeatIds },
        committee: { organizationId, isActive: true },
        user: { organizationId, status: 'ACTIVE' },
      },
      select: { id: true },
    });
    if (officer) return true;
  }
  return overseesCommittee(client, committeeId, organizationId, viewer.id, now);
}
