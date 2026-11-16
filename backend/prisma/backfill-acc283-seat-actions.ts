/**
 * ACC-283 PR 1 — committees that existed before seat actions get their
 * organisation's defaults. A committee created after the deploy has them from
 * createCommittee(). Plan: backend/Plans/step-283-change-request-chain.md §2.
 *
 *   npm run backfill:acc283-seat-actions              # dry run — writes nothing
 *   npm run backfill:acc283-seat-actions -- --execute # apply
 *   npm run backfill:acc283-seat-actions              # again: must report 0
 *
 * Runs AFTER PR 1 deploys (the table must exist, and the seat defaults are the
 * deployed seed's). Nothing decides by seat actions until PR 2, so until it
 * runs nothing a person sees changes.
 *
 * WHAT IT WRITES, per non-platform organisation: for each committee with NO
 * seat-action rows, the organisation's defaults — copyDefaultSeatActions(),
 * the same function a new committee uses, so the two cannot differ. A committee
 * that already has rows (any rows) is left alone. An organisation whose
 * defaults are all unticked writes nothing.
 *
 * Refuses a customer organisation (this is tenant configuration written by the
 * vendor: CLAUDE.md, ACC-101). One transaction per organisation (BACKFILL_TX),
 * which locks the committees, plans again and refuses a moved plan, and ONE
 * audit row per committee written, in that organisation's trail. Idempotent: a
 * second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { seatValues } from '../src/foundation/committees/committee-seat-rules';
import { copyDefaultSeatActions, defaultSeatActionRows, seatActionMap } from '../src/foundation/committees/seat-actions';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc283-seat-actions';
export const TICKET = 'ACC-283';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

type Db = Pick<PrismaService, 'committee' | '$queryRaw'>;

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  /** Committees with no seat-action rows, by id. */
  committeeIds: string[];
  /** How many rows each of them gets (the organisation's defaults). */
  rowsPerCommittee: number;
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; committees: number; rows: number }[];
  refusedCustomers: string[];
}

/** The committees with no rows, read with `db` (the client, or a transaction). */
export async function committeesWithoutSeatActions(db: Db, organizationId: string): Promise<string[]> {
  const rows = await db.committee.findMany({
    where: { organizationId, seatActions: { none: {} } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => r.id);
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: readonly string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<OrgPlan[]> {
  const orgs = await prisma.organization.findMany({
    where: { isPlatformOrg: false, ...(organizationIds && { id: { in: [...organizationIds] } }) },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });
  const plans: OrgPlan[] = [];
  for (const org of orgs) {
    const [committeeIds, seats] = await Promise.all([committeesWithoutSeatActions(prisma, org.id), seatValues(prisma, org.id)]);
    plans.push({
      organizationId: org.id,
      slug: org.slug,
      customer: !isFixture(org.slug),
      committeeIds,
      rowsPerCommittee: defaultSeatActionRows(seats).length,
    });
  }
  return plans;
}

/**
 * The whole run, minus the printing. `organizationIds` narrows it and
 * `isFixture` stands in for the fixture list: the spec seeds only its own
 * organisations, which the real guard would rightly call customers.
 */
export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.committeeIds.length > 0 && p.rowsPerCommittee > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // The committees' rows first, in id order, then the plan again: refuse
      // rather than act on a stale plan (a committee created or edited since).
      await tx.$queryRaw`SELECT id FROM "Committee" WHERE "organizationId" = ${plan.organizationId} AND id = ANY(${plan.committeeIds}::text[]) ORDER BY id FOR UPDATE`;
      const now = await committeesWithoutSeatActions(tx, plan.organizationId);
      if (JSON.stringify(now) !== JSON.stringify(plan.committeeIds)) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      let rows = 0;
      for (const committeeId of plan.committeeIds) {
        const written = await copyDefaultSeatActions(tx, plan.organizationId, committeeId);
        rows += written.length;
        await tx.auditLog.create({
          data: {
            organizationId: plan.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'Committee',
            objectId: committeeId,
            before: { seatActions: {} },
            after: { seatActions: seatActionMap(written) },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason: "A committee created before seat actions existed gets its organisation's default seat actions.",
            },
          },
        });
      }
      result.changed.push({ slug: plan.slug, committees: plan.committeeIds.length, rows });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — default seat actions for existing committees (${TICKET})`);
  for (const p of result.plans) {
    console.log(
      `  ${p.slug.padEnd(24)} ${p.committeeIds.length} committee(s) with no seat actions, ${p.rowsPerCommittee} default row(s) each` +
        `${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`,
    );
  }
  const total = result.plans.reduce((n, p) => n + (p.rowsPerCommittee > 0 ? p.committeeIds.length : 0), 0);
  console.log(`\nTotal: ${total} committee(s) to fill.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — configuring a customer organisation is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.committees} committee(s), ${c.rows} row(s); ${c.committees} audit row(s).`);
    console.log(total === 0 ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must report 0.\n');
  } else {
    console.log(total === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const result = await runBackfill(prisma, { execute: process.argv.includes('--execute') });
    report(result);
    if (result.refusedCustomers.length > 0) process.exitCode = 1;
  } finally {
    await prisma.onModuleDestroy();
  }
}

// Run only when executed as a script, so the spec can import it.
if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
