-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT,
ADD COLUMN     "rejectedReason" TEXT,
ADD COLUMN     "requiresEvidence" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
