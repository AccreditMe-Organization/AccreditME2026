-- AlterEnum
ALTER TYPE "SetupConditionType" ADD VALUE 'STORAGE_ALMOST_FULL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "storageChangeRequestedAt" TIMESTAMP(3),
ADD COLUMN     "storageChangeRequestedById" TEXT,
ADD COLUMN     "storageConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "storageConfirmedById" TEXT,
ADD COLUMN     "storageWarnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "purgedAt" TIMESTAMP(3),
ADD COLUMN     "restoredAt" TIMESTAMP(3),
ADD COLUMN     "restoredById" TEXT;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_storageConfirmedById_fkey" FOREIGN KEY ("storageConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_storageChangeRequestedById_fkey" FOREIGN KEY ("storageChangeRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_restoredById_fkey" FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

