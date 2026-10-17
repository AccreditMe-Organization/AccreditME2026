/**
 * ACC-236 — restores ONE organisation's used AI credits from the AI log, with an
 * audit row.
 *
 *   npm run fix:acc236-ai-credits-used -- al-nakheel             # dry run — writes nothing
 *   npm run fix:acc236-ai-credits-used -- al-nakheel --execute   # apply
 *
 * WHY. On 14 Oct, during the ACC-197 live proof, al-nakheel's `aiCreditsUsed`
 * was set to 0 by hand, with no audit row. The credits the period had spent
 * were still recorded where every charge is recorded: AiInteractionLog. Nothing
 * in the app may set the counter (AiAllocationService renews it, AiCreditService
 * reserves and refunds it), so this one-off script puts it back, and says so in
 * the organisation's own audit trail (ACC-101).
 *
 * WHAT IT COMPUTES — never a hard-coded number:
 *   - The PERIOD is the one the stored `aiCreditsPeriodStart` opens, by the ONE
 *     period rule, `creditPeriodAt()` (ai-credit-period.ts). If the stored start
 *     is not a period start by that rule, it refuses rather than guess.
 *   - USED is the sum of `creditCost` over the organisation's SUCCESSFUL calls
 *     in that period: from its start (inclusive) to its renewal (exclusive). A
 *     failed or refunded call is logged `success: false`, cost 0, so it never
 *     counts; another organisation's call is never read.
 *   - RENEWS AT is the period's renewal by the same rule.
 *
 * WHEN IT REFUSES (and writes nothing, dry run or not):
 *   - a customer organisation — only the seeded fixtures (ACC-101's guard);
 *   - no credit period yet (no allocation was ever set);
 *   - a stored period start the rule does not produce;
 *   - a period that has already ended (the hourly renewal resets it to 0 — run
 *     this BEFORE the renewal);
 *   - a total above the allocation (the gateway can never reach that).
 *
 * --execute takes the Organization row lock, computes again inside the
 * transaction, and writes both values and ONE audit row together: before,
 * after, the reason and the counts — no person, no prompt, no answer. A
 * re-run finds nothing to change and writes nothing. Run it while no AI call is
 * in flight: a call reserved but not yet logged would not be counted.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';
import { activationOf, creditPeriodAt } from '../src/foundation/ai/ai-credit-period';

const SCRIPT_NAME = 'fix-acc236-ai-credits-used';
const TICKET = 'ACC-236';
export const FIXTURE_SLUGS: ReadonlySet<string> = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const FIX_TX = { maxWait: 10_000, timeout: 60_000 } as const;
const REASON =
  "Used credits restored from the AI log after a hand reset to 0 during the ACC-197 live proof (14 Oct), which left no audit row. Live proofs never hand-write credit counters; credits used in a proof stay used.";

export interface CreditsOrg {
  id: string;
  slug: string;
  bootstrappedAt: Date | null;
  createdAt: Date;
  aiMonthlyCredits: number;
  aiCreditsUsed: number;
  aiCreditsPeriodStart: Date | null;
  aiCreditsRenewsAt: Date | null;
}

export interface CreditsFix {
  organizationId: string;
  slug: string;
  /** Why nothing may be written; null when the plan is sound. */
  refused: string | null;
  periodStart: Date | null;
  callsCounted: number;
  before: { aiCreditsUsed: number; aiCreditsRenewsAt: Date | null };
  after: { aiCreditsUsed: number; aiCreditsRenewsAt: Date | null };
  change: boolean;
}

type Client = Pick<PrismaClient, 'organization' | 'aiInteractionLog' | 'auditLog' | '$transaction'>;
type Reader = Pick<PrismaClient, 'organization' | 'aiInteractionLog'>;

const ORG_SELECT = {
  id: true,
  slug: true,
  bootstrappedAt: true,
  createdAt: true,
  aiMonthlyCredits: true,
  aiCreditsUsed: true,
  aiCreditsPeriodStart: true,
  aiCreditsRenewsAt: true,
} as const;

/** The plan for one organisation: read, compute, check. Writes nothing. */
export async function planCreditsFix(
  prisma: Reader,
  slug: string,
  options: { now?: Date; allowedSlugs?: ReadonlySet<string> } = {},
): Promise<CreditsFix | null> {
  const now = options.now ?? new Date();
  const allowed = options.allowedSlugs ?? FIXTURE_SLUGS;
  const org: CreditsOrg | null = await prisma.organization.findFirst({ where: { slug, isPlatformOrg: false }, select: ORG_SELECT });
  if (!org) return null;

  const before = { aiCreditsUsed: org.aiCreditsUsed, aiCreditsRenewsAt: org.aiCreditsRenewsAt };
  const base = { organizationId: org.id, slug: org.slug, before };
  const refuse = (refused: string, periodStart: Date | null = null): CreditsFix => ({
    ...base,
    refused,
    periodStart,
    callsCounted: 0,
    after: before,
    change: false,
  });

  if (!allowed.has(org.slug)) {
    return refuse('a customer organisation — its credits are a customer-notified correction, not a script (ACC-101)');
  }
  if (!org.aiCreditsPeriodStart) return refuse('no credit period yet: no allocation was ever set');

  const period = creditPeriodAt(activationOf(org), org.aiCreditsPeriodStart);
  if (period.start.getTime() !== org.aiCreditsPeriodStart.getTime()) {
    return refuse(
      `the stored period start ${org.aiCreditsPeriodStart.toISOString()} is not a period start by the rule (that period starts ${period.start.toISOString()})`,
      org.aiCreditsPeriodStart,
    );
  }
  if (now.getTime() >= period.renewsAt.getTime()) {
    return refuse(`the period ended at ${period.renewsAt.toISOString()}; the renewal resets used credits to 0`, period.start);
  }

  // The period's charges, by the log: successful calls only, start inclusive,
  // renewal exclusive, this organisation only. The ONE place the window is drawn.
  const calls = await prisma.aiInteractionLog.findMany({
    where: { organizationId: org.id, success: true, createdAt: { gte: period.start, lt: period.renewsAt } },
    select: { creditCost: true },
  });
  const used = calls.reduce((sum, c) => sum + (c.creditCost ?? 0), 0);
  if (used > org.aiMonthlyCredits) {
    return refuse(`the log totals ${used} credits, above the allocation of ${org.aiMonthlyCredits}`, period.start);
  }

  const after = { aiCreditsUsed: used, aiCreditsRenewsAt: period.renewsAt };
  return {
    ...base,
    refused: null,
    periodStart: period.start,
    callsCounted: calls.length,
    after,
    change: before.aiCreditsUsed !== after.aiCreditsUsed || before.aiCreditsRenewsAt?.getTime() !== after.aiCreditsRenewsAt.getTime(),
  };
}

export type RunOutcome = 'not_found' | 'refused' | 'unchanged' | 'dry_run' | 'written';

/** The script: a dry run unless `execute`; prints through `log`. */
export async function runCreditsFix(
  prisma: Client,
  slug: string,
  options: { execute?: boolean; now?: Date; allowedSlugs?: ReadonlySet<string>; log?: (line: string) => void } = {},
): Promise<{ outcome: RunOutcome; plan: CreditsFix | null }> {
  const log = options.log ?? ((line: string) => console.log(line));
  const iso = (d: Date | null) => d?.toISOString() ?? '—';
  log(`\n${options.execute ? 'EXECUTE' : 'DRY RUN'} — restoring used AI credits from the AI log (${TICKET})`);

  const plan = await planCreditsFix(prisma, slug, options);
  if (!plan) {
    log(`No tenant organisation with the slug "${slug}".`);
    return { outcome: 'not_found', plan };
  }
  log(`\n── ${plan.slug}`);
  if (plan.refused) {
    log(`  REFUSED: ${plan.refused}. Nothing written.`);
    return { outcome: 'refused', plan };
  }
  log(`  Period:            ${iso(plan.periodStart)} → ${iso(plan.after.aiCreditsRenewsAt)}`);
  log(`  Successful calls:  ${plan.callsCounted}`);
  log(`  aiCreditsUsed:     ${plan.before.aiCreditsUsed} → ${plan.after.aiCreditsUsed}`);
  log(`  aiCreditsRenewsAt: ${iso(plan.before.aiCreditsRenewsAt)} → ${iso(plan.after.aiCreditsRenewsAt)}`);
  if (!plan.change) {
    log('\nNothing to change.\n');
    return { outcome: 'unchanged', plan };
  }
  if (!options.execute) {
    log('\nDry run only — re-run with --execute to apply.\n');
    return { outcome: 'dry_run', plan };
  }

  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${plan.organizationId} FOR UPDATE`;
    const fresh = await planCreditsFix(tx, slug, options);
    if (!fresh || fresh.refused || !fresh.change) return null;
    await tx.organization.update({
      where: { id: fresh.organizationId },
      data: { aiCreditsUsed: fresh.after.aiCreditsUsed, aiCreditsRenewsAt: fresh.after.aiCreditsRenewsAt },
    });
    await tx.auditLog.create({
      data: {
        organizationId: fresh.organizationId,
        actorId: null,
        action: 'UPDATE',
        objectType: 'Organization',
        objectId: fresh.organizationId,
        before: { aiCreditsUsed: fresh.before.aiCreditsUsed, aiCreditsRenewsAt: iso(fresh.before.aiCreditsRenewsAt) },
        after: { aiCreditsUsed: fresh.after.aiCreditsUsed, aiCreditsRenewsAt: iso(fresh.after.aiCreditsRenewsAt) },
        metadata: {
          event: 'ai_credits_used_restored',
          source: SCRIPT_NAME,
          ticket: TICKET,
          reason: REASON,
          periodStart: iso(fresh.periodStart),
          callsCounted: fresh.callsCounted,
        },
      },
    });
    return fresh;
  }, FIX_TX);

  if (!written) {
    log('  The organisation changed since the dry run; nothing written. Re-run the dry run.\n');
    return { outcome: 'unchanged', plan };
  }
  log(`  ${written.slug}: aiCreditsUsed ${written.after.aiCreditsUsed}, aiCreditsRenewsAt ${iso(written.after.aiCreditsRenewsAt)}; 1 audit row.\n`);
  return { outcome: 'written', plan: written };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  if (!slug) throw new Error('Name the organisation: npm run fix:acc236-ai-credits-used -- <slug> [--execute]');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const { outcome } = await runCreditsFix(prisma, slug, { execute: args.includes('--execute') });
    if (outcome === 'not_found' || outcome === 'refused') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Run only when executed as a script, so the specs can import it.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nFix failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
