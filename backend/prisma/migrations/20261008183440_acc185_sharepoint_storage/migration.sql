-- AlterEnum
ALTER TYPE "StorageProvider" ADD VALUE 'SHAREPOINT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SetupConditionType" ADD VALUE 'STORAGE_ACCESS_WITHDRAWN';
ALTER TYPE "SetupConditionType" ADD VALUE 'STORAGE_SECRET_EXPIRING';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "storageAccessLostAt" TIMESTAMP(3),
ADD COLUMN     "storageAccessLostReason" TEXT,
ADD COLUMN     "storageSecretWarnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "msDriveId" TEXT,
ADD COLUMN     "msItemId" TEXT,
ADD COLUMN     "msSiteId" TEXT;

