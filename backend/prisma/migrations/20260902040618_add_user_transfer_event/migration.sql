-- CreateTable
CREATE TABLE "UserTransferEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceOrgUnitId" TEXT NOT NULL,
    "destinationOrgUnitId" TEXT NOT NULL,
    "sourcePositionId" TEXT,
    "destinationPositionId" TEXT,
    "replacementUserId" TEXT,
    "newManagerId" TEXT,
    "isPromotion" BOOLEAN NOT NULL DEFAULT false,
    "promotionAttempted" BOOLEAN NOT NULL DEFAULT false,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTransferEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserTransferEvent_organizationId_idx" ON "UserTransferEvent"("organizationId");

-- CreateIndex
CREATE INDEX "UserTransferEvent_userId_idx" ON "UserTransferEvent"("userId");

-- CreateIndex
CREATE INDEX "UserTransferEvent_sourceOrgUnitId_idx" ON "UserTransferEvent"("sourceOrgUnitId");

-- CreateIndex
CREATE INDEX "UserTransferEvent_destinationOrgUnitId_idx" ON "UserTransferEvent"("destinationOrgUnitId");

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_replacementUserId_fkey" FOREIGN KEY ("replacementUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_newManagerId_fkey" FOREIGN KEY ("newManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_sourceOrgUnitId_fkey" FOREIGN KEY ("sourceOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTransferEvent" ADD CONSTRAINT "UserTransferEvent_destinationOrgUnitId_fkey" FOREIGN KEY ("destinationOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
