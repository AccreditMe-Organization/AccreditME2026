/**
 * ACC-255 — existing organisations get the stage rules a new organisation gets
 * at creation: what each committee stage allows to be done to the committee
 * (WorkflowStageRecordAction rows) and what it means (WorkflowStage.flags).
 * Plan: backend/Plans/step-255-workflow-stage-rules.md §5.4.
 *
 *   npm run backfill:acc255-stage-rules              # dry run — writes nothing
 *   npm run backfill:acc255-stage-rules -- --execute # apply
 *   npm run backfill:acc255-stage-rules              # again: must report 0
 *
 * Runs AFTER the deploy: the migration adds the table and the column. Nothing
 * reads the rules to decide anything in PR 1, so the moment it runs changes
 * nothing a person sees; `npm run check:acc255-stage-parity` then proves the
 * rules give today's answer for every committee before PR 2 switches to them.
 *
 * WHAT IT WRITES, per non-platform organisation:
 *   - each COMMITTEE stage with a seed key: that seed stage's actions and
 *     flags (the plan's §4.1 table — today's rules exactly);
 *   - each COMMITTEE stage with no key (a tenant added it): the member actions
 *     only, which is what such a stage allows today;
 *   - each COMMITTEE_CHANGE_REQUEST template's `approved` stage: the
 *     APPLIES_APPROVED_CHANGE flag, unless some stage of it already has it.
 *
 * ONLY WHAT IS MISSING: a stage that already has any action row or any flag is
 * left as it is and reported, so a re-run, or a tenant who configured a stage
 * first, changes nothing. The seed's own values come from workflow.seed.ts and
 * the new-stage defaults from record-registry.ts — never a copy here.
 *
 * One transaction per organisation (BACKFILL_TX), which plans again first and
 * refuses if the plan moved since the dry run, and writes one audit row to the
 * organisation's own trail (ACC-101).
 *
 * CUSTOMER GUARD (ACC-101): only the seeded fixtures exist today. If a customer
 * organisation would be changed, --execute refuses and says so. A NEW
 * organisation never needs this script: applyWorkflowSeed() writes the same
 * rules when bootstrap creates its stages (plan §16.3).
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SYSTEM_WORKFLOW_SEED } from '../src/foundation/workflow/workflow.seed';
import { newStageActionKeys, STAGE_FLAG } from '../src/foundation/workflow/record-registry';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

const SCRIPT_NAME = 'backfill-acc255-stage-rules';
const TICKET = 'ACC-255';
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;
const APPROVED_STAGE_KEY = 'approved';

type Db = Pick<PrismaService, 'organization' | 'workflowTemplate' | 'workflowStage' | 'workflowStageRecordAction'>;

export interface StageWrite {
  stageId: string;
  templateId: string;
  objectType: 'COMMITTEE' | 'COMMITTEE_CHANGE_REQUEST';
  key: string | null;
  nameEn: string;
  actions: string[];
  flags: string[];
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  writes: StageWrite[];
  /** Stages that already carry rules, left as they are. */
  alreadyConfigured: number;
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  written: { slug: string; stages: number }[];
  refusedCustomers: string[];
}

/** What the seed says each keyed stage of a type allows and means. */
function seedRules(objectType: 'COMMITTEE' | 'COMMITTEE_CHANGE_REQUEST'): Map<string, { actions: string[]; flags: string[] }> {
  const workflow = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === objectType);
  if (!workflow) throw new Error(`The workflow seed has no ${objectType} template`);
  return new Map(
    workflow.stages.filter((s) => s.key).map((s) => [s.key!, { actions: [...(s.actions ?? [])], flags: [...(s.flags ?? [])] }]),
  );
}

/** One organisation's plan, read with `db` (the client, or a transaction). */
export async function planOrganization(db: Db, organizationId: string): Promise<Pick<OrgPlan, 'writes' | 'alreadyConfigured'>> {
  const committeeSeed = seedRules('COMMITTEE');
  const templates = await db.workflowTemplate.findMany({
    where: { organizationId, objectType: { in: ['COMMITTEE', 'COMMITTEE_CHANGE_REQUEST'] } },
    orderBy: [{ objectType: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      objectType: true,
      stages: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          key: true,
          nameEn: true,
          flags: true,
          _count: { select: { recordActions: { where: { organizationId } } } },
        },
      },
    },
  });

  const writes: StageWrite[] = [];
  let alreadyConfigured = 0;
  for (const template of templates) {
    const objectType = template.objectType as 'COMMITTEE' | 'COMMITTEE_CHANGE_REQUEST';
    for (const stage of template.stages) {
      const configured = stage.flags.length > 0 || stage._count.recordActions > 0;
      if (objectType === 'COMMITTEE') {
        if (configured) {
          alreadyConfigured++;
          continue;
        }
        const seeded = stage.key ? committeeSeed.get(stage.key) : undefined;
        const rules = seeded ?? { actions: newStageActionKeys('COMMITTEE'), flags: [] };
        writes.push({ stageId: stage.id, templateId: template.id, objectType, key: stage.key, nameEn: stage.nameEn, ...rules });
      } else if (stage.key === APPROVED_STAGE_KEY) {
        const flagged = template.stages.some((s) => s.flags.includes(STAGE_FLAG.APPLIES_APPROVED_CHANGE));
        if (configured || flagged) {
          alreadyConfigured++;
          continue;
        }
        writes.push({
          stageId: stage.id,
          templateId: template.id,
          objectType,
          key: stage.key,
          nameEn: stage.nameEn,
          actions: [],
          flags: [STAGE_FLAG.APPLIES_APPROVED_CHANGE],
        });
      }
    }
  }
  return { writes, alreadyConfigured };
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<OrgPlan[]> {
  const orgs = await prisma.organization.findMany({
    where: { isPlatformOrg: false, ...(organizationIds && { id: { in: organizationIds } }) },
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
  options: { execute: boolean; organizationIds?: string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, plans, written: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.writes.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // Again, inside the transaction: refuse rather than write a stale plan.
      const now = await planOrganization(tx, plan.organizationId);
      if (JSON.stringify(now.writes) !== JSON.stringify(plan.writes)) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      for (const write of plan.writes) {
        if (write.flags.length > 0) {
          await tx.workflowStage.update({ where: { id: write.stageId }, data: { flags: write.flags } });
        }
        if (write.actions.length > 0) {
          await tx.workflowStageRecordAction.createMany({
            data: write.actions.map((actionKey) => ({ organizationId: plan.organizationId, stageId: write.stageId, actionKey })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'WorkflowTemplate',
          objectId: plan.writes[0]!.templateId,
          after: {
            stages: plan.writes.map((w) => ({
              templateId: w.templateId,
              stageId: w.stageId,
              key: w.key,
              actions: w.actions,
              flags: w.flags,
            })),
          },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason:
              "What each committee stage allows and means, written for an existing organisation exactly as a new organisation's workflows are created with it. It reproduces today's rules; nothing a person sees changed.",
            stagesWritten: plan.writes.length,
          },
        },
      });
      result.written.push({ slug: plan.slug, stages: plan.writes.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — stage rules (${TICKET})`);
  for (const p of result.plans) {
    const keyed = p.writes.filter((w) => w.key).length;
    console.log(
      `  ${p.slug.padEnd(24)} ${String(p.writes.length).padStart(3)} stage(s) to write (${keyed} keyed, ${p.writes.length - keyed} added by the organisation), ` +
        `${p.alreadyConfigured} already configured${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`,
    );
  }
  const total = result.plans.reduce((n, p) => n + p.writes.length, 0);
  console.log(`\nTotal: ${total} stage(s) to write.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — a customer organisation's workflow configuration is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const w of result.written) console.log(`  ${w.slug}: ${w.stages} stage(s) written; 1 audit row.`);
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
