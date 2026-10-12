import { PrismaService } from '../../prisma/prisma.service';

// ACC-190 — two pieces the workflow engine and task requests share, so both
// sides of a stage task take their locks in ONE order and keep the stage's
// deadline rule in one place.

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * The workflow instance's row lock. The engine takes it first on every stage
 * change, and anything that changes a stage task in a way that touches its stage
 * (an approved extension or hold moving the stage deadline) takes it BEFORE the
 * task's own lock, so the two can never wait on each other.
 */
export async function lockWorkflowInstance(tx: Tx, workflowInstanceId: string, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id = ${workflowInstanceId} AND "organizationId" = ${organizationId} FOR UPDATE`;
}

export interface StageDeadlineMove {
  workflowInstanceStageId: string;
  from: Date;
  to: Date;
}

/**
 * The stage's deadline is never before a MANDATORY task's due date (Ahmad,
 * 6 Oct; 9 Oct E): when an approved extension or hold moves a mandatory stage
 * task's due date past its open entry's deadline, the deadline moves out to
 * match. An optional task never holds its stage, so it never moves it, and a
 * stage with no deadline has nothing to move (9 Oct D).
 *
 * A deadline moved into the future is judged afresh by the breach sweep, so
 * its breached flag and fired escalation rules are cleared.
 */
export async function moveStageDeadlineForTaskInTx(
  tx: Tx,
  task: { isMandatory: boolean; workflowInstanceStageId: string | null; dueAt: Date | null },
  organizationId: string,
  now: Date,
): Promise<StageDeadlineMove | null> {
  if (!task.isMandatory || !task.workflowInstanceStageId || !task.dueAt) return null;
  const entry = await tx.workflowInstanceStage.findFirst({
    where: { id: task.workflowInstanceStageId, exitedAt: null, workflowInstance: { organizationId } },
    select: { id: true, slaDueAt: true },
  });
  if (!entry?.slaDueAt || task.dueAt <= entry.slaDueAt) return null;
  await tx.workflowInstanceStage.update({
    where: { id: entry.id },
    data: {
      slaDueAt: task.dueAt,
      ...(task.dueAt > now ? { slaBreached: false, escalatedRuleIndexes: [] } : {}),
    },
  });
  return { workflowInstanceStageId: entry.id, from: entry.slaDueAt, to: task.dueAt };
}
