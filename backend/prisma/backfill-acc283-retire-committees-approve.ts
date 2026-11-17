/**
 * ACC-283 PR 4 — committees:approve is RETIRED. Since PR 2 the chain of
 * authority decides committee change requests (change-request-chain.ts) and
 * nothing reads the key; PR 4 takes it out of the catalogue and the seed. This
 * takes it off the roles that still hold it, then removes its catalogue row.
 * Plan: backend/Plans/step-283-change-request-chain.md §9.
 *
 *   npm run backfill:acc283-retire-committees-approve              # dry run — writes nothing
 *   npm run backfill:acc283-retire-committees-approve -- --execute # apply
 *   npm run backfill:acc283-retire-committees-approve              # again: must report 0
 *
 * RUN ONLY AFTER PR 4 IS LIVE: until then the old catalogue still offers the key,
 * and a tenant admin could grant it back between this run and the deploy.
 *
 * WHAT IT REMOVES:
 *   1. every RolePermission row granting committees:approve, in every
 *      organisation (the platform organisation too: the key leaves the
 *      catalogue for everyone, so no role keeps it);
 *   2. then the key's Permission catalogue row, on a full run only, once no
 *      RolePermission anywhere still references it. The catalogue is shared by
 *      every organisation.
 * Nothing else of any role changes.
 *
 * A REVOCATION BACKFILL IS PERMITTED ONLY WHILE NO CUSTOMER TENANT EXISTS
 * (CLAUDE.md, ACC-101): --execute refuses, writing nothing, if a customer
 * organisation holds the key. A dry run still reports.
 *
 * THE AUDIT TRAIL (ACC-101): ONE AuditLog row PER ROLE CHANGED, in that
 * organisation's own trail, in the same transaction as the delete, in the shape
 * a role save writes (RoleService.assignPermissions): UPDATE / RolePermission,
 * objectId the role, its permissions before and after, the key under
 * metadata.removed. actorId is null: no person did this.
 *
 * THE REPORT names organisations by slug and gives counts only: no role, no
 * person.
 *
 * One transaction per organisation (BACKFILL_TX), which plans again first and
 * refuses if the plan moved since the dry run. Idempotent: a second run plans
 * nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc283-retire-committees-approve';
export const TICKET = 'ACC-283';
export const KEY = 'committees:approve';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const [MODULE, ACTION] = KEY.split(':') as [string, string];

type Db = Pick<PrismaService, 'rolePermission'>;

export interface PlannedRevocation {
  rolePermissionId: string;
  roleId: string;
  isSystem: boolean;
  activeHolders: number;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  /** Neither the platform organisation nor a seeded fixture. */
  customer: boolean;
  revocations: PlannedRevocation[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  revoked: { slug: string; roles: number }[];
  refusedCustomers: string[];
  /** Whether the catalogue row was present before the run, and whether this run removed it. */
  catalogue: { present: boolean; deleted: boolean; stillReferenced: number };
}

/** One organisation's grants to revoke, read with `db` (the client, or a transaction). */
export async function planOrganization(db: Db, organizationId: string): Promise<PlannedRevocation[]> {
  const rows = await db.rolePermission.findMany({
    where: { permission: { module: MODULE, action: ACTION }, role: { organizationId } },
    select: {
      id: true,
      role: {
        select: {
          id: true,
          isSystem: true,
          _count: { select: { userRoles: { where: { user: { status: 'ACTIVE' } } } } },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({
    rolePermissionId: r.id,
    roleId: r.role.id,
    isSystem: r.role.isSystem,
    activeHolders: r.role._count.userRoles,
  }));
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: readonly string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<OrgPlan[]> {
  const orgs = await prisma.organization.findMany({
    where: organizationIds ? { id: { in: [...organizationIds] } } : {},
    select: { id: true, slug: true, isPlatformOrg: true },
    orderBy: { slug: 'asc' },
  });
  const plans: OrgPlan[] = [];
  for (const org of orgs) {
    plans.push({
      organizationId: org.id,
      slug: org.slug,
      customer: !org.isPlatformOrg && !isFixture(org.slug),
      revocations: await planOrganization(prisma, org.id),
    });
  }
  return plans;
}

/**
 * The catalogue row, removed only when no grant anywhere still references it.
 * Returns whether it was present, whether it was deleted, and how many grants
 * still reference it (non-zero means it was kept).
 */
export async function retireCatalogueRow(
  prisma: PrismaService,
  execute: boolean,
): Promise<{ present: boolean; deleted: boolean; stillReferenced: number }> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.permission.findFirst({ where: { module: MODULE, action: ACTION }, select: { id: true } });
    if (!row) return { present: false, deleted: false, stillReferenced: 0 };
    const stillReferenced = await tx.rolePermission.count({ where: { permissionId: row.id } });
    if (!execute || stillReferenced > 0) return { present: true, deleted: false, stillReferenced };
    await tx.permission.delete({ where: { id: row.id } });
    return { present: true, deleted: true, stillReferenced: 0 };
  }, BACKFILL_TX);
}

/**
 * The whole run, minus the printing. `organizationIds` narrows it (and then the
 * shared catalogue row is left alone), and `isFixture` stands in for the
 * fixture list: the spec seeds only its own organisations, which the real guard
 * would rightly call customers.
 */
export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = {
    execute: options.execute,
    plans,
    revoked: [],
    refusedCustomers: [],
    catalogue: { present: false, deleted: false, stillReferenced: 0 },
  };
  const work = plans.filter((p) => p.revocations.length > 0);

  if (options.execute) {
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
          if (count !== 1) throw new Error(`${plan.slug}: expected to remove 1 grant from a role, removed ${count}.`);
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
                reason:
                  'committees:approve is retired (ACC-283): the chain of authority decides committee change requests, and no key does. This role held it, and it is removed.',
                added: [],
                removed: [KEY],
              },
            },
          });
        }
        result.revoked.push({ slug: plan.slug, roles: plan.revocations.length });
      }, BACKFILL_TX);
    }
  }

  // The shared catalogue row: only on a full run, never a narrowed one.
  if (!options.organizationIds) result.catalogue = await retireCatalogueRow(prisma, options.execute);
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — retire committees:approve (${TICKET})`);
  for (const p of result.plans) {
    const system = p.revocations.filter((r) => r.isSystem).length;
    const holders = p.revocations.reduce((n, r) => n + r.activeHolders, 0);
    console.log(
      `  ${p.slug.padEnd(24)} ${p.revocations.length} role(s) to change (${system} system, ${p.revocations.length - system} custom), ${holders} active holder(s)${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`,
    );
  }
  const total = result.plans.reduce((n, p) => n + p.revocations.length, 0);
  console.log(`\nTotal: ${total} role(s) to change.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.join(', ')} — taking a key from a customer organisation's role is a customer-notified change, not a script (ACC-101). Nothing was written.\n`);
    return;
  }
  const c = result.catalogue;
  console.log(
    `Catalogue row: ${!c.present ? 'not present' : c.deleted ? 'deleted' : c.stillReferenced > 0 ? `kept (${c.stillReferenced} grant(s) still reference it)` : 'present; would be deleted'}.`,
  );
  if (result.execute) {
    for (const r of result.revoked) console.log(`  ${r.slug}: ${r.roles} role(s) changed; ${r.roles} audit row(s).`);
    console.log(total === 0 && !c.deleted ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must report 0.\n');
  } else {
    console.log(total === 0 && !c.present ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
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
