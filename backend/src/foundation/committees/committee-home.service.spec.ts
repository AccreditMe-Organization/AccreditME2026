import { CommitteeHomeService, MY_COMMITTEES_READ_CAP, MY_COMMITTEES_ROWS } from './committee-home.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LookupService } from '../lookup/lookup.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-279 — GET /committees/mine: the caller's own committees, five, by seat.
// homeCounts() is proved against a real database (committee-home.db-spec.ts).

const ORG = 'org-a';
const ME = 'user-me';
const day = (n: number) => new Date(Date.UTC(2026, 0, n));

const SEATS = [
  { id: 'chair', labelEn: 'Chairman', labelAr: 'الرئيس' },
  { id: 'secretary', labelEn: 'Secretary', labelAr: null },
  { id: 'member', labelEn: 'Member', labelAr: 'عضو' },
];

interface MembershipRow {
  roleValueId: string;
  joinedAt: Date;
  committee: { id: string; nameEn: string; nameAr: string | null; isActive: boolean };
}

const membership = (id: string, roleValueId: string, joined: number): MembershipRow => ({
  roleValueId,
  joinedAt: day(joined),
  committee: { id, nameEn: `Committee ${id}`, nameAr: null, isActive: true },
});

function setup(memberships: MembershipRow[], total = memberships.length) {
  const prisma = {
    committeeMember: {
      findMany: jest.fn().mockResolvedValue(memberships),
      count: jest.fn().mockResolvedValue(total),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    workflowInstance: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { objectId: { in: string[] } } }) =>
        Promise.resolve(where.objectId.in.map((objectId) => ({ objectId, currentStageId: objectId === 'c-dis' ? 'st-dis' : 'st-force' }))),
      ),
    },
    workflowStage: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'st-force', nameEn: 'Active', nameAr: 'نشطة', flags: ['IN_FORCE'] },
        { id: 'st-dis', nameEn: 'Dissolution Pending', nameAr: null, flags: ['IN_FORCE', 'DISSOLVING'] },
      ]),
    },
  };
  const lookups = { getValues: jest.fn().mockResolvedValue(SEATS) };
  const service = new CommitteeHomeService(prisma as unknown as PrismaService, lookups as unknown as LookupService);
  const queries = () =>
    prisma.committeeMember.findMany.mock.calls.length +
    prisma.committeeMember.count.mock.calls.length +
    prisma.committeeMember.groupBy.mock.calls.length +
    prisma.workflowInstance.findMany.mock.calls.length +
    prisma.workflowStage.findMany.mock.calls.length +
    lookups.getValues.mock.calls.length;
  return { prisma, lookups, service, queries };
}

describe('CommitteeHomeService.mine (ACC-279)', () => {
  it('asks only for the caller\'s ACTIVE memberships on ACTIVE committees, capped, with an honest count', async () => {
    const { prisma, service } = setup([membership('c-1', 'member', 1)]);

    await service.mine(ORG, ME);

    const expected = { organizationId: ORG, userId: ME, isActive: true, committee: { organizationId: ORG, isActive: true } };
    expect(prisma.committeeMember.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expected, take: MY_COMMITTEES_READ_CAP }));
    expect(prisma.committeeMember.count).toHaveBeenCalledWith({ where: expected });
  });

  itEnforcesTenantIsolation('committees/mine', async () => {
    const { prisma, lookups, service } = setup([membership('c-1', 'member', 1)]);

    await service.mine(ORG, ME);

    // Every query is scoped by the caller's organisation, the committee too.
    const where = prisma.committeeMember.findMany.mock.calls[0][0].where;
    expect(where.organizationId).toBe(ORG);
    expect(where.committee.organizationId).toBe(ORG);
    expect(prisma.committeeMember.count.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(lookups.getValues).toHaveBeenCalledWith('committee_member_role', ORG);
    expect(prisma.workflowInstance.findMany.mock.calls[0][0].where.organizationId).toBe(ORG);
    expect(prisma.workflowStage.findMany.mock.calls[0][0].where.workflowTemplate).toEqual({ organizationId: ORG });
  });

  it('five rows by seat (the tenant\'s order), then longest-served; the total counts them all', async () => {
    const { service } = setup([
      membership('c-m1', 'member', 1),
      membership('c-m2', 'member', 2),
      membership('c-sec', 'secretary', 9),
      membership('c-gone-seat', 'retired-seat', 0),
      membership('c-chair-new', 'chair', 8),
      membership('c-chair-old', 'chair', 3),
      membership('c-m3', 'member', 4),
    ]);

    const result = await service.mine(ORG, ME);

    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(MY_COMMITTEES_ROWS);
    expect(result.rows.map((r) => r.committeeId)).toEqual(['c-chair-old', 'c-chair-new', 'c-sec', 'c-m1', 'c-m2']);
  });

  it('each row names the seat and the stage, and carries the stage\'s meanings', async () => {
    const { service } = setup([membership('c-1', 'chair', 1), membership('c-dis', 'member', 2)]);

    const { rows } = await service.mine(ORG, ME);

    expect(rows[0]).toEqual({
      committeeId: 'c-1',
      nameEn: 'Committee c-1',
      nameAr: null,
      isActive: true,
      seat: { id: 'chair', labelEn: 'Chairman', labelAr: 'الرئيس' },
      stage: { nameEn: 'Active', nameAr: 'نشطة' },
      isInForce: true,
      isDissolving: false,
    });
    expect(rows[1]).toEqual(expect.objectContaining({ committeeId: 'c-dis', isInForce: true, isDissolving: true }));
  });

  it('a seat the tenant no longer offers still shows, with no label, after every known seat', async () => {
    const { service } = setup([membership('c-old', 'retired-seat', 0), membership('c-1', 'member', 5)]);

    const { rows } = await service.mine(ORG, ME);

    expect(rows.map((r) => r.committeeId)).toEqual(['c-1', 'c-old']);
    expect(rows[1]?.seat).toEqual({ id: 'retired-seat', labelEn: null, labelAr: null });
  });

  it('no membership: no stage query at all', async () => {
    const { prisma, service } = setup([], 0);

    expect(await service.mine(ORG, ME)).toEqual({ total: 0, rows: [] });
    expect(prisma.workflowInstance.findMany).not.toHaveBeenCalled();
  });

  it('the same number of queries for one membership as for seven: no query per row', async () => {
    const one = setup([membership('c-1', 'member', 1)]);
    await one.service.mine(ORG, ME);
    const seven = setup(Array.from({ length: 7 }, (_, i) => membership(`c-${i}`, 'member', i)));
    await seven.service.mine(ORG, ME);

    expect(seven.queries()).toBe(one.queries());
    // The stage facts are read only for the five shown.
    expect(seven.prisma.workflowInstance.findMany.mock.calls[0][0].where.objectId.in).toHaveLength(MY_COMMITTEES_ROWS);
  });
});
