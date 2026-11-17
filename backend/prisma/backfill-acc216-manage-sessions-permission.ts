// One-off backfill for ACC-216 — GRANTS users:manage_sessions to every existing
// organisation's Organization Administrator role (TENANT_ADMIN). It revokes
// nothing. ACC-164's shape (backfill-acc164-reset-mfa-permission.ts), with the
// customer refusal of the ACC-283 backfills (plan step-216 §2.7, lane B).
//
// WHY. New organisations get the key from the seed: TENANT_ADMIN's set is
// "every key but platform:*" (role.seed.ts). Existing organisations hold
// RolePermission rows written before the key existed, and seedSystemRoles()
// must not be re-run to reach them: it deletes and recreates every
// RolePermission row of every system role (CLAUDE.md, ACC-101). This adds
// exactly one row per organisation.
//
// WHY THE ROLE PERMISSION IS WRITTEN DIRECTLY. RoleService.assignPermissions()
// refuses the root role (its set is frozen, ACC-120). The freeze protects the
// set from a TENANT; the vendor adding a key the product now checks is the case
// the freeze has no answer for, so it is done here, audited.
//
// IT REFUSES CUSTOMERS. A customer organisation is any organisation that is not
// the platform and not one of the seeded fixtures. While one exists, --execute
// writes nothing and exits 1 (ACC-101: configuring a customer organisation is a
// customer-notified change, not a script). The dry run still reports it.
//
// THE PLATFORM ORGANISATION IS SKIPPED. Nobody holds Organization Administrator
// there: its people hold Platform Administrator, whose set is the whole
// catalogue by construction.
//
// THE AUDIT TRAIL (CLAUDE.md, ACC-101): ONE AuditLog row per organisation, its
// one grant: CREATE / RolePermission, objectId the new row, the role and key in
// `after`. actorId is null: no person did this.
//
// IDEMPOTENT. A role already holding the key is skipped, so a re-run plans
// nothing and writes nothing. Everything --execute writes is ONE transaction.
//
// RUN --execute ONLY AFTER ACC-216's Sessions PR IS DEPLOYED, and only on
// Ahmad's go: dry run, then --execute, then a dry run reporting 0. Never against
// the shared database from a branch.
//
// Run: npm run backfill:acc216-manage-sessions-permission               (dry run)
//      npm run backfill:acc216-manage-sessions-permission -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { USERS_PERMISSIONS } from '../src/common/constants/permissions';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc216-manage-sessions-permission';
export const TICKET = 'ACC-216';
export const KEY = USERS_PERMISSIONS.MANAGE_SESSIONS;
const TENANT_ADMIN_KEY = 'TENANT_ADMIN';
export const FIXTURE_SLUGS: ReadonlySet<string> = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

// Same values as the other backfills' BACKFILL_TX: Prisma's default 5 seconds
// runs out over the network from a developer machine.
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

export interface PlannedGrant {
  organizationId: string;
  slug: string;
  roleId: string;
  customer: boolean;
}

export interface GrantPlan {
  catalogueRowMissing: boolean;
  grants: PlannedGrant[];
  alreadyHeld: string[];
  /** Organisations with no TENANT_ADMIN role at all. */
  withoutRole: string[];
  /** Skipped by design: the platform organisation. */
  skipped: string[];
  /** Customer organisations the plan would grant to: --execute refuses while any exists. */
  customers: string[];
}

type Client = Pick<PrismaClient, 'organization' | 'permission' | 'role' | 'rolePermission' | 'auditLog' | '$transaction'>;

const [MODULE, ACTION] = KEY.split(':') as [string, string];

/** Reads only. What --execute would write. `isFixture` stands in for the fixture list in specs. */
export async function planGrants(
  prisma: Client,
  onlyOrganizationIds?: readonly string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<GrantPlan> {
  const organizations = await prisma.organization.findMany({
    where: onlyOrganizationIds ? { id: { in: [...onlyOrganizationIds] } } : undefined,
    select: { id: true, slug: true, isPlatformOrg: true },
    orderBy: { slug: 'asc' },
  });
  const catalogue = await prisma.permission.findFirst({
    where: { module: MODULE, action: ACTION },
    select: { id: true },
  });
  const tenants = organizations.filter((o) => !o.isPlatformOrg);
  const roles = await prisma.role.findMany({
    where: { organizationId: { in: tenants.map((o) => o.id) }, key: TENANT_ADMIN_KEY },
    select: {
      id: true,
      organizationId: true,
      rolePermissions: {
        where: { permission: { module: MODULE, action: ACTION } },
        select: { id: true },
      },
    },
  });
  const roleByOrg = new Map(roles.map((r) => [r.organizationId, r]));

  const plan: GrantPlan = {
    catalogueRowMissing: catalogue === null,
    grants: [],
    alreadyHeld: [],
    withoutRole: [],
    skipped: organizations.filter((o) => o.isPlatformOrg).map((o) => o.slug),
    customers: [],
  };
  for (const org of tenants) {
    const role = roleByOrg.get(org.id);
    if (!role) plan.withoutRole.push(org.slug);
    else if (role.rolePermissions.length > 0) plan.alreadyHeld.push(org.slug);
    else plan.grants.push({ organizationId: org.id, slug: org.slug, roleId: role.id, customer: !isFixture(org.slug) });
  }
  plan.customers = plan.grants.filter((g) => g.customer).map((g) => g.slug);
  return plan;
}

/** Writes the plan: the catalogue row, the grants and one audit row each, in ONE transaction. Refuses customers. */
export async function applyGrants(prisma: Client, plan: GrantPlan): Promise<number> {
  if (plan.customers.length > 0) {
    throw new Error(`Refused: customer organisation(s) ${plan.customers.join(', ')}. Configuring a customer is a customer-notified change (ACC-101).`);
  }
  return prisma.$transaction(async (tx) => {
    const permission = await tx.permission.upsert({
      where: { module_action: { module: MODULE, action: ACTION } },
      update: {},
      create: { module: MODULE, action: ACTION, description: KEY },
      select: { id: true },
    });
    let written = 0;
    for (const g of plan.grants) {
      // The unique (roleId, permissionId) makes a concurrent second run fail
      // the whole transaction rather than grant twice.
      const created = await tx.rolePermission.create({
        data: { roleId: g.roleId, permissionId: permission.id },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: g.organizationId,
          actorId: null,
          action: 'CREATE',
          objectType: 'RolePermission',
          objectId: created.id,
          after: { roleId: g.roleId, roleKey: TENANT_ADMIN_KEY, permission: KEY },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            grantedPermission: KEY,
            reason:
              "See another person's sign-ins and sign them out everywhere: a new key, seeded to Organization Administrator for new organisations and granted here to existing ones.",
          },
        },
      });
      written++;
    }
    return written;
  }, BACKFILL_TX);
}

function report(plan: GrantPlan, execute: boolean): void {
  console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — granting ${KEY} to Organization Administrator (${TICKET})\n`);
  console.log(`Catalogue row: ${plan.catalogueRowMissing ? (execute ? 'missing, upserting' : 'missing') : 'present'}`);
  console.log(`${execute ? 'Granting' : 'Would grant'}: ${plan.grants.length}`);
  for (const g of plan.grants) console.log(`  + ${g.slug}${g.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  console.log(`Already held, left alone: ${plan.alreadyHeld.length}`);
  console.log(`Organisations without an Organization Administrator role: ${plan.withoutRole.length}`);
  for (const s of plan.withoutRole) console.log(`  ! ${s}`);
  console.log(`Skipped by design (the platform organisation): ${plan.skipped.length}`);
  console.log(`${execute ? 'Writing' : 'Would write'} ${plan.grants.length} AuditLog row(s), one per organisation.`);
  if (plan.customers.length > 0) {
    console.log(`\nREFUSED on --execute: ${plan.customers.join(', ')}. Configuring a customer organisation is a customer-notified change, not a script (ACC-101).`);
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const plan = await planGrants(prisma);
    report(plan, execute);
    if (!execute) {
      console.log('\nDry run only. Re-run with -- --execute to apply.\n');
      return;
    }
    if (plan.customers.length > 0) {
      process.exitCode = 1;
      return;
    }
    if (plan.grants.length === 0 && !plan.catalogueRowMissing) {
      console.log('\nNothing to change.\n');
      return;
    }
    const written = await applyGrants(prisma, plan);
    console.log(`\nGranted ${written} key(s) and wrote ${written} audit row(s).\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
