-- CreateEnum
CREATE TYPE "PlanModuleAccess" AS ENUM ('FULL', 'READ_ONLY', 'NONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'IMPERSONATE_START';
ALTER TYPE "AuditAction" ADD VALUE 'IMPERSONATE_END';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "emailConfig" TEXT,
ADD COLUMN     "isPlatformOrg" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "annualPrice" DECIMAL(10,2) NOT NULL,
    "maxFullUsers" INTEGER,
    "maxStaff" INTEGER,
    "maxStorageGb" INTEGER NOT NULL,
    "aiCreditsPerMonth" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanModule" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "accessLevel" "PlanModuleAccess" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "PlanModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCreditPack" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameAr" TEXT,
    "credits" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "availableTo" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreditPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiFeatureCost" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFeatureCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Plan_isActive_idx" ON "Plan"("isActive");

-- CreateIndex
CREATE INDEX "Plan_isPublic_idx" ON "Plan"("isPublic");

-- CreateIndex
CREATE INDEX "PlanModule_planId_idx" ON "PlanModule"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanModule_planId_moduleKey_key" ON "PlanModule"("planId", "moduleKey");

-- CreateIndex
CREATE INDEX "AiCreditPack_isActive_idx" ON "AiCreditPack"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AiFeatureCost_featureKey_key" ON "AiFeatureCost"("featureKey");

-- CreateIndex
CREATE INDEX "Organization_isPlatformOrg_idx" ON "Organization"("isPlatformOrg");

-- CreateIndex
CREATE INDEX "Organization_planId_idx" ON "Organization"("planId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanModule" ADD CONSTRAINT "PlanModule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
