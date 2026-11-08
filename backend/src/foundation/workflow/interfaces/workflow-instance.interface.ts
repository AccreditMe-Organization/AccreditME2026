import type { WorkflowTransitionKind } from '../../../../generated/prisma/client';

export interface IWorkflowInstance {
  id: string;
  organizationId: string;
  workflowTemplateId: string;
  objectType: string;
  objectId: string;
  status: string; // WorkflowStatus
  currentStageId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // ACC-34 — one message per CREATE_TASK action (this trigger only) that
  // resolved zero eligible assignees. [] on every response except a fresh
  // triggerTransition() result that actually fired actions.
  unassignedTaskWarnings: string[];
}

export interface IWorkflowInstanceStage {
  id: string;
  workflowInstanceId: string;
  stageId: string;
  enteredAt: Date;
  exitedAt: Date | null;
  slaDueAt: Date | null;
  slaBreached: boolean;
  outcome: string; // WorkflowInstanceStageOutcome
  actorId: string | null;
  comment: string | null;
  // ACC-40 Section 2.6.3
  delegationReason: string | null; // DelegationReason
  delegationContextId: string | null;
}

export interface IWorkflowApproval {
  id: string;
  workflowInstanceStageId: string;
  approverId: string;
  decision: string; // WorkflowApprovalDecision
  comment: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  // ACC-40 Section 2.6.3
  delegationReason: string | null; // DelegationReason
  delegationContextId: string | null;
}

/**
 * ACC-282 — the moves this viewer may press from the record's current stage (pool
 * only), each with what its button shows and where it leads, so no screen reads
 * the whole template for them. Empty for anyone outside the pool.
 */
export interface IWorkflowMove {
  id: string;
  labelEn: string;
  labelAr: string | null;
  kind: WorkflowTransitionKind;
  toStageId: string;
  toStageNameEn: string;
  toStageNameAr: string | null;
}

export interface IWorkflowMoves {
  /** The same ids as `moves`, kept for callers that read only the ids (ACC-271). */
  transitionIds: string[];
  moves: IWorkflowMove[];
}
