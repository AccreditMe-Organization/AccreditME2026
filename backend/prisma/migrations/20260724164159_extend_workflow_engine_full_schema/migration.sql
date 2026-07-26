-- CreateEnum
CREATE TYPE "WorkflowObjectType" AS ENUM ('DOCUMENT', 'INCIDENT', 'AUDIT', 'CORRECTIVE_ACTION', 'MEETING', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "WorkflowApprovalMode" AS ENUM ('SINGLE', 'SEQUENTIAL', 'PARALLEL', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "WorkflowParallelThreshold" AS ENUM ('ALL', 'MAJORITY', 'ANY');

-- CreateEnum
CREATE TYPE "WorkflowAssigneeStrategy" AS ENUM ('SPECIFIC_USER', 'ROLE', 'ORG_UNIT_HEAD', 'SELF', 'COMMITTEE', 'ROUND_ROBIN');

-- CreateEnum
CREATE TYPE "WorkflowTriggerCondition" AS ENUM ('SPECIFIC_USER', 'ROLE_BASED', 'ANY_AUTHENTICATED', 'SYSTEM_AUTOMATIC');

-- CreateEnum
CREATE TYPE "WorkflowActionType" AS ENUM ('CREATE_TASK', 'SEND_NOTIFICATION', 'GENERATE_PDF', 'LOCK_DOCUMENT', 'LOG_AUDIT', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "WorkflowApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkflowActionLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "WorkflowInstanceStageOutcome" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- AlterTable
ALTER TABLE "WorkflowInstance" ADD COLUMN     "organizationId" TEXT NOT NULL,
DROP COLUMN "objectType",
ADD COLUMN     "objectType" "WorkflowObjectType" NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowInstanceStage" ADD COLUMN     "outcome" "WorkflowInstanceStageOutcome" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "slaBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slaDueAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WorkflowStage" DROP COLUMN "name",
ADD COLUMN     "approvalMode" "WorkflowApprovalMode" NOT NULL DEFAULT 'SINGLE',
ADD COLUMN     "assigneeRoleId" TEXT,
ADD COLUMN     "assigneeStrategy" "WorkflowAssigneeStrategy" NOT NULL DEFAULT 'ROLE',
ADD COLUMN     "assigneeUserId" TEXT,
ADD COLUMN     "committeeId" TEXT,
ADD COLUMN     "escalationConfig" JSONB,
ADD COLUMN     "nameAr" TEXT NOT NULL,
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "parallelThreshold" "WorkflowParallelThreshold";

-- AlterTable
ALTER TABLE "WorkflowTemplate" DROP COLUMN "name",
ADD COLUMN     "nameAr" TEXT NOT NULL,
ADD COLUMN     "nameEn" TEXT NOT NULL,
DROP COLUMN "objectType",
ADD COLUMN     "objectType" "WorkflowObjectType" NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowTransition" DROP COLUMN "conditionJson",
DROP COLUMN "label",
ADD COLUMN     "labelAr" TEXT NOT NULL,
ADD COLUMN     "labelEn" TEXT NOT NULL,
ADD COLUMN     "triggerCondition" "WorkflowTriggerCondition" NOT NULL DEFAULT 'ROLE_BASED',
ADD COLUMN     "triggerRoleId" TEXT,
ADD COLUMN     "triggerUserId" TEXT,
ADD COLUMN     "validatorConfig" JSONB;

-- CreateTable
CREATE TABLE "WorkflowApproval" (
    "id" TEXT NOT NULL,
    "workflowInstanceStageId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" "WorkflowApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowTransitionAction" (
    "id" TEXT NOT NULL,
    "workflowTransitionId" TEXT NOT NULL,
    "actionType" "WorkflowActionType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "configJson" JSONB,

    CONSTRAINT "WorkflowTransitionAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowActionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowTransitionActionId" TEXT NOT NULL,
    "workflowInstanceId" TEXT NOT NULL,
    "actionType" "WorkflowActionType" NOT NULL,
    "status" "WorkflowActionLogStatus" NOT NULL DEFAULT 'SUCCESS',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "responseSummary" TEXT,
    "errorMessage" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowApproval_workflowInstanceStageId_idx" ON "WorkflowApproval"("workflowInstanceStageId");

-- CreateIndex
CREATE INDEX "WorkflowApproval_approverId_idx" ON "WorkflowApproval"("approverId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowApproval_workflowInstanceStageId_approverId_key" ON "WorkflowApproval"("workflowInstanceStageId", "approverId");

-- CreateIndex
CREATE INDEX "WorkflowTransitionAction_workflowTransitionId_idx" ON "WorkflowTransitionAction"("workflowTransitionId");

-- CreateIndex
CREATE INDEX "WorkflowActionLog_organizationId_idx" ON "WorkflowActionLog"("organizationId");

-- CreateIndex
CREATE INDEX "WorkflowActionLog_workflowTransitionActionId_idx" ON "WorkflowActionLog"("workflowTransitionActionId");

-- CreateIndex
CREATE INDEX "WorkflowActionLog_workflowInstanceId_idx" ON "WorkflowActionLog"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "WorkflowActionLog_status_idx" ON "WorkflowActionLog"("status");

-- CreateIndex
CREATE INDEX "WorkflowActionLog_executedAt_idx" ON "WorkflowActionLog"("executedAt");

-- CreateIndex
CREATE INDEX "WorkflowInstance_organizationId_idx" ON "WorkflowInstance"("organizationId");

-- CreateIndex
CREATE INDEX "WorkflowInstance_objectType_objectId_idx" ON "WorkflowInstance"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "WorkflowInstanceStage_slaDueAt_idx" ON "WorkflowInstanceStage"("slaDueAt");

-- CreateIndex
CREATE INDEX "WorkflowTemplate_objectType_idx" ON "WorkflowTemplate"("objectType");

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_workflowInstanceStageId_fkey" FOREIGN KEY ("workflowInstanceStageId") REFERENCES "WorkflowInstanceStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowApproval" ADD CONSTRAINT "WorkflowApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowTransitionAction" ADD CONSTRAINT "WorkflowTransitionAction_workflowTransitionId_fkey" FOREIGN KEY ("workflowTransitionId") REFERENCES "WorkflowTransition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionLog" ADD CONSTRAINT "WorkflowActionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionLog" ADD CONSTRAINT "WorkflowActionLog_workflowTransitionActionId_fkey" FOREIGN KEY ("workflowTransitionActionId") REFERENCES "WorkflowTransitionAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowActionLog" ADD CONSTRAINT "WorkflowActionLog_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
