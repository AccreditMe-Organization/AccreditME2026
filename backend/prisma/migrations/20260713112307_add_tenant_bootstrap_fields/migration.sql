-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bootstrappedAt" TIMESTAMP(3),
ADD COLUMN     "isBootstrapped" BOOLEAN NOT NULL DEFAULT false;
