import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { SeedWorkflow } from './workflow.seed';
import { KEYED_SEED_TEMPLATES } from './workflow-stage-keys';

/**
 * Writes seed workflows into one organisation: each template, its stages, its
 * transitions and their actions, created or brought back to the seed. Moved out
 * of WorkflowTemplateService.seedDefaultWorkflows() in ACC-239 so the change
 * request backfill writes its ONE template with exactly the code a new
 * organisation's bootstrap does — re-applying every template there would
 * overwrite the tenant's own edits to the other seven.
 *
 * `db` is the PrismaService, or a transaction of it (the backfill writes each
 * organisation's template and its audit row together).
 */
export type WorkflowSeedDb = Pick<
  Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
  | 'workflowTemplate'
  | 'workflowStage'
  | 'workflowTransition'
  | 'workflowTransitionAction'
  | 'workflowStageRecordAction'
  | 'workflowStageAssignee'
>;

export async function applyWorkflowSeed(db: WorkflowSeedDb, organizationId: string, seeds: readonly SeedWorkflow[]): Promise<void> {
  // ACC-271 PR 6b — the seed names no role (it named them for the old people
  // columns), so nothing is resolved before writing.
  for (const seedWorkflow of seeds) {
    const existingTemplate = await db.workflowTemplate.findFirst({
      where: { organizationId, objectType: seedWorkflow.objectType, isDefault: true },
    });

    const templateData = {
      nameEn: seedWorkflow.nameEn,
      nameAr: seedWorkflow.nameAr,
      objectType: seedWorkflow.objectType,
      isDefault: true,
      isActive: true,
    };

    const template = existingTemplate
      ? await db.workflowTemplate.update({
          where: { id: existingTemplate.id },
          data: templateData,
        })
      : await db.workflowTemplate.create({
          data: { organizationId, ...templateData },
        });

    const stageIdByKey = new Map<string, string>();

    // ACC-233 — the stages of a keyed template carry the seed's own key, so
    // code can recognise them whatever the tenant later calls them. Found by
    // key first: a stage renamed since would otherwise be created again.
    const keyed = KEYED_SEED_TEMPLATES.has(seedWorkflow.objectType);

    for (const seedStage of seedWorkflow.stages) {
      const existingStage =
        (keyed &&
          (await db.workflowStage.findFirst({
            where: { workflowTemplateId: template.id, key: seedStage.key },
          }))) ||
        (await db.workflowStage.findFirst({
          where: { workflowTemplateId: template.id, nameEn: seedStage.nameEn },
        }));

      const stageData = {
        ...(keyed && { key: seedStage.key }),
        nameEn: seedStage.nameEn,
        nameAr: seedStage.nameAr,
        order: seedStage.order,
        slaWorkingHours: seedStage.slaWorkingHours ?? null,
        isInitial: seedStage.isInitial,
        isFinal: seedStage.isFinal,
        // ACC-271 PR 6b — no old people column: they keep their database
        // defaults until 6c drops them.
      };

      // ACC-255 — a stage's record actions and flags are written only when the
      // seed CREATES it: a stage that already exists keeps what its tenant
      // configured. This is how a NEW organisation gets the rules (bootstrap
      // runs this same code); existing ones got them from the ACC-255
      // backfill, which refuses customer organisations.
      //
      // ACC-271 — who works the stage, by the same rule: written when the seed
      // creates it (whoMode, and a CREATOR entry where the seed names one). A
      // stage the seed marks for a starting assignment gets its entry from
      // assignStartingAssignments() once the first admin is invited.
      const stage = existingStage
        ? await db.workflowStage.update({ where: { id: existingStage.id }, data: stageData })
        : await db.workflowStage.create({
            data: {
              workflowTemplateId: template.id,
              ...stageData,
              flags: [...(seedStage.flags ?? [])],
              whoMode: seedStage.who.mode,
            },
          });
      if (!existingStage && seedStage.actions?.length) {
        await db.workflowStageRecordAction.createMany({
          data: seedStage.actions.map((actionKey) => ({ organizationId, stageId: stage.id, actionKey })),
        });
      }
      if (!existingStage && 'entries' in seedStage.who && seedStage.who.entries.length > 0) {
        await db.workflowStageAssignee.createMany({
          data: seedStage.who.entries.map((entry, i) => ({ organizationId, stageId: stage.id, order: i + 1, kind: entry.kind })),
        });
      }

      stageIdByKey.set(seedStage.key, stage.id);
    }

    for (const seedTransition of seedWorkflow.transitions) {
      const fromStageId = stageIdByKey.get(seedTransition.fromStageKey);
      const toStageId = stageIdByKey.get(seedTransition.toStageKey);
      if (!fromStageId || !toStageId) {
        throw new Error(
          `Workflow seed for objectType '${seedWorkflow.objectType}' references an unknown stage key in a transition`,
        );
      }

      const existingTransition = await db.workflowTransition.findFirst({
        where: { fromStageId, toStageId },
      });

      const transitionData = {
        labelEn: seedTransition.labelEn,
        labelAr: seedTransition.labelAr,
        // ACC-271 PR 6b — no old people column (they keep their database
        // defaults until 6c drops them); the mover says who moves it.
        validatorConfig: toJson(seedTransition.validatorConfig),
        isApprovalPath: seedTransition.isApprovalPath ?? false,
        kind: seedTransition.kind ?? 'ADVANCE',
      };

      const transition = existingTransition
        ? await db.workflowTransition.update({
            where: { id: existingTransition.id },
            data: transitionData,
          })
        : await db.workflowTransition.create({
            // ACC-271 — who moves the record, written with the transition, like who works a stage.
            // PR 6a — the seed states it.
            data: { fromStageId, toStageId, ...transitionData, mover: seedTransition.mover },
          });

      for (const seedAction of seedTransition.actions) {
        const existingAction = await db.workflowTransitionAction.findFirst({
          where: {
            workflowTransitionId: transition.id,
            actionType: seedAction.actionType,
            order: seedAction.order,
          },
        });

        const actionData = {
          isEnabled: true,
          configJson: toJson(seedAction.configJson),
        };

        if (existingAction) {
          await db.workflowTransitionAction.update({
            where: { id: existingAction.id },
            data: actionData,
          });
        } else {
          await db.workflowTransitionAction.create({
            data: {
              workflowTransitionId: transition.id,
              actionType: seedAction.actionType,
              order: seedAction.order,
              ...actionData,
            },
          });
        }
      }
    }
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined || value === null ? undefined : (value as Prisma.InputJsonValue);
}
