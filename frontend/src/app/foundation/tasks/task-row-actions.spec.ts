import { NO_ACTIONS } from './components/record-tasks-panel/record-tasks.fixtures';
import { ITaskActionsDto } from './services/task.service';
import { taskPrimaryActionId, taskRowActions } from './task-row-actions';

// ACC-229 — where a row's actions sit (Record Tasks Panel §4). Which ones the
// viewer may take is the server's; this pins only the placement.

const actions = (over: Partial<ITaskActionsDto>): ITaskActionsDto => ({ ...NO_ACTIONS, ...over });
const ids = (groups: { id: string }[][]) => groups.map((g) => g.map((a) => a.id));

describe('taskRowActions (ACC-229)', () => {
  it('the server\'s main action is the button, and is not repeated in the menu', () => {
    const model = taskRowActions(actions({ start: true, complete: true, primary: 'START' }), 0, 'IN_PROGRESS');
    expect(model.primary?.id).toBe('start');
    expect(ids(model.menu)).toEqual([['complete'], ['open']]);
  });

  it('an assignee\'s items come first, then the creator\'s, then View evidence and Open task — in groups', () => {
    const model = taskRowActions(
      actions({ complete: true, addEvidence: true, requestMoreTime: true, reject: true, reassign: true, edit: true, cancel: true, primary: 'COMPLETE' }),
      2,
      'IN_PROGRESS',
    );
    expect(ids(model.menu)).toEqual([['addEvidence', 'requestMoreTime', 'reject'], ['reassign', 'edit', 'cancel'], ['viewEvidence', 'open']]);
    expect(model.menu[2]![0]!.count).toBe(2);
  });

  it('an action the viewer cannot take is ABSENT, never disabled', () => {
    const model = taskRowActions(actions({}), 0, 'IN_PROGRESS');
    expect(model.primary).toBeNull();
    expect(ids(model.menu)).toEqual([['open']]);
  });

  it('Complete waiting for evidence is the one disabled item, and says so through the caller', () => {
    const model = taskRowActions(actions({ complete: true, completeNeedsEvidence: true, primary: 'COMPLETE' }), 0, 'IN_PROGRESS');
    expect(model.primary).toEqual(jasmine.objectContaining({ id: 'complete', disabled: true }));
  });

  it('Reject carries its sub-line, Cancel is worded as danger', () => {
    const model = taskRowActions(actions({ reject: true, cancel: true }), 0, 'IN_PROGRESS');
    const flat = model.menu.flat();
    expect(flat.find((a) => a.id === 'reject')?.subKey).toBe('taskActions.rejectSub');
    expect(flat.find((a) => a.id === 'cancel')?.danger).toBeTrue();
  });

  it('a primary the flags do not allow is not shown (the flags win)', () => {
    const model = taskRowActions(actions({ primary: 'PICK_UP' }), 0, 'IN_PROGRESS');
    expect(model.primary).toBeNull();
  });

  // ACC-120 slice 4 — the next step chosen on the client (Task Screens' action
  // matrix); the server's `primary` is unchanged.
  describe('the client primary', () => {
    it('evidence required and none added: Add evidence leads, and Complete waits in the menu, saying why', () => {
      const a = actions({ complete: true, completeNeedsEvidence: true, addEvidence: true, reject: true, primary: 'COMPLETE' });
      expect(taskPrimaryActionId(a, 'IN_PROGRESS')).toBe('addEvidence');
      const model = taskRowActions(a, 0, 'IN_PROGRESS');
      expect(model.primary?.id).toBe('addEvidence');
      const complete = model.menu.flat().find((m) => m.id === 'complete');
      expect(complete).toEqual(jasmine.objectContaining({ disabled: true, subKey: 'task.completeNeedsEvidence' }));
      // Add evidence is not repeated in the menu.
      expect(model.menu.flat().some((m) => m.id === 'addEvidence')).toBeFalse();
    });

    it('a rejected task its creator may reassign: Reassign… leads; Edit and Cancel stay in the menu', () => {
      const a = actions({ reassign: true, edit: true, cancel: true, primary: null });
      expect(taskPrimaryActionId(a, 'REJECTED')).toBe('reassign');
      const model = taskRowActions(a, 0, 'REJECTED');
      expect(model.primary?.id).toBe('reassign');
      expect(ids(model.menu)).toEqual([['edit', 'cancel'], ['open']]);
    });

    it("otherwise the server's primary: Reassign on an open task does not lead", () => {
      expect(taskPrimaryActionId(actions({ reassign: true, start: true, primary: 'START' }), 'PENDING')).toBe('start');
      expect(taskPrimaryActionId(actions({ reassign: true }), 'PENDING')).toBeNull();
      // Complete with its evidence in: Complete leads, as the server says.
      expect(taskPrimaryActionId(actions({ complete: true, addEvidence: true, primary: 'COMPLETE' }), 'IN_PROGRESS')).toBe('complete');
    });
  });
});
