/**
 * ACC-258 — workflows:manage is the Organization Administrator role's alone
 * (Ahmad, 22 Oct). This REVOKES every grant of it from any other role in the
 * tenants. Plan: backend/Plans/step-258-lock-workflows-manage.md §5.
 *
 *   npm run backfill:acc258-revoke-workflows-manage              # dry run — writes nothing
 *   npm run backfill:acc258-revoke-workflows-manage -- --execute # apply
 *   npm run backfill:acc258-revoke-workflows-manage              # again: must report 0
 *
 * RUN ONLY AFTER THE CODE IS LIVE, never before: until the server refuses the
 * grant (PERMISSION_ROOT_ROLE_ONLY), a tenant admin could give it back between
 * this run and the deploy.
 *
 * WHAT IT REMOVES: in every NON-platform organisation, each RolePermission row
 * granting workflows:manage to a role other than the root role (TENANT_ADMIN)
 * and the Platform Administrator role (PLATFORM_ADMIN), which keeps it through
 * its own frozen seed (Ahmad, 24 Oct, Q1). Nothing else of any role changes.
 * The platform organisation is never in scope.
 *
 * A REVOCATION BACKFILL IS PERMITTED ONLY WHILE NO CUSTOMER TENANT EXISTS
 * (CLAUDE.md, ACC-101): --execute refuses if a customer organisation has a
 * grant to remove. A dry run still reports.
 *
 * THE AUDIT TRAIL (ACC-101): ONE AuditLog row PER REVOKED GRANT, in that
 * organisation's own trail, in the same transaction as the delete, in the
 * shape a role save writes (RoleService.assignPermissions): UPDATE /
 * RolePermission, objectId the role, its permissions before and after, and
 * the key under metadata.removed. actorId is null: no person did this.
 *
 * One transaction per organisation (BACKFILL_TX), which plans again first and
 * refuses if the plan moved since the dry run. Idempotent: a second run plans
 * nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc258-revoke-workflows-manage';
export const TICKET = 'ACC-258';
export const KEY = 'workflows:manage';
/** The roles that keep it: the root role, and the frozen Platform Administrator role (Q1). */
export const KEEPERS: readonly string[] = ['TENANT_ADMIN', 'PLATFORM_ADMIN'];
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const [MODULE, ACTION] = KEY.split(':') as [string, string];

type Db = Pick<PrismaService, 'organization' | 'rolePermission'>;

export interface PlannedRevocation {
  rolePermissionId: string;
  roleId: string;
  roleKey: string | null;
  roleName: string;
  isSystem: boolean;
  activeHolders: number;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  revocations: PlannedRevocation[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  revoked: { slug: string; grants: number }[];
  refusedCustomers: string[];
}

/** One organisation's grants to revoke, read with `db` (the client, or a transaction). */
export async function planOrganization(db: Db, organizationId: string): Promise<PlannedRevocation[]> {
  const rows = await db.rolePermission.findMany({
    where: {
      permission: { module: MODULE, action: ACTION },
      role: { organizationId, OR: [{ key: null }, { key: { notIn: [...KEEPERS] } }] },
    },
    select: {
      id: true,
      role: {
        select: {
          id: true,
          key: true,
          nameEn: true,
          isSystem: true,
          _count: { select: { userRoles: { where: { user: { status: 'ACTIVE' } } } } },
        },
      },
    },
  });
  return rows
    .map((r) => ({
      rolePermissionId: r.id,
      roleId: r.role.id,
      roleKey: r.role.key,
      roleName: r.role.nameEn,
      isSystem: r.role.isSystem,
      activeHolders: r.role._count.userRoles,
    }))
    .sort((a, b) => a.roleName.localeCompare(b.roleName) || a.roleId.localeCompare(b.roleId));
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
    plans.push({ organizationId: org.id, slug: org.slug, customer: !isFixture(org.slug), revocations: await planOrganization(prisma, org.id) });
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
  const result: BackfillResult = { execute: options.execute, plans, revoked: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.revocations.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // Again, inside the transaction: refuse rather than act on a stale plan.
      const now = await planOrganization(tx, plan.organizationId);
      if (JSON.stringify(now.map((r) => r.rolePermissionId)) !== JSON.stringify(plan.revocations.map((r) => r.rolePermissionId))) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      for (const r of plan.revocations) {
        const held = await tx.rolePermission.findMany({
          where: { roleId: r.roleId, role: { organizationId: plan.organizationId } },
          select: { permission: { select: { module: true, action: true } } },
        });
        const before = held.map((h) => `${h.permission.module}:${h.permission.action}`).sort();
        const { count } = await tx.rolePermission.deleteMany({
          where: { id: r.rolePermissionId, roleId: r.roleId, role: { organizationId: plan.organizationId } },
        });
        if (count !== 1) throw new Error(`${plan.slug}: expected to remove 1 grant from role ${r.roleId}, removed ${count}.`);
        await tx.auditLog.create({
          data: {
            organizationId: plan.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'RolePermission',
            objectId: r.roleId,
            before: { permissions: before },
            after: { permissions: before.filter((k) => k !== KEY) },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason: 'Only the Organization Administrator role can edit workflows (ACC-258); this role held workflows:manage, which is now removed.',
              added: [],
              removed: [KEY],
            },
          },
        });
      }
      result.revoked.push({ slug: plan.slug, grants: plan.revocations.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — revoke workflows:manage outside Organization Administrator (${TICKET})`);
  for (const p of result.plans) {
    console.log(`  ${p.slug.padEnd(24)} ${p.revocations.length} grant(s) to revoke${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
    for (const r of p.revocations) {
      console.log(`      ${r.roleName} (${r.isSystem ? `system${r.roleKey ? `, ${r.roleKey}` : ''}` : 'custom'}), ${r.activeHolders} active user(s)`);
    }
  }
  const total = result.plans.reduce((n, p) => n + p.revocations.length, 0);
  console.log(`\nTotal: ${total} grant(s) to revoke.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — revoking a customer organisation's grant is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const r of result.revoked) console.log(`  ${r.slug}: ${r.grants} grant(s) revoked; ${r.grants} audit row(s).`);
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
