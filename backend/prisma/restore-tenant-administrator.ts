// ACC-120 — RESTORE AN ACTIVE ADMINISTRATOR TO A TENANT THAT HAS NONE.
//
// This is the recovery path for the one state the root-role invariant cannot
// prevent and cannot fix by itself: a tenant with zero active holders of
// TENANT_ADMIN. The invariant deliberately ALLOWS mutations in such a tenant
// (refusing them would block the very changes needed to recover), so the hole
// has to be closed from outside the API — which is what this does.
//
// IT EXISTS SO THE GUARD CAN BE TESTED LIVE. Ahmad authorised locking the dev
// tenant to prove the refusal works in a browser, on the basis that the
// database can be rewritten to recover. A recovery path nobody has executed is
// a plan, not a recovery path — so this was run end to end against al-manara
// before al-nakheel was touched: broken deliberately, confirmed in breach,
// restored, and confirmed identical to its starting state.
//
// ## Usage
//
//   npm run restore:tenant-admin -- --org al-nakheel                  (report)
//   npm run restore:tenant-admin -- --org al-nakheel --email a@b.test (report)
//   npm run restore:tenant-admin -- --org al-nakheel --email a@b.test --apply
//
// Dry run by default, like every other script here. With no --email it reports
// the tenant's state and lists the ACTIVE users who could be given the role,
// so the operator chooses a real person rather than the script guessing.
//
// ## What it will and will not do
//
//   - It REACTIVATES the TENANT_ADMIN role if it was deactivated, because a
//     tenant whose root role is inactive is locked out just as surely (an
//     inactive role grants nothing — getUserPermissions() filters on it).
//   - It GRANTS the role to the named user, who must be ACTIVE and in that
//     organisation. An INVITED or INACTIVE user cannot administer anything, so
//     naming one is refused rather than silently "fixed".
//   - It will NOT reactivate a user. Bringing someone's account back is a
//     decision about a person, not a repair to a role, and it belongs to
//     whoever runs the tenant.
//   - It does NOT restore the role's permission set. The set is frozen and
//     seeded; if it has been emptied, re-run the role seed instead.
//
// ## It writes via direct Prisma, so it leaves NO audit trail
//
// Stated rather than discovered later. Every script in this directory bypasses
// AuditLogService the same way (CLAUDE.md records this under ACC-101: "a
// backfill that modifies TENANT data must write to that tenant's audit
// trail — today none do"). For a customer tenant that is not acceptable and
// this script is not the tool; for dev recovery it is the point, because the
// API path is exactly what is refusing.
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const TENANT_ADMIN_KEY = 'TENANT_ADMIN';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const slug = arg('org');
  const email = arg('email')?.toLowerCase();
  const apply = process.argv.includes('--apply');

  if (!slug) {
    throw new Error('Pass --org <slug>, e.g. --org al-nakheel');
  }

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const org = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true, slug: true, isPlatformOrg: true },
    });
    if (!org) throw new Error(`No organization with slug '${slug}'`);
    if (org.isPlatformOrg) {
      throw new Error(
        `'${slug}' is the PLATFORM organization. It holds no tenant administrator by ` +
          `design — its people hold PLATFORM_ADMIN — and the invariant excludes it.`,
      );
    }

    const role = await prisma.role.findFirst({
      where: { organizationId: org.id, key: TENANT_ADMIN_KEY },
      select: { id: true, nameEn: true, isActive: true },
    });
    if (!role) {
      throw new Error(
        `'${slug}' has no ${TENANT_ADMIN_KEY} role at all. That is a seeding failure, ` +
          `not a lockout — run the role seed for this tenant.`,
      );
    }

    // The invariant's own definition, deliberately duplicated here rather than
    // imported: this script must be able to report the truth even if the
    // application code is mid-change, which is the situation it exists for.
    const activeHolders = await prisma.userRole.findMany({
      where: { roleId: role.id, user: { organizationId: org.id, status: 'ACTIVE' } },
      select: { id: true, user: { select: { email: true, name: true } } },
    });

    console.log(`\norganization   ${org.slug} (${org.id})`);
    console.log(`role           "${role.nameEn}" isActive=${role.isActive}`);
    console.log(`active holders ${activeHolders.length}`);
    for (const h of activeHolders) {
      console.log(`                 - ${h.user?.email} (${h.user?.name})`);
    }
    if (activeHolders.length > 0 && role.isActive) {
      console.log(`\nThis tenant is NOT locked out. Nothing to restore.`);
    }

    if (!email) {
      const candidates = await prisma.user.findMany({
        where: { organizationId: org.id, status: 'ACTIVE' },
        select: { email: true, name: true },
        orderBy: { email: 'asc' },
        take: 25,
      });
      console.log(`\nACTIVE users who could be given the role (first ${candidates.length}):`);
      for (const c of candidates) console.log(`  ${c.email}  (${c.name})`);
      console.log(`\nRe-run with --email <one of these> --apply\n`);
      return;
    }

    const user = await prisma.user.findFirst({
      where: { organizationId: org.id, email },
      select: { id: true, email: true, name: true, status: true },
    });
    if (!user) throw new Error(`No user '${email}' in '${slug}'`);
    if (user.status !== 'ACTIVE') {
      throw new Error(
        `'${email}' is ${user.status}, not ACTIVE. An ${user.status} account cannot ` +
          `administer anything, so granting the role would leave the tenant locked out ` +
          `while looking repaired. Reactivate the person first, deliberately.`,
      );
    }

    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId: role.id },
      select: { id: true },
    });

    console.log(`\nPLAN for ${email}:`);
    console.log(`  reactivate role   ${role.isActive ? 'not needed' : 'YES'}`);
    console.log(`  grant role        ${existing ? 'already held' : 'YES'}`);

    if (!apply) {
      console.log(`\nDRY RUN — nothing written. Add --apply to write.\n`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (!role.isActive) {
        await tx.role.update({ where: { id: role.id }, data: { isActive: true } });
      }
      if (!existing) {
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      }
    });

    const after = await prisma.userRole.count({
      where: { roleId: role.id, user: { organizationId: org.id, status: 'ACTIVE' } },
    });
    const roleAfter = await prisma.role.findUnique({
      where: { id: role.id },
      select: { isActive: true },
    });

    console.log(`\nAPPLIED. active holders now ${after}, role isActive=${roleAfter?.isActive}`);
    if (after === 0) {
      throw new Error(
        'Still zero active holders after writing. Something else is wrong — do not ' +
          'assume this succeeded.',
      );
    }
    console.log('');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
