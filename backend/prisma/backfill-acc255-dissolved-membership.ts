/**
 * ACC-255 PR 2 — a dissolved committee's members can't be changed (Ahmad, Q-A).
 * The seed's Dissolved stage no longer allows add_member, remove_member or
 * change_member_role; this brings existing organisations into line. Plan:
 * backend/Plans/step-255-workflow-stage-rules.md §16.2.
 *
 *   npm run backfill:acc255-dissolved-membership              # dry run — writes nothing
 *   npm run backfill:acc255-dissolved-membership -- --execute # apply
 *   npm run backfill:acc255-dissolved-membership              # again: must report 0
 *
 * Runs AFTER PR 2 deploys. Before that the rules decide nothing, so the order
 * only matters for when the refusal starts.
 *
 * WHAT IT CHANGES, per non-platform organisation: on each COMMITTEE stage keyed
 * `dissolved`, the three member action rows are removed — but only where the
 * stage's action rows are EXACTLY the three PR 1 seeded. A Dissolved stage a
 * tenant has configured since (any other set) is left as it is and reported.
 * Its flags are not touched. The platform organisation is never in scope.
 *
 * A REVOCATION BACKFILL IS PERMITTED ONLY WHILE NO CUSTOMER TENANT EXISTS
 * (CLAUDE.md, ACC-101): --execute refuses if a customer organisation would
 * change. One transaction per organisation (BACKFILL_TX), which plans again
 * and refuses a moved plan, and ONE audit row per organisation in its own
 * trail. Idempotent: a second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { COMMITTEE_ACTIONS } from '../src/foundation/workflow/record-registry';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc255-dissolved-membership';
export const TICKET = 'ACC-255';
const DISSOLVED_STAGE_KEY = 'dissolved';
/** What PR 1 seeded on Dissolved, and what this removes. */
export const MEMBER_ACTIONS: readonly string[] = [
  COMMITTEE_ACTIONS.ADD_MEMBER,
  COMMITTEE_ACTIONS.REMOVE_MEMBER,
  COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE,
];
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

type Db = Pick<PrismaService, 'workflowStage'>;

export interface StagePlan {
  stageId: string;
  templateId: string;
  nameEn: string;
  actions: string[];
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  /** Dissolved stages still holding exactly PR 1's three member actions. */
  toChange: StagePlan[];
  /** Dissolved stages a tenant has configured otherwise: left alone. */
  skipped: StagePlan[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; stages: number }[];
  refusedCustomers: string[];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((k) => b.includes(k));

/** One organisation's Dissolved stages, read with `db` (the client, or a transaction). */
export async function planOrganization(db: Db, organizationId: string): Promise<Pick<OrgPlan, 'toChange' | 'skipped'>> {
  const stages = await db.workflowStage.findMany({
    where: { key: DISSOLVED_STAGE_KEY, workflowTemplate: { organizationId, objectType: 'COMMITTEE' } },
    select: {
      id: true,
      workflowTemplateId: true,
      nameEn: true,
      recordActions: { where: { organizationId }, select: { actionKey: true } },
    },
    orderBy: { id: 'asc' },
  });
  const toChange: StagePlan[] = [];
  const skipped: StagePlan[] = [];
  for (const s of stages) {
    const plan = { stageId: s.id, templateId: s.workflowTemplateId, nameEn: s.nameEn, actions: s.recordActions.map((r) => r.actionKey).sort() };
    (sameSet(plan.actions, MEMBER_ACTIONS) ? toChange : skipped).push(plan);
  }
  return { toChange, skipped };
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
    plans.push({ organizationId: org.id, slug: org.slug, customer: !isFixture(org.slug), ...(await planOrganization(prisma, org.id)) });
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
  const work = plans.filter((p) => p.toChange.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // Again, inside the transaction: refuse rather than act on a stale plan.
      const now = await planOrganization(tx, plan.organizationId);
      if (JSON.stringify(now.toChange.map((s) => s.stageId)) !== JSON.stringify(plan.toChange.map((s) => s.stageId))) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      for (const stage of plan.toChange) {
        const { count } = await tx.workflowStageRecordAction.deleteMany({
          where: { organizationId: plan.organizationId, stageId: stage.stageId, actionKey: { in: [...MEMBER_ACTIONS] } },
        });
        if (count !== MEMBER_ACTIONS.length) {
          throw new Error(`${plan.slug}: expected to remove ${MEMBER_ACTIONS.length} action rows from stage ${stage.stageId}, removed ${count}.`);
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'WorkflowTemplate',
          objectId: plan.toChange[0]!.templateId,
          before: { stages: plan.toChange.map((s) => ({ stageId: s.stageId, actions: s.actions })) },
          after: { stages: plan.toChange.map((s) => ({ stageId: s.stageId, actions: [] })) },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason: "A dissolved committee's members can't be changed (Ahmad, Q-A): the Dissolved stage no longer allows adding, removing or changing the role of a member.",
            removed: [...MEMBER_ACTIONS],
            stagesChanged: plan.toChange.length,
          },
        },
      });
      result.changed.push({ slug: plan.slug, stages: plan.toChange.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — Dissolved stops member changes (${TICKET})`);
  for (const p of result.plans) {
    console.log(
      `  ${p.slug.padEnd(24)} ${p.toChange.length} Dissolved stage(s) to change, ${p.skipped.length} configured otherwise (left alone)` +
        `${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`,
    );
    for (const s of p.skipped) console.log(`      left alone: "${s.nameEn}" allows [${s.actions.join(', ')}]`);
  }
  const total = result.plans.reduce((n, p) => n + p.toChange.length, 0);
  console.log(`\nTotal: ${total} stage(s) to change.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — changing a customer organisation's workflow is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.stages} stage(s) changed; 1 audit row.`);
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
