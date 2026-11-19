import { NotFoundException } from '@nestjs/common';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import type { WorkflowService } from '../workflow/workflow.service';
import type { StageRulesService } from '../workflow/stage-rules.service';
import type { NotificationService } from '../notification/notification.service';
import type { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { MeetingMinutesService } from './meeting-minutes.service';
import { MeetingReviewService } from './meeting-review.service';

/**
 * ACC-316 PR 4 — the minutes and review reads and writes are scoped by
 * organisation. The behaviour is proved against a real Postgres in
 * meeting-minutes.db-spec.ts; this file pins the scoping where CI's
 * tenant-isolation gate (a name match over the unit suite) can see it.
 */
describe('MeetingMinutesService and MeetingReviewService — tenant scoping (ACC-316 PR 4)', () => {
  const ORG_A = 'org-a';
  const ORG_B = 'org-b';
  const THEIRS = 'meeting-of-b';
  const viewer = { id: 'user-a', permissions: ['meetings:view'] };

  function build() {
    const owned = (where: { id?: string; organizationId?: string }) => where.id === THEIRS && where.organizationId === ORG_B;
    const visibility = {
      assertCanViewOrNotFound: jest.fn(async (_type: string, id: string, organizationId: string) => {
        if (!owned({ id, organizationId })) throw new NotFoundException('Meeting not found');
      }),
    } as unknown as ObjectVisibilityService;
    const meeting = { findFirst: jest.fn(async ({ where }: { where: { id?: string; organizationId?: string } }) => (owned(where) ? { id: THEIRS } : null)) };
    const attendees = { findMany: jest.fn(async () => []) };
    const prisma = {
      meeting,
      meetingAttendee: attendees,
      meetingReviewAnswer: { findMany: jest.fn(async () => []) },
      meetingSuggestion: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(),
    } as unknown as PrismaService;
    const stageRules = { stageRulesFor: jest.fn(async () => new Map()) } as unknown as StageRulesService;
    const minutes = new MeetingMinutesService(prisma, visibility, stageRules, {} as WorkflowService, {} as WorkingCalendarService);
    const review = new MeetingReviewService(prisma, visibility, stageRules, {} as WorkflowService, {} as NotificationService, {} as WorkingCalendarService);
    return { minutes, review, prisma, attendees };
  }

  const refused = async (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundException);

  itEnforcesTenantIsolation("the minutes read and every minutes write miss another organisation's meeting", async () => {
    const { minutes, prisma } = build();
    await refused(minutes.getMinutes(THEIRS, ORG_A, viewer));
    await refused(minutes.recordAttendance(THEIRS, { rows: [] }, ORG_A, viewer));
    await refused(minutes.setItemMinutes(THEIRS, 'item', { discussion: 'x' }, ORG_A, viewer));
    await refused(minutes.addDecision(THEIRS, 'item', { text: 'x' }, ORG_A, viewer));
    await refused(minutes.addActionItem(THEIRS, 'item', { title: 'x', ownerUserId: 'u', dueAt: new Date(Date.now() + 86_400_000).toISOString() }, ORG_A, viewer));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("every review write misses another organisation's meeting", async () => {
    const { review, prisma } = build();
    await refused(review.distribute(THEIRS, {}, ORG_A, viewer));
    await refused(review.returnForCorrection(THEIRS, {}, ORG_A, viewer));
    await refused(review.noCorrections(THEIRS, ORG_A, viewer));
    await refused(review.suggest(THEIRS, { text: 'x' }, ORG_A, viewer));
    await refused(review.decideSuggestion(THEIRS, 's', 'DECLINED', {}, ORG_A, viewer));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  itEnforcesTenantIsolation("Home's meeting rows are read in the caller's organisation only", async () => {
    const { review, attendees } = build();
    await review.awaitingMe(ORG_A, 'user-a');
    for (const [args] of attendees.findMany.mock.calls as unknown as [{ where: { organizationId: string; meeting: { organizationId: string } } }][]) {
      expect(args.where.organizationId).toBe(ORG_A);
      expect(args.where.meeting.organizationId).toBe(ORG_A);
    }
    expect(attendees.findMany).toHaveBeenCalledTimes(2);
  });
});
