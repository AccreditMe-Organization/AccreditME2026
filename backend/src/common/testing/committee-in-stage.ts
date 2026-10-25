import { PrismaService } from '../../prisma/prisma.service';
import { COMMITTEE_ACTIONS } from '../../foundation/workflow/record-registry';

/**
 * ACC-255 PR 2 — for real-database specs that edit a committee directly.
 *
 * Since PR 2 a committee's direct edit and member changes are allowed only
 * where its current stage allows them, and a committee with no workflow
 * instance allows nothing (D14). A spec that is about something else (the
 * reference checks, the stale save) gives its committees a live stage that
 * allows every direct change, as Formation does, and is then free of it.
 *
 * One template and stage per organisation, made on first use; each committee
 * gets its own instance there. The stage has no key, so nothing here can be
 * mistaken for a seeded stage.
 */
const EVERY_DIRECT_CHANGE = [
  COMMITTEE_ACTIONS.EDIT_DETAILS,
  COMMITTEE_ACTIONS.ADD_MEMBER,
  COMMITTEE_ACTIONS.REMOVE_MEMBER,
  COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE,
];

const stageByOrganization = new Map<string, Promise<{ templateId: string; stageId: string }>>();

async function editableStage(prisma: PrismaService, organizationId: string): Promise<{ templateId: string; stageId: string }> {
  const template = await prisma.workflowTemplate.create({
    data: { organizationId, nameEn: 'Committee (spec)', objectType: 'COMMITTEE', isDefault: true, isActive: true },
  });
  const stage = await prisma.workflowStage.create({
    data: {
      workflowTemplateId: template.id,
      nameEn: 'Formation (spec)',
      order: 10,
      isInitial: true,
      recordActions: { create: EVERY_DIRECT_CHANGE.map((actionKey) => ({ organizationId, actionKey })) },
    },
  });
  return { templateId: template.id, stageId: stage.id };
}

/** Puts `committeeId` in a live stage that allows every direct change. */
export async function putCommitteeInEditableStage(prisma: PrismaService, organizationId: string, committeeId: string): Promise<void> {
  let stage = stageByOrganization.get(organizationId);
  if (!stage) {
    stage = editableStage(prisma, organizationId);
    stageByOrganization.set(organizationId, stage);
  }
  const { templateId, stageId } = await stage;
  await prisma.workflowInstance.create({
    data: { organizationId, workflowTemplateId: templateId, objectType: 'COMMITTEE', objectId: committeeId, status: 'IN_PROGRESS', currentStageId: stageId },
  });
}
