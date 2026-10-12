import { AiService } from './ai.service';
import { AiCreditService } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';
import { AiRefusalException } from './ai-refusal';
import { AiNoticesService } from './ai-notices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProvider, AiProviderCallError } from '../../providers/ai/ai.provider';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const PERIOD_START = new Date('2026-09-21T04:39:49Z');
const RENEWS_AT = new Date('2099-10-21T00:00:00Z');
const MARKER = 'CONFIDENTIAL-POLICY-TEXT-7731';

function setup() {
  const prisma = {
    aiFeatureCost: {
      findUnique: jest.fn().mockResolvedValue({ featureKey: 'task_description_drafting', creditCost: 2, restricted: false, allowedOrganizationIds: [] }),
      findMany: jest.fn().mockResolvedValue([
        { featureKey: 'task_description_drafting', creditCost: 2, restricted: false, allowedOrganizationIds: [] },
        { featureKey: 'document_summary', creditCost: 15, restricted: false, allowedOrganizationIds: [] },
      ]),
    },
    aiInteractionLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const credits = {
    reserve: jest.fn().mockResolvedValue({ used: 2, allocation: 20, periodStart: PERIOD_START, renewsAt: RENEWS_AT }),
    refund: jest.fn().mockResolvedValue(true),
    state: jest.fn(),
    claimNotice: jest.fn().mockResolvedValue(true),
  };
  const notices = { creditsUsedUp: jest.fn().mockResolvedValue(undefined) };
  const allocation = { renewIfDue: jest.fn().mockResolvedValue(true) };
  const provider: jest.Mocked<AiProvider> = {
    name: 'ANTHROPIC',
    isConfigured: jest.fn().mockReturnValue(true),
    complete: jest.fn().mockResolvedValue({ content: 'A drafted description.', model: 'claude-sonnet-5-5', inputTokens: 120, outputTokens: 80, truncated: false }),
  } as unknown as jest.Mocked<AiProvider>;
  const service = new AiService(
    prisma as unknown as PrismaService,
    credits as unknown as AiCreditService,
    allocation as unknown as AiAllocationService,
    notices as unknown as AiNoticesService,
    provider,
  );
  return { service, prisma, credits, allocation, provider, notices };
}

const request = { prompt: `Draft a description. ${MARKER}`, description: 'Task tsk_1 draft' };

async function refusal(promise: Promise<unknown>): Promise<AiRefusalException> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof AiRefusalException) return e;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('AiService.run (ACC-194)', () => {
  it('prices, reserves, calls with the feature’s model, effort and limit, logs, and returns the answer', async () => {
    const { service, provider, credits, prisma } = setup();
    const result = await service.run('task_description_drafting', { organizationId: ORG, actorId: 'u1' }, request);

    expect(result).toEqual({ content: 'A drafted description.', creditCost: 2, inputTokens: 120, outputTokens: 80, truncated: false });
    expect(credits.reserve).toHaveBeenCalledWith(ORG, 2, expect.any(Date));
    expect(provider.complete).toHaveBeenCalledWith({
      model: 'claude-sonnet-5-5',
      prompt: request.prompt,
      system: undefined,
      maxTokens: 2000,
      effort: 'low',
    });
    expect(prisma.aiInteractionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: ORG,
        actorId: 'u1',
        feature: 'task_description_drafting',
        success: true,
        creditCost: 2,
        provider: 'ANTHROPIC',
        tier: 'STANDARD',
        inputTokens: 120,
        outputTokens: 80,
      }),
    });
  });

  it('never logs the customer’s text: neither the prompt nor the answer reaches the log (D5)', async () => {
    const { service, prisma, provider } = setup();
    provider.complete.mockResolvedValue({ content: `Summary of ${MARKER}`, model: 'm', inputTokens: 1, outputTokens: 1, truncated: false });
    await service.run('task_description_drafting', { organizationId: ORG }, request);

    const logged = JSON.stringify(prisma.aiInteractionLog.create.mock.calls);
    expect(logged).not.toContain(MARKER);
    expect(logged).toContain('Task tsk_1 draft');
    expect(logged).toContain(`${request.prompt.length} characters in`);
  });

  it('an unpriced feature is refused before anything else — never free', async () => {
    const { service, prisma, credits, provider } = setup();
    prisma.aiFeatureCost.findUnique.mockResolvedValue(null);
    const e = await refusal(service.run('document_summary', { organizationId: ORG }, request));
    expect(e.code).toBe('AI_FEATURE_NOT_PRICED');
    expect(credits.reserve).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('a restricted feature is refused for an organisation not on its list, before reserving (D17)', async () => {
    const { service, prisma, credits } = setup();
    prisma.aiFeatureCost.findUnique.mockResolvedValue({ featureKey: 'morning_briefing', creditCost: 5, restricted: true, allowedOrganizationIds: [OTHER_ORG] });
    const e = await refusal(service.run('morning_briefing', { organizationId: ORG }, request));
    expect(e.code).toBe('AI_NOT_ENABLED');
    expect(e.details.reason).toBe('FEATURE_NOT_AVAILABLE');
    expect(credits.reserve).not.toHaveBeenCalled();
  });

  it('a restricted feature with an EMPTY list is open to nobody (fails closed)', async () => {
    const { service, prisma } = setup();
    prisma.aiFeatureCost.findUnique.mockResolvedValue({ featureKey: 'morning_briefing', creditCost: 5, restricted: true, allowedOrganizationIds: [] });
    expect((await refusal(service.run('morning_briefing', { organizationId: ORG }, request))).details.reason).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('a restricted feature runs for a listed organisation and costs its price', async () => {
    const { service, prisma, credits } = setup();
    prisma.aiFeatureCost.findUnique.mockResolvedValue({ featureKey: 'morning_briefing', creditCost: 5, restricted: true, allowedOrganizationIds: [ORG] });
    const result = await service.run('morning_briefing', { organizationId: ORG }, request);
    expect(result.creditCost).toBe(5);
    expect(credits.reserve).toHaveBeenCalledWith(ORG, 5, expect.any(Date));
  });

  it('no platform key: AI_PROVIDER_UNAVAILABLE, and nothing is reserved', async () => {
    const { service, provider, credits } = setup();
    provider.isConfigured.mockReturnValue(false);
    const e = await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
    expect(e.code).toBe('AI_PROVIDER_UNAVAILABLE');
    expect(e.getStatus()).toBe(503);
    expect(credits.reserve).not.toHaveBeenCalled();
  });

  it.each([
    ['no allocation', { allocation: 0, used: 0, periodStart: null, renewsAt: null, switchedOff: false }, 'AI_NOT_ENABLED', 'NO_ALLOWANCE'],
    ['switched off', { allocation: 20, used: 0, periodStart: PERIOD_START, renewsAt: RENEWS_AT, switchedOff: true }, 'AI_NOT_ENABLED', 'SWITCHED_OFF'],
    ['used up', { allocation: 20, used: 19, periodStart: PERIOD_START, renewsAt: RENEWS_AT, switchedOff: false }, 'AI_CREDITS_EXHAUSTED', undefined],
  ])('a refused reservation is explained: %s', async (_label, state, code, reason) => {
    const { service, credits, provider } = setup();
    credits.reserve.mockResolvedValue(null);
    credits.state.mockResolvedValue(state);
    const e = await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
    expect(e.code).toBe(code);
    expect(e.details.reason).toBe(reason);
    expect(e.getStatus()).toBe(409);
    expect(provider.complete).not.toHaveBeenCalled();
    if (code === 'AI_CREDITS_EXHAUSTED') {
      expect(e.details).toEqual({ creditCost: 2, creditsRemaining: 1, renewsAt: RENEWS_AT.toISOString() });
    }
  });

  it('a due period is renewed inline and the reservation retried once, without waiting for the job', async () => {
    const { service, credits, allocation } = setup();
    const past = new Date('2020-01-01T00:00:00Z');
    credits.reserve.mockResolvedValueOnce(null).mockResolvedValueOnce({ used: 2, allocation: 20, periodStart: PERIOD_START, renewsAt: RENEWS_AT });
    credits.state.mockResolvedValue({ allocation: 20, used: 20, periodStart: PERIOD_START, renewsAt: past, switchedOff: false });
    await service.run('task_description_drafting', { organizationId: ORG }, request);
    expect(allocation.renewIfDue).toHaveBeenCalledWith(ORG, expect.any(Date));
    expect(credits.reserve).toHaveBeenCalledTimes(2);
  });

  it('a failed call is refunded into the period it was taken from, logged at cost 0, and refused AI_PROVIDER_FAILED', async () => {
    const { service, provider, credits, prisma } = setup();
    provider.complete.mockRejectedValue(new AiProviderCallError(529, 'overloaded_error'));
    const e = await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
    expect(e.code).toBe('AI_PROVIDER_FAILED');
    expect(e.getStatus()).toBe(502);
    expect(credits.refund).toHaveBeenCalledWith(ORG, 2, PERIOD_START);
    expect(prisma.aiInteractionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ success: false, creditCost: 0, responseSummary: null }),
    });
  });

  it('a log write that fails never fails the call the organisation paid for', async () => {
    const { service, prisma } = setup();
    prisma.aiInteractionLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.run('task_description_drafting', { organizationId: ORG }, request)).resolves.toEqual(
      expect.objectContaining({ content: 'A drafted description.' }),
    );
  });

  describe('the "credits used up" notice (D10)', () => {
    it('is sent at the first AI_CREDITS_EXHAUSTED refusal of a period, claimed for that period', async () => {
      const { service, credits, notices } = setup();
      credits.reserve.mockResolvedValue(null);
      credits.state.mockResolvedValue({ allocation: 20, used: 19, periodStart: PERIOD_START, renewsAt: RENEWS_AT, switchedOff: false });
      await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
      expect(credits.claimNotice).toHaveBeenCalledWith(ORG, PERIOD_START);
      expect(notices.creditsUsedUp).toHaveBeenCalledWith(ORG, RENEWS_AT);
    });

    it('is not sent again in the same period: an unclaimed stamp sends nothing', async () => {
      const { service, credits, notices } = setup();
      credits.reserve.mockResolvedValue(null);
      credits.state.mockResolvedValue({ allocation: 20, used: 19, periodStart: PERIOD_START, renewsAt: RENEWS_AT, switchedOff: false });
      credits.claimNotice.mockResolvedValue(false);
      await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
      expect(notices.creditsUsedUp).not.toHaveBeenCalled();
    });

    it('is sent after a call that leaves less than the cheapest open feature — nothing can run any more', async () => {
      const { service, credits, notices } = setup();
      credits.reserve.mockResolvedValue({ used: 19, allocation: 20, periodStart: PERIOD_START, renewsAt: RENEWS_AT }); // 1 left < 2
      await service.run('task_description_drafting', { organizationId: ORG }, request);
      expect(notices.creditsUsedUp).toHaveBeenCalledWith(ORG, RENEWS_AT);
    });

    it('is not sent while the cheapest open feature still fits', async () => {
      const { service, credits, notices } = setup();
      credits.reserve.mockResolvedValue({ used: 18, allocation: 20, periodStart: PERIOD_START, renewsAt: RENEWS_AT }); // 2 left = cheapest
      await service.run('task_description_drafting', { organizationId: ORG }, request);
      expect(credits.claimNotice).not.toHaveBeenCalled();
      expect(notices.creditsUsedUp).not.toHaveBeenCalled();
    });

    it('a notice that fails never fails the call', async () => {
      const { service, credits, notices } = setup();
      credits.reserve.mockResolvedValue({ used: 20, allocation: 20, periodStart: PERIOD_START, renewsAt: RENEWS_AT });
      notices.creditsUsedUp.mockRejectedValue(new Error('mail down'));
      await expect(service.run('task_description_drafting', { organizationId: ORG }, request)).resolves.toEqual(
        expect.objectContaining({ content: 'A drafted description.' }),
      );
    });
  });

  it('should NOT return records belonging to a different tenant — reserves, refunds and logs only for the caller organisation', async () => {
    const { service, provider, credits, prisma } = setup();
    provider.complete.mockRejectedValueOnce(new AiProviderCallError(500, 'api_error'));
    await refusal(service.run('task_description_drafting', { organizationId: ORG }, request));
    expect(credits.reserve.mock.calls.every((c) => c[0] === ORG)).toBe(true);
    expect(credits.refund.mock.calls.every((c) => c[0] === ORG)).toBe(true);
    const orgs = prisma.aiInteractionLog.create.mock.calls.map((c) => (c[0] as { data: { organizationId: string } }).data.organizationId);
    expect(orgs).toEqual([ORG]);
    expect(JSON.stringify(credits.reserve.mock.calls)).not.toContain(OTHER_ORG);
  });
});
