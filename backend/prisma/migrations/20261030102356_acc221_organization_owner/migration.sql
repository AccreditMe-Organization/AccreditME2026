-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "ownerUserId" TEXT;

-- CreateIndex
CREATE INDEX "Organization_ownerUserId_idx" ON "Organization"("ownerUserId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
