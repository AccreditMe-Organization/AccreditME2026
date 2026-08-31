/*
  Warnings:

  - You are about to drop the column `requiredPermission` on the `WorkflowStage` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "WorkflowStage" DROP COLUMN "requiredPermission";
