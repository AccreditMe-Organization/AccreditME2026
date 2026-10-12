-- AlterTable
ALTER TABLE "AiFeatureCost" ADD COLUMN     "allowedOrganizationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "restricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AiInteractionLog" ADD COLUMN     "creditCost" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "provider" "AiProvider",
ADD COLUMN     "tier" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiCreditsNoticeFor" TIMESTAMP(3),
ADD COLUMN     "aiCreditsPeriodStart" TIMESTAMP(3),
ADD COLUMN     "aiCreditsRenewsAt" TIMESTAMP(3),
ADD COLUMN     "aiCreditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiMonthlyCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "aiPendingMonthlyCredits" INTEGER;
