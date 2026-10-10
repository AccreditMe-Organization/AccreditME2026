-- CreateEnum
CREATE TYPE "WorkflowTransitionKind" AS ENUM ('ADVANCE', 'RETURN', 'EXIT');

-- CreateEnum
CREATE TYPE "StageTaskAssignKind" AS ENUM ('POSITION', 'RECORD_UNIT_POSITION', 'COMMITTEE_ROLE', 'RECORD_COMMITTEE_ROLE');

-- AlterTable
ALTER TABLE "WorkflowTransition" ADD COLUMN     "kind" "WorkflowTransitionKind" NOT NULL DEFAULT 'ADVANCE';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "isMandatory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stageTaskDefinitionId" TEXT,
ADD COLUMN     "titleAr" TEXT,
ADD COLUMN     "workflowInstanceStageId" TEXT;

-- CreateTable
CREATE TABLE "WorkflowStageTaskDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT,
    "description" TEXT,
    "isMandatory" BOOLEAN NOT NULL,
    "requiresEvidence" BOOLEAN NOT NULL DEFAULT false,
    "priority" "TaskPriority" NOT NULL,
    "assignKind" "StageTaskAssignKind" NOT NULL,
    "orgUnitId" TEXT,
    "positionId" TEXT,
    "userId" TEXT,
    "committeeId" TEXT,
    "committeeRoleValueId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowStageTaskDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowStageTaskDefinition_organizationId_idx" ON "WorkflowStageTaskDefinition"("organizationId");

-- CreateIndex
CREATE INDEX "WorkflowStageTaskDefinition_stageId_order_idx" ON "WorkflowStageTaskDefinition"("stageId", "order");

-- CreateIndex
CREATE INDEX "Task_workflowInstanceStageId_status_idx" ON "Task"("workflowInstanceStageId", "status");

-- CreateIndex
CREATE INDEX "Task_workflowInstanceId_sourceStageId_idx" ON "Task"("workflowInstanceId", "sourceStageId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_workflowInstanceStageId_fkey" FOREIGN KEY ("workflowInstanceStageId") REFERENCES "WorkflowInstanceStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_stageTaskDefinitionId_fkey" FOREIGN KEY ("stageTaskDefinitionId") REFERENCES "WorkflowStageTaskDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageTaskDefinition" ADD CONSTRAINT "WorkflowStageTaskDefinition_committeeRoleValueId_fkey" FOREIGN KEY ("committeeRoleValueId") REFERENCES "LookupValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

