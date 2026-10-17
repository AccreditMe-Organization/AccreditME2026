import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CreditsOrg, FIXTURE_SLUGS, planCreditsFix } from '../../../prisma/fix-acc236-ai-credits-used';

// ACC-236 — the used-credits fix refuses whatever it cannot do safely, and its
// one read of the AI log is this organisation's alone. The window itself is
// proved against a real database (fix-acc236-ai-credits-used.db-spec.ts).

const ACTIVATION = new Date('2026-09-21T04:39:49.741Z');
const NOW = new Date('2026-10-17T12:00:00.000Z');

function org(over: Partial<CreditsOrg> = {}): CreditsOrg {
  return {
    id: 'org-nakheel',
    slug: 'al-nakheel',
    bootstrappedAt: ACTIVATION,
    createdAt: new Date('2026-09-21T04:38:14.666Z'),
    aiMonthlyCredits: 2000,
    aiCreditsUsed: 0,
    aiCreditsPeriodStart: ACTIVATION,
    aiCreditsRenewsAt: new Date('2026-10-21T00:00:00.000Z'),
    ...over,
  };
}

function reader(organisation: CreditsOrg | null, calls: { creditCost: number | null }[] = []) {
  const findMany = jest.fn().mockResolvedValue(calls);
  const findFirst = jest.fn().mockResolvedValue(organisation);
  const prisma = { organization: { findFirst }, aiInteractionLog: { findMany } } as unknown as Parameters<typeof planCreditsFix>[0];
  return { prisma, findMany, findFirst };
}

describe('fix-acc236 — planCreditsFix', () => {
  it('only the seeded fixtures are allowed by default: al-nakheel and al-manara', () => {
    expect([...FIXTURE_SLUGS].sort()).toEqual(['al-manara', 'al-nakheel']);
  });

  it('a customer organisation is refused before the log is read', async () => {
    const { prisma, findMany } = reader(org({ slug: 'king-faisal' }));
    const plan = await planCreditsFix(prisma, 'king-faisal', { now: NOW });
    expect(plan!.refused).toContain('customer organisation');
    expect(plan!.change).toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('the platform organisation is never read as a tenant (isPlatformOrg: false in the lookup)', async () => {
    const { prisma, findFirst } = reader(null);
    expect(await planCreditsFix(prisma, 'platform', { now: NOW })).toBeNull();
    expect(findFirst.mock.calls[0]![0].where).toEqual({ slug: 'platform', isPlatformOrg: false });
  });

  it('no credit period yet: refused', async () => {
    const { prisma } = reader(org({ aiCreditsPeriodStart: null }));
    expect((await planCreditsFix(prisma, 'al-nakheel', { now: NOW }))!.refused).toContain('no credit period yet');
  });

  it('a stored period start the rule does not produce: refused, never guessed', async () => {
    const { prisma } = reader(org({ aiCreditsPeriodStart: new Date('2026-10-01T00:00:00.000Z') }));
    expect((await planCreditsFix(prisma, 'al-nakheel', { now: NOW }))!.refused).toContain('is not a period start by the rule');
  });

  it('the period has ended: refused, because the renewal resets used credits', async () => {
    const { prisma } = reader(org());
    expect((await planCreditsFix(prisma, 'al-nakheel', { now: new Date('2026-10-21T00:00:00.000Z') }))!.refused).toContain('the period ended');
  });

  it('a log total above the allocation: refused', async () => {
    const { prisma } = reader(org({ aiMonthlyCredits: 10 }), [{ creditCost: 8 }, { creditCost: 8 }]);
    expect((await planCreditsFix(prisma, 'al-nakheel', { now: NOW }))!.refused).toContain('above the allocation');
  });

  it('sums the successful calls it is given; a null cost counts as nothing', async () => {
    const { prisma } = reader(org(), [{ creditCost: 15 }, { creditCost: null }, { creditCost: 2 }]);
    const plan = await planCreditsFix(prisma, 'al-nakheel', { now: NOW });
    expect(plan!.after.aiCreditsUsed).toBe(17);
    expect(plan!.callsCounted).toBe(3);
    expect(plan!.change).toBe(true);
  });

  itEnforcesTenantIsolation('fix-acc236 reads only the named organisation\'s successful calls, inside its period', async () => {
    const { prisma, findMany } = reader(org());
    await planCreditsFix(prisma, 'al-nakheel', { now: NOW });
    expect(findMany.mock.calls[0]![0].where).toEqual({
      organizationId: 'org-nakheel',
      success: true,
      createdAt: { gte: ACTIVATION, lt: new Date('2026-10-21T00:00:00.000Z') },
    });
  });
});
