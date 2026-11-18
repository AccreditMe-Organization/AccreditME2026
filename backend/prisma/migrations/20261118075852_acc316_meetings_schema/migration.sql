/*
  Warnings:

  - Added the required column `organizationId` to the `AgendaItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MeetingSeriesEvery" AS ENUM ('WEEK_1', 'WEEK_2', 'MONTH_1', 'MONTH_3', 'MONTH_6', 'MONTH_12');

-- CreateEnum
CREATE TYPE "MeetingSeriesOn" AS ENUM ('WEEKDAY', 'DAY_OF_MONTH', 'ORDINAL_WEEKDAY');

-- CreateEnum
CREATE TYPE "MeetingSeriesOrdinal" AS ENUM ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'LAST');

-- CreateEnum
CREATE TYPE "MeetingAttendeeKind" AS ENUM ('MEMBER', 'ORG_GUEST', 'OUTSIDE_GUEST');

-- CreateEnum
CREATE TYPE "MeetingAttendance" AS ENUM ('PRESENT', 'APOLOGIES', 'ABSENT');

-- CreateEnum
CREATE TYPE "MeetingInvitationAnswer" AS ENUM ('ATTENDING', 'CANT_ATTEND');

-- CreateEnum
CREATE TYPE "MeetingSuggestionStatus" AS ENUM ('OPEN', 'APPLIED', 'DECLINED');

-- CreateEnum
CREATE TYPE "MeetingEditScope" AS ENUM ('THIS_ONLY', 'THIS_AND_LATER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StageAssigneeKind" ADD VALUE 'MEETING_SCHEDULERS';
ALTER TYPE "StageAssigneeKind" ADD VALUE 'MEETING_RECORDERS';
ALTER TYPE "StageAssigneeKind" ADD VALUE 'MEETING_APPROVERS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StoredFileOwnerType" ADD VALUE 'MEETING';
ALTER TYPE "StoredFileOwnerType" ADD VALUE 'MEETING_AGENDA_ITEM';

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN     "discussion" TEXT,
ADD COLUMN     "organizationId" TEXT NOT NULL,
ADD COLUMN     "presenterAttendeeId" TEXT,
ADD COLUMN     "standing" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "durationMinutes" INTEGER,
ADD COLUMN     "orgUnitId" TEXT,
ADD COLUMN     "ownEdits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "quorumAtAttendance" INTEGER,
ADD COLUMN     "reviewBy" TIMESTAMP(3),
ADD COLUMN     "reviewRound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seriesId" TEXT,
ADD COLUMN     "seriesIndex" INTEGER,
ADD COLUMN     "unitQuorum" INTEGER;

-- CreateTable
CREATE TABLE "MeetingSeries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "committeeId" TEXT,
    "orgUnitId" TEXT,
    "subject" TEXT NOT NULL,
    "typeValueId" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "location" TEXT,
    "meetingUrl" TEXT,
    "every" "MeetingSeriesEvery" NOT NULL,
    "onKind" "MeetingSeriesOn" NOT NULL,
    "weekday" INTEGER,
    "dayOfMonth" INTEGER,
    "ordinal" "MeetingSeriesOrdinal",
    "firstDate" TIMESTAMP(3) NOT NULL,
    "endsOn" TIMESTAMP(3),
    "count" INTEGER,
    "standingAgenda" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "MeetingSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "MeetingAttendeeKind" NOT NULL,
    "userId" TEXT,
    "outsideName" TEXT,
    "outsideEmail" TEXT,
    "outsideOrganisation" TEXT,
    "outsideRole" TEXT,
    "seatValueId" TEXT,
    "attendance" "MeetingAttendance",
    "attendanceRecordedAt" TIMESTAMP(3),
    "attendanceRecordedById" TEXT,
    "answer" "MeetingInvitationAnswer",
    "answerNote" TEXT,
    "answeredAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "addedAsPresenter" BOOLEAN NOT NULL DEFAULT false,
    "reviewRemindedRound" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "votesFor" INTEGER,
    "votesAgainst" INTEGER,
    "votesAbstain" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingActionItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingOpenActionNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingOpenActionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReviewAnswer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReviewAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSuggestion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "agendaItemId" TEXT,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "MeetingSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "reply" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReviewChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "agendaItemId" TEXT,
    "what" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReviewChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReschedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "toAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "scope" "MeetingEditScope" NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReschedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingSeries_organizationId_idx" ON "MeetingSeries"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingSeries_committeeId_idx" ON "MeetingSeries"("committeeId");

-- CreateIndex
CREATE INDEX "MeetingSeries_orgUnitId_idx" ON "MeetingSeries"("orgUnitId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_organizationId_idx" ON "MeetingAttendee"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_meetingId_idx" ON "MeetingAttendee"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_userId_idx" ON "MeetingAttendee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendee_meetingId_userId_key" ON "MeetingAttendee"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "MeetingDecision_organizationId_idx" ON "MeetingDecision"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingDecision_meetingId_idx" ON "MeetingDecision"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingDecision_agendaItemId_idx" ON "MeetingDecision"("agendaItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingActionItem_taskId_key" ON "MeetingActionItem"("taskId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_organizationId_idx" ON "MeetingActionItem"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_meetingId_idx" ON "MeetingActionItem"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_agendaItemId_idx" ON "MeetingActionItem"("agendaItemId");

-- CreateIndex
CREATE INDEX "MeetingActionItem_ownerUserId_idx" ON "MeetingActionItem"("ownerUserId");

-- CreateIndex
CREATE INDEX "MeetingOpenActionNote_organizationId_idx" ON "MeetingOpenActionNote"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingOpenActionNote_meetingId_taskId_key" ON "MeetingOpenActionNote"("meetingId", "taskId");

-- CreateIndex
CREATE INDEX "MeetingReviewAnswer_organizationId_idx" ON "MeetingReviewAnswer"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingReviewAnswer_userId_idx" ON "MeetingReviewAnswer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingReviewAnswer_meetingId_round_userId_key" ON "MeetingReviewAnswer"("meetingId", "round", "userId");

-- CreateIndex
CREATE INDEX "MeetingSuggestion_organizationId_idx" ON "MeetingSuggestion"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingSuggestion_meetingId_idx" ON "MeetingSuggestion"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingSuggestion_authorId_idx" ON "MeetingSuggestion"("authorId");

-- CreateIndex
CREATE INDEX "MeetingReviewChange_organizationId_idx" ON "MeetingReviewChange"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingReviewChange_meetingId_idx" ON "MeetingReviewChange"("meetingId");

-- CreateIndex
CREATE INDEX "MeetingReschedule_organizationId_idx" ON "MeetingReschedule"("organizationId");

-- CreateIndex
CREATE INDEX "MeetingReschedule_meetingId_idx" ON "MeetingReschedule"("meetingId");

-- CreateIndex
CREATE INDEX "AgendaItem_organizationId_idx" ON "AgendaItem"("organizationId");

-- CreateIndex
CREATE INDEX "Meeting_orgUnitId_idx" ON "Meeting"("orgUnitId");

-- CreateIndex
CREATE INDEX "Meeting_seriesId_idx" ON "Meeting"("seriesId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_typeValueId_fkey" FOREIGN KEY ("typeValueId") REFERENCES "LookupValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MeetingSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_presenterAttendeeId_fkey" FOREIGN KEY ("presenterAttendeeId") REFERENCES "MeetingAttendee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_committeeId_fkey" FOREIGN KEY ("committeeId") REFERENCES "Committee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_typeValueId_fkey" FOREIGN KEY ("typeValueId") REFERENCES "LookupValue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSeries" ADD CONSTRAINT "MeetingSeries_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_seatValueId_fkey" FOREIGN KEY ("seatValueId") REFERENCES "LookupValue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_attendanceRecordedById_fkey" FOREIGN KEY ("attendanceRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingActionItem" ADD CONSTRAINT "MeetingActionItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOpenActionNote" ADD CONSTRAINT "MeetingOpenActionNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOpenActionNote" ADD CONSTRAINT "MeetingOpenActionNote_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOpenActionNote" ADD CONSTRAINT "MeetingOpenActionNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingOpenActionNote" ADD CONSTRAINT "MeetingOpenActionNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewAnswer" ADD CONSTRAINT "MeetingReviewAnswer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewAnswer" ADD CONSTRAINT "MeetingReviewAnswer_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewAnswer" ADD CONSTRAINT "MeetingReviewAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSuggestion" ADD CONSTRAINT "MeetingSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSuggestion" ADD CONSTRAINT "MeetingSuggestion_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSuggestion" ADD CONSTRAINT "MeetingSuggestion_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSuggestion" ADD CONSTRAINT "MeetingSuggestion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSuggestion" ADD CONSTRAINT "MeetingSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewChange" ADD CONSTRAINT "MeetingReviewChange_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewChange" ADD CONSTRAINT "MeetingReviewChange_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewChange" ADD CONSTRAINT "MeetingReviewChange_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReviewChange" ADD CONSTRAINT "MeetingReviewChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReschedule" ADD CONSTRAINT "MeetingReschedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReschedule" ADD CONSTRAINT "MeetingReschedule_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReschedule" ADD CONSTRAINT "MeetingReschedule_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
