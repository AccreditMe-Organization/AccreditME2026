// One-off backfill for ACC-244 PR 2 — RETIRES the four flat task keys:
// tasks:view, tasks:create, tasks:reassign and tasks:manage.
//
// WHY. PR 2 moved every task path onto the per-type keys
// (committees:view_all_tasks, …) and the one visibility rule
// (src/foundation/task/task-visibility.ts). Nothing reads the flat keys any
// more — retired-task-keys.spec.ts fails if anything does — and they left the
// catalogue and the seed. Existing roles still HOLD them, as rows that grant
// nothing; the permission matrix would show nothing for them, and a reader of
// a role's permissions would think they meant something. This removes them.
//
// WHAT IS REMOVED:
//   1. every RolePermission row granting one of the four keys, in every role
//      (system or custom) of the organisations in scope;
//   2. then each key's Permission catalogue row, once no RolePermission
//      anywhere still references it. The catalogue is shared by every
//      organisation, so a run limited to some of them may leave a row, and
//      says so.
//
// A REVOCATION BACKFILL IS PERMITTED ONLY WHILE NO CUSTOMER TENANT EXISTS
// (CLAUDE.md, ACC-101). --execute REFUSES if a customer organisation holds one
// of the keys: taking a key away may overwrite a choice a customer made, and
// that is a customer-notified change, not a script. A dry run still reports.
// It also REFUSES if a workflow transition in scope is gated on one of the
// keys: nobody could hold it, so that transition could never be fired again.
//
// WHAT IT CHANGES FOR PEOPLE: nothing, once PR 2 is deployed. The rule reads
// none of these keys, so each user's visible-task count is the same before
// and after the revocation, and the report prints both, per user, computed by
// the rule itself (TaskVisibilityService.countVisible). A difference is a
// defect in PR 2, and --execute refuses it.
//
// THE AUDIT TRAIL (CLAUDE.md, ACC-101): ONE AuditLog row PER REVOCATION, in the
// organisation whose role lost it — DELETE / RolePermission, objectId the
// removed row, the role and key in `before`. actorId is null: no person did
// this. The script and ticket are in metadata.
//
// IDEMPOTENT. A second run finds no rows and writes nothing. Everything
// --execute writes is ONE transaction (BACKFILL_TX), so a role never loses a
// key without its audit row.
//
// RUN --execute ONLY AFTER PR 2 IS DEPLOYED, dry run first. Never --execute
// against the shared database from a branch.
//
// Run: npm run backfill:acc244-retire-flat-task-keys               (dry run)
//      npm run backfill:acc244-retire-flat-task-keys -- --execute

import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaskAuthorityService } from '../src/foundation/task/task-authority.service';
import { TaskVisibilityService } from '../src/foundation/task/task-visibility.service';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc244-retire-flat-task-keys';
export const TICKET = 'ACC-244';

/** Literals on purpose: the constant that named them is gone. */
export const RETIRED_KEYS: readonly string[] = ['tasks:view', 'tasks:create', 'tasks:reassign', 'tasks:manage'];

// The transaction is up to four catalogue deletes plus two writes per
// revocation, each a round trip. Prisma's 5-second default is not enough from
// a developer machine (ACC-244 PR 1's grant rolled back at 5.4 s).
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
type Kind = 'platform org' | 'seeded fixture' | 'customer';

export interface PlannedRevocation {
  organizationId: string;
  slug: string;
  kind: Kind;
  rolePermissionId: string;
  roleId: string;
  roleKey: string | null;
  roleName: string;
  permission: string;
  holders: number;
}

export interface UserCount {
  slug: string;
  userId: string;
  name: string;
  before: number;
  after: number;
}

export interface RetirePlan {
  organizations: { id: string; slug: string; kind: Kind }[];
  revocations: PlannedRevocation[];
  /** Transitions in scope gated on a retired key — each refuses --execute. */
  gatedTransitions: { slug: string; transitionId: string; labelEn: string; permission: string }[];
  /** Catalogue rows present now. */
  catalogue: string[];
  users: UserCount[];
}

const keyOf = (p: { module: string; action: string }) => `${p.module}:${p.action}`;
const RETIRED_WHERE = { OR: RETIRED_KEYS.map((k) => ({ module: k.split(':')[0]!, action: k.split(':')[1]! })) };

/** Each ACTIVE user's permissions, the same resolution as RoleService.getUserPermissions(). */
async function permissionsByUser(prisma: PrismaService, organizationId: string): Promise<Map<string, { name: string; keys: Set<string> }>> {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      userRoles: {
        where: { role: { isActive: true, organizationId } },
        select: { role: { select: { rolePermissions: { select: { permission: { select: { module: true, action: true } } } } } } },
      },
    },
    orderBy: { name: 'asc' },
  });
  return new Map(
    users.map((u) => [
      u.id,
      { name: u.name, keys: new Set(u.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => keyOf(rp.permission)))) },
    ]),
  );
}

/** Reads only. What --execute would write, and each user's count either side of it. */
export async function planRetirement(
  prisma: PrismaService,
  visibility: TaskVisibilityService,
  options: { onlyOrganizationIds?: readonly string[]; now?: Date } = {},
): Promise<RetirePlan> {
  const now = options.now ?? new Date();
  const organizations = (
    await prisma.organization.findMany({
      where: options.onlyOrganizationIds ? { id: { in: [...options.onlyOrganizationIds] } } : undefined,
      select: { id: true, slug: true, isPlatformOrg: true },
      orderBy: { slug: 'asc' },
    })
  ).map((o) => ({
    id: o.id,
    slug: o.slug,
    kind: (o.isPlatformOrg ? 'platform org' : FIXTURE_SLUGS.has(o.slug) ? 'seeded fixture' : 'customer') as Kind,
  }));
  const orgIds = organizations.map((o) => o.id);
  const orgById = new Map(organizations.map((o) => [o.id, o]));

  const rows = await prisma.rolePermission.findMany({
    where: { permission: RETIRED_WHERE, role: { organizationId: { in: orgIds } } },
    select: {
      id: true,
      permission: { select: { module: true, action: true } },
      role: {
        select: {
          id: true,
          key: true,
          nameEn: true,
          organizationId: true,
          _count: { select: { userRoles: { where: { user: { status: 'ACTIVE' } } } } },
        },
      },
    },
  });
  const revocations: PlannedRevocation[] = rows
    .map((r) => {
      const org = orgById.get(r.role.organizationId)!;
      return {
        organizationId: org.id,
        slug: org.slug,
        kind: org.kind,
        rolePermissionId: r.id,
        roleId: r.role.id,
        roleKey: r.role.key,
        roleName: r.role.nameEn,
        permission: keyOf(r.permission),
        holders: r.role._count.userRoles,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.roleName.localeCompare(b.roleName) || a.permission.localeCompare(b.permission));

  const transitions = await prisma.workflowTransition.findMany({
    where: { requiredPermission: { in: [...RETIRED_KEYS] }, fromStage: { workflowTemplate: { organizationId: { in: orgIds } } } },
    select: { id: true, labelEn: true, requiredPermission: true, fromStage: { select: { workflowTemplate: { select: { organizationId: true } } } } },
  });
  const catalogue = (await prisma.permission.findMany({ where: RETIRED_WHERE, select: { module: true, action: true } })).map(keyOf).sort();

  // Each user's visible-task count, by the rule, with today's permissions and
  // with the retired keys taken away.
  const users: UserCount[] = [];
  for (const org of organizations) {
    for (const [userId, { name, keys }] of await permissionsByUser(prisma, org.id)) {
      const before = [...keys];
      const after = before.filter((k) => !RETIRED_KEYS.includes(k));
      const [ctxBefore, ctxAfter] = await Promise.all([
        visibility.contextFor({ id: userId, permissions: before }, org.id, now),
        visibility.contextFor({ id: userId, permissions: after }, org.id, now),
      ]);
      users.push({
        slug: org.slug,
        userId,
        name,
        before: await visibility.countVisible(ctxBefore),
        after: await visibility.countVisible(ctxAfter),
      });
    }
  }

  return {
    organizations,
    revocations,
    gatedTransitions: transitions.map((t) => ({
      slug: orgById.get(t.fromStage.workflowTemplate.organizationId)!.slug,
      transitionId: t.id,
      labelEn: t.labelEn,
      permission: t.requiredPermission!,
    })),
    catalogue,
    users,
  };
}

/** Why --execute must not run, or an empty list. */
export function refusals(plan: RetirePlan): string[] {
  const out: string[] = [];
  const customers = [...new Set(plan.revocations.filter((r) => r.kind === 'customer').map((r) => r.slug))];
  if (customers.length) {
    out.push(`${customers.join(', ')}: a customer organisation holds a retired key — a revocation there is a customer-notified change (ACC-101).`);
  }
  for (const t of plan.gatedTransitions) out.push(`${t.slug}: transition "${t.labelEn}" (${t.transitionId}) is gated on ${t.permission}.`);
  for (const u of plan.users.filter((x) => x.before !== x.after)) {
    out.push(`${u.slug}: ${u.name} would see ${u.before} → ${u.after} tasks — the rule still reads a retired key.`);
  }
  return out;
}

/** Writes the plan: revocations, one audit row each, then unreferenced catalogue rows — ONE transaction. */
export async function applyRetirement(prisma: PrismaService, plan: RetirePlan): Promise<{ revoked: number; catalogueDeleted: string[] }> {
  return prisma.$transaction(async (tx) => {
    let revoked = 0;
    for (const r of plan.revocations) {
      // deleteMany: a concurrent run that already removed the row deletes 0,
      // and then writes no audit row for a revocation it did not make.
      const { count } = await tx.rolePermission.deleteMany({ where: { id: r.rolePermissionId, roleId: r.roleId } });
      if (count === 0) continue;
      await tx.auditLog.create({
        data: {
          organizationId: r.organizationId,
          actorId: null,
          action: 'DELETE',
          objectType: 'RolePermission',
          objectId: r.rolePermissionId,
          before: { roleId: r.roleId, roleKey: r.roleKey, permission: r.permission },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            revokedPermission: r.permission,
            reason: 'Flat task key retired: every task path reads the per-type task keys and one visibility rule; this key granted nothing.',
          },
        },
      });
      revoked++;
    }
    const catalogueDeleted: string[] = [];
    for (const key of RETIRED_KEYS) {
      const [module, action] = key.split(':') as [string, string];
      const row = await tx.permission.findUnique({ where: { module_action: { module, action } }, select: { id: true } });
      if (!row) continue;
      if ((await tx.rolePermission.count({ where: { permissionId: row.id } })) > 0) continue;
      await tx.permission.delete({ where: { id: row.id } });
      catalogueDeleted.push(key);
    }
    return { revoked, catalogueDeleted };
  }, BACKFILL_TX);
}

function report(plan: RetirePlan, execute: boolean, refused: string[]): void {
  console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — retiring the flat task keys (${TICKET})\n`);
  console.log(`Organizations in scope (${plan.organizations.length}):`);
  for (const o of plan.organizations) console.log(`  ${o.slug.padEnd(22)} ${o.kind}`);

  console.log(`\n${execute ? 'Revoking' : 'Would revoke'} ${plan.revocations.length} grant(s):`);
  let last = '';
  for (const r of plan.revocations) {
    const head = `${r.slug} / ${r.roleId}`;
    if (head !== last) {
      console.log(`  ${r.slug.padEnd(22)} ${(r.roleKey ?? r.roleName).padEnd(20)} (${r.holders} active holder(s))`);
      last = head;
    }
    console.log(`  ${''.padEnd(22)}   - ${r.permission}`);
  }
  if (plan.revocations.length === 0) console.log('  (nothing to revoke)');
  console.log(`\nCatalogue rows present: ${plan.catalogue.length ? plan.catalogue.join(', ') : 'none'}`);
  console.log(`Workflow transitions gated on a retired key: ${plan.gatedTransitions.length}`);

  console.log(`\nVisible tasks per active user, by the rule (before → after the revocation):`);
  for (const u of plan.users) {
    const mark = u.before === u.after ? '' : '   ← CHANGES';
    console.log(`  ${u.slug.padEnd(22)} ${u.name.padEnd(28)} ${String(u.before).padStart(4)} → ${String(u.after).padEnd(4)}${mark}`);
  }
  const changed = plan.users.filter((u) => u.before !== u.after).length;
  console.log(`  ${plan.users.length} user(s), ${changed} changed.`);
  console.log(`\n${execute ? 'Writing' : 'Would write'} ${plan.revocations.length} AuditLog row(s), one per revocation.`);
  if (refused.length) {
    console.log(`\n${execute ? 'REFUSED' : 'Would REFUSE --execute'}:`);
    for (const r of refused) console.log(`  ${r}`);
  }
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const prisma = new PrismaService();
  try {
    const visibility = new TaskVisibilityService(prisma, new TaskAuthorityService(prisma));
    const plan = await planRetirement(prisma, visibility);
    const refused = refusals(plan);
    report(plan, execute, refused);
    if (!execute) {
      console.log('\nDry run only. Re-run with -- --execute to apply.\n');
      return;
    }
    if (refused.length) {
      process.exitCode = 1;
      return;
    }
    if (plan.revocations.length === 0 && plan.catalogue.length === 0) {
      console.log('\nNothing to change.\n');
      return;
    }
    const { revoked, catalogueDeleted } = await applyRetirement(prisma, plan);
    console.log(`\nRevoked ${revoked} grant(s), wrote ${revoked} audit row(s).`);
    console.log(`Catalogue rows deleted: ${catalogueDeleted.length ? catalogueDeleted.join(', ') : 'none'}.\n`);
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
