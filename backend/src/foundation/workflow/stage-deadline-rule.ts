import { TaskPriority } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// ACC-190 — THE STAGE DEADLINE RULE (Ahmad, 6 Oct): a stage's deadline is at
// least the longest due time of any task defined on it. Both sides are WORKING
// HOURS counted from the moment the record enters the stage — the stage's
// `slaWorkingHours`, and the tenant's `taskSla[priority].dueAfterHours` — so
// the comparison is two plain numbers. A stage with no deadline has nothing to
// break (Ahmad, 9 Oct, D).
//
// Three saves can break it, and each one is refused with its own code:
//   a definition (its priority)        STAGE_TASK_DUE_AFTER_STAGE_DEADLINE
//   a stage's deadline                 STAGE_DEADLINE_BEFORE_TASKS
//   the tenant's task SLA hours        TASK_SLA_EXCEEDS_STAGE_DEADLINES
// The third is a plain function rather than a service so TenantService can call
// it without TenantModule importing WorkflowModule.

export type DueHours = (priority: TaskPriority) => number;

export interface StageDeadlineConflict {
  stageId: string;
  stageName: string;
  templateName: string;
  stageHours: number;
  longestTaskHours: number;
}

/** Every stage in the tenant whose deadline is shorter than its longest task, with `dueHours`. */
export async function stageDeadlineConflicts(
  prisma: Pick<PrismaService, 'workflowStageTaskDefinition'>,
  organizationId: string,
  dueHours: DueHours,
): Promise<StageDeadlineConflict[]> {
  const definitions = await prisma.workflowStageTaskDefinition.findMany({
    where: { organizationId, stage: { slaWorkingHours: { not: null } } },
    select: {
      priority: true,
      stage: { select: { id: true, nameEn: true, slaWorkingHours: true, workflowTemplate: { select: { nameEn: true } } } },
    },
  });
  const byStage = new Map<string, StageDeadlineConflict>();
  for (const definition of definitions) {
    const { stage } = definition;
    const hours = dueHours(definition.priority);
    const current = byStage.get(stage.id);
    if (!current || hours > current.longestTaskHours) {
      byStage.set(stage.id, {
        stageId: stage.id,
        stageName: stage.nameEn,
        templateName: stage.workflowTemplate.nameEn,
        stageHours: stage.slaWorkingHours ?? 0,
        longestTaskHours: hours,
      });
    }
  }
  return [...byStage.values()].filter((s) => s.longestTaskHours > s.stageHours);
}
