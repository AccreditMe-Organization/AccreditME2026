-- CreateEnum
CREATE TYPE "StageAssigneeKind" AS ENUM ('SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE');

-- CreateEnum
CREATE TYPE "StageWhoMode" AS ENUM ('ANY_ONE', 'ALL', 'COMMITTEE_VOTE');

-- CreateEnum
CREATE TYPE "TransitionMover" AS ENUM ('PERSON', 'APP', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "InstanceStageEventKind" AS ENUM ('POOL_MEMBER_LEFT');

-- AlterEnum
ALTER TYPE "SetupConditionType" ADD VALUE 'STAGE_ON_STARTING_ASSIGNMENT';

-- AlterTable
ALTER TABLE "WorkflowStage" ADD COLUMN     "whoMode" "StageWhoMode";

-- AlterTable
ALTER TABLE "WorkflowTransition" ADD COLUMN     "mover" "TransitionMover";

-- CreateTable
CREATE TABLE "WorkflowStageAssignee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" "StageAssigneeKind" NOT NULL,
    "userId" TEXT,
    "positionId" TEXT,
    "orgUnitId" TEXT,
    "committeeId" TEXT,
    "committeeRoleValueId" TEXT,
    "isStartingAssignment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "WorkflowStageAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstanceStageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workflowInstanceStageId" TEXT NOT NULL,
    "kind" "InstanceStageEventKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowInstanceStageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkflowStageAssignee_organizationId_idx" ON "WorkflowStageAssignee"("organizationId");

-- CreateIndex
CREATE INDEX "WorkflowStageAssignee_stageId_idx" ON "WorkflowStageAssignee"("stageId");

-- CreateIndex
CREATE INDEX "WorkflowStageAssignee_organizationId_userId_idx" ON "WorkflowStageAssignee"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "WorkflowStageAssignee_organizationId_isStartingAssignment_idx" ON "WorkflowStageAssignee"("organizationId", "isStartingAssignment");

-- CreateIndex
CREATE INDEX "WorkflowInstanceStageEvent_organizationId_idx" ON "WorkflowInstanceStageEvent"("organizationId");

-- CreateIndex
CREATE INDEX "WorkflowInstanceStageEvent_workflowInstanceStageId_idx" ON "WorkflowInstanceStageEvent"("workflowInstanceStageId");

-- AddForeignKey
ALTER TABLE "WorkflowStageAssignee" ADD CONSTRAINT "WorkflowStageAssignee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowStageAssignee" ADD CONSTRAINT "WorkflowStageAssignee_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "WorkflowStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstanceStageEvent" ADD CONSTRAINT "WorkflowInstanceStageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstanceStageEvent" ADD CONSTRAINT "WorkflowInstanceStageEvent_workflowInstanceStageId_fkey" FOREIGN KEY ("workflowInstanceStageId") REFERENCES "WorkflowInstanceStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
