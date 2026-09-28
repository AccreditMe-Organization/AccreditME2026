// ACC-107 — a guarded `prisma migrate reset`.
//
// ## Why this exists
//
// The realistic seed cannot run in place: it creates tenants from scratch and
// collides on slugs and emails against a populated database. So re-seeding has
// always meant `npx prisma migrate reset --force` first — a raw command
// pointed at whatever DATABASE_URL happens to say, with no check of any kind.
//
// Every guard in this repo protected the seed, which is the SECOND step. The
// first step, the one that drops every table, had none. ACC-107 makes the
// personas more attractive to run, which makes that asymmetry worse rather
// than merely untidy.
//
// ## What it does NOT do
//
// It does not seed. It resets and stops. seed-realistic.ts records that a
// committed reset-and-seed one-liner is exactly what eventually runs against
// the wrong database, and that reasoning is untouched here — this is strictly
// harder to run than the bare prisma command it replaces, not easier.
//
// Usage:
//   npm run db:reset:dev -- --confirm-db=<project ref>
//   npm run db:reset:dev                 (prompts, interactive terminals only)
// Loaded explicitly, first. This script imports nothing from Prisma, so
// nothing else would populate process.env and every guard below would refuse
// with 'DATABASE_URL is unset' — safe, but uselessly so. Matches demo-seed.ts
// and the backfills, which all declare this dependency rather than inherit it.
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { assertNotProduction, confirmDestructiveIntent, describeDatabase } from './db-guard';

async function main(): Promise<void> {
  assertNotProduction();
  const identity = describeDatabase(process.env['DATABASE_URL']);

  await confirmDestructiveIntent(identity, {
    action: 'prisma migrate reset --force',
    effect: 'DROPS every table, re-applies all migrations, and leaves the database EMPTY',
    'after this': 'npm run seed:demo, then npm run seed:realistic',
  });

  console.log('\nResetting…\n');
  // --force is the ONLY flag Prisma 7's `migrate reset` takes besides --schema
  // and --config. --skip-seed and --skip-generate existed in earlier majors and
  // now make it exit 1 with a usage dump; there is no seed configured for it to
  // skip anyway, since seeding here is two separate deliberate commands.
  const result = spawnSync('npx', ['prisma', 'migrate', 'reset', '--force'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error(`prisma migrate reset exited with status ${String(result.status)}.`);
  }

  // ACC-145 - the GLOBAL SYSTEM lookups, immediately after the reset.
  //
  // WITHOUT THIS, "reset and stop" stops being a usable state. `migrate reset`
  // drops every table including the lookup rows, and until ACC-145 the only
  // thing that recreated them was TenantService.bootstrap(). So a developer who
  // reset and went straight to the Create Tenant form met the same deadlock
  // ACC-145 fixes for production: the type picker is empty, the field is
  // required, and the tenant creation that would seed the values is the thing
  // being blocked.
  //
  // It looked covered before only because seed:realistic calls bootstrap()
  // programmatically with a fixture type - a different path from the UI. That
  // made local correctness depend on the habit of always seeding first. Now
  // local and production have the same guarantee by the same reasoning.
  console.log('\nSeeding global SYSTEM lookups...\n');
  const seed = spawnSync('npm', ['run', '--silent', 'seed:system-lookups'], {
    stdio: 'inherit',
    shell: true,
  });

  if (seed.status !== 0) {
    throw new Error(
      `seed:system-lookups exited with status ${String(seed.status)}. The database is `
        + 'reset but has no lookup values, so the Create Tenant form cannot be used. '
        + 'Re-run `npm run seed:system-lookups` before continuing.',
    );
  }

  console.log('\nDatabase reset. It is now EMPTY — no platform org, no tenants.');
  console.log('The global SYSTEM lookups ARE present, so Create Tenant is usable.');
  console.log('Next:  npm run seed:demo    then    npm run seed:realistic\n');
}

main().catch((error: unknown) => {
  console.error('\nReset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
