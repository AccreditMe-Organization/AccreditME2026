import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { committeeOversightUnitIds } from './committee-membership';

/**
 * ACC-316 PR 3a — WHO MAY SEE A MEETING WITHOUT meetings:view: the one copy of
 * the rule (plan step-316 §4.1), read by the parent rule
 * (ObjectVisibilityService), the meeting lists and the task registry, never
 * written again.
 *
 *   MEMBER    for a committee meeting, an active member of its active
 *             committee; for a unit meeting, an ACTIVE person whose own unit
 *             (primaryOrgUnitId) is the meeting's unit, with no sub-units (lane
 *             B, 18 Nov); and anyone INVITED with a user: an attendee row
 *             whose invitedAt is set, so a guest added while the meeting is
 *             planned sees it only once the agenda is issued (lane B, 18 Nov);
 *   OVERSEER  the head or acting head of the meeting's OWNING unit or a unit
 *             above it (Ahmad, 18 Nov): the owning unit is the meeting's own,
 *             or its committee's. Through committee-membership.ts's
 *             committeeOversightUnitIds(), so headship is read through
 *             unit-headship.ts.
 *
 * Every query is scoped by organisation; the SQL forms take the meeting row's
 * alias, so a list puts the rule in its WHERE before LIMIT.
 */

type Client = Pick<PrismaService, '$queryRaw' | 'user' | 'orgUnitHeadAssignment'>;

/** The meeting's owning unit as SQL, over the meeting row `alias`. */
export function meetingOwningUnitSql(alias: string): Prisma.Sql {
  const m = Prisma.raw(alias);
  return Prisma.sql`COALESCE(${m}."orgUnitId", (SELECT oc."orgUnitId" FROM "Committee" oc WHERE oc.id = ${m}."committeeId" AND oc."organizationId" = ${m}."organizationId"))`;
}

/** The MEMBER clause as SQL, over the meeting row `alias`, for this viewer. */
export function meetingMemberSql(alias: string, viewerId: string): Prisma.Sql {
  const m = Prisma.raw(alias);
  return Prisma.sql`(
    (${m}."committeeId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "CommitteeMember" cm
      JOIN "Committee" c ON c.id = cm."committeeId" AND c."organizationId" = cm."organizationId"
      WHERE cm."committeeId" = ${m}."committeeId" AND cm."organizationId" = ${m}."organizationId"
        AND cm."userId" = ${viewerId} AND cm."isActive" AND c."isActive"))
    OR (${m}."orgUnitId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "User" u
      WHERE u.id = ${viewerId} AND u."organizationId" = ${m}."organizationId"
        AND u."primaryOrgUnitId" = ${m}."orgUnitId" AND u.status = 'ACTIVE'))
    OR EXISTS (
      SELECT 1 FROM "MeetingAttendee" a
      WHERE a."meetingId" = ${m}.id AND a."organizationId" = ${m}."organizationId" AND a."userId" = ${viewerId}
        AND a."invitedAt" IS NOT NULL)
  )`;
}

/** The OVERSEER clause as SQL: the owning unit is one of `unitIds` (the viewer's oversight set). */
export function meetingOverseenSql(alias: string, unitIds: readonly string[]): Prisma.Sql {
  if (unitIds.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${meetingOwningUnitSql(alias)} = ANY(${[...unitIds]}::text[])`;
}

/** Is `viewerId` a MEMBER of this meeting (in this organisation)? One query. */
export async function isMeetingMember(client: Pick<PrismaService, '$queryRaw'>, meetingId: string, organizationId: string, viewerId: string): Promise<boolean> {
  const rows = await client.$queryRaw<{ ok: boolean }[]>`
    SELECT TRUE AS ok FROM "Meeting" m
    WHERE m.id = ${meetingId} AND m."organizationId" = ${organizationId} AND ${meetingMemberSql('m', viewerId)}`;
  return rows.length > 0;
}

/** The units whose meetings this viewer oversees: those they head or cover, and every unit below. */
export function meetingOversightUnitIds(client: Client, organizationId: string, viewerId: string, now: Date): Promise<Set<string>> {
  return committeeOversightUnitIds(client, organizationId, viewerId, now);
}

/**
 * ACC-316 PR 6 — would `viewerId` see a NEW meeting of this owner, by the rule
 * above without meetings:view? The same clauses with no meeting row yet: a new
 * meeting has nobody invited, so MEMBER is the committee's active membership or
 * the unit's own people, and OVERSEER is the owning unit (`unitId`: the unit, or
 * the committee's unit) in the viewer's oversight set. Read by may-schedule, so
 * Schedule meeting is offered only where the meeting it makes would open.
 */
export async function wouldSeeNewMeeting(
  client: Client,
  organizationId: string,
  owner: { committeeId: string | null; unitId: string | null },
  viewerId: string,
  now: Date,
): Promise<boolean> {
  const member = owner.committeeId
    ? await client.$queryRaw<{ ok: boolean }[]>`
        SELECT TRUE AS ok FROM "CommitteeMember" cm
        JOIN "Committee" c ON c.id = cm."committeeId" AND c."organizationId" = cm."organizationId"
        WHERE cm."committeeId" = ${owner.committeeId} AND cm."organizationId" = ${organizationId}
          AND cm."userId" = ${viewerId} AND cm."isActive" AND c."isActive"`
    : await client.$queryRaw<{ ok: boolean }[]>`
        SELECT TRUE AS ok FROM "User" u
        WHERE u.id = ${viewerId} AND u."organizationId" = ${organizationId}
          AND u."primaryOrgUnitId" = ${owner.unitId} AND u.status = 'ACTIVE'`;
  if (member.length > 0) return true;
  if (!owner.unitId) return false;
  return (await meetingOversightUnitIds(client, organizationId, viewerId, now)).has(owner.unitId);
}

/** Does `viewerId` oversee this meeting (its owning unit in their set)? Their set, then one query. */
export async function overseesMeeting(client: Client, meetingId: string, organizationId: string, viewerId: string, now: Date): Promise<boolean> {
  const units = await meetingOversightUnitIds(client, organizationId, viewerId, now);
  if (units.size === 0) return false;
  const rows = await client.$queryRaw<{ ok: boolean }[]>`
    SELECT TRUE AS ok FROM "Meeting" m
    WHERE m.id = ${meetingId} AND m."organizationId" = ${organizationId} AND ${meetingOverseenSql('m', [...units])}`;
  return rows.length > 0;
}
