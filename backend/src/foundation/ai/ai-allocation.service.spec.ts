import { AiAllocationService } from './ai-allocation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ACTIVATION = new Date('2026-09-21T04:39:49.741Z'); // monthly on the 21st
const NOW = new Date('2026-10-12T13:00:00Z');

interface Row {
  id: string;
  aiMonthlyCredits: number;
  aiPendingMonthlyCredits: number | null;
  aiCreditsUsed: number;
  aiCreditsPeriodStart: Date | null;
  aiCreditsRenewsAt: Date | null;
  bootstrappedAt: Date | null;
  createdAt: Date;
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: ORG,
    aiMonthlyCredits: 0,
    aiPendingMonthlyCredits: null,
    aiCreditsUsed: 0,
    aiCreditsPeriodStart: null,
    aiCreditsRenewsAt: null,
    bootstrappedAt: ACTIVATION,
    createdAt: new Date('2026-09-21T04:38:14Z'),
    ...overrides,
  };
}

function setup(current: Row) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    organization: {
      findFirstOrThrow: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    organization: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const auditLog = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new AiAllocationService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);
  const written = (): Record<string, unknown> =>
    (tx.organization.update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined)?.data ?? {};
  return { service, tx, prisma, auditLog, written };
}

describe('AiAllocationService.setAllocation (ACC-194, D3/D15)', () => {
  it('a first allocation sets up the period the organisation is in now, anchored to activation', async () => {
    const { service, written } = setup(row());
    const outcome = await service.setAllocation(ORG, 20, 'manual', 'admin-1', NOW);
    expect(outcome).toEqual({ allocation: 20, pendingAllocation: null, takesEffect: 'now', renewed: false });
    expect(written()).toEqual({
      aiMonthlyCredits: 20,
      aiPendingMonthlyCredits: null,
      aiCreditsUsed: 0,
      aiCreditsPeriodStart: ACTIVATION,
      aiCreditsRenewsAt: new Date('2026-10-21T00:00:00.000Z'),
    });
  });

  it('takes the row lock before reading, inside the transaction', async () => {
    const { service, tx } = setup(row());
    await service.setAllocation(ORG, 20, 'plan', undefined, NOW);
    const sql = (tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(ORG);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.organization.findFirstOrThrow.mock.invocationCallOrder[0] ?? 0);
  });

  it('a raise applies now: the difference is available at once, used is kept, a waiting cut is cleared', async () => {
    const period = { aiCreditsPeriodStart: ACTIVATION, aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z') };
    const { service, written } = setup(row({ ...period, aiMonthlyCredits: 100, aiCreditsUsed: 60, aiPendingMonthlyCredits: 50 }));
    const outcome = await service.setAllocation(ORG, 300, 'plan', undefined, NOW);
    expect(outcome.takesEffect).toBe('now');
    expect(written()).toEqual(expect.objectContaining({ aiMonthlyCredits: 300, aiPendingMonthlyCredits: null, aiCreditsUsed: 60 }));
  });

  it('a cut waits for the next renewal: the current allocation stays and the new value is pending', async () => {
    const period = { aiCreditsPeriodStart: ACTIVATION, aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z') };
    const { service, written, auditLog } = setup(row({ ...period, aiMonthlyCredits: 300, aiCreditsUsed: 10 }));
    const outcome = await service.setAllocation(ORG, 100, 'manual', 'admin-1', NOW);
    expect(outcome).toEqual({ allocation: 300, pendingAllocation: 100, takesEffect: 'next_renewal', renewed: false });
    expect(written()).toEqual(expect.objectContaining({ aiMonthlyCredits: 300, aiPendingMonthlyCredits: 100, aiCreditsUsed: 10 }));
    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: ORG,
        actorId: 'admin-1',
        metadata: expect.objectContaining({ event: 'ai_allocation_changed', source: 'manual', takesEffect: 'next_renewal' }),
      }),
    );
  });

  it('a plan replaces a manual value with the same timing — no "custom" flag survives it', async () => {
    const period = { aiCreditsPeriodStart: ACTIVATION, aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z') };
    const { service, written } = setup(row({ ...period, aiMonthlyCredits: 500 }));
    await service.setAllocation(ORG, 200, 'plan', undefined, NOW);
    expect(written()).toEqual(expect.objectContaining({ aiMonthlyCredits: 500, aiPendingMonthlyCredits: 200 }));
  });

  it('an allocation of 0 on an organisation with none sets up no period', async () => {
    const { service, written } = setup(row());
    await service.setAllocation(ORG, 0, 'plan', undefined, NOW);
    expect(written()).toEqual(expect.objectContaining({ aiMonthlyCredits: 0, aiCreditsPeriodStart: null, aiCreditsRenewsAt: null }));
  });

  it('a due period is renewed first, under the same lock, and the change applies to the renewed period', async () => {
    const due = { aiCreditsPeriodStart: ACTIVATION, aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z') };
    const { service, written } = setup(row({ ...due, aiMonthlyCredits: 100, aiPendingMonthlyCredits: 40, aiCreditsUsed: 90 }));
    const later = new Date('2026-10-25T00:00:00Z');
    const outcome = await service.setAllocation(ORG, 60, 'plan', undefined, later);
    // Renewal applied the waiting 40, then 60 ≥ 40 is a raise.
    expect(outcome).toEqual({ allocation: 60, pendingAllocation: null, takesEffect: 'now', renewed: true });
    expect(written()).toEqual({
      aiMonthlyCredits: 60,
      aiPendingMonthlyCredits: null,
      aiCreditsUsed: 0,
      aiCreditsPeriodStart: new Date('2026-10-21T00:00:00.000Z'),
      aiCreditsRenewsAt: new Date('2026-11-21T00:00:00.000Z'),
    });
  });

  it('should NOT return records belonging to a different tenant — locks, reads and writes only the named organisation', async () => {
    const { service, tx } = setup(row());
    await service.setAllocation(ORG, 20, 'manual', undefined, NOW);
    expect(tx.$queryRaw.mock.calls[0]).not.toContain(OTHER_ORG);
    expect(tx.organization.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORG } }));
    expect(tx.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORG } }));
  });
});

describe('AiAllocationService.renewIfDue (ACC-194, D2)', () => {
  const due = { aiCreditsPeriodStart: ACTIVATION, aiCreditsRenewsAt: new Date('2026-10-21T00:00:00Z') };

  it('does nothing when the renewal time has not passed', async () => {
    const { service, tx, auditLog } = setup(row({ ...due, aiMonthlyCredits: 20, aiCreditsUsed: 5 }));
    expect(await service.renewIfDue(ORG, NOW)).toBe(false);
    expect(tx.organization.update).not.toHaveBeenCalled();
    expect(auditLog.log).not.toHaveBeenCalled();
  });

  it('does nothing for an organisation with no period', async () => {
    const { service, tx } = setup(row());
    expect(await service.renewIfDue(ORG, NOW)).toBe(false);
    expect(tx.organization.update).not.toHaveBeenCalled();
  });

  it('restores the allocation, applies a waiting cut and moves to the period containing now', async () => {
    const { service, written, auditLog } = setup(row({ ...due, aiMonthlyCredits: 300, aiPendingMonthlyCredits: 100, aiCreditsUsed: 250 }));
    expect(await service.renewIfDue(ORG, new Date('2026-10-21T00:00:00Z'))).toBe(true);
    expect(written()).toEqual({
      aiCreditsUsed: 0,
      aiMonthlyCredits: 100,
      aiPendingMonthlyCredits: null,
      aiCreditsPeriodStart: new Date('2026-10-21T00:00:00.000Z'),
      aiCreditsRenewsAt: new Date('2026-11-21T00:00:00.000Z'),
    });
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: ORG, metadata: { event: 'ai_credits_renewed' } }));
  });

  it('a missed renewal catches up with one refill, straight to the current period', async () => {
    const { service, written } = setup(row({ ...due, aiMonthlyCredits: 20, aiCreditsUsed: 20 }));
    await service.renewIfDue(ORG, new Date('2027-03-02T00:00:00Z'));
    expect(written()).toEqual(
      expect.objectContaining({
        aiCreditsUsed: 0,
        aiCreditsPeriodStart: new Date('2027-02-21T00:00:00.000Z'),
        aiCreditsRenewsAt: new Date('2027-03-21T00:00:00.000Z'),
      }),
    );
  });
});

describe('AiAllocationService.renewDue', () => {
  it('renews every due organisation and reports one failure without stopping the rest', async () => {
    const { service, prisma } = setup(row());
    prisma.organization.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const spy = jest
      .spyOn(service, 'renewIfDue')
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const now = new Date('2026-10-21T01:00:00Z');
    expect(await service.renewDue(now)).toEqual({ renewed: 2, failed: ['b'] });
    expect(prisma.organization.findMany).toHaveBeenCalledWith({ where: { aiCreditsRenewsAt: { lte: now } }, select: { id: true } });
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
