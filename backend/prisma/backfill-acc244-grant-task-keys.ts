// One-off backfill for ACC-244 PR 1 — GRANTS the four committee task keys to
// the system roles of every existing organisation. It revokes nothing.
//
// WHY. New organisations get the keys from the seed (role.seed.ts). Existing
// ones were seeded before the keys existed, and seedSystemRoles() must not be
// re-run to reach them: it deletes and recreates every RolePermission row of
// every system role, which would reset each tenant's own edits (CLAUDE.md,
// ACC-101). This adds exactly the rows it lists.
//
// WHAT IS GRANTED, to a role found by its system key:
//   1. the role's seeded share of the four keys — SYSTEM_ROLE_SEED itself, so
//      the table in backend/Plans/step-244-task-permissions.md §5.2 has one
//      copy, pinned by role.seed.spec.ts. VIEWER is in it with none (Q2);
//   2. AND only where the role holds today the flat key the new one replaces:
//        committees:view_all_tasks   ⇐ tasks:view
//        committees:create_tasks     ⇐ tasks:create
//        committees:manage_tasks     ⇐ tasks:reassign  (Manage replaces it, ACC-174)
//        committees:view_unit_tasks  ⇐ tasks:view
//      On the seeded tenants every role in the table holds its old key, so
//      this changes nothing there. It exists for a tenant that took a key away
//      from a system role: the backfill must not hand that reach back under a
//      new name. So it never widens a role past what its organisation chose,
//      and is safe to run whether or not customer tenants exist.
// Nothing reads the new keys until PR 2, so running this changes no behaviour.
//
// THE CATALOGUE ROWS. RoleService.seedPermissions() upserts the catalogue from
// ALL_PERMISSIONS, but only when a tenant is bootstrapped. --execute upserts the
// four rows first, in the same transaction as the grants.
//
// THE AUDIT TRAIL (CLAUDE.md, ACC-101): ONE AuditLog row PER GRANT, in the
// organisation whose role gained it — CREATE / RolePermission, objectId the new
// row, the role and key in `after`. actorId is null: no person did this, and
// there is no system-actor user. The script and ticket are in metadata.
//
// IDEMPOTENT. A role already holding a key is skipped, and a re-run plans
// nothing and writes nothing. Everything --execute writes is ONE transaction,
// so a role can never gain a key without its audit row.
//
// RUN --execute ONLY AFTER PR 1 IS DEPLOYED, dry run first. Never --execute
// against the shared database from a branch.
//
// Run: npm run backfill:acc244-grant-task-keys               (dry run)
//      npm run backfill:acc244-grant-task-keys -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { COMMITTEE_TASKS_PERMISSIONS, TASKS_PERMISSIONS } from '../src/common/constants/permissions';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc244-grant-task-keys';
export const TICKET = 'ACC-244';

const NEW_KEYS: readonly string[] = Object.values(COMMITTEE_TASKS_PERMISSIONS);

/** Each new key, and the flat key a role must hold today to be given it. */
export const REPLACES: Readonly<Record<string, string>> = {
  [COMMITTEE_TASKS_PERMISSIONS.VIEW_ALL]: TASKS_PERMISSIONS.VIEW,
  [COMMITTEE_TASKS_PERMISSIONS.CREATE]: TASKS_PERMISSIONS.CREATE,
  [COMMITTEE_TASKS_PERMISSIONS.MANAGE]: TASKS_PERMISSIONS.REASSIGN,
  [COMMITTEE_TASKS_PERMISSIONS.VIEW_UNIT]: TASKS_PERMISSIONS.VIEW,
};

/** The seeded share of the new keys, per system role key. */
export const SEEDED_KEYS: ReadonlyMap<string, readonly string[]> = new Map(
  SYSTEM_ROLE_SEED.map((r) => [r.key, r.permissions.filter((p) => NEW_KEYS.includes(p))]),
);

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

export interface PlannedGrant {
  organizationId: string;
  slug: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleActive: boolean;
  holders: number;
  permission: string;
}

export interface GrantPlan {
  organizations: { slug: string; kind: 'platform org' | 'seeded fixture' | 'customer' }[];
  missingCatalogue: string[];
  grants: PlannedGrant[];
  alreadyHeld: number;
  /** Seeded for the role, but withheld because the role lacks the key it replaces. */
  withheld: { slug: string; roleKey: string; permission: string; lacks: string }[];
}

type Client = Pick<PrismaClient, 'organization' | 'permission' | 'role' | 'rolePermission' | 'auditLog' | '$transaction'>;

const keyOf = (p: { module: string; action: string }) => `${p.module}:${p.action}`;

/** Reads only. What --execute would write. */
export async function planGrants(prisma: Client, onlyOrganizationIds?: readonly string[]): Promise<GrantPlan> {
  const organizations = await prisma.organization.findMany({
    where: onlyOrganizationIds ? { id: { in: [...onlyOrganizationIds] } } : undefined,
    select: { id: true, slug: true, isPlatformOrg: true },
    orderBy: { slug: 'asc' },
  });
  const catalogue = await prisma.permission.findMany({
    where: { OR: NEW_KEYS.map((k) => ({ module: k.split(':')[0]!, action: k.split(':')[1]! })) },
    select: { module: true, action: true },
  });
  const present = new Set(catalogue.map(keyOf));

  const roles = await prisma.role.findMany({
    where: { organizationId: { in: organizations.map((o) => o.id) }, key: { in: [...SEEDED_KEYS.keys()] } },
    select: {
      id: true,
      key: true,
      nameEn: true,
      isActive: true,
      organizationId: true,
      rolePermissions: { select: { permission: { select: { module: true, action: true } } } },
      _count: { select: { userRoles: { where: { user: { status: 'ACTIVE' } } } } },
    },
    orderBy: [{ organizationId: 'asc' }, { key: 'asc' }],
  });
  const slugById = new Map(organizations.map((o) => [o.id, o.slug]));

  const plan: GrantPlan = {
    organizations: organizations.map((o) => ({
      slug: o.slug,
      kind: o.isPlatformOrg ? 'platform org' : FIXTURE_SLUGS.has(o.slug) ? 'seeded fixture' : 'customer',
    })),
    missingCatalogue: NEW_KEYS.filter((k) => !present.has(k)),
    grants: [],
    alreadyHeld: 0,
    withheld: [],
  };
  for (const role of roles) {
    const held = new Set(role.rolePermissions.map((rp) => keyOf(rp.permission)));
    const slug = slugById.get(role.organizationId) ?? role.organizationId;
    for (const permission of SEEDED_KEYS.get(role.key!) ?? []) {
      if (held.has(permission)) {
        plan.alreadyHeld++;
        continue;
      }
      const lacks = REPLACES[permission]!;
      if (!held.has(lacks)) {
        plan.withheld.push({ slug, roleKey: role.key!, permission, lacks });
        continue;
      }
      plan.grants.push({
        organizationId: role.organizationId,
        slug,
        roleId: role.id,
        roleKey: role.key!,
        roleName: role.nameEn,
        roleActive: role.isActive,
        holders: role._count.userRoles,
        permission,
      });
    }
  }
  return plan;
}

/** Writes the plan: catalogue rows, grants and one audit row per grant, in ONE transaction. */
export async function applyGrants(prisma: Client, plan: GrantPlan): Promise<number> {
  return prisma.$transaction(async (tx) => {
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
    let written = 0;
    for (const g of plan.grants) {
      // The unique (roleId, permissionId) makes a concurrent second run fail
      // the whole transaction rather than grant twice.
      const created = await tx.rolePermission.create({
        data: { roleId: g.roleId, permissionId: ids.get(g.permission)! },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: g.organizationId,
          actorId: null,
          action: 'CREATE',
          objectType: 'RolePermission',
          objectId: created.id,
          after: { roleId: g.roleId, roleKey: g.roleKey, permission: g.permission },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            grantedPermission: g.permission,
            replaces: REPLACES[g.permission],
            reason: 'Per-type task keys, seeded for new organisations; granted to existing system roles that hold the key it replaces.',
          },
        },
      });
      written++;
    }
    return written;
  });
}

function report(plan: GrantPlan, execute: boolean): void {
  console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — granting the committee task keys (${TICKET})\n`);
  console.log(`Organizations in this database (${plan.organizations.length}):`);
  for (const o of plan.organizations) console.log(`  ${o.slug.padEnd(22)} ${o.kind}`);
  console.log(
    `\nCatalogue rows ${execute ? 'to upsert' : 'missing'}: ${plan.missingCatalogue.length ? plan.missingCatalogue.join(', ') : 'none'}`,
  );
  console.log(`\n${execute ? 'Granting' : 'Would grant'} ${plan.grants.length} key(s):`);
  let last = '';
  for (const g of plan.grants) {
    const head = `${g.slug} / ${g.roleKey}`;
    if (head !== last) {
      console.log(`  ${g.slug.padEnd(22)} ${g.roleKey.padEnd(16)} (${g.holders} active holder(s)${g.roleActive ? '' : ', role inactive'})`);
      last = head;
    }
    console.log(`  ${''.padEnd(22)}   + ${g.permission}`);
  }
  if (plan.grants.length === 0) console.log('  (nothing to grant)');
  console.log(`\nAlready held, left alone: ${plan.alreadyHeld}`);
  console.log(`Withheld (the role lacks the key the new one replaces): ${plan.withheld.length}`);
  for (const w of plan.withheld) console.log(`  ${w.slug.padEnd(22)} ${w.roleKey.padEnd(16)} ${w.permission} (lacks ${w.lacks})`);
  console.log(`\n${execute ? 'Writing' : 'Would write'} ${plan.grants.length} AuditLog row(s), one per grant.`);
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
    if (plan.grants.length === 0 && plan.missingCatalogue.length === 0) {
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
