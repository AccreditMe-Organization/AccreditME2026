/**
 * ACC-316 PR 2 — GRANTS the three new meeting keys to the system roles of
 * every existing organisation. It revokes nothing.
 *
 *   npm run backfill:acc316-meeting-keys              # dry run — writes nothing
 *   npm run backfill:acc316-meeting-keys -- --execute # apply
 *   npm run backfill:acc316-meeting-keys              # again: must report 0
 *
 * Runs AFTER PR 2 deploys. Plan: backend/Plans/step-316-meeting-management.md §6.
 *
 * WHAT IS GRANTED, to a role found by its system key: the role's seeded share
 * of meetings:schedule, meetings:schedule_subunits and meetings:approve_subunits
 * (SYSTEM_ROLE_SEED itself, so the table has one copy), and ONLY where the role
 * still holds meetings:manage — the umbrella the seed gives with them. A role
 * an organisation took meetings:manage away from is not handed the new keys.
 * New organisations get them from the seed. seedSystemRoles() is never re-run:
 * it deletes and recreates every RolePermission row of every system role
 * (CLAUDE.md, ACC-101).
 *
 * THE CATALOGUE ROWS are upserted first, in the same transaction.
 *
 * Refuses a customer organisation with anything to grant (tenant configuration
 * written by the vendor: ACC-101). ONE transaction per organisation
 * (BACKFILL_TX) that plans again inside and refuses a moved plan, and ONE audit
 * row per organisation changed, in that organisation's trail. Idempotent: a
 * second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { MEETINGS_PERMISSIONS } from '../src/common/constants/permissions';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc316-meeting-keys';
export const TICKET = 'ACC-316';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export const NEW_KEYS: readonly string[] = [
  MEETINGS_PERMISSIONS.SCHEDULE,
  MEETINGS_PERMISSIONS.SCHEDULE_SUBUNITS,
  MEETINGS_PERMISSIONS.APPROVE_SUBUNITS,
];
/** What a role must still hold to be given its share. */
export const REQUIRES = MEETINGS_PERMISSIONS.MANAGE;

/** The seeded share of the new keys, per system role key. */
export const SEEDED_KEYS: ReadonlyMap<string, readonly string[]> = new Map(
  SYSTEM_ROLE_SEED.map((r) => [r.key, r.permissions.filter((p) => NEW_KEYS.includes(p))] as const).filter(([, keys]) => keys.length > 0),
);

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

const keyOf = (p: { module: string; action: string }): string => `${p.module}:${p.action}`;

export interface PlannedGrant {
  roleId: string;
  roleKey: string;
  permission: string;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  grants: PlannedGrant[];
  /** Seeded for the role, but withheld: the role no longer holds meetings:manage. */
  withheld: { roleKey: string; permission: string }[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; grants: number }[];
  refusedCustomers: string[];
}

type Db = Pick<PrismaService, 'role'>;

async function planOrg(db: Db, organizationId: string): Promise<Pick<OrgPlan, 'grants' | 'withheld'>> {
  const roles = await db.role.findMany({
    where: { organizationId, key: { in: [...SEEDED_KEYS.keys()] } },
    select: { id: true, key: true, rolePermissions: { select: { permission: { select: { module: true, action: true } } } } },
    orderBy: { key: 'asc' },
  });
  const grants: PlannedGrant[] = [];
  const withheld: OrgPlan['withheld'] = [];
  for (const role of roles) {
    const held = new Set(role.rolePermissions.map((rp) => keyOf(rp.permission)));
    for (const permission of SEEDED_KEYS.get(role.key!) ?? []) {
      if (held.has(permission)) continue;
      if (!held.has(REQUIRES)) {
        withheld.push({ roleKey: role.key!, permission });
        continue;
      }
      grants.push({ roleId: role.id, roleKey: role.key!, permission });
    }
  }
  return { grants, withheld };
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
    plans.push({ organizationId: org.id, slug: org.slug, customer: !org.isPlatformOrg && !isFixture(org.slug), ...(await planOrg(prisma, org.id)) });
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
      for (const key of NEW_KEYS) {
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
      if (JSON.stringify(now.grants) !== JSON.stringify(plan.grants)) {
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
          after: { grantedPermissions: plan.grants.map((g) => ({ roleKey: g.roleKey, permission: g.permission })) },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason: 'The new meeting keys, seeded for new organisations, granted to existing system roles that still hold meetings:manage.',
          },
        },
      });
      result.changed.push({ slug: plan.slug, grants: plan.grants.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — the new meeting keys for existing system roles (${TICKET})`);
  const work = result.plans.filter((p) => p.grants.length > 0 || p.withheld.length > 0);
  for (const p of work) {
    console.log(`  ${p.slug.padEnd(24)} ${p.grants.length} grant(s), ${p.withheld.length} withheld${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
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
