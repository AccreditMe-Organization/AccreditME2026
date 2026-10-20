-- AlterEnum
ALTER TYPE "WorkflowObjectType" ADD VALUE 'COMMITTEE_CHANGE_REQUEST';

-- AlterTable
ALTER TABLE "WorkflowInstanceStage" ADD COLUMN     "quorumCount" INTEGER;

-- CreateTable
CREATE TABLE "CommitteeChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "fromValues" JSONB,
    "submittedAt" TIMESTAMP(3),
    "returnNote" TEXT,
    "rejectionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "termsTaskId" TEXT,
    "withdrawnById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitteeChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeChangeRequest_organizationId_idx" ON "CommitteeChangeRequest"("organizationId");

-- CreateIndex
CREATE INDEX "CommitteeChangeRequest_organizationId_committeeId_idx" ON "CommitteeChangeRequest"("organizationId", "committeeId");

-- CreateIndex
CREATE INDEX "CommitteeChangeRequest_organizationId_requestedById_idx" ON "CommitteeChangeRequest"("organizationId", "requestedById");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeChangeRequest_committeeId_number_key" ON "CommitteeChangeRequest"("committeeId", "number");

-- AddForeignKey
ALTER TABLE "CommitteeChangeRequest" ADD CONSTRAINT "CommitteeChangeRequest_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeChangeRequest" ADD CONSTRAINT "CommitteeChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
