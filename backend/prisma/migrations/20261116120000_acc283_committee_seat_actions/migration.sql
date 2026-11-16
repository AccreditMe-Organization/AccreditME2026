-- AlterEnum
ALTER TYPE "SetupConditionType" ADD VALUE 'CHANGE_REQUEST_WITHOUT_DECIDER';

-- CreateTable
CREATE TABLE "CommitteeSeatAction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "committeeId" TEXT NOT NULL,
    "roleValueId" TEXT NOT NULL,
    "actionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeSeatAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommitteeSeatAction_organizationId_idx" ON "CommitteeSeatAction"("organizationId");

-- CreateIndex
CREATE INDEX "CommitteeSeatAction_committeeId_actionKey_idx" ON "CommitteeSeatAction"("committeeId", "actionKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommitteeSeatAction_committeeId_roleValueId_actionKey_key" ON "CommitteeSeatAction"("committeeId", "roleValueId", "actionKey");

-- AddForeignKey
ALTER TABLE "CommitteeSeatAction" ADD CONSTRAINT "CommitteeSeatAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitteeSeatAction" ADD CONSTRAINT "CommitteeSeatAction_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

