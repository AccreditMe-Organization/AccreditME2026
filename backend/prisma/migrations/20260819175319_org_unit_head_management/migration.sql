-- CreateEnum
CREATE TYPE "OrgUnitHeadAction" AS ENUM ('ASSIGNED', 'HANDOVER_DECLARED', 'HANDOVER_COMPLETED', 'HANDOVER_CANCELLED', 'VACATED', 'ACTING_ASSIGNED', 'ACTING_ENDED');

-- AlterTable
ALTER TABLE "OrgUnit" ADD COLUMN     "actingHeadUserId" TEXT,
ADD COLUMN     "headHandoverEffectiveDate" TIMESTAMP(3),
ADD COLUMN     "headVacantSince" TIMESTAMP(3),
ADD COLUMN     "isHeadVacant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingHeadUserId" TEXT;

-- CreateTable
CREATE TABLE "OrgUnitHeadEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT,
    "action" "OrgUnitHeadAction" NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgUnitHeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgUnitHeadEvent_organizationId_idx" ON "OrgUnitHeadEvent"("organizationId");

-- CreateIndex
CREATE INDEX "OrgUnitHeadEvent_orgUnitId_idx" ON "OrgUnitHeadEvent"("orgUnitId");

-- CreateIndex
CREATE INDEX "OrgUnitHeadEvent_userId_idx" ON "OrgUnitHeadEvent"("userId");

-- CreateIndex
CREATE INDEX "OrgUnit_pendingHeadUserId_idx" ON "OrgUnit"("pendingHeadUserId");

-- CreateIndex
CREATE INDEX "OrgUnit_actingHeadUserId_idx" ON "OrgUnit"("actingHeadUserId");

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_pendingHeadUserId_fkey" FOREIGN KEY ("pendingHeadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_actingHeadUserId_fkey" FOREIGN KEY ("actingHeadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadEvent" ADD CONSTRAINT "OrgUnitHeadEvent_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadEvent" ADD CONSTRAINT "OrgUnitHeadEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadEvent" ADD CONSTRAINT "OrgUnitHeadEvent_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
