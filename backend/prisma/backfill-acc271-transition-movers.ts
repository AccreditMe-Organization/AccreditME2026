/**
 * ACC-271 PR 2 — marks who moves the record along every existing transition
 * (plan §6.2, §6.4). Plan: backend/Plans/step-271-stage-owns-who.md.
 *
 *   npm run backfill:acc271-transition-movers              # dry run — writes nothing
 *   npm run backfill:acc271-transition-movers -- --execute # apply
 *   npm run backfill:acc271-transition-movers              # again: must report 0
 *
 * Runs AFTER PR 2 deploys. Until it runs, a transition with no mover already
 * reads as this script would write it (transitionMover(), PR 1), so running it
 * changes nothing a person sees; it makes the marker explicit for PR 3's
 * screens and PR 6's cleanup.
 *
 * WHAT IT CHANGES, per non-platform organisation, on every transition with no
 * mover yet: SYSTEM_AUTOMATIC → APP (the module's own code), everything else →
 * PERSON (whoever works the from-stage). `requiredPermission`, `triggerRoleId`
 * and `triggerUserId` stay where they are, unread on a converted stage (Q2);
 * the dry run lists, per organisation, the PERSON moves that carried a
 * permission, by key, so nobody has to guess what stopped being checked.
 *
 * Refuses a customer organisation (ACC-101) and a plan whose counts differ
 * from §6.4. One transaction per organisation (BACKFILL_TX) under its template
 * row locks, planning again inside it; ONE audit row per organisation in its
 * own trail. Reads in batches — no query inside a row loop.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { moverForTrigger } from '../src/foundation/workflow/workflow-who';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc271-transition-movers';
export const TICKET = 'ACC-271';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

export interface MoverCounts {
  transitions: number;
  app: number;
  person: number;
  personWithPermission: number;
}

/** Plan §6.4: both fixture organisations, measured 28 Oct. */
const SECTION_6_4: MoverCounts = { transitions: 75, app: 8, person: 67, personWithPermission: 65 };
export const EXPECTED: Readonly<Record<string, MoverCounts>> = {
  [HOSPITAL_FIXTURE.slug]: SECTION_6_4,
  [UNIVERSITY_FIXTURE.slug]: SECTION_6_4,
};

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  appIds: string[];
  personIds: string[];
  /** PERSON moves that carried a permission, by key: what stops being checked on a converted stage. */
  permissionsByKey: Record<string, number>;
  counts: MoverCounts;
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; counts: MoverCounts }[];
  refused: { slug: string; reason: string }[];
}

type Db = Pick<PrismaService, 'workflowTransition'>;

/** One organisation's unmarked transitions, in ONE read. */
export async function planOrganization(db: Db, organizationId: string): Promise<Omit<OrgPlan, 'organizationId' | 'slug' | 'customer'>> {
  const rows = await db.workflowTransition.findMany({
    where: { mover: null, fromStage: { workflowTemplate: { organizationId } } },
    select: { id: true, triggerCondition: true, requiredPermission: true },
    orderBy: { id: 'asc' },
  });
  const appIds: string[] = [];
  const personIds: string[] = [];
  const permissionsByKey: Record<string, number> = {};
  for (const row of rows) {
    if (moverForTrigger(row.triggerCondition) === 'APP') {
      appIds.push(row.id);
    } else {
      personIds.push(row.id);
      if (row.requiredPermission) permissionsByKey[row.requiredPermission] = (permissionsByKey[row.requiredPermission] ?? 0) + 1;
    }
  }
  const personWithPermission = Object.values(permissionsByKey).reduce((n, c) => n + c, 0);
  return {
    appIds,
    personIds,
    permissionsByKey,
    counts: { transitions: rows.length, app: appIds.length, person: personIds.length, personWithPermission },
  };
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

const sameCounts = (a: MoverCounts, b: MoverCounts): boolean => JSON.stringify(a) === JSON.stringify(b);

export async function runBackfill(
  prisma: PrismaService,
  options: {
    execute: boolean;
    organizationIds?: readonly string[];
    isFixture?: (slug: string) => boolean;
    expected?: Readonly<Record<string, MoverCounts>>;
  },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const expected = options.expected ?? EXPECTED;
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refused: [] };
  const work = plans.filter((p) => p.counts.transitions > 0);
  for (const plan of work) {
    if (plan.customer) result.refused.push({ slug: plan.slug, reason: 'a customer organisation (ACC-101)' });
    else if (!expected[plan.slug]) result.refused.push({ slug: plan.slug, reason: 'no expected counts for this organisation (plan §6.4)' });
    else if (!sameCounts(plan.counts, expected[plan.slug]!)) {
      result.refused.push({ slug: plan.slug, reason: `counts differ from plan §6.4: planned ${JSON.stringify(plan.counts)}` });
    }
  }
  if (!options.execute || work.length === 0 || result.refused.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WorkflowTemplate" WHERE "organizationId" = ${plan.organizationId} ORDER BY id FOR UPDATE`;
      const now = await planOrganization(tx, plan.organizationId);
      if (JSON.stringify([now.appIds, now.personIds]) !== JSON.stringify([plan.appIds, plan.personIds])) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      if (now.appIds.length > 0) await tx.workflowTransition.updateMany({ where: { id: { in: now.appIds }, mover: null }, data: { mover: 'APP' } });
      if (now.personIds.length > 0) {
        await tx.workflowTransition.updateMany({ where: { id: { in: now.personIds }, mover: null }, data: { mover: 'PERSON' } });
      }
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: plan.organizationId,
          before: { unmarkedTransitions: now.counts.transitions },
          after: { app: now.counts.app, person: now.counts.person },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason:
              "Each workflow move now says who makes it (ACC-271): the app's own moves are APP, every other move is made by whoever works its stage. The moves' old permission and trigger fields are left in place and no longer read on a converted stage.",
            permissionsNoLongerChecked: now.permissionsByKey,
          },
        },
      });
      result.changed.push({ slug: plan.slug, counts: now.counts });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — who moves the record along each transition (${TICKET})`);
  for (const p of result.plans) {
    const c = p.counts;
    console.log(
      `  ${p.slug.padEnd(24)} ${c.transitions} transition(s) to mark: APP ${c.app}, PERSON ${c.person}` +
        `${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}\n      PERSON moves that carried a permission: ${c.personWithPermission}`,
    );
    for (const [key, n] of Object.entries(p.permissionsByKey).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`        ${key.padEnd(28)} ${n}`);
    }
  }
  const total = result.plans.reduce((n, p) => n + p.counts.transitions, 0);
  console.log(`\nTotal: ${total} transition(s) to mark.`);
  if (result.refused.length > 0) {
    for (const r of result.refused) console.log(`REFUSED: ${r.slug} — ${r.reason}`);
    console.log('');
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.counts.transitions} transition(s) marked; 1 audit row.`);
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
    if (result.refused.length > 0) process.exitCode = 1;
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
