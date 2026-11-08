import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import {
  assertMaySeeCommittee,
  assertMayWriteCommittee,
  isActiveMember,
  maySeeCommittee,
  memberCommitteeIds,
  seesEveryCommittee,
} from './committee-membership';

// ACC-281 — the ONE membership rule. Proved on real rows in
// committee-member-access.db-spec.ts; this pins the query shapes and the costs.

const ORG = 'org-a';

function client(rows: { committeeId: string }[] = []) {
  const prisma = {
    committeeMember: {
      findFirst: jest.fn(async () => (rows.length ? { id: 'cm-1' } : null)),
      findMany: jest.fn(async () => rows),
    },
  };
  return { prisma, typed: prisma as unknown as Pick<PrismaService, 'committeeMember'> };
}

describe('committee membership (ACC-281)', () => {
  it('a member is an ACTIVE row on an ACTIVE committee, in the organisation: one query', async () => {
    const { prisma, typed } = client([{ committeeId: 'c-1' }]);
    expect(await isActiveMember(typed, 'c-1', 'u-1', ORG)).toBe(true);
    expect(prisma.committeeMember.findFirst).toHaveBeenCalledWith({
      where: { committeeId: 'c-1', userId: 'u-1', organizationId: ORG, isActive: true, committee: { organizationId: ORG, isActive: true } },
      select: { id: true },
    });
  });

  it('the batch form is one query, and none for an empty batch', async () => {
    const { prisma, typed } = client([{ committeeId: 'c-1' }, { committeeId: 'c-2' }]);
    expect(await memberCommitteeIds(typed, 'u-1', ORG, ['c-1', 'c-2', 'c-1'])).toEqual(new Set(['c-1', 'c-2']));
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.committeeMember.findMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', organizationId: ORG, isActive: true, committee: { organizationId: ORG, isActive: true }, committeeId: { in: ['c-1', 'c-2'] } },
      select: { committeeId: true },
    });
    await memberCommitteeIds(typed, 'u-1', ORG, []);
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
  });

  it('committees:view needs no membership read', async () => {
    const { prisma, typed } = client();
    expect(seesEveryCommittee(['committees:view'])).toBe(true);
    expect(await maySeeCommittee(typed, 'c-1', ORG, { id: 'u-1', permissions: ['committees:view'] })).toBe(true);
    expect(prisma.committeeMember.findFirst).not.toHaveBeenCalled();
  });

  it("a read refused is today's 403; a write refused is the 404 a missing committee gets", async () => {
    const { typed } = client();
    const stranger = { id: 'u-9', permissions: ['committees:edit_details'] };
    await expect(assertMaySeeCommittee(typed, 'c-1', ORG, stranger)).rejects.toEqual(new ForbiddenException('Required permission: committees:view'));
    await expect(assertMayWriteCommittee(typed, 'c-1', ORG, stranger)).rejects.toEqual(new NotFoundException('Committee not found'));
    await expect(assertMayWriteCommittee(typed, 'cr-1', ORG, stranger, 'Change request not found')).rejects.toEqual(
      new NotFoundException('Change request not found'),
    );
  });

  itEnforcesTenantIsolation('committee membership rule', async () => {
    const { prisma, typed } = client();
    await isActiveMember(typed, 'c-1', 'u-1', 'org-b');
    await memberCommitteeIds(typed, 'u-1', 'org-b');
    const one = (prisma.committeeMember.findFirst.mock.calls[0] as unknown as [{ where: { organizationId: string; committee: { organizationId: string } } }])[0].where;
    const many = (prisma.committeeMember.findMany.mock.calls[0] as unknown as [{ where: { organizationId: string; committee: { organizationId: string } } }])[0].where;
    for (const where of [one, many]) {
      expect(where.organizationId).toBe('org-b');
      expect(where.committee.organizationId).toBe('org-b');
    }
  });
});
