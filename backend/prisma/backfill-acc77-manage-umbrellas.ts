/**
 * ACC-77 — GRANTS each existing system role the specific keys of every umbrella
 * it holds (ACC-44's rule, manage-umbrellas.ts). It revokes nothing.
 *
 *   npm run backfill:acc77-manage-umbrellas              # dry run — writes nothing
 *   npm run backfill:acc77-manage-umbrellas -- --execute # apply
 *   npm run backfill:acc77-manage-umbrellas              # again: must report 0
 *
 * WHAT IS GRANTED: for a role found by its SYSTEM key (SYSTEM_ROLE_SEED), each
 * umbrella it STILL holds brings that umbrella's missing specifics
 * (missingSpecifics(), the same rule the seed is tested against). On today's
 * seed that is QUALITY_MANAGER's two view_unit_tasks keys. A role an
 * organisation took the umbrella away from is given nothing for it. A tenant's
 * own (custom) roles are left as they are: what a custom role holds is the
 * tenant's choice. New organisations get the keys from the seed;
 * seedSystemRoles() is never re-run (CLAUDE.md, ACC-101).
 *
 * THE CATALOGUE ROWS for every granted key are upserted first, in the same
 * transaction.
 *
 * Refuses a customer organisation with anything to grant (tenant configuration
 * written by the vendor: ACC-101). ONE transaction per organisation
 * (BACKFILL_TX) that plans again inside and refuses a moved plan, and ONE audit
 * row per organisation changed, in that organisation's trail. Idempotent: a
 * second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { missingSpecifics } from '../src/foundation/roles/manage-umbrellas';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc77-manage-umbrellas';
export const TICKET = 'ACC-77';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const SYSTEM_KEYS: readonly string[] = SYSTEM_ROLE_SEED.map((r) => r.key);
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const keyOf = (p: { module: string; action: string }): string => `${p.module}:${p.action}`;

export interface PlannedGrant {
  roleId: string;
  roleKey: string;
  umbrella: string;
  permission: string;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  grants: PlannedGrant[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; grants: number }[];
  refusedCustomers: string[];
}

type Db = Pick<PrismaService, 'role'>;

async function planOrg(db: Db, organizationId: string): Promise<PlannedGrant[]> {
  const roles = await db.role.findMany({
    where: { organizationId, key: { in: [...SYSTEM_KEYS] } },
    select: { id: true, key: true, rolePermissions: { select: { permission: { select: { module: true, action: true } } } } },
    orderBy: { key: 'asc' },
  });
  return roles.flatMap((role) =>
    missingSpecifics(new Set(role.rolePermissions.map((rp) => keyOf(rp.permission)))).flatMap(({ umbrella, missing }) =>
      missing.map((permission) => ({ roleId: role.id, roleKey: role.key!, umbrella, permission })),
    ),
  );
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: readonly string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<OrgPlan[]> {
  const orgs = await prisma.organization.findMany({
    where: organizationIds ? { id: { in: [...organizationIds] } } : undefined,
    select: { id: true, slug: true, isPlatformOrg: true },
    orderBy: { slug: 'asc' },
  });
  const plans: OrgPlan[] = [];
  for (const org of orgs) {
    plans.push({ organizationId: org.id, slug: org.slug, customer: !org.isPlatformOrg && !isFixture(org.slug), grants: await planOrg(prisma, org.id) });
  }
  return plans;
}

export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.grants.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      const ids = new Map<string, string>();
      for (const key of new Set(plan.grants.map((g) => g.permission))) {
        const [module, action] = key.split(':') as [string, string];
        const row = await tx.permission.upsert({
          where: { module_action: { module, action } },
          update: {},
          create: { module, action, description: key },
          select: { id: true },
        });
        ids.set(key, row.id);
      }
      // Plan again inside: refuse rather than act on a stale plan.
      const now = await planOrg(tx, plan.organizationId);
      if (JSON.stringify(now) !== JSON.stringify(plan.grants)) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      // The unique (roleId, permissionId) makes a concurrent second run fail the whole transaction.
      await tx.rolePermission.createMany({ data: plan.grants.map((g) => ({ roleId: g.roleId, permissionId: ids.get(g.permission)! })) });
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: plan.organizationId,
          after: { grantedPermissions: plan.grants.map((g) => ({ roleKey: g.roleKey, umbrella: g.umbrella, permission: g.permission })) },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason: "Each system role holds the specific keys of every umbrella it holds (ACC-44's rule), as the seed now gives them.",
          },
        },
      });
      result.changed.push({ slug: plan.slug, grants: plan.grants.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — every system role's umbrellas hold their specifics (${TICKET})`);
  for (const p of result.plans.filter((x) => x.grants.length > 0)) {
    const byRole = [...new Set(p.grants.map((g) => g.roleKey))].map((k) => `${k} ${p.grants.filter((g) => g.roleKey === k).length}`).join(', ');
    console.log(`  ${p.slug.padEnd(24)} ${p.grants.length} grant(s): ${byRole}${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  }
  const total = result.plans.reduce((n, p) => n + p.grants.length, 0);
  const orgs = result.plans.filter((p) => p.grants.length > 0).length;
  console.log(`\nTotal: ${total} grant(s) in ${orgs} organisation(s), of ${result.plans.length} read.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.length} customer organisation(s) — configuring a customer organisation is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.grants} grant(s); 1 audit row.`);
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
