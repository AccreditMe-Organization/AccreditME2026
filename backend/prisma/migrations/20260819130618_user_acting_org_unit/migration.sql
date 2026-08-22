-- AlterTable
ALTER TABLE "User" ADD COLUMN     "actingOrgUnitId" TEXT,
ADD COLUMN     "actingOrgUnitUntil" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_actingOrgUnitId_idx" ON "User"("actingOrgUnitId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_actingOrgUnitId_fkey" FOREIGN KEY ("actingOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
