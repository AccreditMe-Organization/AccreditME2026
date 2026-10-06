-- CreateEnum
CREATE TYPE "TaskRequestType" AS ENUM ('EXTENSION', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "TaskRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN', 'CANCELLED');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldFromStatus" "TaskStatus",
ADD COLUMN     "onHoldUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TaskRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "type" "TaskRequestType" NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedDueAt" TIMESTAMP(3),
    "holdUntil" TIMESTAMP(3),
    "status" "TaskRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskRequest_organizationId_idx" ON "TaskRequest"("organizationId");

-- CreateIndex
CREATE INDEX "TaskRequest_taskId_status_idx" ON "TaskRequest"("taskId", "status");

-- CreateIndex
CREATE INDEX "TaskRequest_organizationId_status_idx" ON "TaskRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "TaskRequest_requestedById_idx" ON "TaskRequest"("requestedById");

-- CreateIndex
CREATE INDEX "Task_onHoldUntil_idx" ON "Task"("onHoldUntil");

-- AddForeignKey
ALTER TABLE "TaskRequest" ADD CONSTRAINT "TaskRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRequest" ADD CONSTRAINT "TaskRequest_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRequest" ADD CONSTRAINT "TaskRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskRequest" ADD CONSTRAINT "TaskRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
