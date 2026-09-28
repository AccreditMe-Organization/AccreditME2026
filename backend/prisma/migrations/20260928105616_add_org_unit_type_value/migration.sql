-- AlterEnum
ALTER TYPE "SetupConditionType" ADD VALUE 'ORG_UNIT_WITHOUT_TYPE';

-- AlterTable
ALTER TABLE "OrgUnit" ADD COLUMN     "typeValueId" TEXT;

-- CreateIndex
CREATE INDEX "OrgUnit_typeValueId_idx" ON "OrgUnit"("typeValueId");

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_typeValueId_fkey" FOREIGN KEY ("typeValueId") REFERENCES "LookupValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
