-- CreateEnum
CREATE TYPE "SetupConditionType" AS ENUM ('ORG_UNIT_WITHOUT_HEAD', 'STAGE_WITHOUT_ASSIGNEE', 'TASK_WITHOUT_OWNER', 'POSITION_WITHOUT_ROLE');

-- CreateEnum
CREATE TYPE "SetupConditionSeverity" AS ENUM ('BLOCKS_WORK', 'AT_RISK');

-- CreateTable
CREATE TABLE "SetupCondition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "SetupConditionType" NOT NULL,
    "severity" "SetupConditionSeverity" NOT NULL,
    "objectId" TEXT NOT NULL,
    "subject" JSONB NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetupCondition_organizationId_idx" ON "SetupCondition"("organizationId");

-- CreateIndex
CREATE INDEX "SetupCondition_organizationId_clearedAt_idx" ON "SetupCondition"("organizationId", "clearedAt");

-- CreateIndex
CREATE INDEX "SetupCondition_organizationId_type_objectId_idx" ON "SetupCondition"("organizationId", "type", "objectId");

-- AddForeignKey
ALTER TABLE "SetupCondition" ADD CONSTRAINT "SetupCondition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
