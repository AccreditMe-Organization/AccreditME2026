import { WorkflowObjectType } from '../../../generated/prisma/client';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';

/**
 * ACC-255 — what can be done to a record, what a stage means, and which record
 * fields a rule may read: per record type, in CODE, served by the template API
 * (`GET /workflow-templates/:id`), never copied in the frontend.
 *
 * FAIL CLOSED, as RECORD_ROUTES does (stage-task-record-routes.ts):
 *   - a record type with no RECORD_ACTIONS entry offers nothing to configure,
 *     and asking the engine about one of its actions is refused;
 *   - a stage save naming a key this registry does not list is refused
 *     (STAGE_ACTION_UNKNOWN / STAGE_FLAG_UNKNOWN);
 *   - a stage with no row for an action does not allow it.
 *
 * A stage only NARROWS what a role allows; it never grants. The engine answers
 * "does this record's current stage allow this action?" and the module still
 * checks the person's permission — both must say yes.
 *
 * Adding an action later: it is dark on every existing stage until a seed
 * default and a backfill give it somewhere to be allowed (fail closed). Labels
 * are the frontend's (`labelKey`); the server sends keys only. Every labelKey
 * must exist in both translation files — `record-registry.spec.ts` reads them.
 */

export interface RecordActionDef {
  readonly key: string;
  readonly labelKey: string;
  /**
   * ACC-255 PR 4b-be (G1) — the permission the action's own endpoint checks.
   * A person needs it AND a stage that allows the action ("A stage only
   * narrows"), so the stage editor shows it beside the action ("Also needs:
   * …") in the catalogue's own sentence. It states the check the module makes;
   * `record-registry.spec.ts` holds the two against each other.
   */
  readonly permissionKey: string;
  /**
   * Allowed on a stage a tenant ADDS when the save names no actions, so a new
   * stage keeps what the record allowed before stage rules existed. The
   * committee's member actions were never limited by stage; Edit and Request a
   * change were never offered on a tenant-added stage (plan §4.1).
   */
  readonly onNewStage?: boolean;
}

export type StageFlagCardinality = 'any' | 'exactlyOne';

export interface StageFlagDef {
  readonly key: string;
  readonly labelKey: string;
  /** `exactlyOne`: every template of the type has the flag on exactly one stage. */
  readonly cardinality: StageFlagCardinality;
}

export interface RecordFieldDef {
  readonly key: string;
  readonly labelKey: string;
  readonly kind: 'lookup' | 'orgUnit';
}

/** The committee record actions a stage may allow (ACC-255). */
export const COMMITTEE_ACTIONS = {
  EDIT_DETAILS: 'edit_details',
  ADD_MEMBER: 'add_member',
  REMOVE_MEMBER: 'remove_member',
  CHANGE_MEMBER_ROLE: 'change_member_role',
  REQUEST_CHANGE: 'request_change',
} as const;
export type CommitteeAction = (typeof COMMITTEE_ACTIONS)[keyof typeof COMMITTEE_ACTIONS];

/** The stage flags (ACC-255). Keys are code; their meaning is the label. */
export const STAGE_FLAG = {
  /** The committee is being dissolved, or has been: no parent or reports-to may point at it. */
  DISSOLVING: 'DISSOLVING',
  /** The committee is approved and governs: a change request may be submitted and decided. */
  IN_FORCE: 'IN_FORCE',
  /** Reaching this stage applies an approved change request. Exactly one stage per template. */
  APPLIES_APPROVED_CHANGE: 'APPLIES_APPROVED_CHANGE',
} as const;
export type StageFlag = (typeof STAGE_FLAG)[keyof typeof STAGE_FLAG];

const committeeAction = (key: CommitteeAction, permissionKey: string, onNewStage = false): RecordActionDef => ({
  key,
  labelKey: `workflow.recordAction.COMMITTEE.${key}`,
  permissionKey,
  ...(onNewStage && { onNewStage }),
});
const flag = (key: StageFlag, cardinality: StageFlagCardinality): StageFlagDef => ({ key, labelKey: `workflow.stageFlag.${key}`, cardinality });

export const RECORD_ACTIONS: Partial<Record<WorkflowObjectType, readonly RecordActionDef[]>> = {
  COMMITTEE: [
    committeeAction(COMMITTEE_ACTIONS.EDIT_DETAILS, COMMITTEES_PERMISSIONS.EDIT_DETAILS),
    committeeAction(COMMITTEE_ACTIONS.ADD_MEMBER, COMMITTEES_PERMISSIONS.ADD_MEMBER, true),
    committeeAction(COMMITTEE_ACTIONS.REMOVE_MEMBER, COMMITTEES_PERMISSIONS.REMOVE_MEMBER, true),
    committeeAction(COMMITTEE_ACTIONS.CHANGE_MEMBER_ROLE, COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE, true),
    // Raising a change request is checked against Edit details
    // (committee-change-request.service.ts, requirePermission on create).
    committeeAction(COMMITTEE_ACTIONS.REQUEST_CHANGE, COMMITTEES_PERMISSIONS.EDIT_DETAILS),
  ],
};

export const STAGE_FLAGS: Partial<Record<WorkflowObjectType, readonly StageFlagDef[]>> = {
  COMMITTEE: [flag(STAGE_FLAG.DISSOLVING, 'any'), flag(STAGE_FLAG.IN_FORCE, 'any')],
  COMMITTEE_CHANGE_REQUEST: [flag(STAGE_FLAG.APPLIES_APPROVED_CHANGE, 'exactlyOne')],
};

/** Read by step 2's conditions; defined now, read by nothing in ACC-255. */
export const RECORD_FIELDS: Partial<Record<WorkflowObjectType, readonly RecordFieldDef[]>> = {
  COMMITTEE: [
    { key: 'typeValueId', labelKey: 'workflow.recordField.COMMITTEE.typeValueId', kind: 'lookup' },
    { key: 'orgUnitId', labelKey: 'workflow.recordField.COMMITTEE.orgUnitId', kind: 'orgUnit' },
  ],
};

export function recordActionsFor(objectType: WorkflowObjectType): readonly RecordActionDef[] {
  return RECORD_ACTIONS[objectType] ?? [];
}

export function stageFlagsFor(objectType: WorkflowObjectType): readonly StageFlagDef[] {
  return STAGE_FLAGS[objectType] ?? [];
}

export function recordFieldsFor(objectType: WorkflowObjectType): readonly RecordFieldDef[] {
  return RECORD_FIELDS[objectType] ?? [];
}

/** Whether `actionKey` is a record action of `objectType`. */
export function isRecordAction(objectType: WorkflowObjectType, actionKey: string): boolean {
  return recordActionsFor(objectType).some((a) => a.key === actionKey);
}

/** Whether `flagKey` is a stage flag of `objectType`. */
export function isStageFlag(objectType: WorkflowObjectType, flagKey: string): boolean {
  return stageFlagsFor(objectType).some((f) => f.key === flagKey);
}

/** The actions a stage a tenant adds gets when its save names none. */
export function newStageActionKeys(objectType: WorkflowObjectType): string[] {
  return recordActionsFor(objectType).filter((a) => a.onNewStage).map((a) => a.key);
}

/** Puts action keys in registry order (the order the screens list them). */
export function orderedActionKeys(objectType: WorkflowObjectType, keys: Iterable<string>): string[] {
  const held = new Set(keys);
  return recordActionsFor(objectType).filter((a) => held.has(a.key)).map((a) => a.key);
}

/** Puts flag keys in registry order. */
export function orderedFlagKeys(objectType: WorkflowObjectType, keys: Iterable<string>): string[] {
  const held = new Set(keys);
  return stageFlagsFor(objectType).filter((f) => held.has(f.key)).map((f) => f.key);
}
