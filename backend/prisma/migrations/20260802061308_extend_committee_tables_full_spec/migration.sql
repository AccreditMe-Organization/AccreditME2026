/*
  Warnings:

  - You are about to drop the column `description` on the `Committee` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Committee` table. All the data in the column will be lost.
  - You are about to drop the column `quorum` on the `Committee` table. All the data in the column will be lost.
  - Added the required column `nameAr` to the `Committee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `nameEn` to the `Committee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `organizationId` to the `CommitteeMember` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CommitteeMeetingFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL', 'ANNUAL', 'AS_NEEDED');

-- CreateEnum
CREATE TYPE "CommitteeMembershipAction" AS ENUM ('JOINED', 'LEFT', 'ROLE_CHANGED');

-- AlterTable
ALTER TABLE "Committee" DROP COLUMN "description",
DROP COLUMN "name",
DROP COLUMN "quorum",
ADD COLUMN     "dissolvedAt" TIMESTAMP(3),
ADD COLUMN     "formedAt" TIMESTAMP(3),
ADD COLUMN     "meetingFrequency" "CommitteeMeetingFrequency" NOT NULL DEFAULT 'AS_NEEDED',
ADD COLUMN     "nameAr" TEXT NOT NULL,
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "parentCommitteeId" TEXT,
ADD COLUMN     "purpose" TEXT,
ADD COLUMN     "quorumCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reportingToCommitteeId" TEXT,
ADD COLUMN     "reportingToRoleId" TEXT,
ADD COLUMN     "termsOfReferenceDocumentId" TEXT;

-- AlterTable
ALTER TABLE "CommitteeMember" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "organizationId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "CommitteeMembershipEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleValueId" TEXT NOT NULL,
    "action" "CommitteeMembershipAction" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeMembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeMembershipEvent_organizationId_idx" ON "CommitteeMembershipEvent"("organizationId");

-- CreateIndex
CREATE INDEX "CommitteeMembershipEvent_committeeId_idx" ON "CommitteeMembershipEvent"("committeeId");

-- CreateIndex
CREATE INDEX "CommitteeMembershipEvent_userId_idx" ON "CommitteeMembershipEvent"("userId");

-- CreateIndex
CREATE INDEX "Committee_parentCommitteeId_idx" ON "Committee"("parentCommitteeId");

-- CreateIndex
CREATE INDEX "Committee_reportingToCommitteeId_idx" ON "Committee"("reportingToCommitteeId");

-- CreateIndex
CREATE INDEX "Committee_reportingToRoleId_idx" ON "Committee"("reportingToRoleId");

-- CreateIndex
CREATE INDEX "CommitteeMember_organizationId_idx" ON "CommitteeMember"("organizationId");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_parentCommitteeId_fkey" FOREIGN KEY ("parentCommitteeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_reportingToCommitteeId_fkey" FOREIGN KEY ("reportingToCommitteeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_reportingToRoleId_fkey" FOREIGN KEY ("reportingToRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembershipEvent" ADD CONSTRAINT "CommitteeMembershipEvent_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeMembershipEvent" ADD CONSTRAINT "CommitteeMembershipEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
