-- CreateTable
CREATE TABLE "AiInteractionLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "model" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "promptSummary" TEXT NOT NULL,
    "responseSummary" TEXT,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiInteractionLog_organizationId_idx" ON "AiInteractionLog"("organizationId");

-- CreateIndex
CREATE INDEX "AiInteractionLog_actorId_idx" ON "AiInteractionLog"("actorId");

-- CreateIndex
CREATE INDEX "AiInteractionLog_feature_idx" ON "AiInteractionLog"("feature");

-- CreateIndex
CREATE INDEX "AiInteractionLog_createdAt_idx" ON "AiInteractionLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AiInteractionLog" ADD CONSTRAINT "AiInteractionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteractionLog" ADD CONSTRAINT "AiInteractionLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
