import type { Prisma } from '../../../generated/prisma/client';

/**
 * ACC-271 — the tenant admin's starting assignment on a stage. ACC-278 removed
 * the old-column mapping that lived here (whoFromLegacy, moverForTrigger,
 * decidesTogether) with the executed backfills that read it.
 */

export type StartingAssignmentDb = Pick<
  Parameters<Parameters<import('../../prisma/prisma.service').PrismaService['$transaction']>[0]>[0],
  'workflowStage' | 'workflowStageAssignee'
>;

/**
 * ACC-271 — the starting assignment: a SPECIFIC_USER entry marked
 * `isStartingAssignment` on every CONVERTED stage of the organisation that has
 * no entry yet (what the seed marks). Two queries, whatever the count. A stage
 * that already has an entry is left alone, so running it again writes nothing.
 * Returns the stages it wrote.
 */
export async function writeStartingAssignments(
  db: StartingAssignmentDb,
  organizationId: string,
  adminUserId: string,
  createdById: string | null,
): Promise<{ stageIds: string[] }> {
  const stages = await db.workflowStage.findMany({
    where: { whoMode: { not: null }, workflowTemplate: { organizationId }, assignees: { none: {} } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (stages.length === 0) return { stageIds: [] };
  const data: Prisma.WorkflowStageAssigneeCreateManyInput[] = stages.map((s) => ({
    organizationId,
    stageId: s.id,
    order: 1,
    kind: 'SPECIFIC_USER',
    userId: adminUserId,
    isStartingAssignment: true,
    createdById,
  }));
  await db.workflowStageAssignee.createMany({ data });
  return { stageIds: stages.map((s) => s.id) };
}
