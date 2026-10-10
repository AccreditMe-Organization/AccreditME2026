import { readFileSync } from 'fs';
import { join } from 'path';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CREATE_TASK_PAIRS, KIND_PAIRS, planOrg } from '../../../prisma/backfill-acc190-stage-tasks';

// ACC-190 — backfill-acc190-stage-tasks.ts: what its dry run plans. The
// execute path re-runs this same planning inside each tenant's transaction and
// refuses on any difference, so the plan IS what gets written.

const ORG = { id: 'org-a', slug: 'al-nakheel', customer: false };

const transition = (
  objectType: string,
  from: string,
  to: string,
  over: { id?: string; kind?: string; label?: string; actions?: unknown[] } = {},
) => ({
  id: over.id ?? `${from}->${to}`,
  labelEn: over.label ?? 'Label',
  kind: over.kind ?? 'ADVANCE',
  toStageId: `stage:${to}`,
  fromStage: { nameEn: from, workflowTemplate: { objectType } },
  toStage: { nameEn: to },
  actions: over.actions ?? [],
});
const createTask = (id: string, logs: { id: string; workflowInstanceId: string }[] = []) => ({
  id,
  actionLogs: logs.map((l) => ({ ...l, status: 'SUCCESS', executedAt: new Date('2026-09-01T10:00:00Z') })),
});

function client(transitions: unknown[], tasks: unknown[] = []) {
  return {
    workflowTransition: { findMany: jest.fn().mockResolvedValue(transitions) },
    task: { findMany: jest.fn().mockResolvedValue(tasks) },
  };
}

describe('backfill-acc190-stage-tasks — the plan (ACC-190)', () => {
  it('knows the 26 seeded CREATE_TASK transitions and the 22 seeded RETURN/EXIT transitions, by stage NAME', () => {
    expect(CREATE_TASK_PAIRS).toHaveLength(26);
    expect(KIND_PAIRS).toHaveLength(22);
    expect(CREATE_TASK_PAIRS).toContainEqual({ objectType: 'COMMITTEE', fromName: 'Formation', toName: 'Terms Review' });
    expect(KIND_PAIRS).toContainEqual(expect.objectContaining({ objectType: 'COMMITTEE', fromName: 'Terms Review', toName: 'Formation', kind: 'RETURN' }));
  });

  it('plans to DELETE a seeded CREATE_TASK action, its log rows first, and lists the tasks it made — which stay', async () => {
    const prisma = client(
      [transition('COMMITTEE', 'Formation', 'Terms Review', { actions: [createTask('action-1', [{ id: 'log-1', workflowInstanceId: 'instance-1' }])] })],
      [{ id: 'task-old', title: 'Submit for Approval — Quality Committee', status: 'CANCELLED', createdAt: new Date() }],
    );

    const plan = await planOrg(prisma as never, ORG);

    expect(plan.deleteActions).toEqual([
      expect.objectContaining({ actionId: 'action-1', from: 'Formation', to: 'Terms Review', logs: [expect.objectContaining({ id: 'log-1' })] }),
    ]);
    expect(plan.tasksThatStay.map((t) => t.id)).toEqual(['task-old']);
    // The tasks it made: the logged instances, at the stage the action led to,
    // with no stage entry (a stage-definition task always has one).
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-a', workflowInstanceId: { in: ['instance-1'] }, sourceStageId: 'stage:Terms Review', workflowInstanceStageId: null },
      }),
    );
  });

  it('only REPORTS a CREATE_TASK the seed never placed', async () => {
    const plan = await planOrg(
      client([transition('COMMITTEE', 'Active', 'Suspended', { label: 'Suspend', actions: [createTask('action-x')] })]) as never,
      ORG,
    );
    expect(plan.deleteActions).toEqual([]);
    expect(plan.reportOnlyActions).toEqual([expect.objectContaining({ actionId: 'action-x', from: 'Active', to: 'Suspended' })]);
  });

  it('sets a seeded return transition\'s kind, counts one already set, and reports one whose stages were renamed', async () => {
    const plan = await planOrg(
      client([
        transition('COMMITTEE', 'Terms Review', 'Formation', { kind: 'ADVANCE', label: 'Revise Terms' }),
        transition('MEETING', 'Minutes Review', 'Minutes Draft', { kind: 'RETURN' }),
      ]) as never,
      ORG,
    );
    expect(plan.setKinds).toEqual([
      expect.objectContaining({ objectType: 'COMMITTEE', from: 'Terms Review', to: 'Formation', before: 'ADVANCE', after: 'RETURN' }),
    ]);
    expect(plan.kindsAlreadySet).toBe(1);
    // Every other seeded RETURN/EXIT pair is absent from this fake tenant —
    // reported for a person to set by hand, never guessed.
    expect(plan.unmatchedKinds).toHaveLength(KIND_PAIRS.length - 2);
  });

  itEnforcesTenantIsolation('workflow transitions and tasks read by the ACC-190 backfill', async () => {
    const prisma = client([
      transition('COMMITTEE', 'Formation', 'Terms Review', { actions: [createTask('action-1', [{ id: 'log-1', workflowInstanceId: 'instance-1' }])] }),
    ]);
    await planOrg(prisma as never, { id: 'org-b', slug: 'other', customer: false });
    expect(prisma.workflowTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fromStage: { workflowTemplate: { organizationId: 'org-b' } } } }),
    );
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-b' }) }));
  });

  // "Tasks those actions already created stay untouched" (Ahmad, 9 Oct, B):
  // the script has no write to the Task table at all — pinned by reading it.
  it('never writes the Task table', () => {
    const source = readFileSync(join(__dirname, '../../../prisma/backfill-acc190-stage-tasks.ts'), 'utf8');
    expect(source).not.toMatch(/\.task\.(update|updateMany|delete|deleteMany|create|createMany|upsert)\(/);
  });

  // A customer tenant is never changed by this script (ACC-101): --execute refuses.
  it('marks a non-fixture tenant as a customer, which --execute refuses', () => {
    const source = readFileSync(join(__dirname, '../../../prisma/backfill-acc190-stage-tasks.ts'), 'utf8');
    expect(source).toContain("customer: !FIXTURE_SLUGS.has(org.slug)");
    expect(source).toMatch(/REFUSED:/);
  });
});
