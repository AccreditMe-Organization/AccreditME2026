// One-off cleanup for ACC-82 (SYSTEM-REFERENCE §13.7, §13.2, §13.11). Three
// parts, run together in ONE transaction:
//
//   1. The condition notifications that accumulated in the bell before ACC-82
//      stopped sending them — one repeated report every 15 minutes per tenant.
//      Matched by exact title; every title here is one ACC-82 removed from the
//      code, and none is still produced by it.
//   2. The rows left by POSITION_WITHOUT_ROLE, deferred in ACC-82 before it
//      shipped: its SetupCondition rows and its SetupConditionRun rows. Nothing
//      reconciles a deferred type, so these would otherwise sit frozen.
//   3. The CLEARED ORG_UNIT_WITHOUT_HEAD rows. They record gaps that never
//      existed: the stale isHeadVacant cache opened them, and the first
//      recompute closed them, so every seeded tenant's "Cleared by itself"
//      showed closures of units that had a Head all along. OPEN rows of the
//      type are genuine and are not touched.
//
// RUN ONLY AFTER ACC-82's MERGE HAS DEPLOYED. A server still running the older
// code keeps writing the notifications this deletes.
//
// Safe by default:
//   - Without --execute it only counts and prints; nothing is written.
//   - Each delete has its own guard, and any failing guard stops the whole run:
//       notifications      within EXPECTED_NOTIFICATIONS_TOLERANCE of
//                          EXPECTED_NOTIFICATIONS (1,489 counted on dev on
//                          2026-09-15). If older code kept writing past the
//                          guard before the deploy, RAISE the expected number
//                          after checking the new rows are the same titles —
//                          do not widen the tolerance.
//       cleared unit rows  exactly EXPECTED_CLEARED_UNIT_ROWS (32).
//   - With --execute the guards are evaluated INSIDE the transaction and the
//     deletes must remove exactly what was counted, so nothing that changes
//     between the count and the delete (a reconciliation pass, say) can be
//     deleted by accident; any mismatch rolls the whole transaction back.
//
// Nothing else reads Notification rows as history: the only readers are the
// bell and home page (NotificationService — per-user inbox) and
// NotificationEmailProcessor (a single row by id at send time; these titles
// were in-app only). No table has a foreign key to Notification. AuditLog rows
// recording each notification's creation are untouched (append-only).
//
// Run: npm run cleanup:acc82-condition-data            (dry run)
//      npm run cleanup:acc82-condition-data -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

const REMOVED_NOTIFICATION_TITLES = [
  'Head-authority setup incomplete',
  'Org unit has no resolvable Head',
  'Reminder: org unit still has no resolvable Head',
  'Workflow stage unreachable — no eligible assignee',
  'Task created with no eligible assignee',
];

const DEFERRED_TYPE = 'POSITION_WITHOUT_ROLE' as const;

const EXPECTED_NOTIFICATIONS = 1489;
const EXPECTED_NOTIFICATIONS_TOLERANCE = 0.05;
const EXPECTED_CLEARED_UNIT_ROWS = 32;

const NOTIFICATIONS_WHERE: Prisma.NotificationWhereInput = {
  titleEn: { in: REMOVED_NOTIFICATION_TITLES },
};
const CLEARED_UNIT_ROWS_WHERE: Prisma.SetupConditionWhereInput = {
  type: 'ORG_UNIT_WITHOUT_HEAD',
  clearedAt: { not: null },
};

type Db = Pick<PrismaClient, 'notification' | 'setupCondition' | 'setupConditionRun'>;

async function countAll(db: Db) {
  return {
    notifications: await db.notification.count({ where: NOTIFICATIONS_WHERE }),
    deferredConditions: await db.setupCondition.count({ where: { type: DEFERRED_TYPE } }),
    deferredRuns: await db.setupConditionRun.count({ where: { type: DEFERRED_TYPE } }),
    clearedUnitRows: await db.setupCondition.count({ where: CLEARED_UNIT_ROWS_WHERE }),
    openUnitRows: await db.setupCondition.count({
      where: { type: 'ORG_UNIT_WITHOUT_HEAD', clearedAt: null },
    }),
  };
}

function print(label: string, c: Awaited<ReturnType<typeof countAll>>): void {
  console.log(`${label}:`);
  console.log(`  notifications with removed titles:         ${c.notifications}`);
  console.log(`  SetupCondition rows (${DEFERRED_TYPE}):        ${c.deferredConditions}`);
  console.log(`  SetupConditionRun rows (${DEFERRED_TYPE}):     ${c.deferredRuns}`);
  console.log(`  cleared ORG_UNIT_WITHOUT_HEAD rows:        ${c.clearedUnitRows}`);
  console.log(`  open ORG_UNIT_WITHOUT_HEAD rows (kept):    ${c.openUnitRows}`);
}

// Returns the reason the run must stop, or null.
function guardFailure(c: Awaited<ReturnType<typeof countAll>>): string | null {
  const low = Math.floor(EXPECTED_NOTIFICATIONS * (1 - EXPECTED_NOTIFICATIONS_TOLERANCE));
  const high = Math.ceil(EXPECTED_NOTIFICATIONS * (1 + EXPECTED_NOTIFICATIONS_TOLERANCE));
  if (c.notifications < low || c.notifications > high) {
    return `expected about ${EXPECTED_NOTIFICATIONS} notifications (${low}–${high}), found ${c.notifications}`;
  }
  if (c.clearedUnitRows !== EXPECTED_CLEARED_UNIT_ROWS) {
    return `expected exactly ${EXPECTED_CLEARED_UNIT_ROWS} cleared ORG_UNIT_WITHOUT_HEAD rows, found ${c.clearedUnitRows}`;
  }
  return null;
}

class GuardFailed extends Error {}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const before = await countAll(prisma);
    print('Before', before);

    const failure = guardFailure(before);
    if (failure) {
      console.error(`\nSTOPPED: ${failure}. Nothing was deleted.`);
      process.exitCode = 1;
      return;
    }

    if (!execute) {
      console.log('\nDry run — guards pass, nothing deleted. Re-run with --execute to delete.');
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const inTx = await countAll(tx);
        const txFailure = guardFailure(inTx);
        if (txFailure) throw new GuardFailed(txFailure);

        const notifications = await tx.notification.deleteMany({ where: NOTIFICATIONS_WHERE });
        const deferredConditions = await tx.setupCondition.deleteMany({ where: { type: DEFERRED_TYPE } });
        const deferredRuns = await tx.setupConditionRun.deleteMany({ where: { type: DEFERRED_TYPE } });
        const clearedUnitRows = await tx.setupCondition.deleteMany({ where: CLEARED_UNIT_ROWS_WHERE });

        const mismatch =
          notifications.count !== inTx.notifications ||
          deferredConditions.count !== inTx.deferredConditions ||
          deferredRuns.count !== inTx.deferredRuns ||
          clearedUnitRows.count !== inTx.clearedUnitRows;
        if (mismatch) {
          throw new GuardFailed(
            `deleted counts (${notifications.count}/${deferredConditions.count}/${deferredRuns.count}/${clearedUnitRows.count}) ` +
              `differ from counted (${inTx.notifications}/${inTx.deferredConditions}/${inTx.deferredRuns}/${inTx.clearedUnitRows})`,
          );
        }
      });
    } catch (err) {
      if (err instanceof GuardFailed) {
        console.error(`\nSTOPPED inside the transaction: ${err.message}. Rolled back; nothing was deleted.`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    print('\nAfter', await countAll(prisma));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
