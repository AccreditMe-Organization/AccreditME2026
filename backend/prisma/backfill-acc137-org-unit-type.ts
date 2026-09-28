// ACC-137 — carry OrgUnit.type (a free-text lookup KEY) onto OrgUnit.typeValueId.
//
// ## RUN THIS AFTER THE MIGRATION AND BEFORE THE CODE DEPLOYS
//
// Purely additive: it writes a column the running container has never heard of,
// so it costs nothing to run early and leaves every unit looking untyped to the
// new Setup health condition if run late.
//
// ## The ticket said there was nothing to back-fill. There is.
//
// ACC-137 recorded "all 40 active units across both tenants have type = null,
// so there is nothing to map and no backfill is possible." Re-measured 28 Sep,
// the figure is inverted: 40 of 41 units HAVE a type and all 40 resolve. The one
// without is the PLATFORM organization's root, which is structurally exempt.
//
// That is not drift. `apply-org-tree.ts` has written `type` from fixtures
// carrying lookup keys since ACC-62, committed 21 Sep — six days before the
// measurement — and its own comment says the values are "added BEFORE the tree
// so a unit's `type` always refers to a value that exists, even though nothing
// validates that today". The keys were always meant to be lookup keys.
//
// ## Matching by KEY, but never globally
//
// A value is a candidate when it is SYSTEM (organizationId null, shared) or
// belongs to the unit's OWN tenant. `ward` is Al Nakheel's and `faculty`,
// `school`, `program`, `deanship` are Al Manara's — all TENANT-layer rows. A
// global key match would hand one tenant the other's private value, which is a
// cross-tenant leak written by a maintenance script rather than by a request,
// and nothing downstream would flag it. Verified before writing this: zero
// cross-tenant key collisions exist today, so the scoping changes no row now —
// it is there for the tenant that adds a colliding key later.
//
// Dry run by default. Pass --apply to write.
//
//   npm run backfill:acc137-org-unit-type            (dry run)
//   npm run backfill:acc137-org-unit-type -- --apply (writes)
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const ORG_UNIT_TYPE_CATEGORY = 'org_unit_type';

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
    if (!category) {
      throw new Error(
        `Lookup category '${ORG_UNIT_TYPE_CATEGORY}' not found — has seedSystemData() run?`,
      );
    }

    const values = await prisma.lookupValue.findMany({
      where: { categoryId: category.id },
      select: { id: true, key: true, organizationId: true },
    });

    // key -> id, per tenant. SYSTEM values are visible to every tenant; a
    // tenant row with the same key OVERRIDES the system one, and its id is what
    // getValues() would hand back, so the override wins here too.
    const systemByKey = new Map(
      values.filter((v) => v.organizationId === null).map((v) => [v.key, v.id]),
    );
    const tenantByOrgAndKey = new Map(
      values
        .filter((v) => v.organizationId !== null)
        .map((v) => [`${v.organizationId}:${v.key}`, v.id]),
    );

    const units = await prisma.orgUnit.findMany({
      where: { type: { not: null }, typeValueId: null },
      select: { id: true, organizationId: true, code: true, type: true },
    });

    console.log(`Units with a type and no typeValueId: ${units.length}`);

    const plan: Array<{ id: string; code: string; key: string; valueId: string }> = [];
    const unresolved: Array<{ code: string; key: string }> = [];

    for (const unit of units) {
      const key = unit.type as string;
      const valueId =
        tenantByOrgAndKey.get(`${unit.organizationId}:${key}`) ?? systemByKey.get(key);
      if (!valueId) {
        unresolved.push({ code: unit.code, key });
        continue;
      }
      plan.push({ id: unit.id, code: unit.code, key, valueId });
    }

    console.log(`Resolvable: ${plan.length}`);
    console.log(`UNRESOLVABLE: ${unresolved.length}`);
    for (const u of unresolved) console.log(`  ${u.code} -> '${u.key}' (no such value)`);

    if (unresolved.length > 0) {
      // Never a partial backfill. A key that does not resolve is a value someone
      // deleted or renamed, and guessing at it is worse than stopping: the units
      // left behind would simply appear untyped, which reads as data rather than
      // as a failed script.
      throw new Error(
        `${unresolved.length} unit(s) carry a type that resolves to no value in their tenant. ` +
          'Nothing was written. Add the missing lookup values, then re-run.',
      );
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.');
      return;
    }

    // One transaction: a half-finished backfill would leave some units typed and
    // some not, with no way to tell which by looking.
    //
    // The timeout is not boilerplate. Prisma's default is 5 SECONDS, and the
    // first run of this script failed with P2028 at 5330ms: 40 sequential
    // updates against a database in eu-central-1, from a client in the Middle
    // East, is ~130ms each before any work happens (ACC-60 measured the same
    // geography at 6–11s for a transition that is 240ms of application work).
    // The rollback was clean and nothing was written — but a backfill that
    // fails on latency alone, at a row count this small, would fail far more
    // confusingly on a real tenant.
    await prisma.$transaction(
      plan.map((p) =>
        prisma.orgUnit.update({ where: { id: p.id }, data: { typeValueId: p.valueId } }),
      ),
      { timeout: 120_000, maxWait: 30_000 },
    );

    const remaining = await prisma.orgUnit.count({
      where: { type: { not: null }, typeValueId: null },
    });
    console.log(`\nWrote ${plan.length} unit(s). Still unmapped: ${remaining}`);
    if (remaining !== 0) {
      throw new Error(`Expected 0 unmapped units after the backfill, found ${remaining}.`);
    }

    const untyped = await prisma.orgUnit.findMany({
      where: { typeValueId: null },
      select: { code: true, organization: { select: { slug: true, isPlatformOrg: true } } },
    });
    console.log(`\nUnits still with no type at all: ${untyped.length}`);
    for (const u of untyped) {
      console.log(
        `  ${u.code} (${u.organization.slug})` +
          (u.organization.isPlatformOrg ? '  [platform — structurally exempt]' : ''),
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
