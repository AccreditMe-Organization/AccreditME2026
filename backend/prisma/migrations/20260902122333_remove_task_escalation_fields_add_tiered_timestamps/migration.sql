/*
  Warnings:

  - You are about to drop the column `escalatedAt` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `escalationAfterHours` on the `Task` table. All the data in the column will be lost.
  - You are about to drop the column `escalationUserId` on the `Task` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Task" DROP COLUMN "escalatedAt",
DROP COLUMN "escalationAfterHours",
DROP COLUMN "escalationUserId",
ADD COLUMN     "headEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "managerEscalatedAt" TIMESTAMP(3);
