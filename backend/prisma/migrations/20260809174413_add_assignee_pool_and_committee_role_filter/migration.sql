-- AlterEnum
ALTER TYPE "WorkflowTriggerCondition" ADD VALUE 'ASSIGNEE_POOL';

-- AlterTable
ALTER TABLE "WorkflowStage" ADD COLUMN     "assigneeCommitteeRoleValueId" TEXT;
