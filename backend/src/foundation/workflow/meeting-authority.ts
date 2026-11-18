import type { PrismaService } from '../../prisma/prisma.service';
import { MEETINGS_PERMISSIONS } from '../../common/constants/permissions';
import { SEAT_ACTIONS, seatActionsFor, type SeatActionKey } from '../committees/seat-actions';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from '../organization/unit-headship';

/**
 * ACC-316 PR 2 — WHO MAY SCHEDULE, RECORD AND APPROVE A MEETING. The one place
 * the three meeting stage kinds (MEETING_SCHEDULERS, MEETING_RECORDERS,
 * MEETING_APPROVERS) are resolved; the meeting screens and writes (PR 3 on)
 * ask these same predicates, so a stage's pool and a button cannot disagree.
 * Plan: backend/Plans/step-316-meeting-management.md §3.8 and §4.2.
 *
 * A meeting's OWNING UNIT is its own unit (a unit meeting) or its committee's
 * unit (a committee meeting). "A head above" is the head or acting head of the
 * owning unit or of any unit above it (headship read through unit-headship.ts).
 *
 *   SCHEDULERS  committee meeting: the committee's active members whose seat
 *                 has `schedule_meeting`;
 *               both: `meetings:schedule` holders whose own unit is the owning
 *                 unit; heads above holding `meetings:schedule_subunits`.
 *   RECORDERS   committee meeting: members whose seat has `record_minutes`;
 *               unit meeting: `meetings:record_minutes` holders of the unit.
 *   APPROVERS   committee meeting: NOBODY — a committee's minutes are its
 *                 Chair's alone (Ahmad, 18 Nov), a fixed seat on the stage;
 *               unit meeting: `meetings:approve_minutes` holders of the unit;
 *                 heads above holding `meetings:approve_subunits`.
 *
 * BATCHED: every read takes all the meetings at once, scoped by organisation;
 * the number of queries does not grow with the number of meetings. Only an
 * ACTIVE person holding the key through an ACTIVE role counts; the stage pool
 * applies its own ACTIVE filter and out-of-office routing on top.
 */

export type MeetingStageKind = 'MEETING_SCHEDULERS' | 'MEETING_RECORDERS' | 'MEETING_APPROVERS';

export const MEETING_STAGE_KINDS: readonly MeetingStageKind[] = ['MEETING_SCHEDULERS', 'MEETING_RECORDERS', 'MEETING_APPROVERS'];

export function isMeetingStageKind(kind: string): kind is MeetingStageKind {
  return (MEETING_STAGE_KINDS as readonly string[]).includes(kind);
}

interface KindRule {
  /** The seat action a committee member's seat needs, or none (no seat path). */
  seatAction: SeatActionKey | null;
  /** The key counted for the holder's own unit, and whether a COMMITTEE meeting's owning unit counts. */
  ownUnitKey: string;
  ownUnitForCommittees: boolean;
  /** The key a head above needs, or none (no head path), and whether it reaches committee meetings. */
  subunitsKey: string | null;
  subunitsForCommittees: boolean;
}

export const MEETING_KIND_RULES: Readonly<Record<MeetingStageKind, KindRule>> = {
  MEETING_SCHEDULERS: {
    seatAction: SEAT_ACTIONS.SCHEDULE_MEETING,
    ownUnitKey: MEETINGS_PERMISSIONS.SCHEDULE,
    ownUnitForCommittees: true,
    subunitsKey: MEETINGS_PERMISSIONS.SCHEDULE_SUBUNITS,
    subunitsForCommittees: true,
  },
  MEETING_RECORDERS: {
    seatAction: SEAT_ACTIONS.RECORD_MINUTES,
    ownUnitKey: MEETINGS_PERMISSIONS.RECORD_MINUTES,
    ownUnitForCommittees: false,
    subunitsKey: null,
    subunitsForCommittees: false,
  },
  MEETING_APPROVERS: {
    seatAction: null,
    ownUnitKey: MEETINGS_PERMISSIONS.APPROVE_MINUTES,
    ownUnitForCommittees: false,
    subunitsKey: MEETINGS_PERMISSIONS.APPROVE_SUBUNITS,
    subunitsForCommittees: false,
  },
};

export type MeetingAuthorityClient = Pick<
  PrismaService,
  'meeting' | 'committeeMember' | 'committeeSeatAction' | 'user' | 'orgUnitHeadAssignment' | '$queryRaw'
>;

interface MeetingOwner {
  id: string;
  committeeId: string | null;
  /** The owning unit: the meeting's own, else its committee's. */
  unitId: string | null;
}

/**
 * For each kind asked, each meeting's people (user ids, unfiltered by the
 * pool's own rules). A meeting not in this organisation is absent.
 */
export async function resolveMeetingStageKinds(
  client: MeetingAuthorityClient,
  organizationId: string,
  meetingIds: readonly string[],
  kinds: ReadonlySet<MeetingStageKind>,
  now: Date = new Date(),
): Promise<Map<MeetingStageKind, Map<string, string[]>>> {
  const out = new Map<MeetingStageKind, Map<string, string[]>>();
  for (const kind of kinds) out.set(kind, new Map());
  if (meetingIds.length === 0 || kinds.size === 0) return out;

  const owners = await meetingOwners(client, organizationId, meetingIds);
  if (owners.length === 0) return out;
  const rules = [...kinds].map((kind) => [kind, MEETING_KIND_RULES[kind]] as const);

  const seatActions = [...new Set(rules.map(([, r]) => r.seatAction).filter((a): a is SeatActionKey => a !== null))];
  const ownKeys = [...new Set(rules.map(([, r]) => r.ownUnitKey))];
  const subunitKeys = [...new Set(rules.map(([, r]) => r.subunitsKey).filter((k): k is string => k !== null))];
  const committeeIds = [...new Set(owners.map((o) => o.committeeId).filter((id): id is string => id !== null))];
  const unitIds = [...new Set(owners.map((o) => o.unitId).filter((id): id is string => id !== null))];

  const [seatHolders, ownUnitHolders, headsAbove] = await Promise.all([
    seatActionHolders(client, organizationId, seatActions.length > 0 ? committeeIds : [], seatActions),
    ownUnitKeyHolders(client, organizationId, unitIds, ownKeys),
    headsAboveWithKeys(client, organizationId, subunitKeys.length > 0 ? unitIds : [], subunitKeys, now),
  ]);

  for (const [kind, rule] of rules) {
    const byMeeting = out.get(kind)!;
    for (const owner of owners) {
      const isCommittee = owner.committeeId !== null;
      const ids = new Set<string>();
      if (isCommittee && rule.seatAction) {
        for (const id of seatHolders.get(`${owner.committeeId} ${rule.seatAction}`) ?? []) ids.add(id);
      }
      if (owner.unitId && (!isCommittee || rule.ownUnitForCommittees)) {
        for (const id of ownUnitHolders.get(`${owner.unitId} ${rule.ownUnitKey}`) ?? []) ids.add(id);
      }
      if (owner.unitId && rule.subunitsKey && (!isCommittee || rule.subunitsForCommittees)) {
        for (const id of headsAbove.get(`${owner.unitId} ${rule.subunitsKey}`) ?? []) ids.add(id);
      }
      byMeeting.set(owner.id, [...ids].sort());
    }
  }
  return out;
}

/** Each meeting's committee and owning unit, in ONE query. */
async function meetingOwners(client: MeetingAuthorityClient, organizationId: string, meetingIds: readonly string[]): Promise<MeetingOwner[]> {
  const rows = await client.meeting.findMany({
    where: { organizationId, id: { in: [...meetingIds] } },
    select: { id: true, committeeId: true, orgUnitId: true, committee: { select: { orgUnitId: true } } },
  });
  return rows.map((r) => ({ id: r.id, committeeId: r.committeeId, unitId: r.orgUnitId ?? r.committee?.orgUnitId ?? null }));
}

/**
 * "committeeId action" → the committee's active members whose seat allows the
 * action. Two queries (the seat-action rows through seat-actions.ts's one
 * reader, then the members), whatever the number of committees.
 */
async function seatActionHolders(
  client: MeetingAuthorityClient,
  organizationId: string,
  committeeIds: readonly string[],
  actions: readonly SeatActionKey[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (committeeIds.length === 0 || actions.length === 0) return out;
  const rows = (await seatActionsFor(client, organizationId, committeeIds)).filter((r) => (actions as readonly string[]).includes(r.actionKey));
  if (rows.length === 0) return out;
  const members = await client.committeeMember.findMany({
    where: { organizationId, committeeId: { in: [...new Set(rows.map((r) => r.committeeId))] }, isActive: true, user: { status: 'ACTIVE' } },
    select: { committeeId: true, userId: true, roleValueId: true },
  });
  for (const r of rows) {
    const key = `${r.committeeId} ${r.actionKey}`;
    const list = out.get(key) ?? [];
    for (const m of members) if (m.committeeId === r.committeeId && m.roleValueId === r.roleValueId) list.push(m.userId);
    out.set(key, list);
  }
  return out;
}

/** The active people holding `key` through an active role of this organisation, among `userIds` or in `unitIds`. */
function holdingKeyWhere(organizationId: string, key: string) {
  const [module, action] = key.split(':') as [string, string];
  return {
    organizationId,
    status: 'ACTIVE' as const,
    userRoles: { some: { role: { organizationId, isActive: true, rolePermissions: { some: { permission: { module, action } } } } } },
  };
}

/** "unitId key" → the active people whose own unit it is and who hold the key. One query per key. */
async function ownUnitKeyHolders(
  client: MeetingAuthorityClient,
  organizationId: string,
  unitIds: readonly string[],
  keys: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (unitIds.length === 0) return out;
  const results = await Promise.all(
    keys.map((key) =>
      client.user.findMany({
        where: { ...holdingKeyWhere(organizationId, key), primaryOrgUnitId: { in: [...unitIds] } },
        select: { id: true, primaryOrgUnitId: true },
      }),
    ),
  );
  keys.forEach((key, i) => {
    for (const u of results[i]!) {
      if (!u.primaryOrgUnitId) continue;
      const k = `${u.primaryOrgUnitId} ${key}`;
      out.set(k, [...(out.get(k) ?? []), u.id]);
    }
  });
  return out;
}

/**
 * "unitId key" → the heads and acting heads of the unit or any unit above it
 * who hold the key. The ancestors in ONE recursive query, their heads and
 * covers through unit-headship.ts, then one query per key for who holds it.
 */
async function headsAboveWithKeys(
  client: MeetingAuthorityClient,
  organizationId: string,
  unitIds: readonly string[],
  keys: readonly string[],
  now: Date,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (unitIds.length === 0 || keys.length === 0) return out;
  const chain = await client.$queryRaw<{ start: string; id: string }[]>`
    WITH RECURSIVE up(start, id, "parentId") AS (
      SELECT u.id, u.id, u."parentId" FROM "OrgUnit" u
       WHERE u."organizationId" = ${organizationId} AND u.id = ANY(${[...unitIds]}::text[])
      UNION
      SELECT up.start, p.id, p."parentId" FROM "OrgUnit" p JOIN up ON p.id = up."parentId"
       WHERE p."organizationId" = ${organizationId}
    )
    SELECT start, id FROM up`;
  const ancestorIds = [...new Set(chain.map((c) => c.id))];
  const [holders, covers] = await Promise.all([
    findCurrentHeadHoldersForUnits(client, organizationId, ancestorIds),
    findRunningActingCoversForUnits(client, organizationId, ancestorIds, now),
  ]);
  const headsOf = new Map<string, string[]>();
  for (const unitId of ancestorIds) {
    const ids = (holders.get(unitId) ?? []).map((h) => h.id);
    const cover = covers.get(unitId);
    if (cover) ids.push(cover.userId);
    headsOf.set(unitId, ids);
  }
  const candidates = [...new Set([...headsOf.values()].flat())];
  if (candidates.length === 0) return out;
  const results = await Promise.all(
    keys.map((key) =>
      client.user.findMany({ where: { ...holdingKeyWhere(organizationId, key), id: { in: candidates } }, select: { id: true } }),
    ),
  );
  keys.forEach((key, i) => {
    const holding = new Set(results[i]!.map((u) => u.id));
    for (const { start, id } of chain) {
      const k = `${start} ${key}`;
      const list = out.get(k) ?? [];
      for (const userId of headsOf.get(id) ?? []) if (holding.has(userId) && !list.includes(userId)) list.push(userId);
      out.set(k, list);
    }
  });
  return out;
}
