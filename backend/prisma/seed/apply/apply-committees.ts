// ACC-62 — creates each tenant's committees and their members.
//
// Goes through CommitteesService, which does more than write rows: createCommittee()
// starts a real COMMITTEE workflow instance (ACC-9's 6-stage template), and
// addMember() writes a CommitteeMembershipEvent to the append-only membership
// ledger. Seeding via Prisma directly would produce committees with no
// workflow instance and no membership history — visibly different from any
// committee a real user could create, and useless for testing either.
import { CommitteesService } from '../../../src/foundation/committees/committees.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { CommitteeFixture, SeedContext, TenantFixture, resolve } from '../fixtures/fixture.types';

// committee_type and committee_member_role are SYSTEM lookups
// (organizationId: null), shared by every tenant. Resolved once per tenant and
// cached in the context so a 5-member committee does not re-query the same
// role five times.
async function loadLookupValues(
  prisma: PrismaService,
  categoryKey: string,
  ctx: SeedContext,
): Promise<void> {
  const category = await prisma.lookupCategory.findFirst({
    where: { key: categoryKey, organizationId: null },
  });
  if (!category) {
    throw new Error(`SYSTEM lookup category '${categoryKey}' not found — has seedSystemData() run?`);
  }

  const values = await prisma.lookupValue.findMany({
    where: { categoryId: category.id, organizationId: null },
  });
  for (const value of values) {
    ctx.lookupValueIdByKey.set(`${categoryKey}:${value.key}`, value.id);
  }
}

// A committee may report to another, so a referenced committee must exist
// first. Rather than trusting the fixture's array order, this computes a safe
// one — the same fixed-point approach orderPeopleForInvite() uses, for the
// same reason: an author reordering the array should not silently break the
// seed.
function orderCommitteesForCreate(fixture: TenantFixture): CommitteeFixture[] {
  const remaining = [...fixture.committees];
  const ordered: CommitteeFixture[] = [];
  const created = new Set<string>();

  while (remaining.length > 0) {
    const index = remaining.findIndex(
      (c) => !c.reportsToCommittee || created.has(c.reportsToCommittee),
    );
    if (index === -1) {
      throw new Error(
        'Cannot order committees: a reporting cycle exists among ' +
          remaining.map((c) => c.key).join(', '),
      );
    }
    const [committee] = remaining.splice(index, 1);
    ordered.push(committee!);
    created.add(committee!.key);
  }

  return ordered;
}

export async function applyCommittees(
  deps: { prisma: PrismaService; committeesService: CommitteesService },
  fixture: TenantFixture,
  ctx: SeedContext,
  actorId: string,
): Promise<void> {
  const { prisma, committeesService } = deps;

  await loadLookupValues(prisma, 'committee_type', ctx);
  await loadLookupValues(prisma, 'committee_member_role', ctx);

  for (const committee of orderCommitteesForCreate(fixture)) {
    const typeValueId = resolve(
      ctx.lookupValueIdByKey,
      `committee_type:${committee.type}`,
      'committee type lookup value',
    );

    const created = await committeesService.createCommittee(
      {
        nameEn: committee.nameEn,
        nameAr: committee.nameAr,
        typeValueId,
        purpose: committee.purpose,
        quorumCount: committee.quorumCount,
        meetingFrequency: committee.meetingFrequency,
        ...(committee.reportsToCommittee
          ? {
              reportingToCommitteeId: resolve(
                ctx.committeeIdByKey,
                committee.reportsToCommittee,
                'committee',
              ),
            }
          : {}),
      },
      ctx.organizationId,
      actorId,
    );

    ctx.committeeIdByKey.set(committee.key, created.id);

    for (const member of committee.members) {
      await committeesService.addMember(
        created.id,
        {
          userId: resolve(ctx.personIdByKey, member.person, 'person'),
          roleValueId: resolve(
            ctx.lookupValueIdByKey,
            `committee_member_role:${member.role}`,
            'committee member role lookup value',
          ),
          reason: 'Founding member — seeded by ACC-62.',
        },
        ctx.organizationId,
        actorId,
      );
    }
  }
}
