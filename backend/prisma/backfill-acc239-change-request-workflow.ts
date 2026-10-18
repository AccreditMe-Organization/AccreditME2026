/**
 * ACC-239 — existing organisations get the Committee Change Request workflow
 * that a new organisation gets at creation. Plan:
 * backend/Plans/step-238-committee-changes.md §12.
 *
 *   npm run backfill:acc239-change-request-workflow              # dry run — writes nothing
 *   npm run backfill:acc239-change-request-workflow -- --execute # apply
 *
 * The migration that adds the COMMITTEE_CHANGE_REQUEST value must have run
 * first, so --execute runs AFTER the deploy. The dry run also works BEFORE it:
 * it notices the value is not there yet and only reports.
 *
 * ONLY THIS ONE TEMPLATE IS WRITTEN, by the same code a new organisation's
 * bootstrap runs (applyWorkflowSeed). Re-applying the whole seed would reset the
 * tenant's own edits to its other seven workflows.
 *
 * An organisation that already has any Committee Change Request template is
 * left alone, so a re-run writes nothing. Each organisation is seeded in ONE
 * transaction that checks again first and writes one audit row to the
 * organisation's own trail (ACC-101: a vendor change to a tenant's
 * configuration is recorded in the tenant's record). The platform organisation
 * has no committees and is not seeded (ACC-233's scope).
 *
 * CUSTOMER GUARD (ACC-101): only the seeded fixtures exist today. If a customer
 * organisation would be changed, --execute refuses and says so.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SYSTEM_WORKFLOW_SEED, SeedWorkflow } from '../src/foundation/workflow/workflow.seed';
import { applyWorkflowSeed } from '../src/foundation/workflow/workflow-seed-apply';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

const SCRIPT_NAME = 'backfill-acc239-change-request-workflow';
const TICKET = 'ACC-239';
const OBJECT_TYPE = 'COMMITTEE_CHANGE_REQUEST' as const;
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  /** How many Committee Change Request templates it has now (null: the type does not exist yet). */
  existingTemplates: number | null;
  seed: boolean;
}

export interface BackfillResult {
  execute: boolean;
  typePresent: boolean;
  plans: OrgPlan[];
  seeded: string[];
  refusedCustomers: string[];
}

export function changeRequestSeed(): SeedWorkflow {
  const seed = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === OBJECT_TYPE);
  if (!seed) throw new Error('The workflow seed has no COMMITTEE_CHANGE_REQUEST template');
  return seed;
}

/** Whether the database knows the new enum value — false before the migration has run. */
async function typeExists(prisma: PrismaService): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'WorkflowObjectType' AND e.enumlabel = ${OBJECT_TYPE}
    ) AS "present"`;
  return rows[0]?.present === true;
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<{ typePresent: boolean; plans: OrgPlan[] }> {
  const typePresent = await typeExists(prisma);
  const orgs = await prisma.organization.findMany({
    where: { isPlatformOrg: false, ...(organizationIds && { id: { in: organizationIds } }) },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });
  const plans: OrgPlan[] = [];
  for (const org of orgs) {
    const existingTemplates = typePresent
      ? await prisma.workflowTemplate.count({ where: { organizationId: org.id, objectType: OBJECT_TYPE } })
      : null;
    plans.push({
      organizationId: org.id,
      slug: org.slug,
      customer: !isFixture(org.slug),
      existingTemplates,
      seed: (existingTemplates ?? 0) === 0,
    });
  }
  return { typePresent, plans };
}

/**
 * The whole run, minus the printing. `organizationIds` narrows it and
 * `isFixture` stands in for the fixture list: the spec seeds only its own
 * organisations, which the real guard would rightly call customers.
 */
export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const { typePresent, plans } = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, typePresent, plans, seeded: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.seed);
  if (!options.execute || work.length === 0) return result;
  if (!typePresent) throw new Error('The COMMITTEE_CHANGE_REQUEST workflow type does not exist — run the migration (deploy) first.');

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  const seed = changeRequestSeed();
  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // Again, inside the transaction: a run that raced another writes nothing.
      const now = await tx.workflowTemplate.count({ where: { organizationId: plan.organizationId, objectType: OBJECT_TYPE } });
      if (now !== 0) return;
      await applyWorkflowSeed(tx, plan.organizationId, [seed]);
      const template = await tx.workflowTemplate.findFirstOrThrow({
        where: { organizationId: plan.organizationId, objectType: OBJECT_TYPE, isDefault: true },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'CREATE',
          objectType: 'WorkflowTemplate',
          objectId: template.id,
          after: {
            objectType: OBJECT_TYPE,
            nameEn: seed.nameEn,
            stages: seed.stages.map((s) => s.key),
          },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason:
              'The Committee Change Request workflow, which every new organisation gets at creation, added for an existing organisation. Nothing a person sees changed until a change request is raised.',
          },
        },
      });
      result.seeded.push(plan.slug);
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — the Committee Change Request workflow (${TICKET})`);
  if (!result.typePresent) console.log('The COMMITTEE_CHANGE_REQUEST workflow type does not exist yet (the migration has not run): reporting only.');
  for (const p of result.plans) {
    const state =
      p.existingTemplates === null
        ? 'would be seeded (after the migration)'
        : p.seed
          ? 'to seed'
          : `already has ${p.existingTemplates} template(s) — left alone`;
    console.log(`  ${p.slug.padEnd(24)} ${state}${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  }
  const toSeed = result.plans.filter((p) => p.seed).length;
  console.log(`\nTotal: ${toSeed} organisation(s) to seed, ${result.plans.length - toSeed} already seeded.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — a customer organisation's workflow configuration is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const slug of result.seeded) console.log(`  ${slug}: seeded; 1 audit row.`);
    console.log(toSeed === 0 ? '\nNothing to change.\n' : '\nDone.\n');
  } else {
    console.log(toSeed === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
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
