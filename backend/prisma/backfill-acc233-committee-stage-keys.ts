/**
 * ACC-233 — existing organisations' committee lifecycle stages get their stable
 * keys (`WorkflowStage.key`). Plan: backend/Plans/step-233-committee-reference-checks.md §4.
 *
 *   npm run backfill:acc233-committee-stage-keys              # dry run — writes nothing
 *   npm run backfill:acc233-committee-stage-keys -- --execute # apply
 *
 * The migration that adds the column must have run first, so --execute runs
 * AFTER the deploy. The dry run also works BEFORE it: it notices the column is
 * not there yet and only reports what it would key.
 *
 * MATCHING, BY POSITION. Each stage of an organisation's default COMMITTEE
 * workflow takes the key of the seed stage at the same position (`order`), and
 * only when its first/final flags agree with that seed stage's. Position, not
 * name, because a tenant renaming a stage is the ordinary case the key exists
 * to survive. A stage the tenant added, two stages at one position, or flags
 * that disagree are REPORTED and left null — never guessed. A stage already
 * holding the key it would get is counted and left alone, so a re-run changes
 * nothing.
 *
 * Each organisation's keys are written in ONE transaction that re-plans first
 * and refuses if the database changed since the dry run, and that transaction
 * writes one audit row to the organisation's own trail (ACC-101: a vendor
 * change to a tenant's configuration is recorded in the tenant's record).
 *
 * CUSTOMER GUARD (ACC-101): only the seeded fixtures exist today. If a customer
 * organisation would be changed, --execute refuses and says so.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';
import { SYSTEM_WORKFLOW_SEED } from '../src/foundation/workflow/workflow.seed';

const SCRIPT_NAME = 'backfill-acc233-committee-stage-keys';
const TICKET = 'ACC-233';
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export interface SeedStage {
  key: string;
  order: number;
  isInitial: boolean;
  isFinal: boolean;
}

export interface StoredStage {
  id: string;
  nameEn: string;
  order: number;
  isInitial: boolean;
  isFinal: boolean;
  /** undefined when the column does not exist yet (a dry run before the deploy). */
  key?: string | null;
}

export interface KeyMatch {
  toSet: { stageId: string; nameEn: string; order: number; key: string }[];
  alreadyKeyed: number;
  unmatched: { stageId: string; nameEn: string; order: number; reason: string }[];
  /** Seed stages no stored stage matched (removed, or moved to another position). */
  seedKeysMissing: string[];
}

/** The committee lifecycle as the seed defines it. */
export function committeeSeedStages(): SeedStage[] {
  const committee = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE');
  if (!committee) throw new Error('The workflow seed has no COMMITTEE template');
  return committee.stages.map((s) => ({ key: s.key, order: s.order, isInitial: s.isInitial, isFinal: s.isFinal }));
}

/** Pure: which stored stage takes which seed key. Exported for the spec. */
export function matchStageKeys(stored: StoredStage[], seed: SeedStage[]): KeyMatch {
  const result: KeyMatch = { toSet: [], alreadyKeyed: 0, unmatched: [], seedKeysMissing: [] };
  const byOrder = new Map<number, StoredStage[]>();
  for (const s of stored) byOrder.set(s.order, [...(byOrder.get(s.order) ?? []), s]);
  const seedByOrder = new Map(seed.map((s) => [s.order, s]));
  const matchedKeys = new Set<string>();

  for (const stage of stored) {
    const seedStage = seedByOrder.get(stage.order);
    const atPosition = byOrder.get(stage.order) ?? [];
    if (!seedStage) {
      result.unmatched.push({ stageId: stage.id, nameEn: stage.nameEn, order: stage.order, reason: 'no seed stage at this position' });
      continue;
    }
    if (atPosition.length > 1) {
      result.unmatched.push({ stageId: stage.id, nameEn: stage.nameEn, order: stage.order, reason: 'two or more stages share this position' });
      continue;
    }
    if (stage.isInitial !== seedStage.isInitial || stage.isFinal !== seedStage.isFinal) {
      result.unmatched.push({ stageId: stage.id, nameEn: stage.nameEn, order: stage.order, reason: `first/final flags differ from the seed's "${seedStage.key}"` });
      continue;
    }
    if (stage.key && stage.key !== seedStage.key) {
      result.unmatched.push({ stageId: stage.id, nameEn: stage.nameEn, order: stage.order, reason: `already keyed "${stage.key}", the seed says "${seedStage.key}"` });
      continue;
    }
    matchedKeys.add(seedStage.key);
    if (stage.key === seedStage.key) result.alreadyKeyed++;
    else result.toSet.push({ stageId: stage.id, nameEn: stage.nameEn, order: stage.order, key: seedStage.key });
  }
  result.seedKeysMissing = seed.filter((s) => !matchedKeys.has(s.key)).map((s) => s.key);
  return result;
}

interface OrgPlan extends KeyMatch {
  organizationId: string;
  slug: string;
  customer: boolean;
  templateId: string | null;
}

type Reader = Pick<PrismaClient, 'workflowTemplate' | 'workflowStage'>;

async function planOrg(
  prisma: Reader,
  org: { id: string; slug: string; customer: boolean },
  keyColumn: boolean,
): Promise<OrgPlan> {
  const template = await prisma.workflowTemplate.findFirst({
    where: { organizationId: org.id, objectType: 'COMMITTEE', isDefault: true },
    select: { id: true },
  });
  const base = { organizationId: org.id, slug: org.slug, customer: org.customer, templateId: template?.id ?? null };
  if (!template) return { ...base, toSet: [], alreadyKeyed: 0, unmatched: [], seedKeysMissing: committeeSeedStages().map((s) => s.key) };

  // The key column is selected only once it exists: before the deploy the
  // generated client would otherwise ask for a column the database lacks.
  const stages: StoredStage[] = await prisma.workflowStage.findMany({
    where: { workflowTemplateId: template.id },
    select: { id: true, nameEn: true, order: true, isInitial: true, isFinal: true, ...(keyColumn && { key: true }) },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  return { ...base, ...matchStageKeys(stages, committeeSeedStages()) };
}

function report(plan: OrgPlan): void {
  console.log(`\n── ${plan.slug}${plan.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  if (!plan.templateId) {
    console.log('  No default COMMITTEE workflow — nothing to key.');
    return;
  }
  console.log(`  Stages to key: ${plan.toSet.length}   already keyed: ${plan.alreadyKeyed}   not matched (left null): ${plan.unmatched.length}`);
  for (const s of plan.toSet) console.log(`    ${String(s.order).padStart(3)}  ${s.nameEn.padEnd(24)} → ${s.key}`);
  for (const s of plan.unmatched) console.log(`    ${String(s.order).padStart(3)}  ${s.nameEn.padEnd(24)}   NOT MATCHED: ${s.reason}`);
  if (plan.seedKeysMissing.length) console.log(`  Seed keys with no stage: ${plan.seedKeysMissing.join(', ')}`);
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const column = await prisma.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WorkflowStage' AND column_name = 'key') AS "present"`;
    const keyColumn = column[0]?.present === true;
    console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — keying the committee lifecycle stages (${TICKET})`);
    if (!keyColumn) console.log('The WorkflowStage.key column does not exist yet (the migration has not run): reporting only.');

    const orgs = await prisma.organization.findMany({
      where: { isPlatformOrg: false },
      select: { id: true, slug: true },
      orderBy: { slug: 'asc' },
    });
    const plans: OrgPlan[] = [];
    for (const org of orgs) plans.push(await planOrg(prisma, { ...org, customer: !FIXTURE_SLUGS.has(org.slug) }, keyColumn));
    plans.forEach(report);

    const totals = plans.reduce(
      (t, p) => ({ toSet: t.toSet + p.toSet.length, already: t.already + p.alreadyKeyed, unmatched: t.unmatched + p.unmatched.length }),
      { toSet: 0, already: 0, unmatched: 0 },
    );
    console.log(`\nTotal: ${totals.toSet} stage(s) to key, ${totals.already} already keyed, ${totals.unmatched} not matched.`);

    const work = plans.filter((p) => p.toSet.length > 0);
    if (work.length === 0) {
      console.log('\nNothing to change.\n');
      return;
    }
    if (!execute) {
      console.log('\nDry run only — re-run with --execute to apply.\n');
      return;
    }
    if (!keyColumn) throw new Error('The WorkflowStage.key column does not exist — run the migration (deploy) first.');
    const customers = work.filter((p) => p.customer);
    if (customers.length > 0) {
      console.log(`\nREFUSED: ${customers.map((p) => p.slug).join(', ')} — a customer organisation's workflow configuration is a customer-notified change, not a script (ACC-101).\n`);
      process.exitCode = 1;
      return;
    }

    for (const plan of work) {
      await prisma.$transaction(async (tx) => {
        const now = await planOrg(tx, { id: plan.organizationId, slug: plan.slug, customer: plan.customer }, true);
        if (JSON.stringify(now.toSet) !== JSON.stringify(plan.toSet)) {
          throw new Error(`The database changed since the dry run for ${plan.slug} — re-run the dry run.`);
        }
        for (const s of plan.toSet) {
          // Scoped to the organisation's own committee template, and only a stage still unkeyed.
          const updated = await tx.workflowStage.updateMany({
            where: { id: s.stageId, workflowTemplateId: plan.templateId!, key: null },
            data: { key: s.key },
          });
          if (updated.count !== 1) throw new Error(`Stage ${s.stageId} in ${plan.slug} could not be keyed — re-run the dry run.`);
        }
        await tx.auditLog.create({
          data: {
            organizationId: plan.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'WorkflowTemplate',
            objectId: plan.templateId,
            before: { stageKeys: plan.toSet.map((s) => ({ stageId: s.stageId, key: null })) },
            after: { stageKeys: plan.toSet.map((s) => ({ stageId: s.stageId, key: s.key })) },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason: 'Committee lifecycle stages given their stable keys, matched to the seed by position (Ahmad, 15 Oct). Nothing a person sees changed.',
              unmatched: plan.unmatched,
            },
          },
        });
      }, BACKFILL_TX);
      console.log(`  ${plan.slug}: keyed ${plan.toSet.length} stage(s); 1 audit row.`);
    }
    console.log('\nDone.\n');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Run only when executed as a script, so the spec can import the matching.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
