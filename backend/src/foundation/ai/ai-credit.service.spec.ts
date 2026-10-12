import { AiCreditService, aiSwitchedOff } from './ai-credit.service';
import { PrismaService } from '../../prisma/prisma.service';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function setup() {
  const prisma = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    organization: { findFirst: jest.fn(), updateMany: jest.fn() },
  };
  return { prisma, service: new AiCreditService(prisma as unknown as PrismaService) };
}

const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('$');

/*
 * The SQL's behaviour under concurrency is proved against a real Postgres in
 * ai-credit.db-spec.ts (npm run test:db). These assert its shape and wiring.
 */
describe('AiCreditService (ACC-194)', () => {
  it('reserve is ONE conditional UPDATE that refuses no allowance, switched off, a due period and too few credits', async () => {
    const { service, prisma } = setup();
    const periodStart = new Date('2026-09-21T04:39:49Z');
    const renewsAt = new Date('2026-10-21T00:00:00Z');
    prisma.$queryRaw.mockResolvedValue([{ aiCreditsUsed: 2, aiMonthlyCredits: 20, aiCreditsPeriodStart: periodStart, aiCreditsRenewsAt: renewsAt }]);
    const now = new Date('2026-10-12T00:00:00Z');
    expect(await service.reserve(ORG, 2, now)).toEqual({ used: 2, allocation: 20, periodStart, renewsAt });

    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    const sql = sqlOf(call);
    expect(sql).toMatch(/^\s*UPDATE "Organization"/);
    expect(sql).toContain('"aiMonthlyCredits" > 0');
    expect(sql).toContain(`("settings" -> 'ai' -> 'enabled') = 'false'::jsonb`);
    expect(sql).toContain('"aiCreditsRenewsAt" >');
    expect(sql).toContain('"aiCreditsUsed" + $::int <= "aiMonthlyCredits"');
    expect(sql).toContain('RETURNING');
    expect(call.slice(1)).toEqual([2, ORG, now, 2]);
  });

  it('reserve answers null when the statement changed no row', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await service.reserve(ORG, 15)).toBeNull();
  });

  it('refund is keyed by the period the credits came from, and never goes below 0', async () => {
    const { service, prisma } = setup();
    prisma.$executeRaw.mockResolvedValue(1);
    const periodStart = new Date('2026-09-21T04:39:49Z');
    expect(await service.refund(ORG, 15, periodStart)).toBe(true);
    const call = prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(sqlOf(call)).toContain('GREATEST("aiCreditsUsed" - $::int, 0)');
    expect(sqlOf(call)).toContain('"aiCreditsPeriodStart" = $');
    expect(call.slice(1)).toEqual([15, ORG, periodStart]);
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await service.refund(ORG, 15, periodStart)).toBe(false);
  });

  it('claimNotice moves the stamp to this period, and only that call is told to send', async () => {
    const { service, prisma } = setup();
    const periodStart = new Date('2026-09-21T04:39:49Z');
    prisma.organization.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await service.claimNotice(ORG, periodStart)).toBe(true);
    expect(await service.claimNotice(ORG, periodStart)).toBe(false);
    expect(prisma.organization.updateMany).toHaveBeenCalledWith({
      where: { id: ORG, OR: [{ aiCreditsNoticeFor: null }, { aiCreditsNoticeFor: { not: periodStart } }] },
      data: { aiCreditsNoticeFor: periodStart },
    });
  });

  it('state reads the columns and the switch', async () => {
    const { service, prisma } = setup();
    prisma.organization.findFirst.mockResolvedValue({
      aiMonthlyCredits: 20,
      aiCreditsUsed: 19,
      aiCreditsPeriodStart: null,
      aiCreditsRenewsAt: null,
      settings: { ai: { enabled: false } },
    });
    expect(await service.state(ORG)).toEqual({ allocation: 20, used: 19, periodStart: null, renewsAt: null, switchedOff: true });
  });

  it('should NOT return records belonging to a different tenant — every statement names only the caller organisation', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.organization.findFirst.mockResolvedValue(null);
    prisma.organization.updateMany.mockResolvedValue({ count: 0 });
    await service.reserve(ORG, 2);
    await service.refund(ORG, 2, new Date());
    await service.state(ORG);
    await service.claimNotice(ORG, new Date());
    expect((prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1)).toContain(ORG);
    expect((prisma.$queryRaw.mock.calls[0] as unknown[]).slice(1)).not.toContain(OTHER_ORG);
    expect((prisma.$executeRaw.mock.calls[0] as unknown[]).slice(1)).toContain(ORG);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ORG } }));
    expect(prisma.organization.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: ORG }) }));
  });
});

describe('aiSwitchedOff (D13)', () => {
  it('only an explicit false switches AI off', () => {
    expect(aiSwitchedOff(null)).toBe(false);
    expect(aiSwitchedOff({})).toBe(false);
    expect(aiSwitchedOff({ ai: {} })).toBe(false);
    expect(aiSwitchedOff({ ai: { enabled: true } })).toBe(false);
    expect(aiSwitchedOff({ ai: { enabled: 'false' } })).toBe(false);
    expect(aiSwitchedOff({ ai: { enabled: false } })).toBe(true);
  });
});
