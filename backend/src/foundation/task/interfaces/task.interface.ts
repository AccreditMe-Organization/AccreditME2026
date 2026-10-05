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
  // ACC-163 — complete() refuses while this is true and no evidence exists.
  requiresEvidence: boolean;
  // ACC-163 — set when the last active assignee rejects; cleared by reassign.
  rejectedReason: string | null;
  rejectedAt: Date | null;
  rejectedById: string | null;
  // ACC-46 Section 2.7.b — managerEscalatedAt/headEscalatedAt replace the
  // old escalationUserId/escalationAfterHours/escalatedAt trio; written
  // only by SlaMonitorProcessor, never by any caller.
  managerEscalatedAt: Date | null;
  headEscalatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
