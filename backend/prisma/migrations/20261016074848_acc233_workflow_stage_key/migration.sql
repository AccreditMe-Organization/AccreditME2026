-- AlterTable
ALTER TABLE "WorkflowStage" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStage_workflowTemplateId_key_key" ON "WorkflowStage"("workflowTemplateId", "key");

