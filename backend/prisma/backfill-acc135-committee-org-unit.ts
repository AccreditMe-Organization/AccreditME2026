// ACC-135 — every existing committee gets its own tenant's root org unit.
//
// ## Why the root, and why that is not a fallback
//
// A committee serving the whole organisation is not a committee with no owner.
// It is a committee owned one level up. The root unit IS the organisation —
// ACC-141 made that explicit by fixing the root's type to `organization` — so
// "organisation-wide" and "owned by the root" are the same statement.
//
// That is what removed the nullable column ACC-63 had proposed, and with it the
// every-query `IS NULL OR IN (scope)` predicate whose forgotten half would have
// HIDDEN group committees rather than leaked them. Missing data looks like no
// data, so nobody reports it.
//
// ## A SECOND ACTIVE ROOT IS REFUSED, NOT RESOLVED
//
// The obvious query is `findFirst({ parentId: null, isActive: true })` ordered
// by createdAt — which silently picks one if it ever finds two. ACC-134 says a
// tenant has exactly one root, so two is a VIOLATION OF THAT INVARIANT, not a
// tie for this script to break. It stops and names the organisation instead.
// Picking one would write a real owner onto real committees on the strength of a
// row ordering nobody chose.
//
// ## Measured before writing (2026-09-29, dev)
//
//   6 committees — al-manara 3, al-nakheel 3, platform 0
//   every organisation has exactly one active root: MANARA, NAKHEEL, PLATFORM
//
// Dry run by default. Pass --apply to write.
//
//   npm run backfill:acc135-committee-org-unit            (dry run)
//   npm run backfill:acc135-committee-org-unit -- --apply (writes)
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const committees = await prisma.committee.findMany({
      where: { orgUnitId: null },
      select: {
        id: true,
        nameEn: true,
        organizationId: true,
        organization: { select: { slug: true } },
      },
    });

    console.log(`Committees with no owning unit: ${committees.length}`);
    if (committees.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // One root lookup per ORGANISATION, not per committee — 2 reads rather than
    // 6, and it is the read that has to refuse on two roots, so doing it once
    // per organisation is also where that check belongs.
    const organizationIds = [...new Set(committees.map((c) => c.organizationId))];
    const rootByOrganization = new Map<string, { id: string; code: string }>();

    for (const organizationId of organizationIds) {
      const roots = await prisma.orgUnit.findMany({
        where: { organizationId, parentId: null, isActive: true },
        select: { id: true, code: true, nameEn: true },
        orderBy: { createdAt: 'asc' },
      });
      const slug =
        committees.find((c) => c.organizationId === organizationId)?.organization.slug ??
        organizationId;

      if (roots.length === 0) {
        throw new Error(
          `Organisation "${slug}" has NO active root org unit, so there is no unit to ` +
            'assign its committees to. Nothing was written. ACC-134 guarantees at most ' +
            'one root but never guaranteed at least one, and nothing blocks deactivating ' +
            'the root (ACC-152) — so this is reachable, not theoretical.',
        );
      }
      if (roots.length > 1) {
        throw new Error(
          `Organisation "${slug}" has ${roots.length} active root org units ` +
            `(${roots.map((r) => r.code).join(', ')}). ACC-134 says a tenant has exactly ` +
            'one, so this is a violation of that invariant, not a tie for this script to ' +
            'break. Nothing was written — fix the roots first.',
        );
      }

      const root = roots[0]!;
      rootByOrganization.set(organizationId, root);
      console.log(`  ${slug} -> root ${root.code} (${root.nameEn})`);
    }

    for (const committee of committees) {
      const root = rootByOrganization.get(committee.organizationId)!;
      console.log(`  ${committee.organization.slug}/${committee.nameEn} -> ${root.code}`);
    }

    if (!apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply.');
      return;
    }

    // 120s, not the 5s default: the dev database is in Frankfurt and a Middle
    // East client pays 6-11 seconds of round trip per transaction (ACC-60), which
    // is what produced a P2028 on the ACC-141 backfill.
    await prisma.$transaction(
      committees.map((committee) =>
        prisma.committee.update({
          where: { id: committee.id },
          data: { orgUnitId: rootByOrganization.get(committee.organizationId)!.id },
        }),
      ),
      { timeout: 120_000, maxWait: 30_000 },
    );

    const stillNull = await prisma.committee.count({ where: { orgUnitId: null } });
    console.log(`\nWrote ${committees.length} committee(s).`);
    console.log(`Committees still without an owning unit: ${stillNull}`);
    console.log(
      stillNull === 0
        ? 'NOT NULL on Committee.orgUnitId is now ACHIEVABLE — the contract migration can run.'
        : `NOT NULL is NOT yet achievable: ${stillNull} row(s) still null.`,
    );
    if (stillNull !== 0) throw new Error(`Expected 0 committees without a unit, found ${stillNull}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
