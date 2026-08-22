-- DropForeignKey
ALTER TABLE "OrgPosition" DROP CONSTRAINT "OrgPosition_orgUnitId_fkey";

-- DropIndex
DROP INDEX "OrgPosition_orgUnitId_idx";

-- DropIndex
DROP INDEX "OrgPosition_organizationId_orgUnitId_nameEn_key";

-- AlterTable
ALTER TABLE "OrgPosition" DROP COLUMN "orgUnitId",
ADD COLUMN     "isSingleAssignee" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isUnitHeadPosition" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "roleId" TEXT;

-- CreateIndex
CREATE INDEX "OrgPosition_roleId_idx" ON "OrgPosition"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPosition_organizationId_nameEn_key" ON "OrgPosition"("organizationId", "nameEn");

-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
