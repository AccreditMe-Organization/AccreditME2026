-- CreateTable
CREATE TABLE "SetupConditionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "SetupConditionType" NOT NULL,
    "lastAttemptedAt" TIMESTAMP(3) NOT NULL,
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupConditionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetupConditionRun_organizationId_idx" ON "SetupConditionRun"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupConditionRun_organizationId_type_key" ON "SetupConditionRun"("organizationId", "type");

-- AddForeignKey
ALTER TABLE "SetupConditionRun" ADD CONSTRAINT "SetupConditionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
