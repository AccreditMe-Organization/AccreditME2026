// One-off cleanup for ACC-82 (SYSTEM-REFERENCE §13.7, §13.2). Two parts, run
// together in one transaction:
//
//   1. The condition notifications that accumulated in the bell before ACC-82
//      stopped sending them — one repeated report every 15 minutes per tenant.
//      Matched by exact title; every title here is one ACC-82 removed from the
//      code, and none is still produced by it.
//   2. The rows left by POSITION_WITHOUT_ROLE, deferred in ACC-82 before it
//      shipped: its SetupCondition rows and its SetupConditionRun rows. Nothing
//      reconciles a deferred type, so these would otherwise sit frozen.
//
// RUN ONLY AFTER ACC-82's MERGE HAS DEPLOYED. A server still running the older
// code keeps writing the notifications this deletes.
//
// Safe by default:
//   - Without --execute it only counts and prints; nothing is written.
//   - With --execute it refuses to run unless the notification count is within
//     EXPECTED_TOLERANCE of EXPECTED_NOTIFICATIONS (1,489 counted on dev on
//     2026-09-15). A count far from that means the data is not what was
//     reviewed, and the right move is to look again, not to delete anyway.
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
import { PrismaClient } from '../generated/prisma/client';

const REMOVED_NOTIFICATION_TITLES = [
  'Head-authority setup incomplete',
  'Org unit has no resolvable Head',
  'Reminder: org unit still has no resolvable Head',
  'Workflow stage unreachable — no eligible assignee',
  'Task created with no eligible assignee',
];

const DEFERRED_TYPE = 'POSITION_WITHOUT_ROLE' as const;

const EXPECTED_NOTIFICATIONS = 1489;
const EXPECTED_TOLERANCE = 0.05;

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const counts = async () => ({
    notifications: await prisma.notification.count({
      where: { titleEn: { in: REMOVED_NOTIFICATION_TITLES } },
    }),
    conditions: await prisma.setupCondition.count({ where: { type: DEFERRED_TYPE } }),
    runs: await prisma.setupConditionRun.count({ where: { type: DEFERRED_TYPE } }),
  });

  try {
    const before = await counts();
    console.log('Before:');
    console.log(`  notifications with removed titles:     ${before.notifications}`);
    console.log(`  SetupCondition rows (${DEFERRED_TYPE}):    ${before.conditions}`);
    console.log(`  SetupConditionRun rows (${DEFERRED_TYPE}): ${before.runs}`);

    const low = Math.floor(EXPECTED_NOTIFICATIONS * (1 - EXPECTED_TOLERANCE));
    const high = Math.ceil(EXPECTED_NOTIFICATIONS * (1 + EXPECTED_TOLERANCE));
    if (before.notifications < low || before.notifications > high) {
      console.error(
        `\nSTOPPED: expected about ${EXPECTED_NOTIFICATIONS} notifications (${low}–${high}), found ${before.notifications}. Nothing was deleted.`,
      );
      process.exitCode = 1;
      return;
    }

    if (!execute) {
      console.log('\nDry run — nothing deleted. Re-run with --execute to delete.');
      return;
    }

    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { titleEn: { in: REMOVED_NOTIFICATION_TITLES } } }),
      prisma.setupCondition.deleteMany({ where: { type: DEFERRED_TYPE } }),
      prisma.setupConditionRun.deleteMany({ where: { type: DEFERRED_TYPE } }),
    ]);

    const after = await counts();
    console.log('\nAfter:');
    console.log(`  notifications with removed titles:     ${after.notifications}`);
    console.log(`  SetupCondition rows (${DEFERRED_TYPE}):    ${after.conditions}`);
    console.log(`  SetupConditionRun rows (${DEFERRED_TYPE}): ${after.runs}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
