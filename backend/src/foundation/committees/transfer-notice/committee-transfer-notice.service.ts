import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { COMMITTEES_PERMISSIONS } from '../../../common/constants/permissions';
import { LookupService } from '../../lookup/lookup.service';
import { NotificationService } from '../../notification/notification.service';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from '../../organization/unit-headship';
import { seatOrderedMemberships } from '../committee-memberships';
import {
  recipientsByCommittee,
  transferNoticeText,
  type CommitteeAudience,
  type Named,
  type TransferNoticeLine,
} from './committee-transfer-notice';

export const COMMITTEE_TRANSFER_NOTICE_QUEUE = 'committee-transfer-notice';
export const COMMITTEE_TRANSFER_NOTICE_JOB = 'notify-committees-after-transfer';
/** How long after the transfer the notice is built: the wizard removes seats in that window (Ahmad, 11 Nov). */
export const COMMITTEE_TRANSFER_NOTICE_DELAY_MS = 2 * 60 * 1000;
/** The most a transfer request waits to enqueue; past it the notice is given up, never the transfer. */
export const COMMITTEE_TRANSFER_NOTICE_ENQUEUE_TIMEOUT_MS = 3000;
/** Hard caps on what one run reads (the performance rule). */
export const TRANSFER_NOTICE_SEATS_CAP = 200;
export const TRANSFER_NOTICE_LEFT_CAP = 200;

/** The seats whose holders are told (lookup keys, the committee_member_role seed). */
export const OFFICER_SEAT_KEYS: readonly string[] = ['chairman', 'secretary'];

export interface TransferNoticeJob {
  organizationId: string;
  userId: string;
  actorId: string;
  /** The app's clock just before the transfer's transaction opened, in ms. */
  sinceMs: number;
}

/** One job per organisation, person and transfer time, so a second schedule of the same transfer is ignored. */
export function transferNoticeJobId(job: Pick<TransferNoticeJob, 'organizationId' | 'userId' | 'sinceMs'>): string {
  // BullMQ refuses ':' in a custom id.
  return `transfer-notice_${job.organizationId}_${job.userId}_${job.sinceMs}`;
}

interface CommitteeLine {
  committee: Named & { id: string };
  build: (committee: Named | null) => TransferNoticeLine;
}

/**
 * ACC-297 (Ahmad, 11 Nov) — after a person is transferred, the officers of each
 * committee they sat on are told, so someone who may remove a member can decide
 * on the seat. The transfer never waits for this, and nothing here removes a seat.
 *
 * `schedule()` is called by UserService.transferUser() after its transaction
 * commits. It adds one delayed job; the processor (behind RUN_WORKERS) calls `run()`.
 *
 * `run()` reads in three waves, each one Promise.all with no query per row, then
 * writes once:
 *
 *   1. the person's active seats on active committees (seatOrderedMemberships(),
 *      which also gives the tenant's seats); their LEFT events since the
 *      transfer, with committee, seat, reason and who removed them; the person,
 *      with their unit now;
 *   2. each committee's chair and secretary (active seat holders who are ACTIVE
 *      users), in one query; the owning units' head holders and the covers in
 *      force, through unit-headship.ts;
 *   3. which recipients are ACTIVE, which hold committees:view, and which are
 *      active members of which of these committees (the committee page's rule).
 *
 * Every read is scoped by the job's organisation, so another organisation's
 * seats, events, heads and people are never read.
 */
@Injectable()
export class CommitteeTransferNoticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lookups: LookupService,
    private readonly notifications: NotificationService,
    @InjectQueue(COMMITTEE_TRANSFER_NOTICE_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Adds the delayed job. Throws if it cannot (the caller logs and carries on),
   * including when Redis does not answer within the enqueue timeout, so a
   * transfer request is never held by a queue outage.
   */
  async schedule(input: { organizationId: string; userId: string; actorId: string; since: Date }): Promise<void> {
    const job: TransferNoticeJob = {
      organizationId: input.organizationId,
      userId: input.userId,
      actorId: input.actorId,
      sinceMs: input.since.getTime(),
    };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('enqueue timed out')), COMMITTEE_TRANSFER_NOTICE_ENQUEUE_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        this.queue.add(COMMITTEE_TRANSFER_NOTICE_JOB, job, {
          jobId: transferNoticeJobId(job),
          delay: COMMITTEE_TRANSFER_NOTICE_DELAY_MS,
          // One attempt: the only write is the last step, and a retry after it
          // could tell everyone twice. A failed run stays in the failed list.
          attempts: 1,
          removeOnComplete: { age: 7 * 24 * 3600 },
          removeOnFail: { age: 30 * 24 * 3600 },
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Builds and writes the notices. Returns how many were written. */
  async run(job: TransferNoticeJob): Promise<number> {
    const { organizationId, userId, actorId } = job;
    const since = new Date(job.sinceMs);

    // Wave 1 — the person's seats now, their removals since the transfer, and the person.
    const [held, leftRows, person] = await Promise.all([
      seatOrderedMemberships(this.prisma, this.lookups, organizationId, userId, TRANSFER_NOTICE_SEATS_CAP),
      this.prisma.committeeMembershipEvent.findMany({
        where: {
          organizationId,
          userId,
          action: 'LEFT',
          createdAt: { gte: since },
          committee: { organizationId, isActive: true },
        },
        select: {
          committeeId: true,
          roleValueId: true,
          reason: true,
          approvedBy: true,
          committee: { select: { nameEn: true, nameAr: true, orgUnitId: true } },
        },
        // Newest first: the latest removal from a committee is the one told.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TRANSFER_NOTICE_LEFT_CAP,
      }),
      this.prisma.user.findFirst({
        where: { id: userId, organizationId },
        select: { name: true, primaryOrgUnit: { select: { nameEn: true, nameAr: true } } },
      }),
    ]);
    if (!person) return 0;

    const seatName = (roleValueId: string): Named | null => {
      const seat = held.seatById.get(roleValueId);
      return seat ? { nameEn: seat.labelEn, nameAr: seat.labelAr } : null;
    };
    const newUnit: Named | null = person.primaryOrgUnit;

    // Each committee once: a seat held now wins over an earlier removal from it.
    const lines = new Map<string, CommitteeLine & { orgUnitId: string }>();
    for (const m of held.memberships) {
      if (lines.has(m.committee.id)) continue;
      const seat = seatName(m.roleValueId);
      lines.set(m.committee.id, {
        committee: { id: m.committee.id, nameEn: m.committee.nameEn, nameAr: m.committee.nameAr },
        orgUnitId: m.committee.orgUnitId,
        build: (committee) => ({ kind: 'HOLDS', committee, seat }),
      });
    }
    for (const e of leftRows) {
      if (lines.has(e.committeeId)) continue;
      const seat = seatName(e.roleValueId);
      const reason = e.reason?.trim() ?? '';
      const build = (committee: Named | null): TransferNoticeLine =>
        e.approvedBy === actorId
          ? { kind: 'REMOVED_IN_TRANSFER', committee, seat }
          : reason
            ? { kind: 'REMOVED_WITH_REASON', committee, seat, reason }
            : { kind: 'REMOVED_NO_REASON', committee, seat };
      lines.set(e.committeeId, {
        committee: { id: e.committeeId, nameEn: e.committee.nameEn, nameAr: e.committee.nameAr },
        orgUnitId: e.committee.orgUnitId,
        build,
      });
    }
    if (lines.size === 0) return 0;

    // Wave 2 — the officers of these committees, and their owning units' heads and covers.
    const committeeIds = [...lines.keys()];
    const unitIds = [...new Set([...lines.values()].map((l) => l.orgUnitId))];
    const officerSeatIds = [...held.seatById.values()].filter((s) => OFFICER_SEAT_KEYS.includes(s.key)).map((s) => s.id);
    const [officers, heads, covers] = await Promise.all([
      officerSeatIds.length === 0
        ? Promise.resolve([] as { committeeId: string; userId: string }[])
        : this.prisma.committeeMember.findMany({
            where: {
              organizationId,
              committeeId: { in: committeeIds },
              isActive: true,
              roleValueId: { in: officerSeatIds },
              user: { organizationId, status: 'ACTIVE' },
            },
            select: { committeeId: true, userId: true },
          }),
      findCurrentHeadHoldersForUnits(this.prisma, organizationId, unitIds),
      findRunningActingCoversForUnits(this.prisma, organizationId, unitIds),
    ]);

    const officersOf = new Map<string, string[]>();
    for (const o of officers) officersOf.set(o.committeeId, [...(officersOf.get(o.committeeId) ?? []), o.userId]);
    const audiences: CommitteeAudience[] = [...lines.entries()].map(([committeeId, line]) => ({
      committeeId,
      officerIds: officersOf.get(committeeId) ?? [],
      headIds: (heads.get(line.orgUnitId) ?? []).map((h) => h.id),
      coverId: covers.get(line.orgUnitId)?.userId ?? null,
    }));
    const byRecipient = recipientsByCommittee(audiences, { personId: userId, actorId });
    const recipients = [...byRecipient.keys()];
    if (recipients.length === 0) return 0;

    // Wave 3 — who is ACTIVE, and who may open which committee (committees:view, or an active member of it).
    const [module, action] = COMMITTEES_PERMISSIONS.VIEW.split(':') as [string, string];
    const [active, viewers, memberships] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId, id: { in: recipients }, status: 'ACTIVE' },
        select: { id: true },
      }),
      this.prisma.userRole.findMany({
        where: {
          userId: { in: recipients },
          role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } },
        },
        select: { userId: true },
      }),
      this.prisma.committeeMember.findMany({
        where: {
          organizationId,
          userId: { in: recipients },
          committeeId: { in: committeeIds },
          isActive: true,
          committee: { organizationId, isActive: true },
        },
        select: { userId: true, committeeId: true },
      }),
    ]);
    const isActive = new Set(active.map((u) => u.id));
    const seesEvery = new Set(viewers.map((v) => v.userId));
    const memberOf = new Set(memberships.map((m) => `${m.userId}|${m.committeeId}`));
    const mayOpen = (readerId: string, committeeId: string) => seesEvery.has(readerId) || memberOf.has(`${readerId}|${committeeId}`);

    const rows = [...byRecipient.entries()]
      .filter(([readerId]) => isActive.has(readerId))
      .map(([readerId, ids]) => {
        const shown = ids.map((id) => {
          const line = lines.get(id)!;
          const opens = mayOpen(readerId, id);
          return { id, opens, line: line.build(opens ? line.committee : null) };
        });
        const text = transferNoticeText({ personName: person.name, newUnit, lines: shown.map((s) => s.line) });
        // One link per notice: the first listed committee this reader may open.
        const link = shown.find((s) => s.opens);
        return {
          userId: readerId,
          titleEn: text.titleEn,
          titleAr: text.titleAr,
          bodyEn: text.bodyEn,
          bodyAr: text.bodyAr,
          objectType: link ? 'COMMITTEE' : null,
          objectId: link ? link.id : null,
        };
      });

    // One write for every reader, after all the reads; never inside a transaction.
    return this.notifications.createInAppMany(rows, organizationId, 'committee-transfer-notice');
  }
}
