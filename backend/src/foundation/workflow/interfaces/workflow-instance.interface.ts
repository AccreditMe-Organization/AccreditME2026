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
