import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { aiBalanceOf, AiBalanceSource } from './ai-balance';
import { ChangeTenantPlanDto } from '../../platform/tenant/dto/change-tenant-plan.dto';

const base: AiBalanceSource = {
  aiMonthlyCredits: 0,
  aiPendingMonthlyCredits: null,
  aiCreditsUsed: 0,
  aiCreditsPeriodStart: null,
  aiCreditsRenewsAt: null,
  bootstrappedAt: new Date('2026-09-21T04:39:49.741Z'),
  createdAt: new Date('2026-09-21T04:38:14Z'),
  settings: null,
};
const NOW = new Date('2026-10-12T13:00:00Z');

describe('aiBalanceOf (ACC-194)', () => {
  it('no allocation: off, all zeros, no period', () => {
    expect(aiBalanceOf(base, NOW)).toEqual({
      enabled: false,
      monthlyCredits: 0,
      creditsUsed: 0,
      creditsRemaining: 0,
      resetDate: null,
      overageEnabled: false,
      pendingMonthlyCredits: null,
      periodStart: null,
    });
  });

  it('an allocation in its period: remaining is allocation minus used, and a pending cut is shown', () => {
    const balance = aiBalanceOf(
      {
        ...base,
        aiMonthlyCredits: 300,
        aiCreditsUsed: 120,
        aiPendingMonthlyCredits: 100,
        aiCreditsPeriodStart: new Date('2026-09-21T04:39:49.741Z'),
        aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z'),
      },
      NOW,
    );
    expect(balance).toEqual({
      enabled: true,
      monthlyCredits: 300,
      creditsUsed: 120,
      creditsRemaining: 180,
      resetDate: '2026-10-21T00:00:00.000Z',
      overageEnabled: false,
      pendingMonthlyCredits: 100,
      periodStart: '2026-09-21T04:39:49.741Z',
    });
  });

  it('a period past its renewal reads as the period it renews into — live, before the job stores it', () => {
    const balance = aiBalanceOf(
      {
        ...base,
        aiMonthlyCredits: 300,
        aiCreditsUsed: 300,
        aiPendingMonthlyCredits: 100,
        aiCreditsPeriodStart: new Date('2026-09-21T04:39:49.741Z'),
        aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z'),
      },
      new Date('2026-10-22T09:00:00Z'),
    );
    expect(balance).toEqual(
      expect.objectContaining({
        monthlyCredits: 100,
        creditsUsed: 0,
        creditsRemaining: 100,
        pendingMonthlyCredits: null,
        periodStart: '2026-10-21T00:00:00.000Z',
        resetDate: '2026-11-21T00:00:00.000Z',
      }),
    );
  });

  it('switched off reads as off, whatever the allocation (D13)', () => {
    const balance = aiBalanceOf({ ...base, aiMonthlyCredits: 50, settings: { ai: { enabled: false } } }, NOW);
    expect(balance.enabled).toBe(false);
  });

  it('ignores the old settings.ai counters entirely', () => {
    const balance = aiBalanceOf({ ...base, settings: { ai: { monthlyCredits: 999, creditsUsed: 3, creditsRemaining: 996, overageEnabled: true } } }, NOW);
    expect(balance.monthlyCredits).toBe(0);
    expect(balance.overageEnabled).toBe(false);
  });
});

describe('ChangeTenantPlanDto (ACC-194, D18)', () => {
  const errors = (body: unknown) => validate(plainToInstance(ChangeTenantPlanDto, body));
  it('accepts a plan id, or null to remove the plan', async () => {
    expect(await errors({ planId: 'plan-pro' })).toHaveLength(0);
    expect(await errors({ planId: null })).toHaveLength(0);
  });
  it('refuses an empty string, a number, and a missing field', async () => {
    expect(await errors({ planId: '' })).not.toHaveLength(0);
    expect(await errors({ planId: 7 })).not.toHaveLength(0);
    expect(await errors({})).not.toHaveLength(0);
  });
});
