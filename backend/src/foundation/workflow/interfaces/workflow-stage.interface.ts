import { IWorkflowTransition } from './workflow-transition.interface';

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
  transitions?: IWorkflowTransition[];
  // ACC-190 — on a template read: how many tasks entering this stage creates,
  // and the longest one's due time in working hours (null when it creates none).
  taskDefinitionCount?: number;
  longestTaskHours?: number | null;
}
