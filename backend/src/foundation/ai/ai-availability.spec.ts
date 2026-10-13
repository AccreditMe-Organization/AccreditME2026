import { aiFeatureAvailability } from './ai-availability';
import { PrismaService } from '../../prisma/prisma.service';

// ACC-197 — the one "may this organisation use this AI feature?" check.

const ORG = 'org-a';
const NOW = new Date('2026-10-13T08:00:00.000Z');
const baseOrg = {
  aiMonthlyCredits: 2000,
  aiPendingMonthlyCredits: null,
  aiCreditsUsed: 0,
  aiCreditsPeriodStart: new Date('2026-09-21T00:00:00.000Z'),
  aiCreditsRenewsAt: new Date('2099-01-01T00:00:00.000Z'),
  bootstrappedAt: new Date('2026-09-21T00:00:00.000Z'),
  createdAt: new Date('2026-09-21T00:00:00.000Z'),
  settings: {},
};
const draftingRow = { featureKey: 'task_description_drafting', creditCost: 2, restricted: false, allowedOrganizationIds: [] };

function setup(org: Record<string, unknown> | null = baseOrg, rows: unknown[] = [draftingRow]) {
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue(org) },
    aiFeatureCost: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return { prisma, run: () => aiFeatureAvailability(prisma as unknown as PrismaService, ORG, 'task_description_drafting') };
}

describe('aiFeatureAvailability (ACC-197)', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(NOW));
  afterAll(() => jest.useRealTimers());

  it('available, with the price, when the feature is open and there is an allowance', async () => {
    await expect(setup().run()).resolves.toEqual({ available: true, creditCost: 2 });
  });

  it('reads the organisation by its own id only', async () => {
    const { prisma, run } = setup();
    await run();
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORG } }));
  });

  it('NO_ALLOWANCE with nothing allocated — the price is still known', async () => {
    await expect(setup({ ...baseOrg, aiMonthlyCredits: 0 }).run()).resolves.toEqual({ available: false, reason: 'NO_ALLOWANCE', creditCost: 2 });
  });

  it('SWITCHED_OFF when the organisation has an allowance and AI is switched off', async () => {
    await expect(setup({ ...baseOrg, settings: { ai: { enabled: false } } }).run()).resolves.toEqual({
      available: false,
      reason: 'SWITCHED_OFF',
      creditCost: 2,
    });
  });

  it('FEATURE_NOT_AVAILABLE when there is no price row, or the row is restricted to others', async () => {
    await expect(setup(baseOrg, []).run()).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_AVAILABLE', creditCost: null });
    const restricted = { ...draftingRow, restricted: true, allowedOrganizationIds: ['org-b'] };
    await expect(setup(baseOrg, [restricted]).run()).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_AVAILABLE', creditCost: null });
  });

  it('FEATURE_NOT_AVAILABLE when the organisation is not found', async () => {
    await expect(setup(null).run()).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_AVAILABLE', creditCost: null });
  });

  it('still available with every credit used: the press, not this check, says "used up"', async () => {
    await expect(setup({ ...baseOrg, aiCreditsUsed: 2000 }).run()).resolves.toEqual({ available: true, creditCost: 2 });
  });
});
