-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "assignedCommitteeId" TEXT,
ADD COLUMN     "assignedCommitteeRoleValueId" TEXT,
ADD COLUMN     "assignedOrgUnitId" TEXT,
ADD COLUMN     "assignedPositionId" TEXT,
ADD COLUMN     "poolEscalateAt" TIMESTAMP(3),
ADD COLUMN     "poolEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "pooledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TaskAssignee" ADD COLUMN     "pickedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_organizationId_assignedOrgUnitId_assignedPositionId_idx" ON "Task"("organizationId", "assignedOrgUnitId", "assignedPositionId");

-- CreateIndex
CREATE INDEX "Task_assignedCommitteeId_assignedCommitteeRoleValueId_idx" ON "Task"("assignedCommitteeId", "assignedCommitteeRoleValueId");

-- CreateIndex
CREATE INDEX "Task_poolEscalateAt_idx" ON "Task"("poolEscalateAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedOrgUnitId_fkey" FOREIGN KEY ("assignedOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedPositionId_fkey" FOREIGN KEY ("assignedPositionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedCommitteeId_fkey" FOREIGN KEY ("assignedCommitteeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedCommitteeRoleValueId_fkey" FOREIGN KEY ("assignedCommitteeRoleValueId") REFERENCES "LookupValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
