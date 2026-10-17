/**
 * ACC-236 — the used-credits fix against a REAL Postgres (npm run test:db).
 *
 * What only a database proves: the AI log's period window (start inclusive,
 * renewal exclusive, successful calls only, this organisation only), the one
 * transaction that writes both values and its audit row, the refusal that
 * writes nothing, and the re-run that changes nothing.
 *
 * Like every db-spec it FAILS without a database and refuses one that is not
 * on this machine, so it can never reach the shared dev database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { runCreditsFix } from '../../../prisma/fix-acc236-ai-credits-used';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

// al-nakheel's own shape: activated 21 Sep, so monthly on the 21st.
const ACTIVATION = new Date('2026-09-21T04:39:49.741Z');
const RENEWS = new Date('2026-10-21T00:00:00.000Z');
// The wrong renewal a hand-edit could leave behind, 3 hours early.
const WRONG_RENEWS = new Date('2026-10-20T21:00:00.000Z');
const NOW = new Date('2026-10-17T12:00:00.000Z');
const ms = (d: Date, n: number) => new Date(d.getTime() + n);

describe('fix-acc236 — used AI credits restored from the AI log, against a real database', () => {
  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const quiet = () => undefined;

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  async function organisation(over: { used?: number; renewsAt?: Date; allocation?: number } = {}): Promise<{ id: string; slug: string }> {
    const slug = `acc236-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({
      data: {
        name: slug,
        slug,
        country: 'SA',
        bootstrappedAt: ACTIVATION,
        aiMonthlyCredits: over.allocation ?? 2000,
        aiCreditsUsed: over.used ?? 0,
        aiCreditsPeriodStart: ACTIVATION,
        aiCreditsRenewsAt: over.renewsAt ?? WRONG_RENEWS,
      },
      select: { id: true, slug: true },
    });
    return org;
  }

  async function call(organizationId: string, at: Date, creditCost: number, success = true): Promise<void> {
    await prisma.aiInteractionLog.create({
      data: { organizationId, model: 'test', feature: 'task_description_drafting', promptSummary: 'sizes only', durationMs: 1, success, creditCost, createdAt: at },
    });
  }

  /** The period's charges, laid across both of its edges. Counted: 5 + 15 + 2 + 3 = 25. */
  async function periodOfCalls(organizationId: string): Promise<void> {
    await call(organizationId, ACTIVATION, 5); // exactly at the start: counted
    await call(organizationId, ms(ACTIVATION, -1), 100); // 1 ms before the start: not
    await call(organizationId, new Date('2026-10-12T18:57:54.778Z'), 15);
    await call(organizationId, new Date('2026-10-13T09:00:00.000Z'), 2);
    await call(organizationId, new Date('2026-10-13T10:00:00.000Z'), 0, false); // refunded: not
    await call(organizationId, new Date('2026-10-13T11:00:00.000Z'), 7, false); // a failure, whatever its cost: not
    await call(organizationId, ms(RENEWS, -1), 3); // 1 ms before the renewal: counted
    await call(organizationId, RENEWS, 50); // exactly at the renewal: the next period's
  }

  const counters = (id: string) =>
    prisma.organization.findFirstOrThrow({ where: { id }, select: { aiCreditsUsed: true, aiCreditsRenewsAt: true } });
  const audits = (id: string) =>
    prisma.auditLog.findMany({ where: { organizationId: id, objectType: 'Organization', objectId: id }, orderBy: { createdAt: 'asc' } });

  it('the dry run computes from the log — the window, successes only, this organisation only — and writes nothing', async () => {
    const org = await organisation();
    const other = await organisation();
    await periodOfCalls(org.id);
    await call(other.id, new Date('2026-10-13T09:00:00.000Z'), 40); // another organisation's charge

    const { outcome, plan } = await runCreditsFix(prisma, org.slug, { now: NOW, allowedSlugs: new Set([org.slug]), log: quiet });

    expect(outcome).toBe('dry_run');
    expect(plan!.callsCounted).toBe(4);
    expect(plan!.after.aiCreditsUsed).toBe(25);
    expect(plan!.after.aiCreditsRenewsAt!.toISOString()).toBe(RENEWS.toISOString());
    expect(plan!.before).toEqual({ aiCreditsUsed: 0, aiCreditsRenewsAt: WRONG_RENEWS });
    expect(await counters(org.id)).toEqual({ aiCreditsUsed: 0, aiCreditsRenewsAt: WRONG_RENEWS });
    expect(await audits(org.id)).toEqual([]);
  });

  it('--execute writes both values and ONE audit row together: before, after, the reason — no person', async () => {
    const org = await organisation();
    await periodOfCalls(org.id);

    const { outcome } = await runCreditsFix(prisma, org.slug, { execute: true, now: NOW, allowedSlugs: new Set([org.slug]), log: quiet });

    expect(outcome).toBe('written');
    expect(await counters(org.id)).toEqual({ aiCreditsUsed: 25, aiCreditsRenewsAt: RENEWS });
    const rows = await audits(org.id);
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.action).toBe('UPDATE');
    expect(row.actorId).toBeNull();
    expect(row.before).toEqual({ aiCreditsUsed: 0, aiCreditsRenewsAt: WRONG_RENEWS.toISOString() });
    expect(row.after).toEqual({ aiCreditsUsed: 25, aiCreditsRenewsAt: RENEWS.toISOString() });
    const metadata = row.metadata as Record<string, unknown>;
    expect(Object.keys(metadata).sort()).toEqual(['callsCounted', 'event', 'periodStart', 'reason', 'source', 'ticket']);
    expect(metadata['event']).toBe('ai_credits_used_restored');
    expect(metadata['ticket']).toBe('ACC-236');
    expect(metadata['callsCounted']).toBe(4);
    expect(metadata['periodStart']).toBe(ACTIVATION.toISOString());
    expect(String(metadata['reason'])).toContain('AI log');
    // No personal data: nothing but counts, dates and the fixed reason.
    expect(JSON.stringify([row.before, row.after, row.metadata])).not.toMatch(/@|actor|userId|name/i);
  });

  it('a re-run is a no-op: nothing to change, no second audit row', async () => {
    const org = await organisation();
    await periodOfCalls(org.id);
    const options = { execute: true, now: NOW, allowedSlugs: new Set([org.slug]), log: quiet };
    expect((await runCreditsFix(prisma, org.slug, options)).outcome).toBe('written');

    const again = await runCreditsFix(prisma, org.slug, options);

    expect(again.outcome).toBe('unchanged');
    expect(again.plan!.change).toBe(false);
    expect(await counters(org.id)).toEqual({ aiCreditsUsed: 25, aiCreditsRenewsAt: RENEWS });
    expect((await audits(org.id)).length).toBe(1);
  });

  it('a customer organisation is refused, with --execute too: nothing written, no audit row', async () => {
    const org = await organisation();
    await periodOfCalls(org.id);

    // The default allowed list is the two seeded fixtures; this organisation is not one.
    const { outcome, plan } = await runCreditsFix(prisma, org.slug, { execute: true, now: NOW, log: quiet });

    expect(outcome).toBe('refused');
    expect(plan!.refused).toContain('customer organisation');
    expect(await counters(org.id)).toEqual({ aiCreditsUsed: 0, aiCreditsRenewsAt: WRONG_RENEWS });
    expect(await audits(org.id)).toEqual([]);
  });

  it('after the renewal it refuses: the period has ended, and the renewal resets used to 0', async () => {
    const org = await organisation();
    await periodOfCalls(org.id);

    const { outcome, plan } = await runCreditsFix(prisma, org.slug, { execute: true, now: RENEWS, allowedSlugs: new Set([org.slug]), log: quiet });

    expect(outcome).toBe('refused');
    expect(plan!.refused).toContain('the period ended');
    expect(await counters(org.id)).toEqual({ aiCreditsUsed: 0, aiCreditsRenewsAt: WRONG_RENEWS });
  });
});
