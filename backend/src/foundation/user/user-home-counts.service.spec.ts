import { UserHomeCountsService } from './user-home-counts.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-279 — Home's Active users and Pending invites tiles. The fake honours the
// filters as Postgres would, so an unscoped query reaches the other tenant's rows.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const NOW = new Date('2026-11-06T12:00:00.000Z');
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

interface UserRow {
  organizationId: string;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
  invitationExpiresAt: Date | null;
}
interface OrgRow {
  id: string;
  maxUsers: number;
  planCatalog: { maxFullUsers: number | null } | null;
}
type UserWhere = { organizationId?: string; status?: string | { in: string[] }; invitationExpiresAt?: { lt: Date } };

const matches = (u: UserRow, w: UserWhere) =>
  (w.organizationId === undefined || u.organizationId === w.organizationId) &&
  (w.status === undefined || (typeof w.status === 'string' ? u.status === w.status : w.status.in.includes(u.status))) &&
  (w.invitationExpiresAt === undefined || (u.invitationExpiresAt !== null && u.invitationExpiresAt < w.invitationExpiresAt.lt));

function setup(users: UserRow[], orgs: OrgRow[]) {
  const prisma = {
    user: {
      groupBy: jest.fn(({ where }: { where: UserWhere }) => {
        const by = new Map<string, number>();
        for (const u of users.filter((x) => matches(x, where))) by.set(u.status, (by.get(u.status) ?? 0) + 1);
        return Promise.resolve([...by].map(([status, n]) => ({ status, _count: { _all: n } })));
      }),
      count: jest.fn(({ where }: { where: UserWhere }) => Promise.resolve(users.filter((u) => matches(u, where)).length)),
    },
    organization: {
      findFirst: jest.fn(({ where }: { where: { id: string } }) => Promise.resolve(orgs.find((o) => o.id === where.id) ?? null)),
    },
  };
  return { prisma, service: new UserHomeCountsService(prisma as unknown as PrismaService) };
}

const people = (organizationId: string): UserRow[] => [
  { organizationId, status: 'ACTIVE', invitationExpiresAt: null },
  { organizationId, status: 'ACTIVE', invitationExpiresAt: null },
  { organizationId, status: 'INACTIVE', invitationExpiresAt: null },
  { organizationId, status: 'INVITED', invitationExpiresAt: daysFromNow(-1) }, // expired
  { organizationId, status: 'INVITED', invitationExpiresAt: daysFromNow(3) },
];

describe('UserHomeCountsService (ACC-279)', () => {
  it('counts active people, invitations, and the invitations past their expiry', async () => {
    const { service } = setup(people(ORG_A), []);

    expect(await service.counts(ORG_A, { withSeats: false }, NOW)).toEqual({ active: 2, invited: 2, invitedExpired: 1, seats: null });
  });

  it('seats are ACTIVE + INVITED of the enforced limit, when the plan sets a limit', async () => {
    const { service } = setup(people(ORG_A), [{ id: ORG_A, maxUsers: 25, planCatalog: { maxFullUsers: 50 } }]);

    expect((await service.counts(ORG_A, { withSeats: true }, NOW)).seats).toEqual({ occupied: 4, maxUsers: 25 });
  });

  it('no seats line without a plan, with a plan that sets no limit, or with a limit of 0 — never "of 0"', async () => {
    for (const org of [
      { id: ORG_A, maxUsers: 25, planCatalog: null },
      { id: ORG_A, maxUsers: 25, planCatalog: { maxFullUsers: null } },
      { id: ORG_A, maxUsers: 0, planCatalog: { maxFullUsers: 50 } },
    ]) {
      const { service } = setup(people(ORG_A), [org]);
      expect((await service.counts(ORG_A, { withSeats: true }, NOW)).seats).toBeNull();
    }
  });

  it('without tenant:view the organisation is not even read', async () => {
    const { prisma, service } = setup(people(ORG_A), [{ id: ORG_A, maxUsers: 25, planCatalog: { maxFullUsers: 50 } }]);

    await service.counts(ORG_A, { withSeats: false }, NOW);

    expect(prisma.organization.findFirst).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation('home user counts', async () => {
    const { service } = setup(people(ORG_B), [{ id: ORG_B, maxUsers: 25, planCatalog: { maxFullUsers: 50 } }]);

    expect(await service.counts(ORG_A, { withSeats: true }, NOW)).toEqual({ active: 0, invited: 0, invitedExpired: 0, seats: null });
  });
});
