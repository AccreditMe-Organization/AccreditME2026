export interface IWorkflowTransition {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  requiredPermission: string | null;
  triggerCondition: string; // WorkflowTriggerCondition
  triggerUserId: string | null;
  triggerRoleId: string | null;
  validatorConfig: Record<string, unknown> | null;
  isApprovalPath: boolean;
  actions?: IWorkflowTransitionAction[];
}

export interface IWorkflowTransitionAction {
  id: string;
  workflowTransitionId: string;
  actionType: string; // WorkflowActionType
  order: number;
  isEnabled: boolean;
  configJson: Record<string, unknown> | null;
}
