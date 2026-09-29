-- AlterTable
ALTER TABLE "Committee" ADD COLUMN     "orgUnitId" TEXT;

-- CreateIndex
CREATE INDEX "Committee_orgUnitId_idx" ON "Committee"("orgUnitId");

-- AddForeignKey
ALTER TABLE "Committee" ADD CONSTRAINT "Committee_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
