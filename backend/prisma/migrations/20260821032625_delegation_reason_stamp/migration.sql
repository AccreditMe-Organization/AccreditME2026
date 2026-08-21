-- CreateEnum
CREATE TYPE "DelegationReason" AS ENUM ('ACTING_HEAD', 'OUT_OF_OFFICE_COVERAGE');

-- AlterTable
ALTER TABLE "TaskAssignee" ADD COLUMN     "delegationContextId" TEXT,
ADD COLUMN     "delegationReason" "DelegationReason";

-- AlterTable
ALTER TABLE "WorkflowApproval" ADD COLUMN     "delegationContextId" TEXT,
ADD COLUMN     "delegationReason" "DelegationReason";

-- AlterTable
ALTER TABLE "WorkflowInstanceStage" ADD COLUMN     "delegationContextId" TEXT,
ADD COLUMN     "delegationReason" "DelegationReason";
