-- CreateEnum
CREATE TYPE "CommitteeMembershipCause" AS ENUM ('DEACTIVATION');

-- AlterTable
ALTER TABLE "CommitteeMembershipEvent" ADD COLUMN     "cause" "CommitteeMembershipCause";
