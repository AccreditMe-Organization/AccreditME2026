-- AlterTable
ALTER TABLE "User" ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "primaryOrgUnitId" TEXT;

-- CreateTable
CREATE TABLE "OrgPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUnitId" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "grade" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgPosition_organizationId_idx" ON "OrgPosition"("organizationId");

-- CreateIndex
CREATE INDEX "OrgPosition_orgUnitId_idx" ON "OrgPosition"("orgUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgPosition_organizationId_orgUnitId_nameEn_key" ON "OrgPosition"("organizationId", "orgUnitId", "nameEn");

-- CreateIndex
CREATE INDEX "User_positionId_idx" ON "User"("positionId");

-- CreateIndex
CREATE INDEX "User_primaryOrgUnitId_idx" ON "User"("primaryOrgUnitId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_primaryOrgUnitId_fkey" FOREIGN KEY ("primaryOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
