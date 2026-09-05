-- AlterEnum
ALTER TYPE "WorkflowAssigneeStrategy" ADD VALUE 'POSITION_FIXED';

-- AlterTable
ALTER TABLE "WorkflowStage" ADD COLUMN     "assigneeOrgUnitId" TEXT,
ADD COLUMN     "assigneePositionId" TEXT;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_assigneePositionId_fkey" FOREIGN KEY ("assigneePositionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStage" ADD CONSTRAINT "WorkflowStage_assigneeOrgUnitId_fkey" FOREIGN KEY ("assigneeOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
