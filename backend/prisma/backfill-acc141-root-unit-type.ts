// ACC-141 — every root org unit's type becomes `organization`.
//
// ## What this corrects, and why the previous backfill did not catch it
//
// ACC-137's backfill mapped `OrgUnit.type` keys onto lookup value ids and
// reported "40 written, 0 unmapped, complete". It was complete. Every key
// resolved. Nothing asked whether the key was the RIGHT key.
//
// Measured 2026-09-29, both tenant roots hold `administration`:
//
//   al-manara   MANARA   administration
//   al-nakheel  NAKHEEL  administration
//   platform    PLATFORM (no type at all)
//
// A hospital is not a directorate. A university is not a directorate. "0
// unresolvable" measured the mapping, not the meaning — the same shape as the
// Bahrain hosting claim: a value that resolves, reads as decided, and is wrong.
//
// ## The platform root is included, and that reverses ACC-137
//
// ACC-137 recorded the platform organisation's root as a PERMANENT structural
// exemption, on the belief that no lookup value could be meaningful for it. True
// of the six values that then existed, every one of which names a part of an
// organisation. `organization` is meaningful for it: the platform organisation's
// root is an organisation. So the only exemption disappears and NOT NULL on
// typeValueId becomes achievable — reported by this script rather than assumed.
//
// ## Scope: roots only
//
// A non-root unit is never touched. `organization` is reserved for the root
// (rule 3), so a non-root unit holding it would be a defect this script must
// REPORT rather than silently rewrite.
//
// Dry run by default. Pass --apply to write.
//
//   npm run backfill:acc141-root-unit-type            (dry run)
//   npm run backfill:acc141-root-unit-type -- --apply (writes)
//
// Run `npm run seed:system-lookups` first: the `organization` value has to exist.
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const ORG_UNIT_TYPE_CATEGORY = 'org_unit_type';
const ORGANIZATION_KEY = 'organization';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const category = await prisma.lookupCategory.findFirst({
      where: { key: ORG_UNIT_TYPE_CATEGORY, organizationId: null },
      select: { id: true },
    });
    if (!category) throw new Error(`Lookup category '${ORG_UNIT_TYPE_CATEGORY}' not found.`);

    const organizationValue = await prisma.lookupValue.findFirst({
      where: { categoryId: category.id, key: ORGANIZATION_KEY, organizationId: null },
      select: { id: true },
    });
    if (!organizationValue) {
      throw new Error(
        `SYSTEM lookup value '${ORGANIZATION_KEY}' not found. Run ` +
          '`npm run seed:system-lookups` first (ACC-145), then re-run this.',
      );
    }

    const roots = await prisma.orgUnit.findMany({
      where: { parentId: null },
      select: {
        id: true,
        code: true,
        nameEn: true,
        type: true,
        typeValueId: true,
        organization: { select: { slug: true, isPlatformOrg: true } },
      },
    });

    console.log(`Root units: ${roots.length}`);
    const needsWrite = roots.filter((r) => r.typeValueId !== organizationValue.id);
    for (const r of roots) {
      const state = r.typeValueId === organizationValue.id ? 'already organization' : `currently ${r.type ?? '(none)'}`;
      console.log(`  ${r.organization.slug}/${r.code} — ${state}`);
    }
    console.log(`\nRoots to correct: ${needsWrite.length}`);

    // A non-root unit holding `organization` is a rule-3 violation. Report it;
    // never rewrite it, because the right answer depends on what that unit
    // actually is and only a human knows.
    const strays = await prisma.orgUnit.findMany({
      where: { parentId: { not: null }, typeValueId: organizationValue.id },
      select: { code: true, nameEn: true, organization: { select: { slug: true } } },
    });
    console.log(`Non-root units wrongly typed 'organization': ${strays.length}`);
    for (const s of strays) console.log(`  ${s.organization.slug}/${s.code} — ${s.nameEn}`);
    if (strays.length > 0) {
      throw new Error(
        `${strays.length} non-root unit(s) hold 'organization', which rule 3 forbids. ` +
          'Nothing was written — decide what each of those units actually is first.',
      );
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.');
      return;
    }

    await prisma.$transaction(
      needsWrite.map((r) =>
        prisma.orgUnit.update({
          where: { id: r.id },
          data: { type: ORGANIZATION_KEY, typeValueId: organizationValue.id },
        }),
      ),
      { timeout: 120_000, maxWait: 30_000 },
    );

    const stillWrong = await prisma.orgUnit.count({
      where: { parentId: null, typeValueId: { not: organizationValue.id } },
    });
    const stillUntyped = await prisma.orgUnit.count({ where: { typeValueId: null } });

    console.log(`\nWrote ${needsWrite.length} root(s).`);
    console.log(`Roots not typed 'organization': ${stillWrong}`);
    console.log(`Units with NO type at all: ${stillUntyped}`);
    console.log(
      stillUntyped === 0
        ? 'NOT NULL on OrgUnit.typeValueId is now ACHIEVABLE — every row carries a type.'
        : `NOT NULL is NOT yet achievable: ${stillUntyped} row(s) still untyped.`,
    );
    if (stillWrong !== 0) throw new Error(`Expected 0 mistyped roots, found ${stillWrong}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
