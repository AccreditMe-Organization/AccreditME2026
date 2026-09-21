// ACC-62 — seeds two realistic tenants: a hospital and a university.
//
// PREREQUISITES, in order:
//   1. npm run db:reset:dev               (drops and rebuilds the schema)
//   2. npm run seed:demo                  (platform org + PLATFORM_ADMIN)
//   3. npm run seed:realistic             (this script)
//
// Step 1 is still THREE SEPARATE COMMANDS, deliberately. A committed
// "reset-and-seed" one-liner is exactly the thing that eventually gets run
// against the wrong database, so resetting stays its own act — ACC-107 gave
// it the guard it never had (it was a bare `prisma migrate reset --force`
// pointed at whatever DATABASE_URL said), without chaining it to this.
//
// Step 2 is required because this script needs a real actorId for audit
// logging — AuditLog.actorId is a foreign key to User, so an invented id
// would fail on the first write.
// ACC-107 — loaded explicitly rather than inherited. The guards below read
// process.env BEFORE Nest boots, so ConfigModule cannot have populated it;
// until now this worked only as a SIDE EFFECT of importing the generated
// Prisma client further down, which is not something a reader could know and
// not something an import reorder would preserve.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PlatformTenantService } from '../../src/platform/tenant/platform-tenant.service';
import { OrganizationService } from '../../src/foundation/organization/organization.service';
import { OrgUnitHeadService } from '../../src/foundation/organization/org-unit-head.service';
import { LookupService } from '../../src/foundation/lookup/lookup.service';
import { UserService } from '../../src/foundation/user/user.service';
import { CommitteesService } from '../../src/foundation/committees/committees.service';
import { RoleService } from '../../src/foundation/roles/role.service';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './fixtures/university.fixture';
import {
  TenantFixture,
  createSeedContext,
  flattenUnits,
  validateFixture,
} from './fixtures/fixture.types';
import { applyOrgTree } from './apply/apply-org-tree';
import { SEED_PASSWORD, applyPeople } from './apply/apply-people';
import { applyCustomRoles } from './apply/apply-custom-roles';
import { applySystemRolePersonas } from './apply/apply-system-roles';
import {
  assertNotProduction,
  confirmDestructiveIntent,
  describeDatabase,
  warnIfSharedRedis,
} from './db-guard';
import { applyCommittees } from './apply/apply-committees';
import { applyEdgeCases } from './apply/apply-edge-cases';

const FIXTURES: TenantFixture[] = [HOSPITAL_FIXTURE, UNIVERSITY_FIXTURE];

// ─────────────────────────────────────────────────────────────────────────────
// Guards — now shared with the reset (ACC-107)
// ─────────────────────────────────────────────────────────────────────────────

// These used to live here, which meant they protected the SECOND half of a
// two-step operation: `prisma migrate reset --force` runs first and drops
// every table, and it had no guard at all. They moved to db-guard.ts so both
// halves share one implementation, and the confirmation now binds to the
// Supabase PROJECT REF rather than the host — the old host allowlist matched
// `pooler.supabase.com`, which is the shared endpoint for an entire region and
// would have accepted a customer's connection string unchanged. Full reasoning
// in db-guard.ts.

// ─────────────────────────────────────────────────────────────────────────────
// Credentials summary
// ─────────────────────────────────────────────────────────────────────────────

// Every persona listed here is derived from the fixture's own declarations —
// the admin, and the people named by the four edge cases — rather than a
// hand-maintained list that would drift the moment a fixture changed.
// Otherwise testing an edge case means opening a fixture file to work out who
// to log in as, which is exactly the friction this is meant to remove.
function printCredentials(fixture: TenantFixture): void {
  const person = (key: string) => fixture.people.find((p) => p.key === key)!;
  const email = (key: string) => `${person(key).emailLocal}@${fixture.emailDomain}`;
  const line = (label: string, key: string) =>
    console.log(
      `  ${label.padEnd(26)} ${email(key).padEnd(42)} ${person(key).name} — ${person(key).position}`,
    );

  const edge = fixture.edgeCases;
  const depthOneUnits = new Set(
    flattenUnits(fixture.tree)
      .filter((u) => u.depth === 1)
      .map((u) => u.unit.key),
  );
  const headPositions = new Set(
    fixture.positions.filter((p) => p.isUnitHeadPosition).map((p) => p.nameEn),
  );
  headPositions.add('Director');
  const departmentHead = fixture.people.find(
    (p) => depthOneUnits.has(p.unit) && headPositions.has(p.position),
  );
  const vacancyStaffer = fixture.people.find(
    (p) => p.unit === edge.vacantHeadUnit.unit && p.key !== edge.vacantHeadUnit.departingHead,
  );

  console.log(`\n─── ${fixture.name}  (org slug: ${fixture.slug}) ───`);

  // ACC-107 — the personas come first, because they are the reason most people
  // run this seed. Derived from fixture.systemRolePersonas rather than written
  // out here: a hand-maintained table is exactly how the old comment came to
  // claim Yasser held a role he did not.
  console.log('  PERMISSION PERSONAS');
  for (const persona of fixture.systemRolePersonas) {
    const p = person(persona.holder);
    console.log(`    ${persona.roleKey.padEnd(16)} ${email(persona.holder).padEnd(42)} ${p.name}`);
    console.log(`    ${''.padEnd(16)} ${persona.why}`);
  }
  for (const role of fixture.customRoles) {
    for (const holder of role.holders) {
      const p = person(holder);
      console.log(`    ${'(custom)'.padEnd(16)} ${email(holder).padEnd(42)} ${p.name}`);
      console.log(`    ${''.padEnd(16)} ${role.nameEn} — ${role.permissions.join(', ')}`);
    }
  }

  console.log('  EDGE CASES');
  line('Tenant admin', fixture.adminKey);
  if (departmentHead) line('Department head', departmentHead.key);
  line('Out of office (absent)', edge.outOfOffice.person);
  line('Out of office (covering)', edge.outOfOffice.covering);
  line('Handover — outgoing', edge.handover.from);
  line('Handover — incoming', edge.handover.to);
  if (vacancyStaffer) line('In the vacant unit', vacancyStaffer.key);
  console.log(`  ${'(departed — cannot log in)'.padEnd(26)} ${email(edge.vacantHeadUnit.departingHead)}`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function seedTenant(
  deps: {
    prisma: PrismaService;
    rawPrisma: PrismaClient;
    platformTenantService: PlatformTenantService;
    organizationService: OrganizationService;
    orgUnitHeadService: OrgUnitHeadService;
    lookupService: LookupService;
    userService: UserService;
    committeesService: CommitteesService;
    roleService: RoleService;
  },
  fixture: TenantFixture,
  actorId: string,
): Promise<void> {
  console.log(`\n▶ ${fixture.name}`);

  const admin = fixture.people.find((p) => p.key === fixture.adminKey)!;
  const adminEmail = `${admin.emailLocal}@${fixture.emailDomain}`;

  // The real provisioning flow — Organization row, bootstrap() (root unit, 10
  // positions, 12 lookup categories, 7 roles, 8 workflow templates), the
  // invited admin, and their TENANT_ADMIN grant. Nothing here reimplements it
  // (ACC-23).
  const tenant = await deps.platformTenantService.createTenant(
    { name: fixture.name, slug: fixture.slug, country: fixture.country, adminEmail, adminName: admin.name },
    actorId,
  );
  console.log('  provisioned via createTenant()');

  const ctx = createSeedContext(tenant.id);

  await applyOrgTree(deps, fixture, ctx, actorId);
  console.log(`  org tree: ${ctx.unitIdByKey.size} units`);

  await applyPeople(deps, fixture, ctx, actorId);
  console.log(`  people: ${ctx.personIdByKey.size} created and activated`);

  // ACC-101 / ACC-107 — after the people exist, since a role is assigned to
  // one of them. System personas first so the credentials table's ordering
  // matches the order a reader meets them in the fixture.
  await applySystemRolePersonas(deps, fixture, ctx, actorId);
  await applyCustomRoles(deps, fixture, ctx, actorId);

  // Before the edge cases, deliberately: applyEdgeCases() deactivates a head,
  // and committee membership should be established while everyone is active.
  await applyCommittees(deps, fixture, ctx, actorId);
  console.log(`  committees: ${ctx.committeeIdByKey.size}`);

  await applyEdgeCases(deps, fixture, ctx, actorId);
  console.log('  edge cases: vacancy, out-of-office, handover, duplicate names');
}

async function main(): Promise<void> {
  assertNotProduction();
  const identity = describeDatabase(process.env['DATABASE_URL']);
  warnIfSharedRedis();

  // Validate BOTH fixtures before touching anything. Seeding one tenant and
  // then failing validation on the second would leave the database half-built
  // and require a manual reset to retry.
  for (const fixture of FIXTURES) validateFixture(fixture);
  console.log(`Fixtures valid: ${FIXTURES.map((f) => f.slug).join(', ')}`);

  // Pre-flight on a standalone client, BEFORE booting Nest. Two reasons:
  // booting starts the BullMQ workers the environment warning is about, so
  // there is no sense doing it for a run the operator is about to decline;
  // and a slug collision should be reported up front rather than surfacing as
  // a ConflictException partway through creating a tenant.
  const preflightPrisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] })),
  });

  let existingSlugs: string[];
  try {
    const clashes = await preflightPrisma.organization.findMany({
      where: { slug: { in: FIXTURES.map((f) => f.slug) } },
      select: { slug: true },
    });
    existingSlugs = clashes.map((c) => c.slug);
  } finally {
    await preflightPrisma.$disconnect();
  }

  if (existingSlugs.length > 0) {
    throw new Error(
      `Refusing to seed: ${existingSlugs.join(', ')} already exist. This script creates tenants from ` +
        'scratch and would collide on slugs and emails. Run `npm run db:reset:dev` first — ' +
        'that reset is the intended way to re-run this seed (see ACC-62 Section 5, ACC-107).',
    );
  }

  await confirmDestructiveIntent(identity, {
    tenants: FIXTURES.map((f) => f.slug).join(', '),
    people: String(FIXTURES.reduce((n, f) => n + f.people.length, 0)),
    personas: String(FIXTURES.reduce((n, f) => n + f.systemRolePersonas.length, 0)),
  });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let authPrisma: PrismaClient | undefined;

  try {
    const prisma = app.get(PrismaService);

    // createTenant() writes audit rows, whose actorId is a real FK to User.
    const platformAdmin = await prisma.user.findFirst({
      where: { organization: { isPlatformOrg: true } },
    });
    if (!platformAdmin) {
      throw new Error(
        'No platform admin found. Run `npm run seed:demo` first — this script needs a real ' +
          'actorId for audit logging, and AuditLog.actorId is a foreign key to User.',
      );
    }

    // A REAL PrismaClient for Better Auth, not the Nest service cast to look
    // like one. PrismaService does not extend PrismaClient — it wraps a
    // private client behind per-model getters — so `prisma as unknown as
    // PrismaClient` was a double-cast that happened to work only because the
    // getters cover the five auth models the adapter touches. Any adapter
    // change reaching for something else would fail at runtime with the type
    // system having asserted it was fine. demo-seed.ts constructs its own
    // client for the same reason; this follows it.
    authPrisma = new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] })),
    });

    const deps = {
      prisma,
      rawPrisma: authPrisma,
      platformTenantService: app.get(PlatformTenantService),
      organizationService: app.get(OrganizationService),
      orgUnitHeadService: app.get(OrgUnitHeadService),
      lookupService: app.get(LookupService),
      userService: app.get(UserService),
      committeesService: app.get(CommitteesService),
      roleService: app.get(RoleService),
    };

    for (const fixture of FIXTURES) {
      await seedTenant(deps, fixture, platformAdmin.id);
    }

    console.log('\n════════ SEEDED TENANT LOGINS ════════');
    console.log(`URL:      http://localhost:4200/login`);
    console.log(`Password: ${SEED_PASSWORD}   (same for every seeded account)`);
    for (const fixture of FIXTURES) printCredentials(fixture);
    console.log('\nEvery other person in both tenants uses the same password.');
    console.log('══════════════════════════════════════\n');
  } finally {
    // Closes the Nest context, which also shuts down the BullMQ workers the
    // warning above is about, and disconnects Better Auth's own client. In a
    // finally block so a mid-seed failure leaves neither running.
    await app.close();
    await authPrisma?.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('\nSeed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
