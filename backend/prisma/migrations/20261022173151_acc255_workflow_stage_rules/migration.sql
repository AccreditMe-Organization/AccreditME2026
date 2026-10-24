-- AlterTable
ALTER TABLE "WorkflowStage" ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "WorkflowStageRecordAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStageRecordAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowStageRecordAction_organizationId_idx" ON "WorkflowStageRecordAction"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStageRecordAction_stageId_actionKey_key" ON "WorkflowStageRecordAction"("stageId", "actionKey");

-- AddForeignKey
ALTER TABLE "WorkflowStageRecordAction" ADD CONSTRAINT "WorkflowStageRecordAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageRecordAction" ADD CONSTRAINT "WorkflowStageRecordAction_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

