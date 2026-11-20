-- CreateEnum
CREATE TYPE "MeetingAiKind" AS ENUM ('AGENDA_ITEM', 'ITEM_MINUTES', 'ACTION_ITEM', 'ABSENT_SUMMARY');

-- CreateEnum
CREATE TYPE "MeetingAiRunKind" AS ENUM ('AGENDA', 'MINUTES', 'ABSENT_SUMMARY');

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN     "sourceChangeRequestId" TEXT,
ADD COLUMN     "sourceTaskId" TEXT;

-- CreateTable
CREATE TABLE "MeetingAiNotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "writerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingAiNotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAiSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT,
    "kind" "MeetingAiKind" NOT NULL,
    "order" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "aiInteractionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingAiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAiRun" (
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "MeetingAiRunKind" NOT NULL,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "lastDoneAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAiRun_pkey" PRIMARY KEY ("meetingId","kind")
);

-- CreateIndex
CREATE INDEX "MeetingAiNotes_organizationId_idx" ON "MeetingAiNotes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAiNotes_meetingId_writerId_key" ON "MeetingAiNotes"("meetingId", "writerId");

-- CreateIndex
CREATE INDEX "MeetingAiSuggestion_organizationId_idx" ON "MeetingAiSuggestion"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingAiSuggestion_meetingId_kind_idx" ON "MeetingAiSuggestion"("meetingId", "kind");

-- CreateIndex
CREATE INDEX "MeetingAiRun_organizationId_idx" ON "MeetingAiRun"("organizationId");

-- CreateIndex
CREATE INDEX "AgendaItem_meetingId_sourceTaskId_idx" ON "AgendaItem"("meetingId", "sourceTaskId");

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_sourceChangeRequestId_fkey" FOREIGN KEY ("sourceChangeRequestId") REFERENCES "CommitteeChangeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiNotes" ADD CONSTRAINT "MeetingAiNotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiNotes" ADD CONSTRAINT "MeetingAiNotes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiNotes" ADD CONSTRAINT "MeetingAiNotes_writerId_fkey" FOREIGN KEY ("writerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiSuggestion" ADD CONSTRAINT "MeetingAiSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiSuggestion" ADD CONSTRAINT "MeetingAiSuggestion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiSuggestion" ADD CONSTRAINT "MeetingAiSuggestion_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiSuggestion" ADD CONSTRAINT "MeetingAiSuggestion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiRun" ADD CONSTRAINT "MeetingAiRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAiRun" ADD CONSTRAINT "MeetingAiRun_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
