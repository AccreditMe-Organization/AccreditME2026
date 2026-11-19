import type { WorkflowService, EngineTx } from '../workflow/workflow.service';
import type { MeetingOwner } from '../workflow/meeting-authority';
import { expectedMembers } from './invitees/meeting-invitee-sync.service';

/** One meeting to create, as schedule() and a series write it. */
export interface NewMeeting {
  id: string;
  organizationId: string;
  owner: MeetingOwner;
  organizerId: string;
  title: string;
  typeValueId: string;
  scheduledAt: Date;
  durationMinutes: number;
  location: string | null;
  meetingUrl: string | null;
  unitQuorum: number | null;
  seriesId?: string;
  seriesIndex?: number;
}

type Started = Awaited<ReturnType<WorkflowService['insertInstanceStartInTx']>>;
type Prepared = Awaited<ReturnType<WorkflowService['prepareInstanceStart']>>;

/**
 * ACC-316 — ONE meeting written inside a caller's transaction: the row, its
 * MEMBER invitees (the committee's active members with their seats, or the
 * unit's own people, as they stand now), its workflow instance at Planned and
 * its CREATE audit row. schedule() writes one; a series writes each of its
 * meetings with it, in one transaction. The instance's notices are the
 * caller's, after the commit (finishInstanceStart()).
 */
export async function insertMeetingInTx(
  tx: EngineTx,
  workflow: Pick<WorkflowService, 'insertInstanceStartInTx'>,
  prepared: Prepared,
  m: NewMeeting,
): Promise<Started> {
  const { organizationId, owner } = m;
  const orgUnitId = owner.committeeId ? null : owner.unitId;
  const meeting = await tx.meeting.create({
    data: {
      id: m.id,
      organizationId,
      committeeId: owner.committeeId,
      orgUnitId,
      organizerId: m.organizerId,
      title: m.title,
      typeValueId: m.typeValueId,
      scheduledAt: m.scheduledAt,
      durationMinutes: m.durationMinutes,
      location: m.location,
      meetingUrl: m.meetingUrl,
      unitQuorum: owner.committeeId ? null : m.unitQuorum,
      seriesId: m.seriesId ?? null,
      seriesIndex: m.seriesIndex ?? null,
    },
  });
  // ACC-316 PR 3b — the MEMBER invitees; the invitee sync keeps them current from here.
  const expected = await expectedMembers(tx, organizationId, [{ id: m.id, committeeId: owner.committeeId, orgUnitId }]);
  const members = [...expected.get(m.id)!];
  if (members.length > 0) {
    await tx.meetingAttendee.createMany({
      data: members.map(([userId, seatValueId]) => ({ organizationId, meetingId: m.id, kind: 'MEMBER' as const, userId, seatValueId })),
    });
  }
  const instance = await workflow.insertInstanceStartInTx(tx, prepared, m.id, organizationId, m.organizerId);
  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: m.organizerId,
      action: 'CREATE',
      objectType: 'Meeting',
      objectId: m.id,
      after: {
        title: meeting.title,
        committeeId: meeting.committeeId,
        orgUnitId: meeting.orgUnitId,
        typeValueId: meeting.typeValueId,
        scheduledAt: meeting.scheduledAt.toISOString(),
        durationMinutes: meeting.durationMinutes,
        location: meeting.location,
        meetingUrl: meeting.meetingUrl,
        unitQuorum: meeting.unitQuorum,
        ...(m.seriesId && { seriesId: m.seriesId, seriesIndex: m.seriesIndex }),
      },
    },
  });
  return instance;
}
