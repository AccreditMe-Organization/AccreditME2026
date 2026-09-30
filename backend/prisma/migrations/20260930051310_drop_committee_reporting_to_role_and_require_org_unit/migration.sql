/*
  Warnings:

  - You are about to drop the column `reportingToRoleId` on the `Committee` table. All the data in the column will be lost.
  - Made the column `orgUnitId` on table `Committee` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Committee" DROP CONSTRAINT "Committee_reportingToRoleId_fkey";

-- DropIndex
DROP INDEX "Committee_reportingToRoleId_idx";

-- AlterTable
ALTER TABLE "Committee" DROP COLUMN "reportingToRoleId",
ALTER COLUMN "orgUnitId" SET NOT NULL;
