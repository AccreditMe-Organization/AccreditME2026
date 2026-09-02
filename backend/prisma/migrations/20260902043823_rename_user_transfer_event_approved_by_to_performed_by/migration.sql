-- Hand-edited from Prisma's generated drop+add: UserTransferEvent has 0
-- rows (confirmed live before this migration was written), so a true
-- RENAME COLUMN is both safe and a more accurate record of what actually
-- happened than a drop-and-recreate.
-- AlterTable
ALTER TABLE "UserTransferEvent" RENAME COLUMN "approvedBy" TO "performedBy";
