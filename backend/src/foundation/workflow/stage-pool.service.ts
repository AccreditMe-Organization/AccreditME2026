import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { WorkflowObjectType, WorkflowStageAssignee } from '../../../generated/prisma/client';
import { findCurrentHeadHoldersForUnits, findRunningActingCoversForUnits } from '../organization/unit-headship';
import { RECORD_ROUTES } from './stage-task-record-routes';

/**
 * ACC-271 — who works a converted stage (plan §4.1). A stage's pool is the
 * union of its assignee entries ("or"), each resolved to ACTIVE users at READ
 * time and never stored (ACC-167's rule: a stored membership would need a
 * recomputer), then routed through out-of-office acting users.
 *
 * BATCHED (Ahmad's performance rule, 28 Oct): `resolveMany()` answers any
 * number of (stage, record) pairs with one query per kind — the entries, the
 * records' units and committees, the creators, the position holders, the unit
 * heads and covers, the committee members, and one users read for status and
 * absence — never one per stage or per row. Independent reads go through
 * Promise.all. Nothing here runs on the per-request guard path.
 *
 * | Kind             | Resolves to                                              |
 * |------------------|----------------------------------------------------------|
 * | SPECIFIC_USER    | that user                                                |
 * | POSITION_IN_UNIT | the holder rule: the position, in that unit as primary    |
 * | ORG_UNIT_HEAD    | the unit's head holders and its acting cover in force;   |
 * |                  | no unit = the record's unit (RECORD_ROUTES, fail closed) |
 * | CREATOR          | whoever moved the record into its first stage            |
 * | COMMITTEE        | the committee's active members, in the role if one is    |
 * |                  | set; no committee = the record's committee               |
 *
 * Every kind ends in the same ACTIVE filter, so a deactivated committee member
 * is out of the pool (plan gap 4). A unit head is read from the period table,
 * never the `actingHeadUserId` cache, and with no walk up to a parent unit (Q3).
 */

/** One (stage, record) pair to resolve. `key` finds the answer in the map. */
export interface StagePoolRequest {
  key: string;
  stageId: string;
  instance: { id: string; objectType: WorkflowObjectType; objectId: string };
}

export interface StagePool {
  /** Who may act now: the ACTIVE people, each absent one replaced by their acting user. */
  members: string[];
  /** The ACTIVE people the entries name, before out-of-office routing. */
  direct: string[];
  /** acting user → the absent member they stand in for (the delegation stamp). */
  coveringFor: Map<string, string>;
  /** acting head who holds no head position there → the unit they cover. */
  actingHeadOf: Map<string, string>;
  /** The committee a COMMITTEE entry resolved to (the first one): what a Committee vote counts against. */
  voteCommitteeId: string | null;
}

type PoolClient = Pick<
  PrismaService,
  'workflowStageAssignee' | 'workflowInstanceStage' | 'user' | 'orgUnitHeadAssignment' | 'committeeMember' | 'committee' | 'meeting'
>;

type RouteKind = 'unitsOf' | 'committeesOf';

const recordKey = (objectType: string, objectId: string): string => `${objectType}:${objectId}`;
const pairKey = (positionId: string, orgUnitId: string): string => `${positionId}|${orgUnitId}`;

const EMPTY_POOL: StagePool = {
  members: [],
  direct: [],
  coveringFor: new Map(),
  actingHeadOf: new Map(),
  voteCommitteeId: null,
};

@Injectable()
export class StagePoolService {
  constructor(private readonly prisma: PrismaService) {}

  /** One stage's pool for one record. */
  async resolve(
    organizationId: string,
    stageId: string,
    instance: StagePoolRequest['instance'],
    client: PoolClient = this.prisma,
  ): Promise<StagePool> {
    const pools = await this.resolveMany(organizationId, [{ key: 'one', stageId, instance }], client);
    return pools.get('one') ?? EMPTY_POOL;
  }

  /**
   * Many pools at once, all in one organisation. Every request gets an answer;
   * a stage with no entries gets the empty pool.
   */
  async resolveMany(
    organizationId: string,
    requests: StagePoolRequest[],
    client: PoolClient = this.prisma,
    now: Date = new Date(),
  ): Promise<Map<string, StagePool>> {
    const pools = new Map<string, StagePool>();
    if (requests.length === 0) return pools;

    const stageIds = [...new Set(requests.map((r) => r.stageId))];
    const entries = await client.workflowStageAssignee.findMany({
      where: { organizationId, stageId: { in: stageIds } },
      orderBy: [{ stageId: 'asc' }, { order: 'asc' }],
    });
    const entriesByStage = new Map<string, WorkflowStageAssignee[]>();
    for (const entry of entries) {
      const list = entriesByStage.get(entry.stageId) ?? [];
      list.push(entry);
      entriesByStage.set(entry.stageId, list);
    }

    // ── What the entries leave to the record: its unit, its committee, its creator.
    const needUnit = new Map<WorkflowObjectType, Set<string>>();
    const needCommittee = new Map<WorkflowObjectType, Set<string>>();
    const needCreator = new Set<string>();
    const add = (map: Map<WorkflowObjectType, Set<string>>, type: WorkflowObjectType, id: string): void => {
      const set = map.get(type) ?? new Set<string>();
      set.add(id);
      map.set(type, set);
    };
    for (const request of requests) {
      for (const entry of entriesByStage.get(request.stageId) ?? []) {
        if (entry.kind === 'ORG_UNIT_HEAD' && !entry.orgUnitId) add(needUnit, request.instance.objectType, request.instance.objectId);
        if (entry.kind === 'COMMITTEE' && !entry.committeeId) add(needCommittee, request.instance.objectType, request.instance.objectId);
        if (entry.kind === 'CREATOR') needCreator.add(request.instance.id);
      }
    }
    const [recordUnits, recordCommittees, creators] = await Promise.all([
      this.recordRefs(client, needUnit, 'unitsOf', organizationId),
      this.recordRefs(client, needCommittee, 'committeesOf', organizationId),
      this.creatorsOf(client, [...needCreator], organizationId),
    ]);

    // ── Each entry's target, now that the record's own are known.
    interface Targets {
      userIds: string[];
      pairs: string[];
      unitIds: string[];
      committees: { committeeId: string; roleValueId: string | null }[];
    }
    const targetsByRequest = new Map<string, Targets>();
    const allPairs = new Map<string, { positionId: string; orgUnitId: string }>();
    const allUnits = new Set<string>();
    const allCommittees = new Set<string>();
    for (const request of requests) {
      const targets: Targets = { userIds: [], pairs: [], unitIds: [], committees: [] };
      const rKey = recordKey(request.instance.objectType, request.instance.objectId);
      for (const entry of entriesByStage.get(request.stageId) ?? []) {
        switch (entry.kind) {
          case 'SPECIFIC_USER':
            if (entry.userId) targets.userIds.push(entry.userId);
            break;
          case 'CREATOR': {
            const creator = creators.get(request.instance.id);
            if (creator) targets.userIds.push(creator);
            break;
          }
          case 'POSITION_IN_UNIT':
            if (entry.positionId && entry.orgUnitId) {
              const key = pairKey(entry.positionId, entry.orgUnitId);
              targets.pairs.push(key);
              allPairs.set(key, { positionId: entry.positionId, orgUnitId: entry.orgUnitId });
            }
            break;
          case 'ORG_UNIT_HEAD': {
            const unitId = entry.orgUnitId ?? recordUnits.get(rKey);
            if (unitId) {
              targets.unitIds.push(unitId);
              allUnits.add(unitId);
            }
            break;
          }
          case 'COMMITTEE': {
            const committeeId = entry.committeeId ?? recordCommittees.get(rKey);
            if (committeeId) {
              targets.committees.push({ committeeId, roleValueId: entry.committeeRoleValueId });
              allCommittees.add(committeeId);
            }
            break;
          }
        }
      }
      targetsByRequest.set(request.key, targets);
    }

    // ── One query per kind, all independent.
    const unitIds = [...allUnits];
    const [positionHolders, headHolders, covers, committeeMembers] = await Promise.all([
      allPairs.size === 0
        ? Promise.resolve([] as { id: string; positionId: string | null; primaryOrgUnitId: string | null }[])
        : client.user.findMany({
            where: {
              organizationId,
              status: 'ACTIVE',
              OR: [...allPairs.values()].map((p) => ({ positionId: p.positionId, primaryOrgUnitId: p.orgUnitId })),
            },
            select: { id: true, positionId: true, primaryOrgUnitId: true },
          }),
      findCurrentHeadHoldersForUnits(client, organizationId, unitIds),
      findRunningActingCoversForUnits(client, organizationId, unitIds, now),
      allCommittees.size === 0
        ? Promise.resolve([] as { committeeId: string; userId: string; roleValueId: string }[])
        : client.committeeMember.findMany({
            where: { organizationId, committeeId: { in: [...allCommittees] }, isActive: true },
            select: { committeeId: true, userId: true, roleValueId: true },
          }),
    ]);

    const holdersByPair = new Map<string, string[]>();
    for (const holder of positionHolders) {
      if (!holder.positionId || !holder.primaryOrgUnitId) continue;
      const key = pairKey(holder.positionId, holder.primaryOrgUnitId);
      holdersByPair.set(key, [...(holdersByPair.get(key) ?? []), holder.id]);
    }

    // ── Each request's people, before the ACTIVE filter.
    const candidatesByRequest = new Map<string, { ids: string[]; actingHeadOf: Map<string, string>; voteCommitteeId: string | null }>();
    const allCandidates = new Set<string>();
    for (const request of requests) {
      const targets = targetsByRequest.get(request.key)!;
      const ids: string[] = [...targets.userIds];
      for (const key of targets.pairs) ids.push(...(holdersByPair.get(key) ?? []));
      const actingHeadOf = new Map<string, string>();
      for (const unitId of targets.unitIds) {
        const holders = (headHolders.get(unitId) ?? []).map((h) => h.id);
        ids.push(...holders);
        const cover = covers.get(unitId);
        if (cover) {
          ids.push(cover.userId);
          if (!holders.includes(cover.userId) && !actingHeadOf.has(cover.userId)) actingHeadOf.set(cover.userId, unitId);
        }
      }
      for (const { committeeId, roleValueId } of targets.committees) {
        for (const m of committeeMembers) {
          if (m.committeeId === committeeId && (!roleValueId || m.roleValueId === roleValueId)) ids.push(m.userId);
        }
      }
      for (const id of ids) allCandidates.add(id);
      candidatesByRequest.set(request.key, {
        ids,
        actingHeadOf,
        voteCommitteeId: targets.committees[0]?.committeeId ?? null,
      });
    }

    // ── One users read: who is ACTIVE, and who is away with someone acting.
    const users =
      allCandidates.size === 0
        ? []
        : await client.user.findMany({
            where: { organizationId, id: { in: [...allCandidates] } },
            select: {
              id: true,
              status: true,
              outOfOfficeFrom: true,
              outOfOfficeTo: true,
              actingUserId: true,
              actingUser: { select: { status: true, organizationId: true } },
            },
          });
    const userById = new Map(users.map((u) => [u.id, u]));

    for (const request of requests) {
      const { ids, actingHeadOf, voteCommitteeId } = candidatesByRequest.get(request.key)!;
      const direct = [...new Set(ids)].filter((id) => userById.get(id)?.status === 'ACTIVE');
      const members: string[] = [];
      const coveringFor = new Map<string, string>();
      for (const id of direct) {
        const user = userById.get(id)!;
        const away = !!user.outOfOfficeFrom && !!user.outOfOfficeTo && user.outOfOfficeFrom <= now && now <= user.outOfOfficeTo;
        const acting =
          away && user.actingUserId && user.actingUser?.status === 'ACTIVE' && user.actingUser.organizationId === organizationId
            ? user.actingUserId
            : null;
        if (acting) {
          if (!members.includes(acting)) members.push(acting);
          if (!direct.includes(acting) && !coveringFor.has(acting)) coveringFor.set(acting, id);
        } else if (!members.includes(id)) {
          members.push(id);
        }
      }
      const activeActingHeads = new Map([...actingHeadOf].filter(([userId]) => direct.includes(userId)));
      pools.set(request.key, { members, direct, coveringFor, actingHeadOf: activeActingHeads, voteCommitteeId });
    }
    return pools;
  }

  /**
   * The committee a Committee vote on this stage counts against, for this
   * record: the stage's COMMITTEE entry's own, or the record's. Read at stage
   * entry for the quorum snapshot (ACC-239), with the other reads.
   */
  async voteCommitteeId(
    organizationId: string,
    stageId: string,
    instance: Pick<StagePoolRequest['instance'], 'objectType' | 'objectId'>,
    client: PoolClient = this.prisma,
  ): Promise<string | null> {
    const entry = await client.workflowStageAssignee.findFirst({
      where: { organizationId, stageId, kind: 'COMMITTEE' },
      orderBy: { order: 'asc' },
      select: { committeeId: true },
    });
    if (!entry) return null;
    if (entry.committeeId) return entry.committeeId;
    const route = RECORD_ROUTES[instance.objectType];
    if (!route) return null;
    return (await route.committeesOf(client, [instance.objectId], organizationId)).get(instance.objectId) ?? null;
  }

  /**
   * ACC-271 decision 7 — the open entries of converted stages whose pool holds
   * `userId` now (directly, or standing in for someone away). Read BEFORE the
   * person is deactivated, so the pools still contain them.
   */
  async openEntriesWithMember(organizationId: string, userId: string, client: PoolClient = this.prisma): Promise<string[]> {
    const open = await client.workflowInstanceStage.findMany({
      where: { exitedAt: null, workflowInstance: { organizationId }, stage: { whoMode: { not: null } } },
      select: { id: true, stageId: true, workflowInstance: { select: { id: true, objectType: true, objectId: true } } },
    });
    if (open.length === 0) return [];
    const pools = await this.resolveMany(
      organizationId,
      open.map((entry) => ({ key: entry.id, stageId: entry.stageId, instance: entry.workflowInstance })),
      client,
    );
    return open
      .filter((entry) => {
        const pool = pools.get(entry.id);
        return !!pool && (pool.direct.includes(userId) || pool.members.includes(userId));
      })
      .map((entry) => entry.id);
  }

  /**
   * ACC-271 decision 7 — "{person} left the stage's pool": one event per open
   * entry, written on the caller's transaction (the deactivation's), so a
   * refused deactivation records nothing.
   */
  async recordPoolMemberLeftInTx(
    tx: Pick<PrismaService, 'workflowInstanceStageEvent'>,
    organizationId: string,
    workflowInstanceStageIds: string[],
    userId: string,
    reason: 'DEACTIVATED',
  ): Promise<void> {
    if (workflowInstanceStageIds.length === 0) return;
    await tx.workflowInstanceStageEvent.createMany({
      data: workflowInstanceStageIds.map((workflowInstanceStageId) => ({
        organizationId,
        workflowInstanceStageId,
        kind: 'POOL_MEMBER_LEFT' as const,
        userId,
        reason,
      })),
    });
  }

  private async recordRefs(
    client: PoolClient,
    needed: Map<WorkflowObjectType, Set<string>>,
    kind: RouteKind,
    organizationId: string,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    // One query per kind of record; a kind with no route resolves to nobody (fail closed).
    const parts = await Promise.all(
      [...needed].map(async ([type, ids]) => {
        const route = RECORD_ROUTES[type];
        if (!route) return [type, new Map<string, string>()] as const;
        return [type, await route[kind](client, [...ids], organizationId)] as const;
      }),
    );
    for (const [type, map] of parts) for (const [objectId, ref] of map) out.set(recordKey(type, objectId), ref);
    return out;
  }

  /** Each instance's first stage entry's actor, in ONE query (today's SELF rule). */
  private async creatorsOf(client: PoolClient, instanceIds: string[], organizationId: string): Promise<Map<string, string>> {
    const creators = new Map<string, string>();
    if (instanceIds.length === 0) return creators;
    const rows = await client.workflowInstanceStage.findMany({
      where: { workflowInstanceId: { in: instanceIds }, workflowInstance: { organizationId } },
      orderBy: { enteredAt: 'asc' },
      select: { workflowInstanceId: true, actorId: true },
    });
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.workflowInstanceId)) continue;
      seen.add(row.workflowInstanceId);
      if (row.actorId) creators.set(row.workflowInstanceId, row.actorId);
    }
    return creators;
  }
}
