-- DropIndex
DROP INDEX "LookupCategory_key_key";

-- AlterTable
ALTER TABLE "LookupCategory" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isExtensible" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "LookupCategory_organizationId_idx" ON "LookupCategory"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LookupCategory_key_organizationId_key" ON "LookupCategory"("key", "organizationId");

-- AddForeignKey
ALTER TABLE "LookupCategory" ADD CONSTRAINT "LookupCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
