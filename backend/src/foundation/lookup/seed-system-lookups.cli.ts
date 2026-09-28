// ACC-145 — seed the GLOBAL SYSTEM lookup categories and values, with no tenant.
//
// ## Why this exists at all
//
// `LookupService.seedSystemData()` writes the global lookup rows
// (`organizationId: null`), and until this script it had exactly ONE non-test
// caller: `tenant.service.ts`, inside `TenantService.bootstrap()`. No
// `OnModuleInit`, no migration step, no CLI path.
//
// So on a database with zero tenants the global lookups did not exist, and the
// only thing that created them was creating a tenant. That was survivable while
// nothing required a lookup value at provisioning time. ACC-141 makes the root
// unit's type a REQUIRED field on Create Tenant, chosen from `org_unit_type`,
// which closes the loop: the picker is empty, the required field blocks
// submission, and the only thing that would seed the values is the tenant
// creation now blocked. The first tenant cannot be created.
//
// ## Why a script invoked from pre-deploy, and not a startup hook
//
// The deciding constraint is concurrency, not convenience. `seedSystemData()`
// is find-then-create per row, which is a textbook TOCTOU: two replicas
// entering it together collide on `@@unique([key, organizationId])` and one
// crashes at boot. A startup hook would therefore need a Postgres advisory lock
// to be correct — and a startup hook that needs a lock to be safe is the trap,
// not the fix.
//
// Pre-deploy runs ONCE PER DEPLOYMENT, not once per replica. There is no race
// to lock, and the safety is structural rather than defended.
//
// A data migration was also rejected: migrations are immutable once applied, so
// a value added to SYSTEM_LOOKUP_SEED later would never reach an existing
// database. It would seed once and then drift permanently — worse than not
// seeding, because it looks done.
//
// ## It is safe to run repeatedly, by construction
//
// `seedSystemData()` updates an existing category or value and creates a
// missing one. Running it on every deploy is its natural cadence, not a cost
// being tolerated.
//
// ## Why it lives in src/ and not prisma/, where every other script does
//
// Because it is the only one that runs in the DEPLOYMENT. `tsconfig.build.json`
// excludes `prisma/`, so a script there is never compiled into `dist` and can
// only be run through ts-node — a devDependency. It happens to be present in
// the production image today, because the Dockerfile copies node_modules from a
// builder that ran a plain `npm ci`. The moment anyone slims that image with
// `--omit=dev`, a `prisma/` script would break the pre-deploy step and fail the
// deployment. Compiling it removes that dependency instead of relying on it.
//
// Run:
//   npm run seed:system-lookups                              (local, ts-node)
//   node dist/src/foundation/lookup/seed-system-lookups.cli.js   (deployment)
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { LookupService } from './lookup.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is unset. Nothing was seeded.');
  }

  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // Nest is NOT booted for this. `seedSystemData()` reads SYSTEM_LOOKUP_SEED
    // and writes through Prisma, and — checked, not assumed — touches
    // AuditLogService on no path, so the stub below is never called. Booting
    // the application context would start the queue processors and require
    // Redis, for a script whose whole job is to write rows into Postgres.
    //
    // If seedSystemData() ever DOES audit, this stub throws rather than
    // silently swallowing the write, so the assumption cannot rot quietly.
    const auditLog = {
      log: () => {
        throw new Error(
          'seedSystemData() called AuditLogService, which this script stubs. ' +
            'It did not when this was written (ACC-145). Wire a real audit log ' +
            'here, or run this through the Nest context, rather than dropping ' +
            'the entry.',
        );
      },
    } as unknown as AuditLogService;

    const lookupService = new LookupService(
      prisma as unknown as PrismaService,
      auditLog,
    );

    const before = await prisma.lookupValue.count({ where: { organizationId: null } });
    await lookupService.seedSystemData();
    const after = await prisma.lookupValue.count({ where: { organizationId: null } });

    const categories = await prisma.lookupCategory.count({ where: { organizationId: null } });

    console.log(
      `[seed:system-lookups] OK — ${categories} SYSTEM categories, ` +
        `${after} SYSTEM values (${after - before >= 0 ? '+' : ''}${after - before} this run).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[seed:system-lookups] FAILED:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
