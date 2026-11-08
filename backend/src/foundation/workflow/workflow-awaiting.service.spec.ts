import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StagePool, StagePoolService } from './stage-pool.service';
import { AWAITING_ME_CANDIDATE_CAP, AWAITING_ME_ROWS, WorkflowAwaitingService } from './workflow-awaiting.service';

// ACC-271 — the records waiting on the viewer, for Home's "Awaiting my action".
// Each gate is pinned on its own; the real database proof is
// workflow-awaiting.db-spec.ts.

const ORG = 'org-a';
const VIEWER = 'viewer';
const VIEW = ['committees:view'];

type Move = { kind: 'ADVANCE' | 'RETURN' | 'EXIT'; mover: 'PERSON' | 'APP' | null; toStageId: string };
const DECIDE: Move[] = [
  { kind: 'ADVANCE', mover: 'PERSON', toStageId: 'stage-active' },
  { kind: 'RETURN', mover: 'PERSON', toStageId: 'stage-formation' },
];

interface EntryOver {
  id?: string;
  committeeId?: string;
  whoMode?: string | null;
  moves?: Move[];
  enteredAt?: Date;
  current?: boolean;
  objectType?: string;
}

let n = 0;
function entry(over: EntryOver = {}) {
  const id = over.id ?? `entry-${++n}`;
  const stageId = `stage-${id}`;
  return {
    id,
    enteredAt: over.enteredAt ?? new Date(Date.UTC(2026, 9, 1, 8, n)),
    stageId,
    workflowInstance: {
      id: `instance-${id}`,
      objectType: over.objectType ?? 'COMMITTEE',
      objectId: over.committeeId ?? `committee-${id}`,
      currentStageId: over.current === false ? 'elsewhere' : stageId,
    },
    stage: {
      id: stageId,
      nameEn: 'Terms Review',
      nameAr: 'مراجعة الشروط',
      whoMode: over.whoMode === undefined ? 'ANY_ONE' : over.whoMode,
      transitionsFrom: over.moves ?? DECIDE,
      workflowTemplate: { stages: [{ id: 'stage-formation' }, { id: stageId }, { id: 'stage-active' }, { id: 'stage-dissolved' }] },
    },
  };
}

const pool = (members: string[], direct: string[] = members): StagePool => ({
  members,
  direct,
  coveringFor: new Map(),
  actingHeadOf: new Map(),
  voteCommitteeId: null,
});

function setup(entries: ReturnType<typeof entry>[], pools: Record<string, StagePool> = {}, voted: string[] = [], memberOf: string[] = []) {
  const prisma = {
    // ACC-281 — the committees the viewer is an active member of (read only without committees:view).
    committeeMember: {
      findMany: jest.fn(async ({ where }: { where: { committeeId?: { in: string[] } } }) =>
        memberOf.filter((id) => !where.committeeId || where.committeeId.in.includes(id)).map((committeeId) => ({ committeeId })),
      ),
    },
    workflowInstanceStage: { findMany: jest.fn(async () => entries) },
    workflowApproval: { findMany: jest.fn(async () => voted.map((workflowInstanceStageId) => ({ workflowInstanceStageId }))) },
    committee: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, nameEn: `Name of ${id}`, nameAr: null })),
      ),
    },
    meeting: { findMany: jest.fn(async () => []) },
  };
  const stagePool = {
    resolveMany: jest.fn(async (_org: string, requests: { key: string }[]) => new Map(requests.map((r) => [r.key, pools[r.key] ?? pool([VIEWER])]))),
  };
  const service = new WorkflowAwaitingService(prisma as unknown as PrismaService, stagePool as unknown as StagePoolService);
  return { service, prisma, stagePool };
}

describe('WorkflowAwaitingService (ACC-271)', () => {
  it('a pool member sees a committee in Terms Review, named, at its place among the stages', async () => {
    const e = entry({ id: 'e1' });
    const { service } = setup([e]);

    const result = await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      {
        instanceStageId: 'e1',
        record: { type: 'COMMITTEE', id: 'committee-e1', nameEn: 'Name of committee-e1', nameAr: null },
        stage: { id: 'stage-e1', nameEn: 'Terms Review', nameAr: 'مراجعة الشروط', position: 2, stageCount: 4 },
        since: e.enteredAt,
      },
    ]);
  });

  it('asks the database only for open entries on running instances, converted non-final stages, in the organisation, of types the viewer sees', async () => {
    const { service, prisma } = setup([]);

    await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(prisma.workflowInstanceStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          exitedAt: null,
          workflowInstance: { organizationId: ORG, status: 'IN_PROGRESS', OR: [{ objectType: { in: ['COMMITTEE', 'COMMITTEE_CHANGE_REQUEST'] } }] },
          stage: { whoMode: { not: null }, isFinal: false, workflowTemplate: { organizationId: ORG } },
        },
        orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
        // ACC-281 — the hard cap on what is read.
        take: AWAITING_ME_CANDIDATE_CAP,
      }),
    );
  });

  it('not a stage with no person RETURN or EXIT (an Active committee), nor one whose moves are all APP', async () => {
    const active = entry({
      moves: [
        { kind: 'ADVANCE', mover: 'PERSON', toStageId: 'stage-suspended' },
        { kind: 'ADVANCE', mover: 'PERSON', toStageId: 'stage-dissolution' },
      ],
    });
    const appOnly = entry({
      moves: [
        { kind: 'ADVANCE', mover: 'APP', toStageId: 'stage-approved' },
        { kind: 'RETURN', mover: 'APP', toStageId: 'stage-returned' },
      ],
    });
    const { service, stagePool } = setup([active, appOnly]);

    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [], oldestSince: null });
    expect(stagePool.resolveMany).not.toHaveBeenCalled();
  });

  // Ahmad, 4 Nov — cancelling is not an approval, so an EXIT is not the way
  // back: a meeting in Planned (Confirm agenda, Cancel meeting) is not listed.
  it('not a stage whose only way out besides ADVANCE is an EXIT', async () => {
    const planned = entry({ moves: [DECIDE[0]!, { kind: 'EXIT', mover: 'PERSON', toStageId: 'stage-cancelled' }] });
    const { service, stagePool } = setup([planned]);

    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [], oldestSince: null });
    expect(stagePool.resolveMany).not.toHaveBeenCalled();
  });

  // A return to the SAME stage (a meeting's Minutes draft, "Revise draft") is
  // not a way back either.
  it('not a stage whose only RETURN loops back to itself', async () => {
    const looped = entry({
      id: 'draft',
      moves: [DECIDE[0]!, { kind: 'RETURN', mover: 'PERSON', toStageId: 'stage-draft' }],
    });
    const { service } = setup([looped]);
    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [], oldestSince: null });
  });

  it('a person RETURN to a different stage makes it a decision point, beside an EXIT', async () => {
    const minutesReview = entry({
      moves: [...DECIDE, { kind: 'EXIT', mover: 'PERSON', toStageId: 'stage-cancelled' }],
    });
    const { service } = setup([minutesReview]);
    expect((await service.awaitingMe(ORG, VIEWER, VIEW)).total).toBe(1);
  });

  // ACC-271 PR 6b — a stage with no `who` is left out twice: by the query, and
  // by its pool, which StagePoolService answers empty (fail closed, PR 6a).
  it('not a stage with no `who`, nor an open entry that is not the instance\'s current stage', async () => {
    const { service, prisma } = setup([entry({ id: 'no-who', whoMode: null }), entry({ current: false })], { 'no-who': pool([]) });
    expect((await service.awaitingMe(ORG, VIEWER, VIEW)).total).toBe(0);
    expect(prisma.workflowInstanceStage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stage: expect.objectContaining({ whoMode: { not: null } }) }) }),
    );
  });

  it('not a stage the viewer is not in the pool of, nor one whose pool is empty', async () => {
    const other = entry({ id: 'other' });
    const empty = entry({ id: 'empty' });
    const { service } = setup([other, empty], { other: pool(['someone-else']), empty: pool([]) });
    expect((await service.awaitingMe(ORG, VIEWER, VIEW)).total).toBe(0);
  });

  it('the acting user sees it for someone away; the absent person, still named directly, does not', async () => {
    const e = entry({ id: 'away' });
    const covered = pool(['acting'], ['absent']);
    const { service } = setup([e], { away: covered });

    expect((await service.awaitingMe(ORG, 'acting', VIEW)).total).toBe(1);
    expect((await service.awaitingMe(ORG, 'absent', VIEW)).total).toBe(0);
  });

  it('on an "All of them" or Committee vote stage, not an entry the viewer already decided; on "Any one", the vote is not even read', async () => {
    const all = entry({ id: 'all', whoMode: 'ALL' });
    const vote = entry({ id: 'vote', whoMode: 'COMMITTEE_VOTE' });
    const open = entry({ id: 'open', whoMode: 'ALL' });
    const anyOne = entry({ id: 'any' });
    const { service, prisma } = setup([all, vote, open, anyOne], {}, ['all', 'vote']);

    const result = await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(result.rows.map((r) => r.instanceStageId)).toEqual(['open', 'any']);
    expect(prisma.workflowApproval.findMany).toHaveBeenCalledWith({
      where: {
        approverId: VIEWER,
        decision: { not: 'PENDING' },
        workflowInstanceStageId: { in: ['all', 'vote', 'open'] },
        workflowInstanceStage: { workflowInstance: { organizationId: ORG } },
      },
      select: { workflowInstanceStageId: true },
    });
  });

  it('someone without committees:view who is on no committee sees nothing; only the membership is read', async () => {
    const { service, prisma } = setup([entry()]);

    expect(await service.awaitingMe(ORG, VIEWER, ['users:view'])).toEqual({ total: 0, rows: [], oldestSince: null });
    expect(prisma.committeeMember.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.workflowInstanceStage.findMany).not.toHaveBeenCalled();
  });

  // ACC-281 (Ahmad, Q7) — a member without committees:view is shown the committee
  // stages that wait on them, for the committees they sit on, and names them.
  describe('a member without committees:view (ACC-281)', () => {
    it('reads committee entries for their own committees only, and names them', async () => {
      const { service, prisma } = setup([entry({ id: 'e1', committeeId: 'cmt-1' })], {}, [], ['cmt-1']);

      const result = await service.awaitingMe(ORG, VIEWER, []);

      const where = (prisma.workflowInstanceStage.findMany.mock.calls[0] as unknown as [{ where: { workflowInstance: unknown } }])[0].where.workflowInstance;
      expect(where).toEqual({ organizationId: ORG, status: 'IN_PROGRESS', OR: [{ objectType: 'COMMITTEE', objectId: { in: ['cmt-1'] } }] });
      expect(result.total).toBe(1);
      expect(result.rows[0]!.record.nameEn).toBe('Name of cmt-1');
    });

    it('a holder of committees:view reads no membership', async () => {
      const { service, prisma } = setup([entry()]);
      await service.awaitingMe(ORG, VIEWER, VIEW);
      expect(prisma.committeeMember.findMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('awaiting-me membership', async () => {
      const { service, prisma } = setup([], {}, [], ['cmt-1']);
      await service.awaitingMe('org-b', VIEWER, []);
      const where = (prisma.committeeMember.findMany.mock.calls[0] as unknown as [{ where: { organizationId: string; committee: { organizationId: string } } }])[0].where;
      expect(where.organizationId).toBe('org-b');
      expect(where.committee.organizationId).toBe('org-b');
    });
  });

  // ACC-281 — ?skip=&take=: today's answer with neither; the total and oldestSince
  // always over everything waiting.
  describe('paging (ACC-281)', () => {
    const seven = () => Array.from({ length: 7 }, (_, i) => entry({ id: `e${i}`, enteredAt: new Date(Date.UTC(2026, 9, 1 + i)) }));

    it('no page: exactly the oldest five, the total and oldestSince', async () => {
      const { service } = setup(seven());
      const result = await service.awaitingMe(ORG, VIEWER, VIEW);
      expect(result.rows.map((r) => r.instanceStageId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
      expect(result.total).toBe(7);
      expect(result.oldestSince).toEqual(new Date(Date.UTC(2026, 9, 1)));
    });

    it('skip and take page the same order; total and oldestSince do not move', async () => {
      const { service } = setup(seven());
      const page2 = await service.awaitingMe(ORG, VIEWER, VIEW, { skip: 3, take: 3 });
      expect(page2.rows.map((r) => r.instanceStageId)).toEqual(['e3', 'e4', 'e5']);
      expect(page2.total).toBe(7);
      expect(page2.oldestSince).toEqual(new Date(Date.UTC(2026, 9, 1)));
    });

    it('skip alone pages by five; past the end is an empty page with the same total', async () => {
      const { service } = setup(seven());
      expect((await service.awaitingMe(ORG, VIEWER, VIEW, { skip: 5 })).rows.map((r) => r.instanceStageId)).toEqual(['e5', 'e6']);
      const past = await service.awaitingMe(ORG, VIEWER, VIEW, { skip: 50, take: 10 });
      expect(past.rows).toEqual([]);
      expect(past.total).toBe(7);
    });
  });

  it('a record it cannot name is left out (fail closed)', async () => {
    const gone = entry({ id: 'gone' });
    const { service, prisma } = setup([gone]);
    prisma.committee.findMany.mockResolvedValueOnce([]);
    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [], oldestSince: null });
  });

  it('oldest first; total counts past five while rows stop at five', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => entry({ id: `e${i}`, enteredAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const { service } = setup(entries);

    const result = await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(AWAITING_ME_ROWS);
    expect(result.rows.map((r) => r.instanceStageId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
  });

  // ACC-279 — Home's "oldest 3 days" reads oldestSince, never rows[0].
  it('oldestSince is the oldest waiting entry, whatever the cap', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => entry({ id: `e${i}`, enteredAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const { service } = setup(entries);

    const result = await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(result.oldestSince).toEqual(new Date(Date.UTC(2026, 9, 1)));
  });

  it('batched: one candidates query, one resolveMany, one approvals query and one names read, for any number of rows', async () => {
    const entries = Array.from({ length: 9 }, (_, i) => entry({ id: `b${i}`, whoMode: 'ALL' }));
    const { service, prisma, stagePool } = setup(entries);

    await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(prisma.workflowInstanceStage.findMany).toHaveBeenCalledTimes(1);
    expect(stagePool.resolveMany).toHaveBeenCalledTimes(1);
    expect((stagePool.resolveMany.mock.calls[0] as unknown[])[1]).toHaveLength(9);
    expect(prisma.workflowApproval.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.committee.findMany).toHaveBeenCalledTimes(1);
  });

  itEnforcesTenantIsolation("WorkflowAwaitingService — entries, pools, votes and names are read in the caller's organisation only", async () => {
    const { service, prisma, stagePool } = setup([entry({ id: 'iso', whoMode: 'ALL' })]);

    await service.awaitingMe(ORG, VIEWER, VIEW);

    const where = (prisma.workflowInstanceStage.findMany.mock.calls[0] as unknown as [{ where: { workflowInstance: { organizationId: string }; stage: { workflowTemplate: { organizationId: string } } } }])[0].where;
    expect(where.workflowInstance.organizationId).toBe(ORG);
    expect(where.stage.workflowTemplate.organizationId).toBe(ORG);
    expect((stagePool.resolveMany.mock.calls[0] as unknown[])[0]).toBe(ORG);
    expect(prisma.workflowApproval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ workflowInstanceStage: { workflowInstance: { organizationId: ORG } } }) }),
    );
    expect(prisma.committee.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) }));
  });
});
