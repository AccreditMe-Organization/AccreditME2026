import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { StageRulesService } from '../workflow/stage-rules.service';
import { MEETING_ACTIONS } from '../workflow/record-registry';
import { reviewers } from './meeting-minutes-rules';
import { peopleDay, reviewReminderNotice } from './meeting-notices';
import { notifyUsers } from './meeting-send';

/** The sweep reads at most this many meetings in review per pass. */
const SWEEP_CAP = 1000;

/**
 * ACC-316 PR 4 — the minutes review's one scheduled part (plan §3.6): on the
 * working day before the review date, the members recorded present who haven't
 * answered are told, ONCE per round. The stamp is
 * `MeetingAttendee.reviewRemindedRound`, set by one conditional UPDATE … WHERE
 * reviewRemindedRound IS DISTINCT FROM round RETURNING, so a second sweep or a
 * second worker sends nothing. A sweep that misses the day itself still sends
 * on the review date; never after it.
 *
 * Run by the SLA sweep (`sla-monitor`, every 15 minutes), behind its worker
 * gate. Each organisation in its own zone and calendar.
 */
@Injectable()
export class MeetingReviewReminderService {
  private readonly logger = new Logger(MeetingReviewReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stageRules: StageRulesService,
    private readonly notifications: NotificationService,
    private readonly calendar: WorkingCalendarService,
  ) {}

  async sweep(now: Date = new Date()): Promise<{ reminded: number }> {
    // A review date at most two days back can still be "today" in some zone.
    const meetings = await this.prisma.meeting.findMany({
      where: { reviewRound: { gt: 0 }, reviewBy: { gte: new Date(now.getTime() - 2 * 86_400_000) } },
      select: { id: true, organizationId: true, title: true, reviewRound: true, reviewBy: true },
      orderBy: [{ reviewBy: 'asc' }, { id: 'asc' }],
      take: SWEEP_CAP,
    });
    const byOrg = new Map<string, typeof meetings>();
    for (const m of meetings) byOrg.set(m.organizationId, [...(byOrg.get(m.organizationId) ?? []), m]);

    let reminded = 0;
    for (const [organizationId, rows] of byOrg) {
      try {
        reminded += await this.sweepOrganisation(organizationId, rows, now);
      } catch (error) {
        this.logger.error(`Review reminders failed for org ${organizationId}: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
    return { reminded };
  }

  private async sweepOrganisation(
    organizationId: string,
    meetings: { id: string; title: string; reviewRound: number; reviewBy: Date | null }[],
    now: Date,
  ): Promise<number> {
    const [zone, rules] = await Promise.all([
      this.calendar.getEffectiveTimeZone(organizationId),
      this.stageRules.stageRulesFor(organizationId, 'MEETING', meetings.map((m) => m.id)),
    ]);
    const today = DateTime.fromJSDate(now).setZone(zone).toISODate()!;
    let reminded = 0;
    for (const m of meetings) {
      if (!m.reviewBy || rules.get(m.id)?.actions[MEETING_ACTIONS.SUGGEST_CORRECTION] !== true) continue;
      const day = m.reviewBy.toISOString().slice(0, 10);
      if (today > day || today < (await this.calendar.previousWorkingDay(day, organizationId))) continue;
      const waiting = (await reviewers(this.prisma, m.id, organizationId, m.reviewRound)).filter((p) => !p.answered).map((p) => p.userId);
      if (waiting.length === 0) continue;
      const stamped = await this.prisma.$queryRaw<{ userId: string }[]>`
        UPDATE "MeetingAttendee" SET "reviewRemindedRound" = ${m.reviewRound}
        WHERE "organizationId" = ${organizationId} AND "meetingId" = ${m.id}
          AND kind = 'MEMBER' AND attendance = 'PRESENT' AND "userId" = ANY(${waiting}::text[])
          AND "reviewRemindedRound" IS DISTINCT FROM ${m.reviewRound}
        RETURNING "userId"`;
      if (stamped.length === 0) continue;
      await notifyUsers(this.notifications, organizationId, m.id, null, stamped.map((s) => s.userId), reviewReminderNotice(m.title, peopleDay(day)));
      reminded += stamped.length;
    }
    return reminded;
  }
}
