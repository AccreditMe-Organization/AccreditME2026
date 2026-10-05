// One-off backfill for ACC-162 — retires tasks:complete from every existing
// organization: every role grant of it, then the global Permission catalog
// row itself.
//
// WHY IT IS RETIRED. ACC-76 ungated POST /tasks/:id/complete and ACC-162
// ungated POST /tasks/:id/evidence, both because the action is self-scoped —
// TaskService refuses anyone who is not a currently-active assignee. That left
// tasks:complete gating nothing anywhere: a permission an admin could grant,
// and that read like task authority, while doing nothing. The constant is gone
// from TASKS_PERMISSIONS, so new tenants are never seeded with it; this removes
// it from the tenants that already exist.
//
// WHY THE CATALOG ROW GOES TOO. RoleService.seedPermissions() only UPSERTS the
// catalog from ALL_PERMISSIONS; it never deletes a row the constants no longer
// name. Left in place, the role permission matrix (listAllPermissions()) would
// keep offering tasks:complete and resolvePermissionIds() would keep accepting
// it. Deleted, an attempt to grant it is refused as an unknown key.
//
// THREE CONDITIONS, each checked before anything is removed:
//
// 1. NO CUSTOMER TENANT EXISTS (CLAUDE.md, ACC-101). A revocation may overwrite
//    a decision a customer made, because roles are tenant-editable; it is
//    permitted only while every organization is the platform org or a seeded
//    fixture. EVERY organization is checked, not only those holding a grant,
//    because deleting the catalog row reaches every tenant at once.
//
// 2. NO WORKFLOW TRANSITION REQUIRES IT. WorkflowTransition.requiredPermission
//    is a free string. A transition requiring tasks:complete, once nobody can
//    hold it, is a transition nobody can fire. No seeded transition does; a
//    tenant-edited one might. Any found are listed and --execute refuses.
//
// 3. THE AUDIT TRAIL RECORDS IT (CLAUDE.md, ACC-101: "a backfill that modifies
//    TENANT data must write to that tenant's audit trail"). This is the first
//    backfill that does. One row per organization whose roles lose the
//    permission, in the shape RoleService.assignPermissions() writes —
//    UPDATE / RolePermission, with each affected role's full permission set
//    before and after. objectId is null because the row covers several roles.
//    actorId is null: no person did this, and there is no system-actor user —
//    inventing one would put a name on the trail that answers nothing. The
//    script and ticket are named in metadata instead.
//
// WHY NOT seedSystemRoles(): it deletes and recreates every RolePermission row
// for each system role, so running it to propagate one removal would reset
// every tenant customisation. This deletes exactly the rows it lists — the
// same narrow-blast-radius rule backfill-remove-base-user-tasks-view.ts set.
//
// RUN --execute ONLY AFTER THIS CODE IS DEPLOYED. seedPermissions() runs on
// every tenant bootstrap and upserts the catalog from ALL_PERMISSIONS, so an
// older deployment still naming tasks:complete would recreate the catalog row
// the first time anyone creates a tenant. A re-run of the dry run shows it.
//
// Everything --execute writes happens in ONE transaction, so a tenant can never
// lose the grant without the audit row that says so.
//
// DRY RUN BY DEFAULT. Pass --execute to apply. Idempotent: once the catalog row
// is gone there is nothing left to find, and a re-run reports exactly that.
//
// Run: npm run backfill:retire-tasks-complete            (dry run)
//      npm run backfill:retire-tasks-complete -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

// A literal, not TASKS_PERMISSIONS.COMPLETE: that constant no longer exists,
// which is the point of this script.
const RETIRED_PERMISSION = 'tasks:complete';
const SCRIPT_NAME = 'backfill-retire-tasks-complete';
const TICKET = 'ACC-162';

// Read from the fixtures rather than retyped, so a renamed fixture cannot make
// this script mistake it for a customer — or a customer for it.
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

interface AffectedRole {
  roleId: string;
  roleKey: string | null; // null for a tenant's own custom role
  roleName: string;
  holders: number;
  permissionsBefore: string[];
}

interface AffectedOrg {
  organizationId: string;
  slug: string;
  roles: AffectedRole[];
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [module, action] = RETIRED_PERMISSION.split(':') as [string, string];
    console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — retiring ${RETIRED_PERMISSION} (${TICKET})\n`);

    // ── Condition 1: every organization is the platform org or a fixture ──────
    const organizations = await prisma.organization.findMany({
      select: { id: true, slug: true, isPlatformOrg: true },
      orderBy: { slug: 'asc' },
    });
    const customers = organizations.filter((o) => !o.isPlatformOrg && !FIXTURE_SLUGS.has(o.slug));

    console.log(`Organizations in this database (${organizations.length}):`);
    for (const o of organizations) {
      const kind = o.isPlatformOrg ? 'platform org' : FIXTURE_SLUGS.has(o.slug) ? 'seeded fixture' : 'NOT A FIXTURE';
      console.log(`  ${o.slug.padEnd(22)} ${kind}`);
    }

    const permission = await prisma.permission.findFirst({ where: { module, action } });
    if (!permission) {
      console.log(`\n${RETIRED_PERMISSION} is not in the Permission catalog — already retired, nothing to do.\n`);
      return;
    }

    // ── What would be removed: every role grant, grouped by organization ──────
    const grants = await prisma.rolePermission.findMany({
      where: { permissionId: permission.id },
      select: {
        role: {
          select: {
            id: true,
            key: true,
            nameEn: true,
            organizationId: true,
            rolePermissions: { select: { permission: { select: { module: true, action: true } } } },
            _count: { select: { userRoles: { where: { user: { status: 'ACTIVE' } } } } },
          },
        },
      },
    });

    const slugById = new Map(organizations.map((o) => [o.id, o.slug]));
    const byOrg = new Map<string, AffectedOrg>();
    for (const { role } of grants) {
      const entry = byOrg.get(role.organizationId) ?? {
        organizationId: role.organizationId,
        slug: slugById.get(role.organizationId) ?? role.organizationId,
        roles: [],
      };
      entry.roles.push({
        roleId: role.id,
        roleKey: role.key,
        roleName: role.nameEn,
        holders: role._count.userRoles,
        permissionsBefore: role.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`).sort(),
      });
      byOrg.set(role.organizationId, entry);
    }
    const affected = [...byOrg.values()].sort((a, b) => a.slug.localeCompare(b.slug));

    console.log(
      `\n${execute ? 'Removing' : 'Would remove'} ${grants.length} RolePermission row(s) ` +
        `across ${affected.length} organization(s):`,
    );
    for (const org of affected) {
      for (const r of org.roles) {
        // Reported per role, because who is affected is what an approver needs
        // — a role nobody holds is a different decision from one fifty hold.
        console.log(
          `  ${org.slug.padEnd(22)} role '${r.roleName}' (${r.roleKey ?? 'custom role'})  — held by ${r.holders} active user(s)`,
        );
      }
    }
    if (grants.length === 0) console.log('  (no role grants it)');

    console.log(`\n${execute ? 'Deleting' : 'Would delete'} the Permission catalog row ${RETIRED_PERMISSION} (id ${permission.id}).`);
    console.log(`${execute ? 'Writing' : 'Would write'} ${affected.length} AuditLog row(s), one per organization above.`);

    // ── Condition 2: no workflow transition requires it ───────────────────────
    const transitions = await prisma.workflowTransition.findMany({
      where: { requiredPermission: RETIRED_PERMISSION },
      select: {
        id: true,
        labelEn: true,
        fromStage: {
          select: {
            nameEn: true,
            workflowTemplate: { select: { nameEn: true, organizationId: true } },
          },
        },
      },
    });

    console.log(`\nWorkflow transitions requiring ${RETIRED_PERMISSION}: ${transitions.length}`);
    for (const t of transitions) {
      const tpl = t.fromStage.workflowTemplate;
      console.log(
        `  ${(slugById.get(tpl.organizationId) ?? tpl.organizationId).padEnd(22)} ` +
          `'${tpl.nameEn}' / stage '${t.fromStage.nameEn}' / transition '${t.labelEn}' (${t.id})`,
      );
    }

    // ── Verdict ───────────────────────────────────────────────────────────────
    const refusals: string[] = [];
    if (customers.length > 0) {
      refusals.push(
        `${customers.length} organization(s) are neither the platform org nor a seeded fixture ` +
          `(${customers.map((c) => c.slug).join(', ')}). CLAUDE.md (ACC-101) permits a revocation ` +
          'backfill only while no customer tenant exists. Their admins decide instead.',
      );
    }
    if (transitions.length > 0) {
      refusals.push(
        `${transitions.length} workflow transition(s) require ${RETIRED_PERMISSION}; removing it would ` +
          'leave them impossible to fire. Change their requiredPermission first.',
      );
    }

    if (refusals.length > 0) {
      console.log('\nREFUSED — --execute will not run:');
      for (const r of refusals) console.log(`  - ${r}`);
      console.log('');
      if (execute) process.exitCode = 1;
      return;
    }

    if (!execute) {
      console.log('\nAll conditions hold. Dry run only — re-run with --execute to apply.\n');
      return;
    }

    // ── Execute: grants, audit rows and catalog row in one transaction ────────
    const removedCount = await prisma.$transaction(async (tx) => {
      const result = await tx.rolePermission.deleteMany({ where: { permissionId: permission.id } });
      if (result.count !== grants.length) {
        throw new Error(
          `Expected to remove ${grants.length} row(s) but matched ${result.count}. ` +
            'The database changed between the dry run and the delete — re-run the dry run.',
        );
      }

      for (const org of affected) {
        await tx.auditLog.create({
          data: {
            organizationId: org.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'RolePermission',
            objectId: null,
            before: {
              roles: org.roles.map((r) => ({ roleId: r.roleId, roleKey: r.roleKey, permissions: r.permissionsBefore })),
            },
            after: {
              roles: org.roles.map((r) => ({
                roleId: r.roleId,
                roleKey: r.roleKey,
                permissions: r.permissionsBefore.filter((p) => p !== RETIRED_PERMISSION),
              })),
            },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              removedPermission: RETIRED_PERMISSION,
              reason: 'Permission retired: it gated no endpoint once completion and evidence became self-scoped.',
            },
          },
        });
      }

      await tx.permission.delete({ where: { id: permission.id } });
      return result.count;
    });

    console.log(
      `\nRemoved ${removedCount} role grant(s), wrote ${affected.length} audit row(s), ` +
        `deleted the ${RETIRED_PERMISSION} catalog row.\n`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
