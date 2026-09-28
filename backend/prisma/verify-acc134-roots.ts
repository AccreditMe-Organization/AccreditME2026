// ACC-134 — verify every tenant has exactly one root org unit, BEFORE the
// constraint is added.
//
// ## Why this runs first, rather than letting the migration find out
//
// A partial unique index is applied to the whole table in one statement: a
// tenant with two roots does not produce a warning, it makes the migration
// FAIL. Migrations run as a pre-deploy step (ACC-127), so that failure means
// the deploy goes red and the old container keeps serving — safe, but it blocks
// every release until the data is fixed, and it finds out on the deployment
// rather than here.
//
// The ticket also asks for the finding to be REPORTED: "A tenant with two is a
// data problem to raise, not to fix silently." So this script writes nothing.
//
// ## It also answers a question the ticket does not ask
//
// A deactivated unit keeps its row and its parentId. If a root is deactivated,
// it still occupies `parentId IS NULL` — so a plain partial index would refuse
// a new root forever, with no way back through the API. That case is counted
// here so the index's predicate is chosen against real data rather than assumed.
//
// Run: npm run verify:acc134-roots
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true, slug: true, isPlatformOrg: true },
      orderBy: { name: 'asc' },
    });

    console.log(`Organizations: ${organizations.length}\n`);

    let offenders = 0;
    let inactiveRoots = 0;

    for (const org of organizations) {
      const roots = await prisma.orgUnit.findMany({
        where: { organizationId: org.id, parentId: null },
        select: { id: true, nameEn: true, code: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const total = await prisma.orgUnit.count({ where: { organizationId: org.id } });
      const inactive = roots.filter((r) => !r.isActive).length;
      inactiveRoots += inactive;

      const verdict =
        roots.length === 1 ? 'OK' : roots.length === 0 ? 'NO ROOT' : 'MULTIPLE ROOTS';
      if (roots.length !== 1) offenders += 1;

      console.log(
        `${verdict.padEnd(16)} ${org.slug ?? '(no slug)'}` +
          `${org.isPlatformOrg ? ' [platform]' : ''} — ${total} units, ` +
          `${roots.length} root(s), ${inactive} inactive`,
      );
      for (const r of roots) {
        console.log(`    root: ${r.code} · ${r.nameEn}${r.isActive ? '' : '  (INACTIVE)'}`);
      }
    }

    // Depth, so the ticket's "unbounded depth with multiple roots is a forest"
    // is checked against the data rather than repeated back.
    const all = await prisma.orgUnit.findMany({ select: { id: true, parentId: true } });
    const byId = new Map(all.map((u) => [u.id, u]));
    let maxDepth = 0;
    for (const unit of all) {
      let depth = 1;
      let current = unit;
      const seen = new Set<string>([unit.id]);
      while (current.parentId) {
        const parent = byId.get(current.parentId);
        if (!parent || seen.has(parent.id)) break; // cycle guard
        seen.add(parent.id);
        current = parent;
        depth += 1;
      }
      if (depth > maxDepth) maxDepth = depth;
    }

    console.log(`\nTotal org units: ${all.length}`);
    console.log(`Max depth: ${maxDepth}`);
    console.log(`Tenants failing the one-root rule: ${offenders}`);
    console.log(`Root units that are INACTIVE: ${inactiveRoots}`);
    console.log(
      offenders === 0
        ? '\nSAFE TO ADD THE CONSTRAINT.'
        : '\nDO NOT ADD THE CONSTRAINT — raise the data problem first.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
