/*
  Warnings:

  - You are about to drop the column `approvalMode` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneeCommitteeRoleValueId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneeOrgUnitId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneePositionId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneeRoleId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneeStrategy` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `assigneeUserId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `committeeId` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `parallelThreshold` on the `WorkflowStage` table. All the data in the column will be lost.
  - You are about to drop the column `requiredPermission` on the `WorkflowTransition` table. All the data in the column will be lost.
  - You are about to drop the column `triggerCondition` on the `WorkflowTransition` table. All the data in the column will be lost.
  - You are about to drop the column `triggerRoleId` on the `WorkflowTransition` table. All the data in the column will be lost.
  - You are about to drop the column `triggerUserId` on the `WorkflowTransition` table. All the data in the column will be lost.
  - Made the column `whoMode` on table `WorkflowStage` required. This step will fail if there are existing NULL values in that column.
  - Made the column `mover` on table `WorkflowTransition` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "WorkflowStage" DROP CONSTRAINT "WorkflowStage_assigneeOrgUnitId_fkey";

-- DropForeignKey
ALTER TABLE "WorkflowStage" DROP CONSTRAINT "WorkflowStage_assigneePositionId_fkey";

-- AlterTable
ALTER TABLE "WorkflowStage" DROP COLUMN "approvalMode",
DROP COLUMN "assigneeCommitteeRoleValueId",
DROP COLUMN "assigneeOrgUnitId",
DROP COLUMN "assigneePositionId",
DROP COLUMN "assigneeRoleId",
DROP COLUMN "assigneeStrategy",
DROP COLUMN "assigneeUserId",
DROP COLUMN "committeeId",
DROP COLUMN "parallelThreshold",
ALTER COLUMN "whoMode" SET NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowTransition" DROP COLUMN "requiredPermission",
DROP COLUMN "triggerCondition",
DROP COLUMN "triggerRoleId",
DROP COLUMN "triggerUserId",
ALTER COLUMN "mover" SET NOT NULL;

-- DropEnum
DROP TYPE "WorkflowApprovalMode";

-- DropEnum
DROP TYPE "WorkflowAssigneeStrategy";

-- DropEnum
DROP TYPE "WorkflowParallelThreshold";

-- DropEnum
DROP TYPE "WorkflowTriggerCondition";
