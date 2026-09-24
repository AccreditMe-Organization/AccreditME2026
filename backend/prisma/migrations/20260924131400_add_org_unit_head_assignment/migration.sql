-- CreateEnum
CREATE TYPE "OrgUnitHeadAssignmentKind" AS ENUM ('SUBSTANTIVE', 'ACTING');

-- CreateEnum
CREATE TYPE "OrgUnitActingReason" AS ENUM ('VACANCY', 'ABSENCE');

-- AlterEnum
ALTER TYPE "SetupConditionType" ADD VALUE 'ACTING_HEAD_OPEN_ENDED';

-- CreateTable
CREATE TABLE "OrgUnitHeadAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "OrgUnitHeadAssignmentKind" NOT NULL,
    "reason" "OrgUnitActingReason",
    "positionId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "endedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "OrgUnitHeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgUnitHeadAssignment_organizationId_idx" ON "OrgUnitHeadAssignment"("organizationId");

-- CreateIndex
CREATE INDEX "OrgUnitHeadAssignment_orgUnitId_idx" ON "OrgUnitHeadAssignment"("orgUnitId");

-- CreateIndex
CREATE INDEX "OrgUnitHeadAssignment_userId_idx" ON "OrgUnitHeadAssignment"("userId");

-- CreateIndex
CREATE INDEX "OrgUnitHeadAssignment_orgUnitId_kind_validFrom_idx" ON "OrgUnitHeadAssignment"("orgUnitId", "kind", "validFrom");

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgUnitHeadAssignment" ADD CONSTRAINT "OrgUnitHeadAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
