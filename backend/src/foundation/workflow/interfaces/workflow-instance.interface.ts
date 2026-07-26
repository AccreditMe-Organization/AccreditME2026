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
}

export interface IWorkflowApproval {
  id: string;
  workflowInstanceStageId: string;
  approverId: string;
  decision: string; // WorkflowApprovalDecision
  comment: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}
