-- AlterTable
ALTER TABLE "WorkflowInstanceStage" ADD COLUMN     "isUnassigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unassignedAt" TIMESTAMP(3);
