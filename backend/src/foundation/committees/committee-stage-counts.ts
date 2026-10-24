import { PrismaService } from '../../prisma/prisma.service';
import { STAGE_FLAG } from '../workflow/record-registry';

export interface CommitteeStageAndCount {
  memberCount: number;
  stageNameEn: string | null;
  stageNameAr: string | null;
  /** ACC-233 — the current stage's key (`WorkflowStage.key`), null for a stage the tenant added. */
  stageKey: string | null;
  /** ACC-255 PR 2 — whether the stage is flagged DISSOLVING (being dissolved, or has been). */
  isDissolving: boolean;
  /** ACC-255 PR 2 — whether the stage is flagged IN_FORCE (approved and governing). */
  isInForce: boolean;
}

/**
 * ACC-76, shared since ACC-230 — each committee's ACTIVE member count and its
 * live workflow stage, for a whole set of committees in three queries
 * regardless of its size (a grouped count, the workflow instances, their
 * stages). The committees list and the Sub-committees list both read it, so
 * the two can never say different things about one committee.
 *
 * Every query is scoped by organisation in its own right, not only through the
 * id set it is given.
 */
export async function committeeStagesAndCounts(
  prisma: PrismaService,
  organizationId: string,
  committeeIds: string[],
): Promise<Map<string, CommitteeStageAndCount>> {
  const result = new Map<string, CommitteeStageAndCount>();
  if (committeeIds.length === 0) return result;

  const [memberCounts, instances] = await Promise.all([
    // Active members only — a departed member is not part of the committee,
    // and CommitteeMember rows are reactivated in place rather than recreated
    // (ACC-32), so isActive is the only thing separating current from past.
    prisma.committeeMember.groupBy({
      by: ['committeeId'],
      where: { organizationId, committeeId: { in: committeeIds }, isActive: true },
      _count: { committeeId: true },
    }),
    prisma.workflowInstance.findMany({
      where: { organizationId, objectType: 'COMMITTEE', objectId: { in: committeeIds } },
      orderBy: { createdAt: 'desc' },
      select: { objectId: true, currentStageId: true },
    }),
  ]);

  const countByCommitteeId = new Map(memberCounts.map((row) => [row.committeeId, row._count.committeeId]));

  // Newest instance wins — ordered createdAt desc, and a committee can
  // accumulate instances over time, as any other object can.
  const stageIdByCommitteeId = new Map<string, string | null>();
  for (const instance of instances) {
    if (!stageIdByCommitteeId.has(instance.objectId)) {
      stageIdByCommitteeId.set(instance.objectId, instance.currentStageId);
    }
  }

  const stageIds = [...new Set([...stageIdByCommitteeId.values()].filter((id): id is string => !!id))];
  const stages =
    stageIds.length > 0
      ? await prisma.workflowStage.findMany({
          where: { id: { in: stageIds }, workflowTemplate: { organizationId } },
          select: { id: true, nameEn: true, nameAr: true, key: true, flags: true },
        })
      : [];
  const stageById = new Map(stages.map((s) => [s.id, s]));

  for (const id of committeeIds) {
    const stageId = stageIdByCommitteeId.get(id) ?? null;
    const stage = stageId ? stageById.get(stageId) : undefined;
    result.set(id, {
      memberCount: countByCommitteeId.get(id) ?? 0,
      stageNameEn: stage?.nameEn ?? null,
      stageNameAr: stage?.nameAr ?? null,
      stageKey: stage?.key ?? null,
      isDissolving: (stage?.flags ?? []).includes(STAGE_FLAG.DISSOLVING),
      isInForce: (stage?.flags ?? []).includes(STAGE_FLAG.IN_FORCE),
    });
  }
  return result;
}
