import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { WORKFLOW_VALUE_UNKNOWN, WorkflowEnumKind, workflowLabelKey, workflowOptionKeys } from './workflow-labels';

// ACC-254 — every workflow enum value the screens show has a sentence in both
// languages, and a value nobody listed reads "Unknown", never its code.

// ACC-271 PR 5b — the trigger block went with "Who can trigger"; a transition's
// kind and who moves it were added.
const KINDS: WorkflowEnumKind[] = ['approvalMode', 'threshold', 'assignee', 'objectType', 'stageAssignee', 'whoMode', 'transitionKind', 'mover'];
const lookup = (lang: unknown, key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], lang);

describe('workflow labels (ACC-254)', () => {
  it('every key a value maps to exists in English and Arabic', () => {
    let count = 0;
    for (const kind of KINDS) {
      for (const { value, labelKey } of workflowOptionKeys(kind)) {
        count++;
        for (const [name, lang] of [['en', en], ['ar', ar]] as const) {
          expect(typeof lookup(lang, labelKey)).withContext(`${kind}.${value} → ${labelKey} (${name})`).toBe('string');
        }
      }
    }
    expect(count).withContext('non-vacuity: every enum was listed').toBe(4 + 3 + 7 + 9 + 5 + 3 + 3 + 3);
    for (const lang of [en, ar]) expect(typeof lookup(lang, WORKFLOW_VALUE_UNKNOWN)).toBe('string');
  });

  it('the backend enums are all listed: none would read "Unknown"', () => {
    const backend: Record<WorkflowEnumKind, string[]> = {
      approvalMode: ['SINGLE', 'SEQUENTIAL', 'PARALLEL', 'COMMITTEE'],
      threshold: ['ALL', 'MAJORITY', 'ANY'],
      assignee: ['SPECIFIC_USER', 'ROLE', 'ORG_UNIT_HEAD', 'SELF', 'COMMITTEE', 'ROUND_ROBIN', 'POSITION_FIXED'],
      objectType: [
        'DOCUMENT_REQUEST',
        'DOCUMENT',
        'CHANGE_REQUEST',
        'INCIDENT',
        'AUDIT',
        'CORRECTIVE_ACTION',
        'MEETING',
        'COMMITTEE',
        'COMMITTEE_CHANGE_REQUEST',
      ],
      // ACC-271 PR 5a — the backend's StageAssigneeKind and StageWhoMode.
      stageAssignee: ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'CREATOR', 'COMMITTEE'],
      whoMode: ['ANY_ONE', 'ALL', 'COMMITTEE_VOTE'],
      // ACC-271 PR 5b — the backend's TransitionKind and TransitionMover.
      transitionKind: ['ADVANCE', 'RETURN', 'EXIT'],
      mover: ['PERSON', 'APP', 'AUTOMATIC'],
    };
    for (const kind of KINDS) {
      for (const value of backend[kind]) expect(workflowLabelKey(kind, value)).withContext(`${kind}.${value}`).not.toBe(WORKFLOW_VALUE_UNKNOWN);
    }
  });

  it('a value nobody listed, or none, reads "Unknown"', () => {
    expect(workflowLabelKey('mover', 'SOMETHING_NEW')).toBe(WORKFLOW_VALUE_UNKNOWN);
    expect(workflowLabelKey('approvalMode', null)).toBe(WORKFLOW_VALUE_UNKNOWN);
    expect(workflowLabelKey('objectType', undefined)).toBe(WORKFLOW_VALUE_UNKNOWN);
  });
});
