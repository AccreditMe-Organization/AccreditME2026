-- CreateTable
CREATE TABLE "AiBriefing" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "lead" TEXT NOT NULL,
    "focus" JSONB NOT NULL,
    "groups" JSONB NOT NULL,
    "creditCost" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "generatingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiBriefing_organizationId_idx" ON "AiBriefing"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiBriefing_organizationId_userId_key" ON "AiBriefing"("organizationId", "userId");

-- AddForeignKey
ALTER TABLE "AiBriefing" ADD CONSTRAINT "AiBriefing_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBriefing" ADD CONSTRAINT "AiBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
