import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { isMeetingKindMember, type MeetingOwner } from '../workflow/meeting-authority';
import { MeetingRefusal } from './meeting-refusal';

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
