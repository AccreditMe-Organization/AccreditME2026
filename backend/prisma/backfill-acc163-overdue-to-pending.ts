// One-off backfill for ACC-163 — rewrites every task still stored as OVERDUE to
// PENDING (shown as "Assigned").
//
// RUN THIS ONLY AFTER ACC-163'S CODE IS DEPLOYED. Until then the deployed SLA
// sweep (SlaMonitorProcessor.sweepOverdueTasks) still writes status OVERDUE:
// every fifteen minutes it flips each open task past its due time to OVERDUE,
// so a PENDING written by this script before the deploy is OVERDUE again within
// a quarter of an hour. ACC-163's sweep writes no status at all — overdue is a
// flag computed from dueAt (Q8) — so after the deploy, what this writes stays
// written. A dry run after the deploy that still lists rows is expected; a dry
// run that lists NEW rows a day after an --execute means old code is running
// somewhere.
//
// WHY PENDING. OVERDUE was only ever written over PENDING: IN_PROGRESS was never
// written by any code before ACC-163, and the sweep skipped COMPLETED, CANCELLED
// and UNASSIGNED. So every OVERDUE row is an Assigned task that went past its
// due time, and PENDING is the status it would have kept. Nothing about it is
// lost: the breach stays recorded in slaBreachedAt, which this does not touch,
// and the task still reads as overdue because its dueAt is still past.
//
// WHY A BACKFILL AND NOT THE MIGRATION. ACC-163's migration had to be additive
// and ran while the old code was still serving (ACC-127); rewriting the rows
// there would have been undone by the old sweep on its next pass.
//
// It does not remove OVERDUE (or DELEGATED) from the TaskStatus enum. That is a
// contracting migration for a later ticket, safe only once this has run and no
// deployed code reads or writes either value.
//
// NOT a revocation, so CLAUDE.md's no-customer-tenant rule (ACC-101) does not
// apply: no tenant ever chose OVERDUE, and the change restores the status the
// task already had. It does change tenant data, so it writes each affected
// tenant's audit trail (ACC-101's audit rule): one UPDATE / Task row per
// organization, listing every task it changed, with actorId null — no person
// did this — and the script and ticket named in metadata.
//
// Everything --execute writes happens in ONE transaction, so a tenant's tasks
// never change without the audit row that says so.
//
// DRY RUN BY DEFAULT. Pass --execute to apply. Idempotent: once no row is
// OVERDUE there is nothing left to find, and a re-run reports exactly that.
//
// Run: npm run backfill:acc163-overdue-to-pending            (dry run)
//      npm run backfill:acc163-overdue-to-pending -- --execute

import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const SCRIPT_NAME = 'backfill-acc163-overdue-to-pending';
const TICKET = 'ACC-163';

interface AffectedOrg {
  organizationId: string;
  slug: string;
  taskIds: string[];
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log(
      `\n${execute ? 'EXECUTE' : 'DRY RUN'} — OVERDUE tasks to PENDING (${TICKET})\n`,
    );

    const overdue = await prisma.task.findMany({
      where: { status: 'OVERDUE' },
      select: {
        id: true,
        organizationId: true,
        title: true,
        dueAt: true,
        slaBreachedAt: true,
      },
      orderBy: [{ organizationId: 'asc' }, { dueAt: 'asc' }],
    });

    if (overdue.length === 0) {
      console.log('No task is stored as OVERDUE — nothing to do.\n');
      return;
    }

    const organizations = await prisma.organization.findMany({
      where: { id: { in: [...new Set(overdue.map((t) => t.organizationId))] } },
      select: { id: true, slug: true },
    });
    const slugById = new Map(organizations.map((o) => [o.id, o.slug]));

    const byOrg = new Map<string, AffectedOrg>();
    for (const task of overdue) {
      const entry = byOrg.get(task.organizationId) ?? {
        organizationId: task.organizationId,
        slug: slugById.get(task.organizationId) ?? task.organizationId,
        taskIds: [],
      };
      entry.taskIds.push(task.id);
      byOrg.set(task.organizationId, entry);
    }
    const affected = [...byOrg.values()].sort((a, b) =>
      a.slug.localeCompare(b.slug),
    );

    console.log(
      `${execute ? 'Rewriting' : 'Would rewrite'} ${overdue.length} task(s) from OVERDUE to PENDING ` +
        `across ${affected.length} organization(s):`,
    );
    for (const task of overdue) {
      const slug = slugById.get(task.organizationId) ?? task.organizationId;
      console.log(
        `  ${slug.padEnd(22)} ${task.id}  due ${task.dueAt?.toISOString() ?? '—'}` +
          `  breach recorded ${task.slaBreachedAt?.toISOString() ?? '—'}  "${task.title}"`,
      );
    }
    console.log(
      `\n${execute ? 'Writing' : 'Would write'} ${affected.length} AuditLog row(s), one per organization above.`,
    );

    if (!execute) {
      console.log(
        '\nDry run only — re-run with --execute to apply (after the ACC-163 deploy).\n',
      );
      return;
    }

    const rewritten = await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const org of affected) {
        // Scoped by organization AND id AND the status it is leaving, so a row
        // that changed since the read above is not touched — and is caught by
        // the count check below.
        const result = await tx.task.updateMany({
          where: {
            organizationId: org.organizationId,
            id: { in: org.taskIds },
            status: 'OVERDUE',
          },
          data: { status: 'PENDING' },
        });
        if (result.count !== org.taskIds.length) {
          throw new Error(
            `${org.slug}: expected to rewrite ${org.taskIds.length} task(s) but matched ${result.count}. ` +
              'The data changed between the read and the write — re-run the dry run.',
          );
        }

        await tx.auditLog.create({
          data: {
            organizationId: org.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'Task',
            objectId: null,
            before: { status: 'OVERDUE', taskIds: org.taskIds },
            after: { status: 'PENDING', taskIds: org.taskIds },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason:
                'Overdue is now a flag computed from the due date, not a status. These tasks were Assigned ' +
                'tasks past their due time; their breach stays recorded in slaBreachedAt.',
            },
          },
        });
        total += result.count;
      }
      return total;
    });

    console.log(
      `\nRewrote ${rewritten} task(s) to PENDING and wrote ${affected.length} audit row(s).\n`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    '\nBackfill failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
