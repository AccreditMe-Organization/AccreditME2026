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
  const result = spawnSync(
    'npx',
    ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'],
    { stdio: 'inherit', shell: true },
  );

  if (result.status !== 0) {
    throw new Error(`prisma migrate reset exited with status ${String(result.status)}.`);
  }

  console.log('\nDatabase reset. It is now EMPTY — no platform org, no tenants.');
  console.log('Next:  npm run seed:demo    then    npm run seed:realistic\n');
}

main().catch((error: unknown) => {
  console.error('\nReset failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
