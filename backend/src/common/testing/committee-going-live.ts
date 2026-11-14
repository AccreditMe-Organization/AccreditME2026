import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { activeMemberCount, requiredSeats } from '../../foundation/committees/committee-seat-rules';

/**
 * ACC-286 — for real-database specs about the ENGINE (pools, votes, stage
 * history) that move a committee into an in-force stage: the seeded Terms
 * Review → Active is going live, which needs every required seat filled and
 * the quorum met. A spec about something else gives its committee that shape
 * here, and is then free of it. The going-live rules themselves are proved in
 * foundation/committees/committee-going-live.db-spec.ts, which uses neither.
 */

/**
 * The organisation unticks every seat that is required today, through its own
 * override rows, as a tenant can (Ahmad, 14 Nov, Q1). Nothing to do where no
 * seat is required (the shared lookups not seeded in this database yet).
 */
export async function untickRequiredSeats(prisma: PrismaService, organizationId: string): Promise<void> {
  for (const seat of await requiredSeats(prisma, organizationId)) {
    const shared = await prisma.lookupValue.findFirstOrThrow({ where: { id: seat.id } });
    await prisma.lookupValue.upsert({
      where: { categoryId_key_organizationId: { categoryId: shared.categoryId, key: shared.key, organizationId } },
      create: {
        categoryId: shared.categoryId,
        organizationId,
        key: shared.key,
        labelEn: shared.labelEn,
        labelAr: shared.labelAr,
        layer: 'TENANT',
        sortOrder: shared.sortOrder,
        attributes: { required: false },
      },
      update: { attributes: { required: false } },
    });
  }
}

/** Adds ACTIVE plain members (no required seat) until the committee's quorum is met. */
export async function seatMembersForQuorum(prisma: PrismaService, organizationId: string, committeeId: string): Promise<void> {
  const { quorumCount } = await prisma.committee.findFirstOrThrow({ where: { id: committeeId, organizationId } });
  for (let n = await activeMemberCount(prisma, organizationId, committeeId); n < quorumCount; n++) {
    const user = await prisma.user.create({
      data: { organizationId, email: `quorum-${randomUUID()}@example.test`, name: 'Quorum member', status: 'ACTIVE' },
    });
    await prisma.committeeMember.create({ data: { organizationId, committeeId, userId: user.id, roleValueId: 'member' } });
  }
}
