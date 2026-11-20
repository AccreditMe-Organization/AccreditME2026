import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { meetingMayOpenSql, meetingOpener } from '../../common/services/meeting-membership';
import { MeetingRefusal } from './meeting-refusal';
import type { EngineTx } from '../workflow/workflow.service';

export const MEETING_NOT_FOUND = 'Meeting not found';

export interface MeetingViewer {
  id: string;
  permissions: readonly string[];
}

/**
 * ACC-316 — WHO MAY SEE AND WHO MAY WRITE ONE MEETING, in one place. Every
 * meeting route (the record, its people, agenda, files and clash check) asks
 * this, never a copy (the InstanceAccess shape: a plain class each service
 * builds from Prisma and the visibility service).
 *
 *   seeing   the parent rule (ObjectVisibilityService MEETING) with oversight:
 *            a head above reads. Anyone else: the identical 404.
 *   writing  seeing, AND meeting-authority.ts's SCHEDULERS for the owner (the
 *            predicate the Planned and Agenda Issued pools read): else 403
 *            MEETING_NOT_ALLOWED. A head above holding
 *            meetings:schedule_subunits writes as a scheduler; without the key,
 *            oversight stays read-only.
 *
 * What the meeting's STAGE allows is asked separately, inside each write's
 * transaction (StageRulesService, the instance FOR SHARE first).
 */
export class MeetingAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: ObjectVisibilityService,
  ) {}

  /** May see it: the meeting's owner, or the identical 404. */
  async seeing(id: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<MeetingOwner> {
    await this.visibility.assertCanViewOrNotFound('MEETING', id, organizationId, viewer.permissions, MEETING_NOT_FOUND, viewer.id, {
      oversight: true,
      now,
    });
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId },
      select: { committeeId: true, orgUnitId: true, committee: { select: { orgUnitId: true } } },
    });
    if (!meeting) throw new NotFoundException(MEETING_NOT_FOUND);
    return { key: id, committeeId: meeting.committeeId, unitId: meeting.orgUnitId ?? meeting.committee?.orgUnitId ?? null };
  }

  /**
   * ACC-316 PR 7b (P206) — may see it, as a yes or no: the meeting's owner, or
   * null. The same rule as seeing(), through assertCanView(), which writes no
   * concealed-refusal log line: for a read that asks about ANOTHER meeting on
   * this caller's behalf (the last meeting's open actions), where nothing is
   * concealed from them. Only the two refusals the rule raises mean "no".
   */
  async canSee(id: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<MeetingOwner | null> {
    try {
      await this.visibility.assertCanView('MEETING', id, organizationId, viewer.permissions, viewer.id, { oversight: true, now });
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) return null;
      throw error;
    }
    const meeting = await this.prisma.meeting.findFirst({
      where: { id, organizationId },
      select: { committeeId: true, orgUnitId: true, committee: { select: { orgUnitId: true } } },
    });
    if (!meeting) return null;
    return { key: id, committeeId: meeting.committeeId, unitId: meeting.orgUnitId ?? meeting.committee?.orgUnitId ?? null };
  }

  /**
   * P237 — which of these meetings the viewer may open: canSee()'s rule for
   * many meetings in ONE query (meeting-membership.ts's meetingMayOpenSql(),
   * the parent rule's own clauses), plus the viewer's oversight set once, so
   * the cost does not grow with the number of ids. Another organisation's or
   * an invented id is never in the answer.
   */
  async openable(ids: readonly string[], organizationId: string, viewer: MeetingViewer, now: Date): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const opener = await meetingOpener(this.prisma, organizationId, viewer, now);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM "Meeting" m
      WHERE m."organizationId" = ${organizationId} AND m.id = ANY(${[...ids]}::text[]) AND ${meetingMayOpenSql('m', opener)}`;
    return new Set(rows.map((r) => r.id));
  }

  /** May write: sees it and schedules for its owner (MEETING_NOT_ALLOWED otherwise). */
  async writing(id: string, organizationId: string, viewer: MeetingViewer, now: Date): Promise<MeetingOwner> {
    const owner = await this.seeing(id, organizationId, viewer, now);
    if (!(await this.isScheduler(owner, organizationId, viewer.id, now))) throw new MeetingRefusal('MEETING_NOT_ALLOWED');
    return owner;
  }

  /** May this person schedule for the owner (a new meeting's too)? One batched read. */
  isScheduler(owner: MeetingOwner, organizationId: string, viewerId: string, now: Date): Promise<boolean> {
    return isMeetingKindMember(this.prisma, organizationId, owner, 'MEETING_SCHEDULERS', viewerId, now);
  }
}

/**
 * ACC-316 PR 3b — the meeting row FOR UPDATE, taken right AFTER the instance
 * FOR SHARE (the stage's rules) in every invitee, guest, agenda and answer
 * write, and in the invitee sync: the engine's order, then the record. It
 * serialises the writes on one meeting — a duplicate-guest check, the next
 * agenda `order`, an answer against the sync — so none of them reads a state
 * another is about to change (lane B's review, fix 6).
 */
export async function lockMeetingRow(tx: Pick<EngineTx, '$queryRaw'>, meetingId: string, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Meeting" WHERE id = ${meetingId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(MEETING_NOT_FOUND);
}

/**
 * A unique-key or missing-row error that still slips past the checks (P2002,
 * P2025) is a coded 409, never a 500: `unique` names what was duplicated.
 */
export function asMeetingConflict(error: unknown, unique: 'MEETING_ALREADY_INVITED' | 'MEETING_CHANGED' = 'MEETING_CHANGED'): never {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'P2002') throw new MeetingRefusal(unique);
  if (code === 'P2025') throw new MeetingRefusal('MEETING_CHANGED');
  throw error;
}
