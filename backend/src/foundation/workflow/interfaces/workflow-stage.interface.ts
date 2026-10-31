import { IWorkflowTransition } from './workflow-transition.interface';

/** ACC-271 PR 3 — one entry of who works a stage, with the names a picker shows. */
export interface IStageWhoEntry {
  id: string;
  order: number;
  kind: string; // StageAssigneeKind
  userId: string | null;
  user: { id: string; name: string } | null;
  positionId: string | null;
  position: { id: string; nameEn: string; nameAr: string | null } | null;
  // Null on an Org unit head entry: the record's unit.
  orgUnitId: string | null;
  orgUnit: { id: string; nameEn: string; nameAr: string | null } | null;
  // Null on a Committee entry: the record's committee.
  committeeId: string | null;
  committee: { id: string; nameEn: string; nameAr: string | null } | null;
  committeeRoleValueId: string | null;
  committeeRole: { id: string; labelEn: string; labelAr: string | null } | null;
  isStartingAssignment: boolean;
  // ACC-271 PR 5-be — on a Fixed position entry, how many ACTIVE people hold the
  // position with this unit as their primary unit (the holder rule); null on
  // every other kind. From one grouped count per read, so the screen can warn
  // "Nobody holds this position in this unit yet." without a call per row.
  holderCount: number | null;
}

/** ACC-271 PR 3 — who works a stage: how they decide, and the entries joined by "or". */
export interface IStageWho {
  mode: string; // StageWhoMode
  entries: IStageWhoEntry[];
}

export interface IWorkflowStage {
  id: string;
  workflowTemplateId: string;
  nameEn: string;
  nameAr: string | null;
  description: string | null;
  order: number;
  slaWorkingHours: number | null;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: string; // WorkflowApprovalMode
  parallelThreshold: string | null; // WorkflowParallelThreshold
  committeeId: string | null;
  assigneeStrategy: string; // WorkflowAssigneeStrategy
  assigneeUserId: string | null;
  assigneeRoleId: string | null;
  assigneeCommitteeRoleValueId: string | null;
  // ACC-54 — only meaningful when assigneeStrategy === 'POSITION_FIXED'.
  assigneePositionId: string | null;
  assigneeOrgUnitId: string | null;
  escalationConfig: Record<string, unknown> | null;
  // ACC-255 — the record actions this stage allows and its flags, as keys in
  // registry order (record-registry.ts). Labels are the frontend's.
  actions: string[];
  flags: string[];
  transitions?: IWorkflowTransition[];
  // ACC-190 — on a template read: how many tasks entering this stage creates,
  // and the longest one's due time in working hours (null when it creates none).
  taskDefinitionCount?: number;
  longestTaskHours?: number | null;
  // ACC-255 PR 4b-be (G4) — on a template read: how many of the organisation's
  // records stand in this stage now (their workflow instance's current stage).
  // A record at a final stage counts (a dissolved committee is at Dissolved);
  // a cancelled instance does not.
  liveCount?: number;
  // ACC-271 PR 3 — on a template read and a stage save. Null on a stage still on
  // the old assignee columns (whoMode null).
  who?: IStageWho | null;
  // ACC-271 PR 3 — the read-back sentence, built by the server (stage-who.ts).
  whoSentence?: { en: string; ar: string } | null;
}
