import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StagePool, StagePoolService } from './stage-pool.service';
import { AWAITING_ME_ROWS, WorkflowAwaitingService } from './workflow-awaiting.service';

// ACC-271 — the records waiting on the viewer, for Home's "Awaiting my action".
// Each gate is pinned on its own; the real database proof is
// workflow-awaiting.db-spec.ts.

const ORG = 'org-a';
const VIEWER = 'viewer';
const VIEW = ['committees:view'];

type Move = { kind: 'ADVANCE' | 'RETURN' | 'EXIT'; mover: 'PERSON' | 'APP' | null; triggerCondition: string };
const DECIDE: Move[] = [
  { kind: 'ADVANCE', mover: 'PERSON', triggerCondition: 'ROLE_BASED' },
  { kind: 'RETURN', mover: 'PERSON', triggerCondition: 'ROLE_BASED' },
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

function setup(entries: ReturnType<typeof entry>[], pools: Record<string, StagePool> = {}, voted: string[] = []) {
  const prisma = {
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
          workflowInstance: { organizationId: ORG, status: 'IN_PROGRESS', objectType: { in: ['COMMITTEE', 'COMMITTEE_CHANGE_REQUEST'] } },
          stage: { whoMode: { not: null }, isFinal: false, workflowTemplate: { organizationId: ORG } },
        },
        orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('not a stage with no person RETURN or EXIT (an Active committee), nor one whose moves are all APP', async () => {
    const active = entry({ moves: [{ kind: 'ADVANCE', mover: 'PERSON', triggerCondition: 'ROLE_BASED' }, { kind: 'ADVANCE', mover: null, triggerCondition: 'ROLE_BASED' }] });
    const appOnly = entry({
      moves: [
        { kind: 'ADVANCE', mover: 'APP', triggerCondition: 'SYSTEM_AUTOMATIC' },
        { kind: 'RETURN', mover: null, triggerCondition: 'SYSTEM_AUTOMATIC' },
      ],
    });
    const { service, stagePool } = setup([active, appOnly]);

    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [] });
    expect(stagePool.resolveMany).not.toHaveBeenCalled();
  });

  it('an EXIT made by a person counts as the way back', async () => {
    const { service } = setup([entry({ moves: [DECIDE[0]!, { kind: 'EXIT', mover: 'PERSON', triggerCondition: 'ROLE_BASED' }] })]);
    expect((await service.awaitingMe(ORG, VIEWER, VIEW)).total).toBe(1);
  });

  it('not an unconverted stage, nor an open entry that is not the instance\'s current stage', async () => {
    const { service } = setup([entry({ whoMode: null }), entry({ current: false })]);
    expect((await service.awaitingMe(ORG, VIEWER, VIEW)).total).toBe(0);
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

  it('someone without committees:view sees nothing, and nothing is read', async () => {
    const { service, prisma } = setup([entry()]);

    expect(await service.awaitingMe(ORG, VIEWER, ['users:view'])).toEqual({ total: 0, rows: [] });
    expect(prisma.workflowInstanceStage.findMany).not.toHaveBeenCalled();
  });

  it('a record it cannot name is left out (fail closed)', async () => {
    const gone = entry({ id: 'gone' });
    const { service, prisma } = setup([gone]);
    prisma.committee.findMany.mockResolvedValueOnce([]);
    expect(await service.awaitingMe(ORG, VIEWER, VIEW)).toEqual({ total: 0, rows: [] });
  });

  it('oldest first; total counts past five while rows stop at five', async () => {
    const entries = Array.from({ length: 7 }, (_, i) => entry({ id: `e${i}`, enteredAt: new Date(Date.UTC(2026, 9, 1 + i)) }));
    const { service } = setup(entries);

    const result = await service.awaitingMe(ORG, VIEWER, VIEW);

    expect(result.total).toBe(7);
    expect(result.rows).toHaveLength(AWAITING_ME_ROWS);
    expect(result.rows.map((r) => r.instanceStageId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4']);
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
