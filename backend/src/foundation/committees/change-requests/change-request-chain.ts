import type { PrismaService } from '../../../prisma/prisma.service';
import { STAGE_FLAG } from '../../workflow/record-registry';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from '../../organization/unit-headship';
import { seatHoldersFor } from '../committee-seat-rules';
import { SEAT_ACTIONS, seatActionsFor } from '../seat-actions';

/**
 * ACC-283 PR 2 — THE CHAIN OF AUTHORITY: who decides a committee's change request.
 * Plan: backend/Plans/step-283-change-request-chain.md §3 (Ahmad, 10 and 16 Nov).
 *
 * For a request on committee C, raised by R:
 *   1. The Reports-to step: if C reports to P and P is in force (active, its newest
 *      instance's stage flagged IN_FORCE, so Suspended counts), the ACTIVE holders
 *      of P's seats whose actions include decide_reporting_changes.
 *   2. The unit steps: C's owning unit, then each parent up to the root; at each,
 *      its head holders and its acting cover in force (ACTIVE users), read only
 *      through unit-headship.ts.
 *   Skipped at every step: R; every active member of C, EXCEPT at the root; and a
 *   vacant step (no seat, empty seats, P not in force, no head and no cover, an
 *   inactive unit). The first step with someone left decides; any one of them.
 *
 * RESOLVED LIVE, NEVER STORED: a new head or seat holder re-routes every open
 * request on its next read. The walk is a pure function over loaded facts
 * (walkChain), and the loader reads them for ANY number of requests in at most
 * nine queries, never one per request, step or unit.
 */

export type ChainStep =
  | { kind: 'REPORTS_TO_SEAT'; committeeId: string; seatIds: string[] }
  | { kind: 'UNIT_HEAD'; unitId: string; isRoot: boolean }
  | { kind: 'NONE' };

export interface ChainResult {
  step: ChainStep;
  /** Who may decide now: the step's people, R and (below the root) C's members removed. */
  deciderIds: string[];
  /** R is a head holder of the root unit, or its acting cover in force (Q4: Approve now). */
  requesterHeadsRoot: boolean;
}

export interface ChainRequest {
  id: string;
  committeeId: string;
  requesterId: string;
}

/** Everything the walk reads, loaded once for a batch. */
export interface ChainFacts {
  committees: Map<string, { orgUnitId: string; reportingToCommitteeId: string | null }>;
  /** Active members (ACTIVE users) of each requesting committee. */
  members: Map<string, Set<string>>;
  /** Reports-to committees in force. */
  inForce: Set<string>;
  /** Each Reports-to committee's seats that decide reporting changes. */
  decidingSeats: Map<string, string[]>;
  /** Each Reports-to committee's ACTIVE holders of those seats. */
  seatHolders: Map<string, string[]>;
  /** Every owning unit and its ancestors. */
  units: Map<string, { parentId: string | null; isActive: boolean }>;
  /** Each unit's head holders and cover in force, ACTIVE users only. */
  heads: Map<string, string[]>;
}

const NONE: ChainStep = { kind: 'NONE' };
/** The ancestor walk's guard: no organisation is this deep, and a loop in the data stops here. */
const MAX_DEPTH = 50;

/** The pure walk: one request over the loaded facts. */
export function walkChain(request: ChainRequest, facts: ChainFacts): ChainResult {
  const committee = facts.committees.get(request.committeeId);
  if (!committee) return { step: NONE, deciderIds: [], requesterHeadsRoot: false };
  const members = facts.members.get(request.committeeId) ?? new Set<string>();
  const notRequester = (id: string) => id !== request.requesterId;

  // The owning unit and every unit above it, in order; the root is the one with no parent.
  const path: string[] = [];
  let rootId: string | null = null;
  for (let unitId: string | null = committee.orgUnitId, depth = 0; unitId && depth <= MAX_DEPTH; depth++) {
    const unit = facts.units.get(unitId);
    if (!unit || path.includes(unitId)) break;
    path.push(unitId);
    if (unit.parentId === null) rootId = unitId;
    unitId = unit.parentId;
  }
  const requesterHeadsRoot = rootId !== null && (facts.heads.get(rootId) ?? []).includes(request.requesterId);

  // 1. The Reports-to committee's deciding seats, if it is in force.
  const reportsTo = committee.reportingToCommitteeId;
  if (reportsTo && facts.inForce.has(reportsTo)) {
    const people = (facts.seatHolders.get(reportsTo) ?? []).filter((id) => notRequester(id) && !members.has(id));
    if (people.length > 0) {
      return {
        step: { kind: 'REPORTS_TO_SEAT', committeeId: reportsTo, seatIds: facts.decidingSeats.get(reportsTo) ?? [] },
        deciderIds: unique(people),
        requesterHeadsRoot,
      };
    }
  }

  // 2. The owning unit, then upwards to the root. Members of C are skipped below the root only.
  for (const unitId of path) {
    const unit = facts.units.get(unitId)!;
    if (!unit.isActive) continue;
    const isRoot = unit.parentId === null;
    const people = (facts.heads.get(unitId) ?? []).filter((id) => notRequester(id) && (isRoot || !members.has(id)));
    if (people.length > 0) return { step: { kind: 'UNIT_HEAD', unitId, isRoot }, deciderIds: unique(people), requesterHeadsRoot };
  }
  return { step: NONE, deciderIds: [], requesterHeadsRoot };
}

type ChainClient = Pick<PrismaService, 'committee' | 'committeeMember' | 'committeeSeatAction' | 'user' | 'orgUnitHeadAssignment' | '$queryRaw'>;

/**
 * Loads the facts for `requests` and walks each. At most NINE queries whatever the
 * number of requests, every one scoped by organisation:
 *   round 1: (1) the requesting committees;
 *   round 2, at once: (2) their active members, (3) which Reports-to committees are
 *     in force, (4) the Reports-to committees' deciding seats, (5) every owning unit
 *     and its ancestors;
 *   round 3, at once: (6) the holders of those seats, (7) the units' head holders,
 *     (8) their covers in force;
 *   round 4: (9) the covers' users, ACTIVE only.
 * A read whose input is empty is skipped.
 */
export async function resolveDecisionChains(
  client: ChainClient,
  organizationId: string,
  requests: readonly ChainRequest[],
  now: Date = new Date(),
): Promise<Map<string, ChainResult>> {
  const out = new Map<string, ChainResult>();
  if (requests.length === 0) return out;
  const facts = await loadChainFacts(client, organizationId, [...new Set(requests.map((r) => r.committeeId))], now);
  for (const request of requests) out.set(request.id, walkChain(request, facts));
  return out;
}

export async function loadChainFacts(client: ChainClient, organizationId: string, committeeIds: string[], now: Date): Promise<ChainFacts> {
  // (1)
  const committeeRows = await client.committee.findMany({
    where: { id: { in: committeeIds }, organizationId },
    select: { id: true, orgUnitId: true, reportingToCommitteeId: true },
  });
  const committees = new Map(committeeRows.map((c) => [c.id, { orgUnitId: c.orgUnitId, reportingToCommitteeId: c.reportingToCommitteeId }]));
  const found = committeeRows.map((c) => c.id);
  const reportsToIds = [...new Set(committeeRows.map((c) => c.reportingToCommitteeId).filter((id): id is string => !!id))];
  const owningUnits = [...new Set(committeeRows.map((c) => c.orgUnitId))];

  // (2) (3) (4) (5)
  const [memberRows, inForceRows, seatRows, unitRows] = await Promise.all([
    found.length
      ? client.committeeMember.findMany({
          where: { organizationId, committeeId: { in: found }, isActive: true, user: { organizationId, status: 'ACTIVE' } },
          select: { committeeId: true, userId: true },
        })
      : Promise.resolve([] as { committeeId: string; userId: string }[]),
    reportsToIds.length ? committeesInForce(client, organizationId, reportsToIds) : Promise.resolve([] as string[]),
    reportsToIds.length ? seatActionsFor(client, organizationId, reportsToIds, SEAT_ACTIONS.DECIDE_REPORTING_CHANGES) : Promise.resolve([]),
    owningUnits.length ? unitsAndAncestors(client, organizationId, owningUnits) : Promise.resolve([] as UnitRow[]),
  ]);

  const members = new Map<string, Set<string>>();
  for (const m of memberRows) (members.get(m.committeeId) ?? members.set(m.committeeId, new Set()).get(m.committeeId)!).add(m.userId);
  const inForce = new Set(inForceRows);
  const decidingSeats = new Map<string, string[]>();
  // Every Reports-to committee's deciding seats: whether it is IN FORCE is the
  // walk's rule alone (walkChain), never filtered here as well.
  for (const s of seatRows) {
    (decidingSeats.get(s.committeeId) ?? decidingSeats.set(s.committeeId, []).get(s.committeeId)!).push(s.roleValueId);
  }
  const units = new Map(unitRows.map((u) => [u.id, { parentId: u.parentId, isActive: u.isActive }]));
  const unitIds = [...units.keys()];
  const seatCommittees = [...decidingSeats.keys()];
  const seatIds = [...new Set([...decidingSeats.values()].flat())];

  // (6) (7) (8)
  const [holderRows, headRows, coverRows] = await Promise.all([
    seatCommittees.length ? seatHoldersFor(client, organizationId, seatCommittees, seatIds) : Promise.resolve([]),
    findCurrentHeadHoldersForUnits(client, organizationId, unitIds),
    findRunningActingCoversForUnits(client, organizationId, unitIds, now),
  ]);

  const seatHolders = new Map<string, string[]>();
  for (const h of holderRows) {
    // seatHoldersFor() answers the cross product; keep each committee's own deciding seats.
    if (!(decidingSeats.get(h.committeeId) ?? []).includes(h.roleValueId)) continue;
    (seatHolders.get(h.committeeId) ?? seatHolders.set(h.committeeId, []).get(h.committeeId)!).push(h.userId);
  }

  // (9) A cover counts only while their user is ACTIVE (the helper does not check).
  const coverUserIds = [...new Set([...coverRows.values()].map((c) => c.userId))];
  const activeCovers = coverUserIds.length
    ? new Set(
        (await client.user.findMany({ where: { id: { in: coverUserIds }, organizationId, status: 'ACTIVE' }, select: { id: true } })).map(
          (u) => u.id,
        ),
      )
    : new Set<string>();

  const heads = new Map<string, string[]>();
  for (const unitId of unitIds) {
    const people = (headRows.get(unitId) ?? []).map((h) => h.id);
    const cover = coverRows.get(unitId);
    if (cover && activeCovers.has(cover.userId)) people.push(cover.userId);
    if (people.length) heads.set(unitId, unique(people));
  }

  return { committees, members, inForce, decidingSeats, seatHolders, units, heads };
}

/** The given committees that are in force: active, and their newest instance's stage flagged IN_FORCE. */
async function committeesInForce(client: Pick<PrismaService, '$queryRaw'>, organizationId: string, ids: string[]): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    WITH newest AS (
      SELECT DISTINCT ON (wi."objectId") wi."objectId", wi."currentStageId"
      FROM "WorkflowInstance" wi
      WHERE wi."organizationId" = ${organizationId}
        AND wi."objectType"::text = 'COMMITTEE'
        AND wi."objectId" = ANY(${ids}::text[])
      ORDER BY wi."objectId", wi."createdAt" DESC
    )
    SELECT c.id
    FROM "Committee" c
    JOIN newest n ON n."objectId" = c.id
    JOIN "WorkflowStage" s ON s.id = n."currentStageId"
    JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
    WHERE c."organizationId" = ${organizationId}
      AND c."isActive"
      AND ${STAGE_FLAG.IN_FORCE} = ANY(s.flags)`;
  return rows.map((r) => r.id);
}

interface UnitRow {
  id: string;
  parentId: string | null;
  isActive: boolean;
}

/** The given units and every unit above them, in ONE recursive query, scoped by organisation at every step. */
async function unitsAndAncestors(client: Pick<PrismaService, '$queryRaw'>, organizationId: string, ids: string[]): Promise<UnitRow[]> {
  return client.$queryRaw<UnitRow[]>`
    WITH RECURSIVE up(id, "parentId", "isActive", depth) AS (
      SELECT u.id, u."parentId", u."isActive", 0
      FROM "OrgUnit" u
      WHERE u."organizationId" = ${organizationId} AND u.id = ANY(${ids}::text[])
      UNION
      SELECT p.id, p."parentId", p."isActive", up.depth + 1
      FROM "OrgUnit" p
      JOIN up ON p.id = up."parentId"
      WHERE p."organizationId" = ${organizationId} AND up.depth < ${MAX_DEPTH}
    )
    SELECT DISTINCT id, "parentId", "isActive" FROM up`;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}
