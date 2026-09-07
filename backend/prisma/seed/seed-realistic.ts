// ACC-62 — seeds two realistic tenants: a hospital and a university.
//
// PREREQUISITES, in order:
//   1. npx prisma migrate reset --force   (drops and rebuilds the schema)
//   2. npm run seed:demo                  (platform org + PLATFORM_ADMIN)
//   3. npm run seed:realistic             (this script)
//
// Step 1 is deliberately NOT wrapped in a script. A committed
// "reset-and-seed" one-liner is exactly the thing that eventually gets run
// against the wrong database; resetting stays a manual, deliberate act.
//
// Step 2 is required because this script needs a real actorId for audit
// logging — AuditLog.actorId is a foreign key to User, so an invented id
// would fail on the first write.
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PlatformTenantService } from '../../src/platform/tenant/platform-tenant.service';
import { OrganizationService } from '../../src/foundation/organization/organization.service';
import { OrgUnitHeadService } from '../../src/foundation/organization/org-unit-head.service';
import { LookupService } from '../../src/foundation/lookup/lookup.service';
import { UserService } from '../../src/foundation/user/user.service';
import { CommitteesService } from '../../src/foundation/committees/committees.service';
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
import { applyCommittees } from './apply/apply-committees';
import { applyEdgeCases } from './apply/apply-edge-cases';

const FIXTURES: TenantFixture[] = [HOSPITAL_FIXTURE, UNIVERSITY_FIXTURE];

// ─────────────────────────────────────────────────────────────────────────────
// Environment guard — fails CLOSED
// ─────────────────────────────────────────────────────────────────────────────

// This script assumes an already-reset database and creates tenants from
// scratch; run against a populated one it would collide on slugs and emails,
// and run against anything real it would be a disaster. Ahmad confirmed THIS
// dev database is disposable (ACC-62 PD #1) — that decision is about this
// database, not a licence to run the seed wherever it happens to point.
const ALLOWED_DB_HOST_FRAGMENTS = ['localhost', '127.0.0.1', 'pooler.supabase.com'];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function assertSafeEnvironment(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to seed: NODE_ENV is production.');
  }

  const dbHost = hostOf(process.env['DATABASE_URL']);
  if (!dbHost) {
    throw new Error('Refusing to seed: DATABASE_URL is unset or unparseable.');
  }
  if (!ALLOWED_DB_HOST_FRAGMENTS.some((fragment) => dbHost.includes(fragment))) {
    throw new Error(
      `Refusing to seed: DATABASE_URL host '${dbHost}' is not in the allowlist ` +
        `(${ALLOWED_DB_HOST_FRAGMENTS.join(', ')}). This seed DESTROYS and recreates tenant data — ` +
        'add the host deliberately if it really is a disposable database.',
    );
  }

  // Not fatal, but worth saying out loud. AppModule pulls in QueueModule, and
  // three @Processor classes (sla-monitor, email-delivery, workflow-actions)
  // become live BullMQ workers the moment the context boots. Against the
  // SHARED Railway Redis this process therefore competes for jobs with the
  // deployed instance for as long as it runs — the exact hazard ACC-51 hit,
  // where a deployed worker consumed a locally-enqueued job and silently
  // invalidated a verification.
  //
  // During a wipe-and-reseed the blast radius is small (the data those jobs
  // would touch is being destroyed anyway), and the window is the length of
  // one seed run. Stated rather than hidden, because someone running this for
  // another reason deserves to know.
  const redisHost = hostOf(process.env['REDIS_URL']);
  if (redisHost && !['localhost', '127.0.0.1'].includes(redisHost)) {
    console.warn(
      `\n⚠  REDIS_URL points at '${redisHost}', not localhost.\n` +
        '   Booting the app starts sla-monitor / email-delivery / workflow-actions workers\n' +
        '   that will compete with any deployed instance on that same Redis for the\n' +
        '   duration of this run (ACC-51). Safe during a deliberate wipe; know about it otherwise.\n',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation gate
// ─────────────────────────────────────────────────────────────────────────────

// assertSafeEnvironment() answers "is this the wrong database?". This answers
// a different question it cannot: "did you MEAN to run this at all?"
//
// Added because that gap was not hypothetical. During ACC-62's own
// guard-branch testing, a run with the real (correctly allowlisted)
// DATABASE_URL passed every check and seeded a live tenant that nobody
// intended to create. The guard behaved exactly as designed; the design was
// simply not covering intent.
//
// Typing the database host, rather than "yes", is deliberate: "yes" is the
// kind of thing a person types reflexively, and the host is the one fact
// worth being sure about.
async function confirmIntent(preflight: {
  dbHost: string;
  existingSlugs: string[];
}): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--confirm')) {
    console.log('Proceeding: --confirm supplied.');
    return;
  }

  console.log('\nThis will create tenants in a REAL database.');
  console.log(`  database host : ${preflight.dbHost}`);
  console.log(`  tenants       : ${FIXTURES.map((f) => f.slug).join(', ')}`);
  console.log(`  people        : ${FIXTURES.reduce((n, f) => n + f.people.length, 0)} across both`);

  if (!process.stdin.isTTY) {
    throw new Error(
      'Refusing to seed: not an interactive terminal and --confirm was not supplied. ' +
        'Pass --confirm only when the run is genuinely intended.',
    );
  }

  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\nType the database host to proceed (${preflight.dbHost}): `);
    if (answer.trim() !== preflight.dbHost) {
      throw new Error('Refusing to seed: confirmation did not match the database host.');
    }
  } finally {
    rl.close();
  }
}

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

  // Before the edge cases, deliberately: applyEdgeCases() deactivates a head,
  // and committee membership should be established while everyone is active.
  await applyCommittees(deps, fixture, ctx, actorId);
  console.log(`  committees: ${ctx.committeeIdByKey.size}`);

  await applyEdgeCases(deps, fixture, ctx, actorId);
  console.log('  edge cases: vacancy, out-of-office, handover, duplicate names');
}

async function main(): Promise<void> {
  assertSafeEnvironment();

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
  const dbHost = hostOf(process.env['DATABASE_URL'])!;
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
        'scratch and would collide on slugs and emails. Run `npx prisma migrate reset --force` first — ' +
        'that reset is the intended way to re-run this seed (see ACC-62 Section 5).',
    );
  }

  await confirmIntent({ dbHost, existingSlugs });

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
