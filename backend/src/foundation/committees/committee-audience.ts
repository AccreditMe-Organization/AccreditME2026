import type { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from '../organization/unit-headship';
import type { CommitteeAudience } from './transfer-notice/committee-transfer-notice';

/**
 * ACC-306 — who is told about a member's committees, read ONCE for every notice
 * that tells a committee's officers about one of its members: the transfer
 * notice (ACC-297) and the deactivation notice (ACC-306). Two notices, one rule;
 * never a second copy of it.
 *
 *   committeeAudiences()  each committee's officers (active holders of the
 *                         chairman and secretary seats who are ACTIVE people),
 *                         and its owning unit's head holders and the cover in
 *                         force — in ONE Promise.all, whatever the number of
 *                         committees. `recipientsByCommittee()` then picks the
 *                         cover instead of the head and leaves out the person
 *                         and the actor.
 *   committeeReaders()    which recipients are ACTIVE, and which may open which
 *                         committee (committees:view, or an active member of it:
 *                         the committee page's rule), in ONE Promise.all.
 *
 * Every read is scoped by the organisation.
 */

/** The seats whose holders are told (lookup keys, the committee_member_role seed). */
export const OFFICER_SEAT_KEYS: readonly string[] = ['chairman', 'secretary'];

type Client = Pick<PrismaService, 'committeeMember' | 'user' | 'orgUnitHeadAssignment' | 'userRole'>;

/** Each committee's audience, in the order given. */
export async function committeeAudiences(
  client: Client,
  organizationId: string,
  committees: readonly { committeeId: string; orgUnitId: string }[],
  officerSeatIds: readonly string[],
): Promise<CommitteeAudience[]> {
  if (committees.length === 0) return [];
  const committeeIds = committees.map((c) => c.committeeId);
  const unitIds = [...new Set(committees.map((c) => c.orgUnitId))];
  const [officers, heads, covers] = await Promise.all([
    officerSeatIds.length === 0
      ? Promise.resolve([] as { committeeId: string; userId: string }[])
      : client.committeeMember.findMany({
          where: {
            organizationId,
            committeeId: { in: committeeIds },
            isActive: true,
            roleValueId: { in: [...officerSeatIds] },
            user: { organizationId, status: 'ACTIVE' },
          },
          select: { committeeId: true, userId: true },
        }),
    findCurrentHeadHoldersForUnits(client, organizationId, unitIds),
    findRunningActingCoversForUnits(client, organizationId, unitIds),
  ]);
  const officersOf = new Map<string, string[]>();
  for (const o of officers) officersOf.set(o.committeeId, [...(officersOf.get(o.committeeId) ?? []), o.userId]);
  return committees.map((c) => ({
    committeeId: c.committeeId,
    officerIds: officersOf.get(c.committeeId) ?? [],
    headIds: (heads.get(c.orgUnitId) ?? []).map((h) => h.id),
    coverId: covers.get(c.orgUnitId)?.userId ?? null,
  }));
}

export interface CommitteeReaders {
  isActive(readerId: string): boolean;
  mayOpen(readerId: string, committeeId: string): boolean;
}

/** Who among `recipients` is ACTIVE, and who may open which of `committeeIds`. */
export async function committeeReaders(
  client: Client,
  organizationId: string,
  recipients: readonly string[],
  committeeIds: readonly string[],
): Promise<CommitteeReaders> {
  if (recipients.length === 0) return { isActive: () => false, mayOpen: () => false };
  const [module, action] = COMMITTEES_PERMISSIONS.VIEW.split(':') as [string, string];
  const [active, viewers, memberships] = await Promise.all([
    client.user.findMany({
      where: { organizationId, id: { in: [...recipients] }, status: 'ACTIVE' },
      select: { id: true },
    }),
    client.userRole.findMany({
      where: {
        userId: { in: [...recipients] },
        role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } },
      },
      select: { userId: true },
    }),
    client.committeeMember.findMany({
      where: {
        organizationId,
        userId: { in: [...recipients] },
        committeeId: { in: [...committeeIds] },
        isActive: true,
        committee: { organizationId, isActive: true },
      },
      select: { userId: true, committeeId: true },
    }),
  ]);
  const activeIds = new Set(active.map((u) => u.id));
  const seesEvery = new Set(viewers.map((v) => v.userId));
  const memberOf = new Set(memberships.map((m) => `${m.userId}|${m.committeeId}`));
  return {
    isActive: (readerId) => activeIds.has(readerId),
    mayOpen: (readerId, committeeId) => seesEvery.has(readerId) || memberOf.has(`${readerId}|${committeeId}`),
  };
}
