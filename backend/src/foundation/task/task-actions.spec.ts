import { TaskActionFacts, taskActionsFor } from './task-actions';

// ACC-228 — each flag restates the refusal of the endpoint it stands for. These
// pin the rule table, one fact at a time, against a baseline where nothing is
// allowed.
const ME = 'viewer-1';

function facts(overrides: Partial<TaskActionFacts> = {}): TaskActionFacts {
  return {
    status: 'PENDING',
    requiresEvidence: false,
    evidenceCount: 0,
    viewerId: ME,
    viewerIsActiveAssignee: false,
    viewerPickedIt: false,
    anyActiveAssignee: true,
    hasPoolTarget: false,
    viewerInPool: false,
    openRequest: null,
    mayManage: false,
    mayDecide: false,
    stageEntryTask: false,
    isMandatory: false,
    legacyWorkflowTask: false,
    stillInStep: true,
    ...overrides,
  };
}

const enabled = (f: TaskActionFacts) =>
  Object.entries(taskActionsFor(f))
    .filter(([key, value]) => key !== 'primary' && value === true)
    .map(([key]) => key)
    .sort();

describe('taskActionsFor (ACC-228)', () => {
  it('a reader with no relationship gets nothing, and no main button', () => {
    expect(enabled(facts())).toEqual([]);
    expect(taskActionsFor(facts()).primary).toBeNull();
  });

  describe('the assignee', () => {
    const assignee = { viewerIsActiveAssignee: true };

    it('Assigned: Start is the button; Complete, evidence, requests and Reject are offered (Q6)', () => {
      expect(enabled(facts({ ...assignee, status: 'PENDING' }))).toEqual(
        ['addEvidence', 'complete', 'reject', 'requestHold', 'requestMoreTime', 'start'].sort(),
      );
      expect(taskActionsFor(facts({ ...assignee, status: 'PENDING' })).primary).toBe('START');
    });

    it('In progress: Complete is the button, and waits for evidence when evidence is required', () => {
      const a = taskActionsFor(facts({ ...assignee, status: 'IN_PROGRESS', requiresEvidence: true, evidenceCount: 0 }));
      expect(a.primary).toBe('COMPLETE');
      expect(a.complete).toBe(true);
      expect(a.completeNeedsEvidence).toBe(true);
      expect(taskActionsFor(facts({ ...assignee, status: 'IN_PROGRESS', requiresEvidence: true, evidenceCount: 1 })).completeNeedsEvidence).toBe(false);
    });

    it('On hold: only Resume and Add evidence — the server answers "Resume the task first" to the rest', () => {
      expect(enabled(facts({ ...assignee, status: 'ON_HOLD' }))).toEqual(['addEvidence', 'resume']);
      expect(taskActionsFor(facts({ ...assignee, status: 'ON_HOLD' })).primary).toBe('RESUME');
    });

    it('a request waiting: Withdraw for the asker, and no second request', () => {
      const a = taskActionsFor(facts({ ...assignee, status: 'IN_PROGRESS', openRequest: { requestedById: ME } }));
      expect(a.withdrawRequest).toBe(true);
      expect(a.requestMoreTime).toBe(false);
      expect(a.requestHold).toBe(false);
      expect(a.reviewRequest).toBe(false); // never your own
    });

    it('Release only for a row that came from a pick, while the task keeps its pool', () => {
      expect(taskActionsFor(facts({ ...assignee, viewerPickedIt: true, hasPoolTarget: true })).release).toBe(true);
      expect(taskActionsFor(facts({ ...assignee, viewerPickedIt: false, hasPoolTarget: true })).release).toBe(false);
      expect(taskActionsFor(facts({ ...assignee, viewerPickedIt: true, hasPoolTarget: false })).release).toBe(false);
    });

    it.each(['COMPLETED', 'CANCELLED'])('%s: nothing for the assignee', (status) => {
      expect(enabled(facts({ ...assignee, status }))).toEqual([]);
    });
  });

  it('a pool member picks up only while nobody holds it and it still waits', () => {
    const pool = { hasPoolTarget: true, viewerInPool: true, anyActiveAssignee: false };
    expect(taskActionsFor(facts(pool)).pickUp).toBe(true);
    expect(taskActionsFor(facts(pool)).primary).toBe('PICK_UP');
    expect(taskActionsFor(facts({ ...pool, anyActiveAssignee: true })).pickUp).toBe(false);
    expect(taskActionsFor(facts({ ...pool, status: 'REJECTED' })).pickUp).toBe(false);
    expect(taskActionsFor(facts({ ...pool, viewerInPool: false })).pickUp).toBe(false);
  });

  describe('the decider and the manager', () => {
    it('Review request comes first for whoever may decide, never for the asker', () => {
      const a = taskActionsFor(facts({ mayDecide: true, openRequest: { requestedById: 'someone-else' } }));
      expect(a.reviewRequest).toBe(true);
      expect(a.primary).toBe('REVIEW_REQUEST');
      expect(taskActionsFor(facts({ mayDecide: true, openRequest: { requestedById: ME } })).reviewRequest).toBe(false);
    });

    it('Reassign follows tasks:reassign or acting for the creator, on an open task', () => {
      expect(taskActionsFor(facts({ mayDecide: true })).reassign).toBe(true);
      expect(taskActionsFor(facts({ mayDecide: true, status: 'COMPLETED' })).reassign).toBe(false);
    });

    it('Edit and Cancel for the manager of an open task; Cancel never on a required stage task or an older workflow task', () => {
      expect(enabled(facts({ mayManage: true }))).toEqual(['cancel', 'edit']);
      expect(taskActionsFor(facts({ mayManage: true, stageEntryTask: true, isMandatory: true })).cancel).toBe(false);
      expect(taskActionsFor(facts({ mayManage: true, stageEntryTask: true, isMandatory: false })).cancel).toBe(true);
      expect(taskActionsFor(facts({ mayManage: true, legacyWorkflowTask: true })).cancel).toBe(false);
    });

    it('Reopen: Completed, and a workflow task still in its step', () => {
      expect(taskActionsFor(facts({ mayManage: true, status: 'COMPLETED' })).reopen).toBe(true);
      expect(taskActionsFor(facts({ mayManage: true, status: 'COMPLETED', stillInStep: false })).reopen).toBe(false);
      expect(taskActionsFor(facts({ mayManage: true, status: 'CANCELLED' })).reopen).toBe(false);
    });

    it('a decider may resume a held task', () => {
      expect(taskActionsFor(facts({ mayDecide: true, status: 'ON_HOLD' })).resume).toBe(true);
    });
  });
});
