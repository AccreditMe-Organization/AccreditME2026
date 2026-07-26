-- AlterTable
ALTER TABLE "WorkflowInstanceStage" ADD COLUMN     "escalatedRuleIndexes" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
