-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'BOTH';

-- CreateIndex
CREATE INDEX "Notification_userId_status_idx" ON "Notification"("userId", "status");
