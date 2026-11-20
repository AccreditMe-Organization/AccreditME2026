import type { WorkflowObjectType, WorkflowStage } from '../../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { committeeReadersAmong } from '../../common/services/committee-membership';
import { isReviewStage } from './review-stages';

/**
 * ACC-325 — who may DECIDE a stage, per kind of record: the people of a stage's
 * pool who could actually take its decision, for ONE question only, whether the
 * stage is unassigned. The two `isUnassigned` flaggers read it (the engine's
 * entry-time `checkAndFlagUnassignedStage()` and the SLA sweep's
 * `sweepUnassignedStages()`), so Setup health's STAGE_WITHOUT_ASSIGNEE lists a
 * stage nobody can decide, not only one whose pool is empty.
 *
 * It never decides who may ACT: the pool stays the pool (StagePoolService,
 * `mayActInStagePool()`), and each record's own decision path keeps its own
 * refusals. Beside TRANSITION_PRECONDITIONS, and FAIL OPEN like it: a kind of
 * record with no entry keeps its whole pool, so a missing rule here never flags
 * an existing workflow.
 */

type DeciderClient = Pick<
  PrismaService,
  'committeeChangeRequest' | 'committeeMember' | 'committee' | 'user' | 'userRole' | 'orgUnitHeadAssignment' | '$queryRaw'
>;

/** One open stage entry and its pool's members, as a flagger resolved them. */
export interface StageDeciderEntry {
  /** The caller's key for the answer: the stage entry's id. */
  key: string;
  organizationId: string;
  stage: Pick<WorkflowStage, 'key' | 'isInitial' | 'isFinal'>;
  instance: { objectType: WorkflowObjectType; objectId: string };
  members: readonly string[];
}

/** The deciders of each entry it is given, keyed as given; it may leave members out, never add one. */
export type StageDeciderFilter = (
  client: DeciderClient,
  organizationId: string,
  entries: StageDeciderEntry[],
  now: Date,
) => Promise<Map<string, string[]>>;

/**
 * A committee change request in an ADDED REVIEW STAGE (ACC-245): the stage's
 * people who may decide it, by the change request's own two rules —
 * - never the requester: `requestedById`, the column `loadDecision()` reads to
 *   refuse CHANGE_REQUEST_OWN_DECISION and `reviewDecisions()` takes out of the
 *   pool (a db-spec holds the flag and that refusal together);
 * - only someone who may open the committee: `committeeReadersAmong()`, the
 *   committee read rule `loadDecision()` applies first (ACC-282).
 * Draft (the requester's own stage, by design) and Under review (decided by the
 * chain, not the pool) are left whole. Batched: one request read, then one
 * readers read per committee.
 */
const changeRequestReviewDeciders: StageDeciderFilter = async (client, organizationId, entries, now) => {
  const out = new Map<string, string[]>();
  const review = entries.filter((e) => isReviewStage(e.stage));
  if (review.length === 0) return out;
  const requests = await client.committeeChangeRequest.findMany({
    where: { id: { in: [...new Set(review.map((e) => e.instance.objectId))] }, organizationId },
    select: { id: true, requestedById: true, committeeId: true },
  });
  const requestById = new Map(requests.map((r) => [r.id, r]));
  const candidatesByCommittee = new Map<string, Set<string>>();
  for (const e of review) {
    const request = requestById.get(e.instance.objectId);
    if (!request) continue;
    const set = candidatesByCommittee.get(request.committeeId) ?? new Set<string>();
    for (const m of e.members) if (m !== request.requestedById) set.add(m);
    candidatesByCommittee.set(request.committeeId, set);
  }
  const readersByCommittee = new Map<string, Set<string>>();
  for (const [committeeId, people] of candidatesByCommittee) {
    readersByCommittee.set(committeeId, await committeeReadersAmong(client, committeeId, organizationId, [...people], now));
  }
  for (const e of review) {
    const request = requestById.get(e.instance.objectId);
    // A request this organisation cannot find: nobody can decide it.
    if (!request) {
      out.set(e.key, []);
      continue;
    }
    const readers = readersByCommittee.get(request.committeeId) ?? new Set<string>();
    out.set(
      e.key,
      e.members.filter((m) => m !== request.requestedById && readers.has(m)),
    );
  }
  return out;
};

export const STAGE_DECIDER_FILTERS: Partial<Record<WorkflowObjectType, StageDeciderFilter>> = {
  COMMITTEE_CHANGE_REQUEST: changeRequestReviewDeciders,
};

/**
 * The deciders of each entry, keyed by `key`: the pool's members, narrowed by
 * the record type's filter where one is registered (fail open otherwise). One
 * call per organisation and record type that has a filter; none for the rest.
 */
export async function stageDeciders(client: DeciderClient, entries: readonly StageDeciderEntry[], now: Date): Promise<Map<string, string[]>> {
  const out = new Map(entries.map((e) => [e.key, [...e.members]]));
  const groups = new Map<string, { organizationId: string; filter: StageDeciderFilter; entries: StageDeciderEntry[] }>();
  for (const e of entries) {
    const filter = STAGE_DECIDER_FILTERS[e.instance.objectType];
    if (!filter || e.members.length === 0) continue;
    const id = `${e.organizationId}:${e.instance.objectType}`;
    const group = groups.get(id) ?? { organizationId: e.organizationId, filter, entries: [] };
    group.entries.push(e);
    groups.set(id, group);
  }
  for (const { organizationId, filter, entries: group } of groups.values()) {
    for (const [key, deciders] of await filter(client, organizationId, group, now)) out.set(key, deciders);
  }
  return out;
}
