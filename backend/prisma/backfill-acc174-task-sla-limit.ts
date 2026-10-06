// One-off backfill for ACC-174 — fills the SLA window on open tasks created
// before ACC-174: slaStartAt, slaLimitAt and, where an extension was approved,
// slaExtendedTo.
//
// WHY. ACC-174 gives every task an SLA limit — the latest due date a person may
// set — counted from its SLA start (TaskSlaService). New tasks get it at
// creation. Older rows have nulls, and until this runs the code reads a null as
// "compute it": TaskSlaService.initialLimit(), which is EXACTLY what this
// writes. So running it changes nothing a person sees; it only stops the value
// being recomputed on every read.
//
// WHAT IS WRITTEN, per open task (status not COMPLETED / CANCELLED) whose
// slaLimitAt is null:
//   slaStartAt     createdAt (left as is if already set)
//   slaExtendedTo  the latest APPROVED request for more time, if any
//   slaLimitAt     the priority SLA from slaStartAt (WorkingCalendarService),
//                  raised to the task's current due date and to slaExtendedTo
//                  — so no existing task starts out over its limit.
// Closed tasks are left alone: a reopen restarts the SLA from scratch.
//
// THE DATES GO THROUGH WorkingCalendarService, never through arithmetic here.
// The script boots a SMALL Nest context — Prisma, the working calendar and
// audit, and TaskSlaService — never AppModule, so no queue module is loaded and
// nothing can touch the shared Redis (the ACC-51 failure). The tenant's SLA is
// read through taskSlaFromSettings(), the one reading the app uses.
//
// NO CUSTOMER-TENANT CONDITION. ACC-101's rule guards REVOCATIONS, which can
// overwrite a decision a customer made. This only fills three new columns: it
// grants nothing and removes nothing.
//
// THE AUDIT TRAIL RECORDS IT (CLAUDE.md, ACC-101): one row per organization —
// UPDATE / Task, objectId null because it covers several tasks, before and
// after per task, actorId null (no person did this), the script and ticket in
// metadata. Each organization is ONE transaction, so its tasks are never
// changed without the row that says so.
//
// RUN AFTER THE ACC-174 DEPLOY, DRY RUN FIRST. The dry run prints every task
// and the values it would write; --execute re-reads each organization's scope
// inside its transaction and refuses if it changed since the dry run's read.
// Idempotent: a re-run finds nothing left to fill.
//
// Run: npm run backfill:acc174-task-sla-limit            (dry run)
//      npm run backfill:acc174-task-sla-limit -- --execute

import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/common/services/audit-log.service';
import { WorkingCalendarService } from '../src/foundation/working-calendar/working-calendar.service';
import { TaskSlaService, latest } from '../src/foundation/task/task-sla.service';

const SCRIPT_NAME = 'backfill-acc174-task-sla-limit';
const TICKET = 'ACC-174';

// Exactly what TaskSlaService needs, and nothing that starts a worker.
@Module({
  imports: [PrismaModule],
  providers: [AuditLogService, WorkingCalendarService, TaskSlaService],
})
class BackfillModule {}

interface PlannedTask {
  id: string;
  organizationId: string;
  title: string;
  priority: string;
  createdAt: Date;
  dueAt: Date | null;
  computed: Date;
  slaStartAt: Date;
  slaLimitAt: Date;
  slaExtendedTo: Date | null;
  raisedBy: 'due date' | 'extension' | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().replace('.000Z', 'Z') : '—');

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(BackfillModule, { logger: ['error', 'warn'] });

  try {
    const prisma = app.get(PrismaService);
    const sla = app.get(TaskSlaService);
    console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — filling the task SLA window (${TICKET})\n`);

    const organizations = await prisma.organization.findMany({
      select: { id: true, slug: true, isPlatformOrg: true },
      orderBy: { slug: 'asc' },
    });
    const slugById = new Map(organizations.map((o) => [o.id, o.slug]));

    const planned = await plan(prisma, sla);
    const byOrg = new Map<string, PlannedTask[]>();
    for (const p of planned) byOrg.set(p.organizationId, [...(byOrg.get(p.organizationId) ?? []), p]);

    console.log(`Open tasks with no SLA limit yet: ${planned.length}, in ${byOrg.size} organization(s)\n`);
    for (const [orgId, tasks] of byOrg) {
      console.log(`${slugById.get(orgId) ?? orgId}`);
      for (const t of tasks) {
        console.log(
          `  ${t.id}  ${t.priority.padEnd(8)} "${t.title}"\n` +
            `    created ${iso(t.createdAt)}  due ${iso(t.dueAt)}\n` +
            `    priority SLA from start ${iso(t.computed)}  →  slaStartAt ${iso(t.slaStartAt)}  ` +
            `slaLimitAt ${iso(t.slaLimitAt)}${t.raisedBy ? `  (raised by the ${t.raisedBy})` : ''}` +
            `${t.slaExtendedTo ? `  slaExtendedTo ${iso(t.slaExtendedTo)}` : ''}`,
        );
      }
    }
    console.log(`\n${execute ? 'Writing' : 'Would write'} ${byOrg.size} AuditLog row(s), one per organization above.`);

    if (planned.length === 0) {
      console.log('\nNothing to fill — already done.\n');
      return;
    }
    if (!execute) {
      console.log('\nDry run only — re-run with --execute to apply.\n');
      return;
    }

    let written = 0;
    for (const [orgId, tasks] of byOrg) {
      await prisma.$transaction(async (tx) => {
        // The scope again, inside the transaction: refuse if it moved.
        const now = await tx.task.findMany({
          where: { organizationId: orgId, id: { in: tasks.map((t) => t.id) }, ...SCOPE },
          select: { id: true },
        });
        if (now.length !== tasks.length) {
          throw new Error(
            `${slugById.get(orgId) ?? orgId}: expected ${tasks.length} task(s) still unfilled, found ${now.length}. ` +
              'The database changed since the dry run — re-run the dry run.',
          );
        }
        for (const t of tasks) {
          await tx.task.update({
            where: { id: t.id },
            data: { slaStartAt: t.slaStartAt, slaLimitAt: t.slaLimitAt, slaExtendedTo: t.slaExtendedTo },
          });
        }
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'Task',
            objectId: null,
            before: { tasks: tasks.map((t) => ({ taskId: t.id, slaStartAt: null, slaLimitAt: null, slaExtendedTo: null })) },
            after: {
              tasks: tasks.map((t) => ({
                taskId: t.id,
                slaStartAt: t.slaStartAt.toISOString(),
                slaLimitAt: t.slaLimitAt.toISOString(),
                slaExtendedTo: t.slaExtendedTo?.toISOString() ?? null,
              })),
            },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason: "Filled the SLA window of tasks created before the SLA limit existed; no task's due date changed.",
            },
          },
        });
        written += tasks.length;
      });
    }
    console.log(`\nFilled ${written} task(s), wrote ${byOrg.size} audit row(s).\n`);
  } finally {
    await app.close();
  }
}

// Open, and not yet filled.
const SCOPE = { status: { notIn: ['COMPLETED' as const, 'CANCELLED' as const] }, slaLimitAt: null };

async function plan(prisma: PrismaService, sla: TaskSlaService): Promise<PlannedTask[]> {
  const tasks = await prisma.task.findMany({
    where: SCOPE,
    select: {
      id: true,
      organizationId: true,
      title: true,
      priority: true,
      createdAt: true,
      dueAt: true,
      slaStartAt: true,
      slaLimitAt: true,
      slaExtendedTo: true,
    },
    orderBy: [{ organizationId: 'asc' }, { createdAt: 'asc' }],
  });
  if (tasks.length === 0) return [];

  const approved = await prisma.taskRequest.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) }, type: 'EXTENSION', status: 'APPROVED' },
    select: { taskId: true, organizationId: true, requestedDueAt: true },
  });

  const result: PlannedTask[] = [];
  for (const t of tasks) {
    const approvedDates = approved
      .filter((a) => a.taskId === t.id && a.organizationId === t.organizationId && a.requestedDueAt)
      .map((a) => a.requestedDueAt as Date);
    const extendedTo = approvedDates.length > 0 ? latest(approvedDates[0]!, ...approvedDates.slice(1), t.slaExtendedTo) : t.slaExtendedTo;
    const start = sla.startOf(t);
    const computed = await sla.windowFrom(start, t.priority, t.organizationId);
    // The same value TaskSlaService.initialLimit() computes for a null limit.
    const limit = latest(computed, t.dueAt, extendedTo);
    result.push({
      id: t.id,
      organizationId: t.organizationId,
      title: t.title,
      priority: t.priority,
      createdAt: t.createdAt,
      dueAt: t.dueAt,
      computed,
      slaStartAt: start,
      slaLimitAt: limit,
      slaExtendedTo: extendedTo,
      raisedBy: limit.getTime() === computed.getTime() ? null : extendedTo && limit.getTime() === extendedTo.getTime() ? 'extension' : 'due date',
    });
  }
  return result;
}

main().catch((error: unknown) => {
  console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
