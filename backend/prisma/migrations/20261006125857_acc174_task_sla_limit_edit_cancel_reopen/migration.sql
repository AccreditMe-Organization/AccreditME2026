-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "reopenedAt" TIMESTAMP(3),
ADD COLUMN     "reopenedById" TEXT,
ADD COLUMN     "reopenedReason" TEXT,
ADD COLUMN     "slaExtendedTo" TIMESTAMP(3),
ADD COLUMN     "slaLimitAt" TIMESTAMP(3),
ADD COLUMN     "slaStartAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
