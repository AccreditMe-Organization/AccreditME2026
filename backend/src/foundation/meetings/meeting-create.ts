import type { Prisma } from '../../../generated/prisma/client';
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

/** The owner's MEMBER invitees as they stand now: [userId, seatValueId]. The same for every meeting of one owner. */
export async function ownerMembers(client: Parameters<typeof expectedMembers>[0], organizationId: string, owner: MeetingOwner): Promise<[string, string | null][]> {
  const key = 'owner';
  const expected = await expectedMembers(client, organizationId, [{ id: key, committeeId: owner.committeeId, orgUnitId: owner.committeeId ? null : owner.unitId }]);
  return [...expected.get(key)!];
}

/**
 * ACC-316 — meetings written inside a caller's transaction, all of ONE owner:
 * the rows, their invitees, each one's workflow instance at Planned, and each
 * one's CREATE audit row. Batched: one write for the rows, one for the
 * invitees, one for the audit rows; the instances one by one (the engine's).
 * schedule() writes one; a series writes all of its meetings.
 *
 * `attendees` replaces the default invitees (the owner's MEMBERS, read here
 * unless `members` is given), for a caller that needs the rows' ids (a series'
 * presenters). The instances' notices are the caller's, after the commit.
 */
export async function insertMeetingsInTx(
  tx: EngineTx,
  workflow: Pick<WorkflowService, 'insertInstanceStartInTx'>,
  prepared: readonly Prepared[],
  meetings: readonly NewMeeting[],
  opts: { members?: readonly [string, string | null][]; attendees?: Prisma.MeetingAttendeeCreateManyInput[] } = {},
): Promise<Started[]> {
  if (meetings.length === 0) return [];
  const { organizationId, owner } = meetings[0]!;
  const orgUnitId = owner.committeeId ? null : owner.unitId;
  await tx.meeting.createMany({
    data: meetings.map((m) => ({
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
    })),
  });
  // ACC-316 PR 3b — the MEMBER invitees; the invitee sync keeps them current from here.
  let attendees = opts.attendees;
  if (!attendees) {
    const members = opts.members ?? (await ownerMembers(tx, organizationId, owner));
    attendees = meetings.flatMap((m) => members.map(([userId, seatValueId]) => ({ organizationId, meetingId: m.id, kind: 'MEMBER' as const, userId, seatValueId })));
  }
  if (attendees.length > 0) await tx.meetingAttendee.createMany({ data: attendees });
  const started: Started[] = [];
  for (const [i, m] of meetings.entries()) started.push(await workflow.insertInstanceStartInTx(tx, prepared[i]!, m.id, organizationId, m.organizerId));
  await tx.auditLog.createMany({
    data: meetings.map((m) => ({
      organizationId,
      actorId: m.organizerId,
      action: 'CREATE' as const,
      objectType: 'Meeting',
      objectId: m.id,
      after: {
        title: m.title,
        committeeId: owner.committeeId,
        orgUnitId,
        typeValueId: m.typeValueId,
        scheduledAt: m.scheduledAt.toISOString(),
        durationMinutes: m.durationMinutes,
        location: m.location,
        meetingUrl: m.meetingUrl,
        unitQuorum: owner.committeeId ? null : m.unitQuorum,
        ...(m.seriesId && { seriesId: m.seriesId, seriesIndex: m.seriesIndex }),
      },
    })),
  });
  return started;
}
