import { HttpErrorResponse } from '@angular/common/http';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import {
  deadlineBeforeTasks,
  dueAfterStageDeadline,
  finalStageTaskCount,
  openStageTasks,
  plainWorkflowRefusalKey,
  taskSlaStageConflicts,
  whoRefusal,
} from './workflow-refusal';

// ACC-208 — the screens read the engine's refusals by CODE and details, never
// by the English message.

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ status, error: { statusCode: status, message: 'English for a log', error: 'x', ...body } });

function lookup(json: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], json);
}

describe('workflow refusals (ACC-208)', () => {
  it('maps every plain refusal to a key that exists in both languages', () => {
    const codes = [
      'STAGE_TASK_ROUTE_INCOMPLETE',
      'STAGE_TASK_ROUTE_NOT_AVAILABLE',
      'STAGE_TASK_UNIT_NOT_FOUND',
      'STAGE_TASK_POSITION_NOT_FOUND',
      'STAGE_TASK_COMMITTEE_NOT_FOUND',
      'STAGE_TASK_ROLE_NOT_FOUND',
      'STAGE_TASK_USER_NOT_IN_POSITION',
      'STAGE_TASK_ON_FINAL_STAGE',
      'STAGE_TASK_ORDER_MISMATCH',
    ];
    for (const code of codes) {
      const key = plainWorkflowRefusalKey(refusal(400, { code }));
      expect(key).withContext(code).not.toBeNull();
      expect(typeof lookup(en, key!)).withContext(`en ${key}`).toBe('string');
      expect(typeof lookup(ar, key!)).withContext(`ar ${key}`).toBe('string');
    }
  });

  // ACC-271 — the two refusals of a converted stage's pool, said on the record
  // page's transition buttons in either language, never the server's English.
  it('words the stage-pool refusals from their codes, in both languages', () => {
    const cases: [number, string, string][] = [
      [409, 'STAGE_HAS_NO_ONE', 'workflow.refusal.stageHasNoOne'],
      [403, 'NOT_IN_STAGE_POOL', 'workflow.refusal.notInStagePool'],
    ];
    for (const [status, code, key] of cases) {
      expect(plainWorkflowRefusalKey(refusal(status, { code, stageNameEn: 'Quality review', stageNameAr: null }))).withContext(code).toBe(key);
      expect(typeof lookup(en, key)).withContext(`en ${key}`).toBe('string');
      expect(typeof lookup(ar, key)).withContext(`ar ${key}`).toBe('string');
    }
  });

  it('gives no plain key to a refusal whose words carry numbers, or to anything else', () => {
    expect(plainWorkflowRefusalKey(refusal(409, { code: 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE' }))).toBeNull();
    expect(plainWorkflowRefusalKey(refusal(409, { code: 'STAGE_TASKS_OPEN' }))).toBeNull();
    expect(plainWorkflowRefusalKey(refusal(400, { message: 'no code' }))).toBeNull();
    expect(plainWorkflowRefusalKey(new Error('not http'))).toBeNull();
  });

  it('reads both numbers and the priority of a definition due after the stage deadline', () => {
    const err = refusal(409, { code: 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE', taskHours: 80, stageHours: 40, priority: 'LOW' });
    expect(dueAfterStageDeadline(err)).toEqual({ taskHours: 80, stageHours: 40, priority: 'LOW' });
    expect(deadlineBeforeTasks(err)).toBeNull();
  });

  it('reads a stage deadline lowered below its tasks, with the definitions it would make late', () => {
    const err = refusal(409, { code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: ['d1', 'd2'] });
    expect(deadlineBeforeTasks(err)).toEqual({ stageHours: 12, longestTaskHours: 16, definitionIds: ['d1', 'd2'] });
    expect(dueAfterStageDeadline(err)).toBeNull();
  });

  it('reads every stage a task SLA change would break', () => {
    const stage = {
      stageId: 's1',
      stageName: 'Terms Review',
      stageNameAr: null,
      templateName: 'Committee',
      templateNameAr: null,
      workflowTemplateId: 't1',
      stageHours: 16,
      longestTaskHours: 24,
      priority: 'HIGH',
    };
    expect(taskSlaStageConflicts(refusal(409, { code: 'TASK_SLA_EXCEEDS_STAGE_DEADLINES', stages: [stage] }))).toEqual([stage] as never);
    expect(taskSlaStageConflicts(refusal(409, { code: 'STAGE_TASKS_OPEN', tasks: [] }))).toBeNull();
  });

  it('reads how many tasks a stage made final still creates', () => {
    expect(finalStageTaskCount(refusal(400, { code: 'STAGE_TASK_ON_FINAL_STAGE', taskDefinitionCount: 2 }))).toBe(2);
    // The definition side sends no count; the screen then uses the plain sentence.
    expect(finalStageTaskCount(refusal(400, { code: 'STAGE_TASK_ON_FINAL_STAGE' }))).toBeNull();
  });

  it('reads the open tasks holding a record, defaulting what an older server leaves out', () => {
    const err = refusal(409, {
      code: 'STAGE_TASKS_OPEN',
      tasks: [
        {
          id: 't1',
          title: 'Check the terms',
          titleAr: 'مراجعة الشروط',
          status: 'PENDING',
          statusLabel: 'Assigned',
          dueAt: '2026-10-14T13:00:00.000Z',
          requiresEvidence: true,
          assignees: [{ id: 'u1', name: 'Nora' }],
          pool: null,
        },
        { id: 't2', title: 'Collect signatures', status: 'ON_HOLD', statusLabel: 'On hold' },
      ],
    });

    expect(openStageTasks(err)).toEqual([
      {
        id: 't1',
        title: 'Check the terms',
        titleAr: 'مراجعة الشروط',
        status: 'PENDING',
        statusLabel: 'Assigned',
        dueAt: '2026-10-14T13:00:00.000Z',
        requiresEvidence: true,
        assignees: [{ id: 'u1', name: 'Nora' }],
        pool: null,
      },
      {
        id: 't2',
        title: 'Collect signatures',
        titleAr: null,
        status: 'ON_HOLD',
        statusLabel: 'On hold',
        dueAt: null,
        requiresEvidence: false,
        assignees: [],
        pool: null,
      },
    ]);
    expect(openStageTasks(refusal(409, { code: 'STAGE_DEADLINE_BEFORE_TASKS' }))).toBeNull();
  });
});

// ACC-255 PR 3 (plan §10.4) — the refusals PR 2 added, the two retired ones, and
// the protected workflow by WHICH edit was refused.
describe('workflow refusals (ACC-255 PR 3)', () => {
  it('gives every new plain refusal a key in both languages', () => {
    const codes = [
      'ACTION_TYPE_RETIRED',
      'VALIDATOR_RETIRED',
      'STAGE_ACTION_NOT_ALLOWED',
      'STAGE_ACTION_UNKNOWN',
      'STAGE_FLAG_UNKNOWN',
      'STAGE_FLAG_EXACTLY_ONE',
    ];
    for (const code of codes) {
      const key = plainWorkflowRefusalKey(refusal(409, { code }));
      expect(key).withContext(code).not.toBeNull();
      expect(typeof lookup(en, key!)).withContext(`en ${key}`).toBe('string');
      expect(typeof lookup(ar, key!)).withContext(`ar ${key}`).toBe('string');
    }
  });

  it('says each of the nine protected edits in its own sentence, in both languages', () => {
    const edits = ['CREATE_TEMPLATE', 'REPLACE_DEFAULT', 'DEACTIVATE', 'CHANGE_TYPE', 'ADD_STAGE', 'REMOVE_STAGE', 'STAGE_FIELD', 'TRANSITION', 'STAGE_TASKS'];
    const sentences = new Set<unknown>();
    for (const edit of edits) {
      const key = plainWorkflowRefusalKey(refusal(409, { code: 'WORKFLOW_TEMPLATE_PROTECTED', edit }));
      expect(key).withContext(edit).toBe(`workflow.refusal.protected.${edit}`);
      expect(typeof lookup(en, key!)).withContext(`en ${edit}`).toBe('string');
      expect(typeof lookup(ar, key!)).withContext(`ar ${edit}`).toBe('string');
      sentences.add(lookup(en, key!));
    }
    expect(sentences.size).withContext('nine different sentences').toBe(9);
  });

  it('says the general sentence for an edit it does not know, or none', () => {
    for (const edit of ['SOMETHING_NEW', undefined, 7, 'toString']) {
      expect(plainWorkflowRefusalKey(refusal(409, { code: 'WORKFLOW_TEMPLATE_PROTECTED', edit })))
        .withContext(String(edit))
        .toBe('workflow.refusal.templateProtected');
    }
  });

  it('gives every workflow screen fallback a key in both languages', () => {
    for (const key of ['updateFailed', 'removeFailed', 'saveFailed', 'reorderFailed', 'setDefaultFailed', 'deactivateFailed', 'invalidHeadersJson']) {
      expect(typeof lookup(en, `workflow.error.${key}`)).withContext(`en ${key}`).toBe('string');
      expect(typeof lookup(ar, `workflow.error.${key}`)).withContext(`ar ${key}`).toBe('string');
    }
  });
});

// ACC-271 PR 5a — a refused `who`, placed in its slot from its code and details.
describe('whoRefusal (ACC-271 PR 5a)', () => {
  it('places each refusal: the section, the mode, or a row by index and field', () => {
    expect(whoRefusal(refusal(400, { code: 'WHO_ENTRIES_REQUIRED' }))?.where).toEqual({ slot: 'section' });
    expect(whoRefusal(refusal(400, { code: 'WHO_REQUIRED' }))?.where).toEqual({ slot: 'section' });
    expect(whoRefusal(refusal(400, { code: 'WHO_MODE_UNKNOWN', mode: 'X' }))?.where).toEqual({ slot: 'mode' });
    expect(whoRefusal(refusal(400, { code: 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' }))?.where).toEqual({ slot: 'mode' });
    expect(whoRefusal(refusal(400, { code: 'WHO_ENTRY_INCOMPLETE', index: 2, kind: 'POSITION_IN_UNIT', field: 'positionId' }))?.where).toEqual({
      slot: 'entry',
      index: 2,
      field: 'positionId',
    });
    expect(whoRefusal(refusal(404, { code: 'WHO_REFERENCE_NOT_FOUND', index: 0, field: 'committeeId' }))?.where).toEqual({
      slot: 'entry',
      index: 0,
      field: 'committeeId',
    });
    expect(whoRefusal(refusal(400, { code: 'WHO_USER_NOT_ACTIVE', index: 1 }))?.where).toEqual({ slot: 'entry', index: 1, field: 'userId' });
    for (const code of ['WHO_ENTRY_DUPLICATE', 'WHO_KIND_NOT_ALLOWED', 'WHO_ENTRY_FIELD_NOT_USED', 'WHO_RECORD_ROUTE_NOT_AVAILABLE']) {
      expect(whoRefusal(refusal(400, { code, index: 3, kind: 'COMMITTEE' }))?.where).withContext(code).toEqual({ slot: 'entry', index: 3, field: null });
    }
    expect(whoRefusal(refusal(400, { code: 'WHO_RECORD_ROUTE_NOT_AVAILABLE', index: 0, kind: 'COMMITTEE' }))?.kind).toBe('COMMITTEE');
  });

  it('is null for any other refusal, a row refusal without a usable index, or a field it does not know', () => {
    expect(whoRefusal(refusal(409, { code: 'STAGE_FLAG_EXACTLY_ONE' }))).toBeNull();
    expect(whoRefusal(refusal(400, { code: 'WHO_ENTRY_DUPLICATE' }))).toBeNull();
    expect(whoRefusal(refusal(400, { code: 'WHO_ENTRY_DUPLICATE', index: -1 }))).toBeNull();
    expect(whoRefusal(refusal(400, { code: 'WHO_ENTRY_INCOMPLETE', index: 0, field: 'somethingElse' }))?.where).toEqual({
      slot: 'entry',
      index: 0,
      field: null,
    });
    expect(whoRefusal(new HttpErrorResponse({ status: 0 }))).toBeNull();
  });
});
