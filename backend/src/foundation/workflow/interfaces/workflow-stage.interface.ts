import { IWorkflowTransition } from './workflow-transition.interface';

export interface IWorkflowStage {
  id: string;
  workflowTemplateId: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  order: number;
  slaWorkingHours: number | null;
  requiredPermission: string | null;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: string; // WorkflowApprovalMode
  parallelThreshold: string | null; // WorkflowParallelThreshold
  committeeId: string | null;
  assigneeStrategy: string; // WorkflowAssigneeStrategy
  assigneeUserId: string | null;
  assigneeRoleId: string | null;
  assigneeCommitteeRoleValueId: string | null;
  escalationConfig: Record<string, unknown> | null;
  transitions?: IWorkflowTransition[];
}
