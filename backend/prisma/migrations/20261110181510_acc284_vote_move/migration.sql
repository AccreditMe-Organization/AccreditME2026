-- AlterTable
ALTER TABLE "WorkflowApproval" ADD COLUMN     "transitionId" TEXT;

-- CreateIndex
CREATE INDEX "WorkflowApproval_transitionId_idx" ON "WorkflowApproval"("transitionId");

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "WorkflowTransition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
