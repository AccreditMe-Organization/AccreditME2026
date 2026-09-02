export interface ITask {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  sourceType: string; // TaskSourceType
  sourceId: string;
  sourceStageId: string | null;
  workflowInstanceId: string | null;
  meetingId: string | null;
  createdById: string;
  status: string; // TaskStatus
  priority: string; // TaskPriority
  dueAt: Date | null;
  dueDateOverridden: boolean;
  slaBreachedAt: Date | null;
  completedAt: Date | null;
  completedById: string | null;
  // ACC-46 Section 2.7.b — managerEscalatedAt/headEscalatedAt replace the
  // old escalationUserId/escalationAfterHours/escalatedAt trio; written
  // only by SlaMonitorProcessor, never by any caller.
  managerEscalatedAt: Date | null;
  headEscalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
