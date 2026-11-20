import { Prisma } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { committeeOversightUnitIds } from './committee-membership';
import { MEETING_KIND_RULES } from '../../foundation/workflow/meeting-authority';
import { MEETINGS_PERMISSIONS } from '../constants/permissions';

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
 *   SCHEDULER whoever may schedule the meeting's meetings (Ahmad, 19 Nov):
 *             meeting-authority.ts's MEETING_SCHEDULERS. Its seat path is a
 *             member and its head path an overseer, so the clause adds its
 *             own-unit path: an ACTIVE person whose own unit is the OWNING
 *             unit and who holds meetings:schedule through an active role, as
 *             holdingKeyWhere() reads it. In meetingMemberSql, so every reader
 *             (the parent rule, the lists, the clash check, the task registry)
 *             gets it, live: the viewer's unit is one scalar subquery per
 *             query, never one per meeting row. Mine alone reads the MEMBER
 *             clause without it (meetingInviteeSql).
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

/**
 * The unit whose meetings `viewerId` schedules as one of its own people: their
 * own unit, when they are ACTIVE and hold MEETING_SCHEDULERS' own-unit key
 * through an active role of their organisation; else NULL. A SCALAR subquery
 * that names no meeting column, so Postgres runs it ONCE per query (an
 * InitPlan), never once per meeting row. It needs no organisation: a unit's id
 * belongs to one organisation, so it can only ever equal the owning unit of
 * that organisation's meetings.
 */
function viewerScheduledUnitSql(viewerId: string): Prisma.Sql {
  const [module, action] = MEETING_KIND_RULES.MEETING_SCHEDULERS.ownUnitKey.split(':') as [string, string];
  return Prisma.sql`(
      SELECT su."primaryOrgUnitId" FROM "User" su
      WHERE su.id = ${viewerId} AND su.status = 'ACTIVE' AND su."primaryOrgUnitId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "UserRole" ur
          JOIN "Role" r ON r.id = ur."roleId" AND r."organizationId" = su."organizationId" AND r."isActive"
          JOIN "RolePermission" rp ON rp."roleId" = r.id
          JOIN "Permission" p ON p.id = rp."permissionId"
          WHERE ur."userId" = su.id AND p.module = ${module} AND p.action = ${action}))`;
}

/** The SCHEDULER clause as SQL: the owning unit `unitSql` is the one the viewer schedules for (once per query). */
function ownUnitSchedulerSql(unitSql: Prisma.Sql, viewerId: string): Prisma.Sql {
  // COALESCE: no scheduled unit is NULL, and `= NULL` would be NULL, not false,
  // which a NOT (Sub-units' view) would turn into a dropped row.
  return Prisma.sql`COALESCE(${unitSql} = ${viewerScheduledUnitSql(viewerId)}, FALSE)`;
}

/**
 * The visibility rule's MEMBER and SCHEDULER clauses as SQL, over the meeting
 * row `alias`, for this viewer: who may see the meeting without meetings:view
 * or oversight.
 */
export function meetingMemberSql(alias: string, viewerId: string): Prisma.Sql {
  return Prisma.sql`(${meetingInviteeSql(alias, viewerId)} OR ${ownUnitSchedulerSql(meetingOwningUnitSql(alias), viewerId)})`;
}

/**
 * The MEMBER clause alone: a member of the meeting's committee, a person of its
 * unit, or an invited attendee. Mine reads this (invited or organiser,
 * P189), not the SCHEDULER clause: a scheduler who is none of those sees the
 * meeting in Past, Sub-units' and the panels, never in their own Mine.
 */
export function meetingInviteeSql(alias: string, viewerId: string): Prisma.Sql {
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

/**
 * P237 — WHO MAY OPEN A MEETING, for many meetings in one query: the parent
 * rule ObjectVisibilityService applies to one MEETING on a read (with
 * oversight), built from the same clauses: `meetings:view`, else the MEMBER
 * and SCHEDULER clauses or the OVERSEER clause over the viewer's oversight set.
 * meetingOpener() reads the viewer's side once (no query for a meetings:view
 * holder, their oversight set otherwise); meetingMayOpenSql() is the rule over
 * a meeting row. Read by the clash check and MeetingAccess.openable(); a
 * db-spec holds openable() equal to canSee() for every viewer kind.
 */
export interface MeetingOpener {
  viewerId: string;
  seesAll: boolean;
  oversight: readonly string[];
}

export async function meetingOpener(
  client: Client,
  organizationId: string,
  viewer: { id: string; permissions: readonly string[] },
  now: Date,
): Promise<MeetingOpener> {
  const seesAll = viewer.permissions.includes(MEETINGS_PERMISSIONS.VIEW);
  return { viewerId: viewer.id, seesAll, oversight: seesAll ? [] : [...(await meetingOversightUnitIds(client, organizationId, viewer.id, now))] };
}

/** The rule above as SQL over the meeting row `alias` (the caller scopes the row by organisation). */
export function meetingMayOpenSql(alias: string, opener: MeetingOpener): Prisma.Sql {
  if (opener.seesAll) return Prisma.sql`TRUE`;
  return Prisma.sql`(${meetingMemberSql(alias, opener.viewerId)} OR ${meetingOverseenSql(alias, opener.oversight)})`;
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
 * the unit's own people, SCHEDULER the owning unit's own schedulers, and
 * OVERSEER the owning unit (`unitId`: the unit, or the committee's unit) in the
 * viewer's oversight set. Read by may-schedule and by schedule() before it
 * writes, so a meeting is never made that its scheduler could not open.
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
  const [scheduler, oversight] = await Promise.all([
    client.$queryRaw<{ ok: boolean }[]>`SELECT TRUE AS ok WHERE ${ownUnitSchedulerSql(Prisma.sql`${owner.unitId}`, viewerId)}`,
    meetingOversightUnitIds(client, organizationId, viewerId, now),
  ]);
  return scheduler.length > 0 || oversight.has(owner.unitId);
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
