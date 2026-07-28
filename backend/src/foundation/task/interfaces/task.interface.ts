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
  escalationUserId: string | null;
  escalationAfterHours: number | null;
  createdAt: Date;
  updatedAt: Date;
}
