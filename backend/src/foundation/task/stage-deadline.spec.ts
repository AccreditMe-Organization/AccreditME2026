import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { lockWorkflowInstance, moveStageDeadlineForTaskInTx } from './stage-deadline';

// ACC-190 — the stage's deadline is never before a MANDATORY stage task's due
// date: an approved extension or hold that moves one past it moves the
// deadline out (Ahmad, 6 Oct; 9 Oct E).

const ORG = 'org-a';
const NOW = new Date('2026-10-09T10:00:00Z');
const DEADLINE = new Date('2026-10-12T16:00:00Z');
const LATER = new Date('2026-10-14T16:00:00Z');

const tx = () => ({
  workflowInstanceStage: {
    findFirst: jest.fn().mockResolvedValue({ id: 'entry-1', slaDueAt: DEADLINE }),
    update: jest.fn().mockResolvedValue({}),
  },
  $queryRaw: jest.fn(),
});
const task = (over: Record<string, unknown> = {}) => ({
  isMandatory: true,
  workflowInstanceStageId: 'entry-1' as string | null,
  dueAt: LATER as Date | null,
  ...over,
});

describe('moveStageDeadlineForTaskInTx (ACC-190)', () => {
  it("moves the open entry's deadline out to a mandatory task's new due date", async () => {
    const client = tx();
    const move = await moveStageDeadlineForTaskInTx(client as never, task(), ORG, NOW);

    expect(move).toEqual({ workflowInstanceStageId: 'entry-1', from: DEADLINE, to: LATER });
    expect(client.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'entry-1' },
      // A deadline moved into the future is judged afresh by the breach sweep.
      data: { slaDueAt: LATER, slaBreached: false, escalatedRuleIndexes: [] },
    });
  });

  it('only ever reads the OPEN entry, in the tenant', async () => {
    const client = tx();
    await moveStageDeadlineForTaskInTx(client as never, task(), ORG, NOW);
    expect(client.workflowInstanceStage.findFirst).toHaveBeenCalledWith({
      where: { id: 'entry-1', exitedAt: null, workflowInstance: { organizationId: ORG } },
      select: { id: true, slaDueAt: true },
    });
  });

  it.each([
    ['an OPTIONAL task — it never holds its stage', { isMandatory: false }],
    ['a task with no stage entry (manual, or before ACC-190)', { workflowInstanceStageId: null }],
    ['a due date still inside the deadline', { dueAt: new Date('2026-10-11T16:00:00Z') }],
    ['a due date exactly at the deadline', { dueAt: DEADLINE }],
  ])('leaves the deadline alone for %s', async (_label, over) => {
    const client = tx();
    expect(await moveStageDeadlineForTaskInTx(client as never, task(over), ORG, NOW)).toBeNull();
    expect(client.workflowInstanceStage.update).not.toHaveBeenCalled();
  });

  it('leaves alone a stage with no deadline (nothing to break, 9 Oct D), and an entry already left', async () => {
    for (const entry of [{ id: 'entry-1', slaDueAt: null }, null]) {
      const client = tx();
      client.workflowInstanceStage.findFirst.mockResolvedValue(entry);
      expect(await moveStageDeadlineForTaskInTx(client as never, task(), ORG, NOW)).toBeNull();
      expect(client.workflowInstanceStage.update).not.toHaveBeenCalled();
    }
  });

  itEnforcesTenantIsolation('the stage entry whose deadline a task may move', async () => {
    const client = tx();
    client.workflowInstanceStage.findFirst.mockImplementation(({ where }: { where: { workflowInstance: { organizationId: string } } }) =>
      Promise.resolve(where.workflowInstance.organizationId === ORG ? { id: 'entry-1', slaDueAt: DEADLINE } : null),
    );
    expect(await moveStageDeadlineForTaskInTx(client as never, task(), 'org-b', NOW)).toBeNull();
    expect(client.workflowInstanceStage.update).not.toHaveBeenCalled();
  });

  it('locks the workflow instance by id AND tenant', async () => {
    const client = tx();
    await lockWorkflowInstance(client as never, 'instance-1', ORG);
    const [strings, ...values] = client.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...string[]];
    expect(strings.join('?')).toBe('SELECT id FROM "WorkflowInstance" WHERE id = ? AND "organizationId" = ? FOR UPDATE');
    expect(values).toEqual(['instance-1', ORG]);
  });
});
