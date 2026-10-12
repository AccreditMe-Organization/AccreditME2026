/**
 * ACC-194 — the AI credit statements against a REAL Postgres (npm run test:db).
 *
 * The unit specs assert the SQL's shape; only a database can prove what the
 * shape is for: that concurrent calls cannot overspend, that the settings
 * writers' whole-JSON read-modify-write cannot erase a deduction, that renewal
 * cannot double-run, and that a plan change and a renewal cannot interleave.
 *
 * It FAILS, never skips, without a database: a spec that quietly skips is a
 * vacuous pass (ACC-120). It also refuses any database that is not on this
 * machine — CI's ephemeral Postgres is on localhost, and so is a local
 * throwaway — so it can never write to the shared dev database.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { AiCreditService } from './ai-credit.service';
import { AiAllocationService } from './ai-allocation.service';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const ACTIVATION = new Date('2026-09-21T04:39:49.741Z');
const IN_PERIOD = new Date('2026-10-12T13:00:00Z');
const AFTER_RENEWAL = new Date('2026-10-25T00:00:00Z');

describe('AI credits against a real database (ACC-194)', () => {
  const prisma = new PrismaService();
  const credits = new AiCreditService(prisma);
  const allocation = new AiAllocationService(prisma, new AuditLogService(prisma));

  async function organisation(): Promise<string> {
    const slug = `acc194-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({
      data: { name: slug, slug, country: 'SA', bootstrappedAt: ACTIVATION, settings: { taskSla: { keep: true } } },
    });
    return org.id;
  }

  async function used(id: string): Promise<number> {
    return (await prisma.organization.findFirstOrThrow({ where: { id }, select: { aiCreditsUsed: true } })).aiCreditsUsed;
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('concurrent reservations never overspend: 50 calls of 3 against 100 → exactly 33 succeed, 99 used', async () => {
    const id = await organisation();
    await allocation.setAllocation(id, 100, 'manual', undefined, IN_PERIOD);

    const results = await Promise.all(Array.from({ length: 50 }, () => credits.reserve(id, 3, IN_PERIOD)));

    expect(results.filter((r) => r !== null)).toHaveLength(33);
    expect(await used(id)).toBe(99);
  });

  it("a settings writer's stale whole-JSON write-back cannot erase a deduction", async () => {
    const id = await organisation();
    await allocation.setAllocation(id, 100, 'manual', undefined, IN_PERIOD);

    // Every writer reads settings BEFORE the deductions, as updateTenantModules does…
    const stale = await Promise.all(
      Array.from({ length: 5 }, () => prisma.organization.findFirstOrThrow({ where: { id }, select: { settings: true } })),
    );
    const reservations = Promise.all(Array.from({ length: 20 }, () => credits.reserve(id, 2, IN_PERIOD)));
    // …and writes its stale copy back while and after they run.
    const writers = Promise.all(
      stale.map((s, i) =>
        prisma.organization.update({
          where: { id },
          data: { settings: { ...(s.settings as Record<string, unknown>), modules: { [`m${i}`]: true } } },
        }),
      ),
    );
    const [made] = await Promise.all([reservations, writers]);

    const succeeded = made.filter((r) => r !== null).length;
    expect(succeeded).toBe(20);
    expect(await used(id)).toBe(succeeded * 2);
  });

  it('renewal cannot double-run: two concurrent renewIfDue → one renewal, one no-op', async () => {
    const id = await organisation();
    await allocation.setAllocation(id, 20, 'manual', undefined, IN_PERIOD);
    await credits.reserve(id, 15, IN_PERIOD);

    const outcomes = await Promise.all([allocation.renewIfDue(id, AFTER_RENEWAL), allocation.renewIfDue(id, AFTER_RENEWAL)]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const org = await prisma.organization.findFirstOrThrow({ where: { id } });
    expect(org.aiCreditsUsed).toBe(0);
    expect(org.aiCreditsPeriodStart?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(org.aiCreditsRenewsAt?.toISOString()).toBe('2026-11-21T00:00:00.000Z');
    const renewals = await prisma.auditLog.count({ where: { organizationId: id, metadata: { path: ['event'], equals: 'ai_credits_renewed' } } });
    expect(renewals).toBe(1);
  });

  it('a refund is keyed by its period: refunding after the period renewed changes nothing', async () => {
    const id = await organisation();
    await allocation.setAllocation(id, 20, 'manual', undefined, IN_PERIOD);
    const reserved = await credits.reserve(id, 15, IN_PERIOD);
    expect(reserved).not.toBeNull();
    await allocation.renewIfDue(id, AFTER_RENEWAL);
    await credits.reserve(id, 2, AFTER_RENEWAL);

    expect(await credits.refund(id, 15, reserved!.periodStart)).toBe(false);
    expect(await used(id)).toBe(2);
    // …while a refund in the same period does give the credits back.
    const fresh = await credits.reserve(id, 3, AFTER_RENEWAL);
    expect(await credits.refund(id, 3, fresh!.periodStart)).toBe(true);
    expect(await used(id)).toBe(2);
  });

  it('a plan change and a renewal do not interleave: either order ends at the same state, renewed once', async () => {
    const id = await organisation();
    await allocation.setAllocation(id, 100, 'plan', undefined, IN_PERIOD);
    await allocation.setAllocation(id, 40, 'plan', undefined, IN_PERIOD); // a cut, pending
    await credits.reserve(id, 90, IN_PERIOD);

    await Promise.all([allocation.renewIfDue(id, AFTER_RENEWAL), allocation.setAllocation(id, 60, 'plan', undefined, AFTER_RENEWAL)]);

    const org = await prisma.organization.findFirstOrThrow({ where: { id } });
    expect(org.aiMonthlyCredits).toBe(60);
    expect(org.aiPendingMonthlyCredits).toBeNull();
    expect(org.aiCreditsUsed).toBe(0);
    expect(org.aiCreditsPeriodStart?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    const renewals = await prisma.auditLog.count({ where: { organizationId: id, metadata: { path: ['event'], equals: 'ai_credits_renewed' } } });
    expect(renewals).toBe(1);
  });

  it('a switched-off organisation reserves nothing, and an organisation with no allocation reserves nothing', async () => {
    const off = await organisation();
    await allocation.setAllocation(off, 20, 'manual', undefined, IN_PERIOD);
    await prisma.organization.update({ where: { id: off }, data: { settings: { ai: { enabled: false } } } });
    expect(await credits.reserve(off, 2, IN_PERIOD)).toBeNull();
    expect(await used(off)).toBe(0);

    const none = await organisation();
    expect(await credits.reserve(none, 0, IN_PERIOD)).toBeNull();
  });

  it('should NOT return records belonging to a different tenant — reserving and refunding for A never touches B', async () => {
    const a = await organisation();
    const b = await organisation();
    await allocation.setAllocation(a, 20, 'manual', undefined, IN_PERIOD);
    await allocation.setAllocation(b, 20, 'manual', undefined, IN_PERIOD);

    const reserved = await credits.reserve(a, 5, IN_PERIOD);
    expect(await used(a)).toBe(5);
    expect(await used(b)).toBe(0);
    await credits.refund(a, 5, reserved!.periodStart);
    expect(await used(b)).toBe(0);
  });
});
