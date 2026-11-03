/**
 * ACC-254 (ACC-255 PR 3, plan §10.1) — the workflow screens' enum values in the
 * reader's words. An approval mode, a parallel threshold, an assignee strategy,
 * a record type, a transition's kind and who moves it each map to ONE translation key here,
 * never printed as the stored code (SINGLE, ROLE_BASED, COMMITTEE_CHANGE_REQUEST).
 * A value this file does not know reads "Unknown", never the raw code.
 * `npm run check:workflow-enum-display` fails a template that prints one of
 * those fields directly.
 */
export type WorkflowEnumKind = 'approvalMode' | 'threshold' | 'assignee' | 'objectType' | WhoEnumKind | MoveEnumKind;

/**
 * ACC-271 PR 5a — who works a stage: an entry's kind, and how several people
 * decide. Its own block (the stage editor's "Who works this stage"); which
 * kinds and modes a stage may use is the server's (assigneeKinds, whoRules),
 * never this list.
 */
export type WhoEnumKind = 'stageAssignee' | 'whoMode';

const WHO_KEYS: Readonly<Record<WhoEnumKind, Readonly<Record<string, string>>>> = {
  stageAssignee: {
    SPECIFIC_USER: 'workflow.who.kind.SPECIFIC_USER',
    POSITION_IN_UNIT: 'workflow.who.kind.POSITION_IN_UNIT',
    ORG_UNIT_HEAD: 'workflow.who.kind.ORG_UNIT_HEAD',
    CREATOR: 'workflow.who.kind.CREATOR',
    COMMITTEE: 'workflow.who.kind.COMMITTEE',
  },
  whoMode: {
    ANY_ONE: 'workflow.who.mode.ANY_ONE',
    ALL: 'workflow.who.mode.ALL',
    COMMITTEE_VOTE: 'workflow.who.mode.COMMITTEE_VOTE',
  },
};

/**
 * ACC-271 PR 5b — a transition's kind (ADVANCE, RETURN, EXIT) and who moves the
 * record (`mover`: PERSON, APP, AUTOMATIC). The transitions list and panel show
 * both in words; an app-run move's own line is the server's `appMove`, never
 * this file.
 */
export type MoveEnumKind = 'transitionKind' | 'mover';

const MOVE_KEYS: Readonly<Record<MoveEnumKind, Readonly<Record<string, string>>>> = {
  transitionKind: {
    ADVANCE: 'workflow.kind.advance',
    RETURN: 'workflow.kind.return',
    EXIT: 'workflow.kind.exit',
  },
  mover: {
    PERSON: 'workflow.mover.PERSON',
    APP: 'workflow.mover.APP',
    AUTOMATIC: 'workflow.mover.AUTOMATIC',
  },
};

const KEYS: Readonly<Record<WorkflowEnumKind, Readonly<Record<string, string>>>> = {
  ...WHO_KEYS,
  ...MOVE_KEYS,
  approvalMode: {
    SINGLE: 'workflow.approvalModeSingle',
    SEQUENTIAL: 'workflow.approvalModeSequential',
    PARALLEL: 'workflow.approvalModeParallel',
    COMMITTEE: 'workflow.approvalModeCommittee',
  },
  threshold: {
    ALL: 'workflow.thresholdAll',
    MAJORITY: 'workflow.thresholdMajority',
    ANY: 'workflow.thresholdAny',
  },
  assignee: {
    SPECIFIC_USER: 'workflow.assigneeSpecificUser',
    ROLE: 'workflow.assigneeRole',
    SELF: 'workflow.assigneeSelf',
    COMMITTEE: 'workflow.assigneeCommittee',
    ROUND_ROBIN: 'workflow.assigneeRoundRobin',
    ORG_UNIT_HEAD: 'workflow.assigneeOrgUnitHead',
    POSITION_FIXED: 'workflow.assigneePositionFixed',
  },
  objectType: {
    DOCUMENT_REQUEST: 'workflow.objectTypeName.DOCUMENT_REQUEST',
    DOCUMENT: 'workflow.objectTypeName.DOCUMENT',
    CHANGE_REQUEST: 'workflow.objectTypeName.CHANGE_REQUEST',
    INCIDENT: 'workflow.objectTypeName.INCIDENT',
    AUDIT: 'workflow.objectTypeName.AUDIT',
    CORRECTIVE_ACTION: 'workflow.objectTypeName.CORRECTIVE_ACTION',
    MEETING: 'workflow.objectTypeName.MEETING',
    COMMITTEE: 'workflow.objectTypeName.COMMITTEE',
    COMMITTEE_CHANGE_REQUEST: 'workflow.objectTypeName.COMMITTEE_CHANGE_REQUEST',
  },
};

export const WORKFLOW_VALUE_UNKNOWN = 'workflow.valueUnknown';

/** The translation key for one stored value; "Unknown" for a value not listed. */
export function workflowLabelKey(kind: WorkflowEnumKind, value: string | null | undefined): string {
  return (value && KEYS[kind][value]) || WORKFLOW_VALUE_UNKNOWN;
}

/** Every value of a kind, in the order listed, with its key — for a picker's options. */
export function workflowOptionKeys(kind: WorkflowEnumKind): { value: string; labelKey: string }[] {
  return Object.entries(KEYS[kind]).map(([value, labelKey]) => ({ value, labelKey }));
}
