// ACC-107 — counts what the database ACTUALLY holds against what the fixtures
// claim, after a reset-and-reseed.
//
// The acceptance criterion it serves is "a full reset-and-reseed produces
// exactly what the fixture claims — RUN IT, DO NOT INFER IT". The seed's own
// console output cannot satisfy that: it prints what the fixture says, so a
// persona that failed to apply would still appear in the credentials table.
// This reads the rows back.
//
// NOT A CI CHECK, deliberately, and this is the reason it is worth having as a
// committed script rather than an ad-hoc query: it needs a seeded database, so
// CI can never run it. seed-fixtures.spec.ts covers everything provable from
// the fixture alone; this covers the half that only exists after a seed.
// Without it the next person re-derives these queries by hand, which is how
// "run it" quietly becomes "infer it".
//
// Usage (after npm run seed:realistic):
//   npm run verify:seed
//
// Exits non-zero on the first mismatch, so it can gate a reseed.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './fixtures/university.fixture';
import { SYSTEM_ROLE_SEED } from '../../src/foundation/roles/role.seed';

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env['DATABASE_URL'] })),
});

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`);
};

void (async () => {
  for (const fixture of [HOSPITAL_FIXTURE, UNIVERSITY_FIXTURE]) {
    console.log(`\n=== ${fixture.slug} ===`);
    const org = await prisma.organization.findFirst({ where: { slug: fixture.slug } });
    if (!org) { console.log('  FAIL org missing'); failures += 1; continue; }

    const users = await prisma.user.findMany({ where: { organizationId: org.id } });
    // +1: bootstrap's invited admin is one of the fixture people, already counted.
    check('people count', users.length, fixture.people.length);
    check('active people', users.filter((u) => u.status === 'ACTIVE').length, fixture.people.length - 1);

    const emailOf = (key: string) => {
      const p = fixture.people.find((x) => x.key === key)!;
      return `${p.emailLocal}@${fixture.emailDomain}`.toLowerCase();
    };

    // --- system-role personas -------------------------------------------------
    for (const persona of fixture.systemRolePersonas) {
      const role = await prisma.role.findFirst({
        where: { organizationId: org.id, key: persona.roleKey },
      });
      if (!role) { console.log(`  FAIL role ${persona.roleKey} missing`); failures += 1; continue; }

      const holders = await prisma.userRole.findMany({
        where: { roleId: role.id },
        include: { user: true },
      });
      const emails = holders.map((h) => h.user.email.toLowerCase()).sort();
      check(`${persona.roleKey} held by exactly ${persona.holder}`, emails, [emailOf(persona.holder)]);

      const active = holders.every((h) => h.user.status === 'ACTIVE');
      check(`${persona.roleKey} holder is ACTIVE`, active, true);
    }

    // Every assignable seeded role has a holder — checked against the DB, not the fixture.
    const assignable = SYSTEM_ROLE_SEED.map((r) => r.key).filter((k) => k !== 'PLATFORM_ADMIN');
    const unheld: string[] = [];
    for (const key of assignable) {
      const role = await prisma.role.findFirst({ where: { organizationId: org.id, key } });
      const n = role ? await prisma.userRole.count({ where: { roleId: role.id } }) : 0;
      if (n === 0) unheld.push(key);
    }
    check('every assignable system role has >=1 holder', unheld, []);

    // --- custom roles ---------------------------------------------------------
    const custom = await prisma.role.findMany({
      where: { organizationId: org.id, isSystem: false },
      include: { rolePermissions: { include: { permission: true } } },
    });
    check('custom role count', custom.length, fixture.customRoles.length);

    for (const cr of fixture.customRoles) {
      const row = custom.find((c) => c.nameEn === cr.nameEn);
      if (!row) { console.log(`  FAIL custom role '${cr.nameEn}' missing`); failures += 1; continue; }
      check(`'${cr.nameEn}' key is null (custom path)`, row.key, null);
      const perms = row.rolePermissions.map((p: { permission: { module: string; action: string } }) => `${p.permission.module}:${p.permission.action}`).sort();
      check(`'${cr.nameEn}' permissions`, perms, [...cr.permissions].sort());
      const holders = await prisma.userRole.findMany({ where: { roleId: row.id }, include: { user: true } });
      check(`'${cr.nameEn}' holders`, holders.map((h) => h.user.email.toLowerCase()).sort(),
            cr.holders.map(emailOf).sort());
    }

    // --- the departed person still cannot sign in ------------------------------
    const departed = await prisma.user.findFirst({
      where: { organizationId: org.id, email: { equals: emailOf(fixture.edgeCases.vacantHeadUnit.departingHead), mode: 'insensitive' } },
    });
    check('departing head is INACTIVE', departed?.status, 'INACTIVE');
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})();
