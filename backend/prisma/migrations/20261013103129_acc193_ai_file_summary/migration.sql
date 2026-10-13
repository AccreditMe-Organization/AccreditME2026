-- CreateTable
CREATE TABLE "AiFileSummary" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storedFileId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "overview" TEXT,
    "keyPoints" JSONB NOT NULL DEFAULT '[]',
    "unitsRead" INTEGER,
    "unitsTotal" INTEGER,
    "creditCost" INTEGER NOT NULL DEFAULT 0,
    "generatedById" TEXT,
    "generatedAt" TIMESTAMP(3),
    "generatingSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFileSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiFileSummary_organizationId_idx" ON "AiFileSummary"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiFileSummary_storedFileId_language_key" ON "AiFileSummary"("storedFileId", "language");

-- AddForeignKey
ALTER TABLE "AiFileSummary" ADD CONSTRAINT "AiFileSummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFileSummary" ADD CONSTRAINT "AiFileSummary_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiFileSummary" ADD CONSTRAINT "AiFileSummary_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
