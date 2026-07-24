-- AlterEnum
BEGIN;
CREATE TYPE "WorkflowApprovalDecision_new" AS ENUM ('PENDING', 'APPROVED', 'APPROVED_WITH_COMMENTS', 'RETURNED', 'ABSTAINED');
ALTER TABLE "public"."WorkflowApproval" ALTER COLUMN "decision" DROP DEFAULT;
ALTER TABLE "WorkflowApproval" ALTER COLUMN "decision" TYPE "WorkflowApprovalDecision_new" USING ("decision"::text::"WorkflowApprovalDecision_new");
ALTER TYPE "WorkflowApprovalDecision" RENAME TO "WorkflowApprovalDecision_old";
ALTER TYPE "WorkflowApprovalDecision_new" RENAME TO "WorkflowApprovalDecision";
DROP TYPE "public"."WorkflowApprovalDecision_old";
ALTER TABLE "WorkflowApproval" ALTER COLUMN "decision" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
ALTER TYPE "WorkflowObjectType" ADD VALUE 'DOCUMENT_REQUEST' BEFORE 'DOCUMENT';
ALTER TYPE "WorkflowObjectType" ADD VALUE 'CHANGE_REQUEST' AFTER 'DOCUMENT';
