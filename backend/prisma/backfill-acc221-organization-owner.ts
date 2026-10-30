/**
 * ACC-221 — every existing organisation gets its ACCOUNT OWNER (Ahmad, 29 Oct):
 * its single ACTIVE Organization Administrator. New organisations get theirs at
 * creation (PlatformTenantService.createTenant()).
 *
 *   npm run backfill:acc221-organization-owner              # dry run — writes nothing
 *   npm run backfill:acc221-organization-owner -- --execute # apply
 *   npm run backfill:acc221-organization-owner              # again: must plan 0
 *
 * Runs AFTER the migration (acc221_organization_owner) has deployed, never
 * before: the column must exist.
 *
 * WHAT IT CHANGES: for each organisation that is not the platform organisation
 * and has no owner yet, `ownerUserId` = its one ACTIVE holder of the ACTIVE
 * TENANT_ADMIN role — the rule tenant-administrator.invariant.ts counts by:
 * people who can sign in, never raw assignment rows. 0 holders or 2 and more:
 * SKIPPED and reported by slug and count (no names, no emails); a platform
 * admin decides. An owner already set is never touched.
 *
 * Reads in two queries whatever the number of organisations (the organisations,
 * then every holder at once). The write is one transaction (BACKFILL_TX) that
 * locks the planned organisation rows, plans again and refuses a moved plan,
 * sets each owner only where it is still null, and writes one audit row per
 * organisation in its own trail.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { TENANT_ADMIN_KEY } from '../src/foundation/roles/tenant-administrator.invariant';

export const SCRIPT_NAME = 'backfill-acc221-organization-owner';
export const TICKET = 'ACC-221';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export type OrgDecision =
  | { slug: string; organizationId: string; action: 'set'; ownerUserId: string }
  | { slug: string; organizationId: string; action: 'skip'; reason: 'no active Organization Administrator' | 'more than one active Organization Administrator'; holders: number };

export interface BackfillResult {
  execute: boolean;
  decisions: OrgDecision[];
  changed: string[];
}

type Db = Pick<PrismaService, 'organization' | 'userRole'>;

/**
 * Every organisation still without an owner, and what it gets. Two queries.
 * `organizationIds` narrows the run to the spec's own organisations.
 */
export async function planBackfill(db: Db, organizationIds?: readonly string[]): Promise<OrgDecision[]> {
  const orgs = await db.organization.findMany({
    where: { isPlatformOrg: false, ownerUserId: null, ...(organizationIds && { id: { in: [...organizationIds] } }) },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });
  if (orgs.length === 0) return [];

  const ids = orgs.map((o) => o.id);
  const rows = await db.userRole.findMany({
    where: {
      role: { key: TENANT_ADMIN_KEY, isActive: true, organizationId: { in: ids } },
      user: { status: 'ACTIVE', organizationId: { in: ids } },
    },
    select: { userId: true, role: { select: { organizationId: true } }, user: { select: { organizationId: true } } },
  });
  const holders = new Map<string, Set<string>>();
  for (const r of rows) {
    // A holder counts only in their own organisation.
    if (r.role.organizationId !== r.user.organizationId) continue;
    const set = holders.get(r.role.organizationId) ?? new Set<string>();
    set.add(r.userId);
    holders.set(r.role.organizationId, set);
  }

  return orgs.map((o): OrgDecision => {
    const people = [...(holders.get(o.id) ?? [])];
    if (people.length === 1) return { slug: o.slug, organizationId: o.id, action: 'set', ownerUserId: people[0]! };
    return {
      slug: o.slug,
      organizationId: o.id,
      action: 'skip',
      reason: people.length === 0 ? 'no active Organization Administrator' : 'more than one active Organization Administrator',
      holders: people.length,
    };
  });
}

const toSet = (d: OrgDecision[]): string =>
  JSON.stringify(d.filter((x) => x.action === 'set').map((x) => [x.organizationId, x.action === 'set' ? x.ownerUserId : null]));

export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[] },
): Promise<BackfillResult> {
  const decisions = await planBackfill(prisma, options.organizationIds);
  const result: BackfillResult = { execute: options.execute, decisions, changed: [] };
  const planned = decisions.filter((d): d is Extract<OrgDecision, { action: 'set' }> => d.action === 'set');
  if (!options.execute || planned.length === 0) return result;

  await prisma.$transaction(async (tx) => {
    const ids = planned.map((d) => d.organizationId);
    // The planned rows, locked, so a second run or a creation cannot move under us.
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    // Again, inside the transaction: refuse rather than act on a stale plan.
    const now = await planBackfill(tx, ids);
    if (toSet(now) !== toSet(planned)) {
      throw new Error('The database changed since the dry run — run the dry run again.');
    }
    for (const d of planned) {
      const { count } = await tx.organization.updateMany({
        where: { id: d.organizationId, isPlatformOrg: false, ownerUserId: null },
        data: { ownerUserId: d.ownerUserId },
      });
      if (count !== 1) throw new Error(`${d.slug}: the owner could not be set — run the dry run again.`);
    }
    await tx.auditLog.createMany({
      data: planned.map((d) => ({
        organizationId: d.organizationId,
        actorId: null,
        action: 'UPDATE' as const,
        objectType: 'Organization',
        objectId: d.organizationId,
        before: { ownerUserId: null },
        after: { ownerUserId: d.ownerUserId },
        metadata: {
          source: SCRIPT_NAME,
          ticket: TICKET,
          reason: "The organisation's account owner (ACC-221) is its single active Organization Administrator.",
        },
      })),
    });
    result.changed.push(...planned.map((d) => d.slug));
  }, BACKFILL_TX);
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — each organisation's account owner (${TICKET})`);
  for (const d of result.decisions) {
    if (d.action === 'set') console.log(`  ${d.slug.padEnd(24)} PLANNED  owner = its active Organization Administrator`);
    else console.log(`  ${d.slug.padEnd(24)} SKIPPED  ${d.reason} (${d.holders})`);
  }
  const planned = result.decisions.filter((d) => d.action === 'set').length;
  const skipped = result.decisions.length - planned;
  console.log(`\nTotal: ${planned} planned, ${skipped} skipped (organisations without an owner, the platform organisation excluded).`);
  if (result.execute) {
    for (const slug of result.changed) console.log(`  ${slug}: owner set; 1 audit row.`);
    console.log(planned === 0 ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must plan 0.\n');
  } else {
    console.log(planned === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    report(await runBackfill(prisma, { execute: process.argv.includes('--execute') }));
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
