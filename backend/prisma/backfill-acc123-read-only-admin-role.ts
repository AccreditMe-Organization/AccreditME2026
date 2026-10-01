// One-off backfill for ACC-123 — creates the READ_ONLY_ADMIN system role in
// every existing organization, grants it its 22 permissions, and gives it to
// the persona each seeded fixture declares.
//
// ## Why a backfill at all
//
// seedSystemRoles() runs inside bootstrap(), so a tenant provisioned AFTER this
// ticket gets the role for free. Organizations provisioned before it have their
// Role and RolePermission rows snapshotted from the seed as it was, and will not
// gain a new role just because the seed source changed. On dev that is the
// platform org and the two realistic tenants.
//
// ## Why NOT seedSystemRoles()
//
// It does deleteMany({ roleId }) and recreates from the seed for EVERY role in
// SYSTEM_ROLE_SEED. Running it to add one role would reset every permission on
// every system role in the tenant, discarding any customisation an admin made —
// and roles are fully tenant-editable. Same reasoning as
// backfill-remove-base-user-tasks-view.ts and backfill-setup-view-permission.ts:
// write exactly the rows named and nothing else.
//
// ## Additive, so the ORDER against the deploy does not matter
//
// Unlike backfill-admin-access-permission.ts — which had to run BEFORE its code,
// because admin:access gates something that already worked — this one creates a
// role nobody holds yet. Nothing is withdrawn and no existing user's access
// changes. Running it early costs nothing; running it late means the persona
// cannot reach the Administration section until it has run, and nothing else.
//
// ## The persona half, and why it is in here rather than in a reseed
//
// Both fixtures now declare a READ_ONLY_ADMIN persona (hospital: Noura
// Al-Ghamdi; university: Prof. Salma Al-Falasi), and validateFixture()'s
// completeness check REQUIRES one — a seeded system role with no credentialed
// holder fails the fixture spec. But picking that declaration up would mean
// re-running seed:realistic, which resets the shared dev database the Railway
// dev deployment also uses. So this script grants the declared persona directly,
// READING the fixtures rather than hardcoding a name, which keeps the two from
// disagreeing. An organization that matches no fixture (the platform org) gets
// the role and no holder, which is correct: nobody administers the platform org
// through the tenant shell.
//
// The role is created in EVERY organization, platform org included, because that
// is what seedSystemRoles() would produce and divergence from the seed is what
// bites a later bootstrap. PLATFORM_ADMIN is seeded into every tenant on exactly
// the same reasoning (ACC-13) — inert there, and harmless.
//
// DRY RUN BY DEFAULT. Pass --execute to write. The dry run prints the same
// per-organization detail the execute path acts on.
//
// Idempotent — a second run finds everything present and writes nothing.
//
// Run: npm run backfill:acc123-read-only-admin-role              (dry run)
//      npm run backfill:acc123-read-only-admin-role -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { SYSTEM_ROLE_SEED } from '../src/foundation/roles/role.seed';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

const ROLE_KEY = 'READ_ONLY_ADMIN';
const FIXTURES = [HOSPITAL_FIXTURE, UNIVERSITY_FIXTURE];

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const seedRole = SYSTEM_ROLE_SEED.find((r) => r.key === ROLE_KEY);
    if (!seedRole) {
      throw new Error(
        `${ROLE_KEY} is not in SYSTEM_ROLE_SEED. This script backfills that seed entry; ` +
          'without it there is nothing to create, and the role was presumably renamed.',
      );
    }

    console.log(
      `\n${execute ? 'EXECUTING' : 'DRY RUN'} — ${ROLE_KEY} (${seedRole.nameEn}), ` +
        `${seedRole.permissions.length} permissions\n`,
    );

    // -- Permission catalogue --------------------------------------------------
    // Every one of these 22 is long-established, so a missing row would mean the
    // catalogue itself is unseeded rather than that this role needs a new
    // permission. Reported as a failure instead of being silently upserted away.
    const permissionIdByKey = new Map<string, string>();
    const missingFromCatalogue: string[] = [];
    for (const key of seedRole.permissions) {
      const [module, action] = key.split(':') as [string, string];
      const row = await prisma.permission.findFirst({ where: { module, action } });
      if (row) permissionIdByKey.set(key, row.id);
      else missingFromCatalogue.push(key);
    }
    if (missingFromCatalogue.length > 0) {
      throw new Error(
        `Not in the Permission catalogue: ${missingFromCatalogue.join(', ')}. ` +
          'Run the permission seed first — this script grants existing permissions, ' +
          'it does not invent them.',
      );
    }
    console.log(`Permission catalogue: all ${permissionIdByKey.size} present.\n`);

    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true, isPlatformOrg: true },
      orderBy: { createdAt: 'asc' },
    });

    let rolesCreated = 0;
    let rolesFound = 0;
    let grantsCreated = 0;
    let personasGranted = 0;
    let personasAlreadyHeld = 0;

    for (const org of organizations) {
      const label = `${org.slug}${org.isPlatformOrg ? ' (platform)' : ''}`;
      let role = await prisma.role.findFirst({
        where: { organizationId: org.id, key: ROLE_KEY },
        select: { id: true },
      });

      if (role) {
        console.log(`  ${label} — role exists`);
        rolesFound++;
      } else if (execute) {
        role = await prisma.role.create({
          data: {
            organizationId: org.id,
            key: ROLE_KEY,
            nameEn: seedRole.nameEn,
            nameAr: seedRole.nameAr,
            description: seedRole.description,
            isSystem: true,
          },
          select: { id: true },
        });
        console.log(`  ${label} — role CREATED`);
        rolesCreated++;
      } else {
        console.log(`  ${label} — would CREATE the role and all ${seedRole.permissions.length} grants`);
        rolesCreated++;
        // Counted here because the grants block below needs a role id and so is
        // skipped on a dry run. Without this the summary read "Grants to create: 0"
        // while the line above said 22 — and a summary is what gets approved.
        grantsCreated += seedRole.permissions.length;
      }

      // -- Grants -------------------------------------------------------------
      // Additive only, scoped to this one role's id. Never a deleteMany.
      if (role) {
        const roleId = role.id;
        const held = new Set(
          (
            await prisma.rolePermission.findMany({
              where: { roleId },
              select: { permissionId: true },
            })
          ).map((r) => r.permissionId),
        );
        const toAdd = [...permissionIdByKey.values()].filter((id) => !held.has(id));
        if (toAdd.length > 0) {
          console.log(
            `      ${execute ? 'granting' : 'would grant'} ${toAdd.length} permission(s)`,
          );
          if (execute) {
            await prisma.rolePermission.createMany({
              data: toAdd.map((permissionId) => ({ roleId, permissionId })),
            });
          }
          grantsCreated += toAdd.length;
        }
      }

      // -- Persona ------------------------------------------------------------
      const fixture = FIXTURES.find((f) => f.slug === org.slug);
      if (!fixture) {
        console.log('      no fixture for this organization, so no holder');
        continue;
      }
      const persona = fixture.systemRolePersonas.find((p) => p.roleKey === ROLE_KEY);
      if (!persona) {
        console.log(`      fixture declares no ${ROLE_KEY} persona`);
        continue;
      }
      const person = fixture.people.find((p) => p.key === persona.holder);
      if (!person) {
        throw new Error(
          `Fixture '${fixture.slug}' names holder '${persona.holder}', who is not in its people list.`,
        );
      }
      const email = `${person.emailLocal}@${fixture.emailDomain}`;
      const user = await prisma.user.findFirst({
        where: { organizationId: org.id, email },
        select: { id: true, name: true, status: true },
      });
      if (!user) {
        console.log(`      holder ${email} not found here, skipped`);
        continue;
      }
      // An inactive holder cannot sign in, so the grant would demonstrate
      // nothing — the same reason validateFixture() refuses a departed persona.
      if (user.status !== 'ACTIVE') {
        console.log(`      holder ${user.name} is ${user.status}, not ACTIVE, skipped`);
        continue;
      }
      if (!role) {
        console.log(`      would grant to ${user.name} (${email}) once the role exists`);
        personasGranted++;
        continue;
      }
      const existing = await prisma.userRole.findFirst({
        where: { userId: user.id, roleId: role.id },
        select: { id: true },
      });
      if (existing) {
        console.log(`      ${user.name} already holds it`);
        personasAlreadyHeld++;
        continue;
      }
      if (execute) {
        await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
        console.log(`      GRANTED to ${user.name} (${email})`);
      } else {
        console.log(`      would grant to ${user.name} (${email})`);
      }
      personasGranted++;
    }

    console.log('');
    console.log(`Organizations checked:  ${organizations.length}`);
    console.log(`Roles ${execute ? 'created' : 'to create'}:       ${rolesCreated}`);
    console.log(`Roles already present:  ${rolesFound}`);
    console.log(`Grants ${execute ? 'created' : 'to create'}:      ${grantsCreated}`);
    console.log(`Personas ${execute ? 'granted' : 'to grant'}:     ${personasGranted}`);
    console.log(`Personas already held:  ${personasAlreadyHeld}`);

    if (!execute) {
      console.log('\nDry run only. Re-run with --execute to write.\n');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
