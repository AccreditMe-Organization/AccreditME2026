import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../testing/tenant-isolation';
import {
  assertMaySeeCommittee,
  assertMayWriteCommittee,
  committeeAccess,
  committeeOversightUnitIds,
  isActiveMember,
  mayReadCommittee,
  maySeeCommittee,
  memberCommitteeIds,
  readableCommitteeIds,
  seesEveryCommittee,
} from './committee-membership';

// ACC-281 — the ONE membership rule. Proved on real rows in
// committee-member-access.db-spec.ts; this pins the query shapes and the costs.

const ORG = 'org-a';

/**
 * ACC-283 PR 2a — `lead` says what the viewer heads and covers: the head's unit
 * (user.findFirst), the covered units (orgUnitHeadAssignment.findMany), the units
 * below them ($queryRaw), and which committees those units own (committee).
 */
function client(
  rows: { committeeId: string }[] = [],
  lead: { headOf?: string | null; covers?: string[]; subtree?: string[]; owned?: string[] } = {},
) {
  const prisma = {
    committeeMember: {
      findFirst: jest.fn(async () => (rows.length ? { id: 'cm-1' } : null)),
      findMany: jest.fn(async () => rows),
    },
    user: { findFirst: jest.fn(async () => (lead.headOf ? { primaryOrgUnitId: lead.headOf } : null)) },
    orgUnitHeadAssignment: { findMany: jest.fn(async () => (lead.covers ?? []).map((orgUnitId) => ({ orgUnitId }))) },
    $queryRaw: jest.fn(async () => (lead.subtree ?? []).map((id) => ({ id }))),
    committee: {
      findFirst: jest.fn(async () => ((lead.owned ?? []).length ? { id: lead.owned![0] } : null)),
      findMany: jest.fn(async () => (lead.owned ?? []).map((id) => ({ id }))),
    },
  };
  return { prisma, typed: prisma as unknown as PrismaService };
}

const NOW = new Date('2026-11-16T09:00:00.000Z');
/** Every read the clause can make, for the cost tests. */
const reads = (prisma: ReturnType<typeof client>['prisma']) =>
  prisma.committeeMember.findFirst.mock.calls.length +
  prisma.committeeMember.findMany.mock.calls.length +
  prisma.user.findFirst.mock.calls.length +
  prisma.orgUnitHeadAssignment.findMany.mock.calls.length +
  prisma.$queryRaw.mock.calls.length +
  prisma.committee.findFirst.mock.calls.length +
  prisma.committee.findMany.mock.calls.length;

describe('committee membership (ACC-281)', () => {
  it('a member is an ACTIVE row on an ACTIVE committee, in the organisation: one query', async () => {
    const { prisma, typed } = client([{ committeeId: 'c-1' }]);
    expect(await isActiveMember(typed, 'c-1', 'u-1', ORG)).toBe(true);
    expect(prisma.committeeMember.findFirst).toHaveBeenCalledWith({
      where: { committeeId: 'c-1', userId: 'u-1', organizationId: ORG, isActive: true, committee: { organizationId: ORG, isActive: true } },
      select: { roleValueId: true }, // ACC-283 PR 6: the seat, from the same one query
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

describe('heads see the committees of their units, read only (ACC-283 PR 2a)', () => {
  const viewer = { id: 'u-1', permissions: [] as string[] };

  it('the oversight set is the headed unit and the covered units, with every unit below: two reads at once, then the walk', async () => {
    const { prisma, typed } = client([], { headOf: 'unit-a', covers: ['unit-b'], subtree: ['unit-a', 'unit-a1', 'unit-b'] });
    expect(await committeeOversightUnitIds(typed, ORG, 'u-1', NOW)).toEqual(new Set(['unit-a', 'unit-a1', 'unit-b']));
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.orgUnitHeadAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRaw.mock.calls[0]).toContainEqual(['unit-a', 'unit-b']);
  });

  it('leading nothing costs the two headship reads and no walk', async () => {
    const { prisma, typed } = client();
    expect(await committeeOversightUnitIds(typed, ORG, 'u-1', NOW)).toEqual(new Set());
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('the cover clause reads the cover in force at `now`', async () => {
    const { prisma, typed } = client([], { covers: ['unit-b'], subtree: ['unit-b'] });
    await committeeOversightUnitIds(typed, ORG, 'u-1', NOW);
    const where = (prisma.orgUnitHeadAssignment.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toEqual(expect.objectContaining({ organizationId: ORG, userId: 'u-1', kind: 'ACTING', endedAt: null, validFrom: { lte: NOW } }));
  });

  it('a READ: a holder costs nothing, a member one query, a non-member who leads nothing three, an overseer five', async () => {
    const holder = client();
    expect(await mayReadCommittee(holder.typed, 'c-1', ORG, { id: 'u-1', permissions: ['committees:view'] }, NOW)).toBe(true);
    expect(reads(holder.prisma)).toBe(0);

    const member = client([{ committeeId: 'c-1' }]);
    expect(await mayReadCommittee(member.typed, 'c-1', ORG, viewer, NOW)).toBe(true);
    expect(reads(member.prisma)).toBe(1);

    const stranger = client();
    expect(await mayReadCommittee(stranger.typed, 'c-1', ORG, viewer, NOW)).toBe(false);
    expect(reads(stranger.prisma)).toBe(3);

    const head = client([], { headOf: 'unit-a', subtree: ['unit-a'], owned: ['c-1'] });
    expect(await mayReadCommittee(head.typed, 'c-1', ORG, viewer, NOW)).toBe(true);
    expect(reads(head.prisma)).toBe(5);
    expect((head.prisma.committee.findFirst.mock.calls[0] as unknown as [{ where: unknown }])[0].where).toEqual({
      id: 'c-1', organizationId: ORG, isActive: true, orgUnitId: { in: ['unit-a'] },
    });
  });

  it('a WRITE never asks headship: an overseer is still refused with the 404 a missing committee gets', async () => {
    const { prisma, typed } = client([], { headOf: 'unit-a', subtree: ['unit-a'], owned: ['c-1'] });
    await expect(assertMayWriteCommittee(typed, 'c-1', ORG, viewer)).rejects.toEqual(new NotFoundException('Committee not found'));
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.orgUnitHeadAssignment.findMany).not.toHaveBeenCalled();
    // The read admits them, and says they may not write.
    await expect(assertMaySeeCommittee(typed, 'c-1', ORG, viewer, NOW)).resolves.toEqual({ read: true, write: false, seat: null });
  });

  // ACC-283 — the committee read's `mayWrite`, from the same pass as the read.
  it('access: a holder reads and writes with no query, a member with one, an overseer reads only', async () => {
    const holder = client();
    expect(await committeeAccess(holder.typed, 'c-1', ORG, { id: 'u-1', permissions: ['committees:view'] }, NOW)).toEqual({ read: true, write: true });
    expect(reads(holder.prisma)).toBe(0);

    const member = client([{ committeeId: 'c-1' }]);
    expect(await committeeAccess(member.typed, 'c-1', ORG, viewer, NOW)).toEqual({ read: true, write: true });
    expect(reads(member.prisma)).toBe(1);

    // The overseer: the one membership read the rule already makes, then the oversight reads.
    const head = client([], { headOf: 'unit-a', subtree: ['unit-a'], owned: ['c-1'] });
    expect(await committeeAccess(head.typed, 'c-1', ORG, viewer, NOW)).toEqual({ read: true, write: false, seat: null });
    expect(reads(head.prisma)).toBe(5);

    const stranger = client();
    expect(await committeeAccess(stranger.typed, 'c-1', ORG, viewer, NOW)).toEqual({ read: false, write: false, seat: null });
    expect(reads(stranger.prisma)).toBe(3);
  });

  it('access.write is the very answer assertMayWriteCommittee acts on, for every kind of viewer', async () => {
    const cases: [string, ReturnType<typeof client>, { id: string; permissions: string[] }][] = [
      ['holder', client(), { id: 'u-1', permissions: ['committees:view'] }],
      ['member', client([{ committeeId: 'c-1' }]), viewer],
      ['overseer', client([], { headOf: 'unit-a', subtree: ['unit-a'], owned: ['c-1'] }), viewer],
      ['stranger', client(), viewer],
    ];
    for (const [who, c, v] of cases) {
      const { write } = await committeeAccess(c.typed, 'c-1', ORG, v, NOW);
      const passes = await assertMayWriteCommittee(c.typed, 'c-1', ORG, v).then(
        () => true,
        () => false,
      );
      expect([who, write]).toEqual([who, passes]);
    }
  });

  it('the batch: holders all, members first, then one oversight read for the rest only', async () => {
    const { prisma, typed } = client([{ committeeId: 'c-1' }], { headOf: 'unit-a', subtree: ['unit-a'], owned: ['c-2'] });
    expect(await readableCommitteeIds(typed, ORG, viewer, ['c-1', 'c-2', 'c-3'], NOW)).toEqual(new Set(['c-1', 'c-2']));
    expect((prisma.committee.findMany.mock.calls[0] as unknown as [{ where: { id: { in: string[] } } }])[0].where.id.in).toEqual(['c-2', 'c-3']);
    expect(prisma.committee.findMany).toHaveBeenCalledTimes(1);
    const holder = client();
    expect(await readableCommitteeIds(holder.typed, ORG, { id: 'u-1', permissions: ['committees:view'] }, ['c-1'], NOW)).toEqual(new Set(['c-1']));
    expect(reads(holder.prisma)).toBe(0);
  });

  itEnforcesTenantIsolation('committee oversight — every headship read and the committee read name the organisation', async () => {
    const { prisma, typed } = client([], { headOf: 'unit-a', covers: ['unit-b'], subtree: ['unit-a'], owned: ['c-1'] });
    await mayReadCommittee(typed, 'c-1', 'org-b', viewer, NOW);
    const head = (prisma.user.findFirst.mock.calls[0] as unknown as [{ where: { organizationId: string } }])[0].where;
    const cover = (prisma.orgUnitHeadAssignment.findMany.mock.calls[0] as unknown as [{ where: { organizationId: string } }])[0].where;
    const committee = (prisma.committee.findFirst.mock.calls[0] as unknown as [{ where: { organizationId: string } }])[0].where;
    expect(head.organizationId).toBe('org-b');
    expect(cover.organizationId).toBe('org-b');
    expect(committee.organizationId).toBe('org-b');
    expect(prisma.$queryRaw.mock.calls[0]).toContain('org-b');
  });
});
