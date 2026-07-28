-- CreateEnum
CREATE TYPE "TaskSourceType" AS ENUM ('MEETING', 'DOCUMENT', 'AUDIT', 'CAPA', 'INCIDENT', 'CORRECTIVE_ACTION', 'STANDARD', 'KPI', 'GAP', 'QUALITY_IMPROVEMENT_PLAN');

-- CreateEnum
CREATE TYPE "TaskEvidenceType" AS ENUM ('TEXT', 'ATTACHMENT', 'LINK', 'INTERNAL_REFERENCE');

-- CreateEnum
CREATE TYPE "TaskEvidenceRefType" AS ENUM ('DOCUMENT', 'AUDIT', 'INCIDENT', 'CAPA', 'MEETING', 'STANDARD', 'CORRECTIVE_ACTION', 'GAP');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'UNASSIGNED';

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_assigneeId_fkey";

-- DropIndex
DROP INDEX "Task_assigneeId_idx";

-- DropIndex
DROP INDEX "Task_objectType_objectId_idx";

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "assigneeId",
DROP COLUMN "delegatedToId",
DROP COLUMN "objectId",
DROP COLUMN "objectType",
ADD COLUMN     "completedById" TEXT,
ADD COLUMN     "dueDateOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "escalationAfterHours" INTEGER,
ADD COLUMN     "escalationUserId" TEXT,
ADD COLUMN     "meetingId" TEXT,
ADD COLUMN     "sourceId" TEXT NOT NULL,
ADD COLUMN     "sourceStageId" TEXT,
ADD COLUMN     "sourceType" "TaskSourceType" NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "actingUserId" TEXT,
ADD COLUMN     "outOfOfficeFrom" TIMESTAMP(3),
ADD COLUMN     "outOfOfficeTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "TaskEvidenceType" NOT NULL,
    "content" TEXT,
    "s3Key" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "url" TEXT,
    "linkTitle" TEXT,
    "refType" "TaskEvidenceRefType",
    "refId" TEXT,
    "refDisplay" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAssignee_taskId_idx" ON "TaskAssignee"("taskId");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE INDEX "TaskEvidence_organizationId_idx" ON "TaskEvidence"("organizationId");

-- CreateIndex
CREATE INDEX "TaskEvidence_taskId_idx" ON "TaskEvidence"("taskId");

-- CreateIndex
CREATE INDEX "Task_sourceType_sourceId_idx" ON "Task"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "Task_meetingId_idx" ON "Task"("meetingId");

-- CreateIndex
CREATE INDEX "User_actingUserId_idx" ON "User"("actingUserId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_actingUserId_fkey" FOREIGN KEY ("actingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvidence" ADD CONSTRAINT "TaskEvidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
