/**
 * ACC-316 PR 2 — existing committees get their organisation's defaults for the
 * two new seat actions, schedule_meeting and record_minutes. A committee
 * created after the deploy gets them from createCommittee() (the defaults are
 * on the shared committee_member_role rows, which seedSystemData() rewrites on
 * every deploy).
 *
 *   npm run backfill:acc316-seat-defaults              # dry run — writes nothing
 *   npm run backfill:acc316-seat-defaults -- --execute # apply
 *   npm run backfill:acc316-seat-defaults              # again: must report 0
 *
 * Runs AFTER PR 2 deploys. Plan: backend/Plans/step-316-meeting-management.md §6.
 *
 * WHAT IT WRITES, per non-platform organisation: for each committee with NO
 * row for a new action, that action's default rows (the seats whose default
 * attribute is true, read by seatValues() and defaultSeatActionRows(), the
 * same functions a new committee uses). A committee that already has a row for
 * the action was configured for it and is left alone. It never removes a row.
 *
 * Refuses a customer organisation with anything to write (ACC-101). ONE
 * transaction per organisation (BACKFILL_TX), which locks the committees,
 * plans again and refuses a moved plan, and ONE audit row per organisation
 * changed. Idempotent: a second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { seatValues } from '../src/foundation/committees/committee-seat-rules';
import { SEAT_ACTIONS, defaultSeatActionRows, type SeatActionKey } from '../src/foundation/committees/seat-actions';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc316-seat-defaults';
export const TICKET = 'ACC-316';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export const NEW_ACTIONS: readonly SeatActionKey[] = [SEAT_ACTIONS.SCHEDULE_MEETING, SEAT_ACTIONS.RECORD_MINUTES];

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

export interface PlannedRow {
  committeeId: string;
  roleValueId: string;
  actionKey: SeatActionKey;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  committees: number;
  rows: PlannedRow[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; committees: number; rows: number }[];
  refusedCustomers: string[];
}

type Db = Pick<PrismaService, 'committee' | 'committeeSeatAction' | '$queryRaw'>;

/** The rows to write in one organisation, read with `db` (the client, or a transaction). */
export async function planOrgRows(db: Db, organizationId: string): Promise<{ committees: number; rows: PlannedRow[] }> {
  const defaults = defaultSeatActionRows(await seatValues(db, organizationId)).filter((r) => NEW_ACTIONS.includes(r.actionKey));
  if (defaults.length === 0) return { committees: 0, rows: [] };
  const committees = await db.committee.findMany({ where: { organizationId }, select: { id: true }, orderBy: { id: 'asc' } });
  if (committees.length === 0) return { committees: 0, rows: [] };
  const existing = await db.committeeSeatAction.findMany({
    where: { organizationId, committeeId: { in: committees.map((c) => c.id) }, actionKey: { in: [...NEW_ACTIONS] } },
    select: { committeeId: true, actionKey: true },
  });
  const configured = new Set(existing.map((r) => `${r.committeeId} ${r.actionKey}`));
  const rows: PlannedRow[] = [];
  const touched = new Set<string>();
  for (const c of committees) {
    for (const d of defaults) {
      if (configured.has(`${c.id} ${d.actionKey}`)) continue;
      rows.push({ committeeId: c.id, roleValueId: d.roleValueId, actionKey: d.actionKey });
      touched.add(c.id);
    }
  }
  return { committees: touched.size, rows };
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
    plans.push({ organizationId: org.id, slug: org.slug, customer: !isFixture(org.slug), ...(await planOrgRows(prisma, org.id)) });
  }
  return plans;
}

export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.rows.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // The organisation's committees, in id order, then the plan again.
      await tx.$queryRaw`SELECT id FROM "Committee" WHERE "organizationId" = ${plan.organizationId} ORDER BY id FOR UPDATE`;
      const now = await planOrgRows(tx, plan.organizationId);
      if (JSON.stringify(now.rows) !== JSON.stringify(plan.rows)) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      await tx.committeeSeatAction.createMany({ data: plan.rows.map((r) => ({ organizationId: plan.organizationId, ...r })) });
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: plan.organizationId,
          after: { seatActionsAdded: { actions: [...NEW_ACTIONS], committees: plan.committees, rows: plan.rows.length } },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason: "Committees created before the meeting seat actions get their organisation's defaults for them.",
          },
        },
      });
      result.changed.push({ slug: plan.slug, committees: plan.committees, rows: plan.rows.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — default meeting seat actions for existing committees (${TICKET})`);
  for (const p of result.plans.filter((x) => x.rows.length > 0)) {
    console.log(`  ${p.slug.padEnd(24)} ${p.committees} committee(s), ${p.rows.length} row(s)${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  }
  const rows = result.plans.reduce((n, p) => n + p.rows.length, 0);
  const committees = result.plans.reduce((n, p) => n + p.committees, 0);
  const orgs = result.plans.filter((p) => p.rows.length > 0).length;
  console.log(`\nTotal: ${rows} row(s) on ${committees} committee(s) in ${orgs} organisation(s), of ${result.plans.length} read.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.length} customer organisation(s) — configuring a customer organisation is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.committees} committee(s), ${c.rows} row(s); 1 audit row.`);
    console.log(rows === 0 ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must report 0.\n');
  } else {
    console.log(rows === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
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

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
