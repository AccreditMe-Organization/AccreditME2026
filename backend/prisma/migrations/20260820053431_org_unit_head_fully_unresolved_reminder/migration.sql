-- AlterTable
ALTER TABLE "OrgUnit" ADD COLUMN     "headFullyUnresolvedLastRemindedAt" TIMESTAMP(3),
ADD COLUMN     "isHeadFullyUnresolved" BOOLEAN NOT NULL DEFAULT false;
