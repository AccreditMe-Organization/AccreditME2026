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
  // ACC-167 — the pool a task is assigned to (one pair or neither), and the
  // pick-up clock. See task-pool.ts.
  assignedOrgUnitId: string | null;
  assignedPositionId: string | null;
  assignedCommitteeId: string | null;
  assignedCommitteeRoleValueId: string | null;
  pooledAt: Date | null;
  poolEscalateAt: Date | null;
  poolEscalatedAt: Date | null;
  // ACC-46 Section 2.7.b — managerEscalatedAt/headEscalatedAt replace the
  // old escalationUserId/escalationAfterHours/escalatedAt trio; written
  // only by SlaMonitorProcessor, never by any caller.
  managerEscalatedAt: Date | null;
  headEscalatedAt: Date | null;
  // ACC-173 — set only while the task is ON_HOLD (an approved hold request);
  // all three cleared on resume.
  heldAt: Date | null;
  onHoldUntil: Date | null;
  heldFromStatus: string | null; // TaskStatus — PENDING or IN_PROGRESS
  // ACC-174 — the SLA window (task-sla.service.ts). Null on a row from before
  // ACC-174 until backfill-acc174-task-sla-limit.ts runs.
  slaStartAt: Date | null;
  slaLimitAt: Date | null;
  slaExtendedTo: Date | null;
  // ACC-174 — a cancel by the creator (or whoever acts for them); the engine's
  // own cancellations leave these null. And the last reopen.
  cancelledReason: string | null;
  cancelledAt: Date | null;
  cancelledById: string | null;
  reopenedReason: string | null;
  reopenedAt: Date | null;
  reopenedById: string | null;
  // ACC-190 — a task created from a stage task definition when its record
  // entered a stage: the entry it belongs to, the definition it came from, and
  // the definition's mandatory flag and Arabic title as they were at entry.
  workflowInstanceStageId: string | null;
  stageTaskDefinitionId: string | null;
  isMandatory: boolean;
  titleAr: string | null;
  createdAt: Date;
  updatedAt: Date;
}
