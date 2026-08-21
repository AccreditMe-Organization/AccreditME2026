export interface ITaskAssignee {
  id: string;
  taskId: string;
  userId: string;
  assignedAt: Date;
  assignedById: string;
  removedAt: Date | null;
  // ACC-40 Section 2.6.3
  delegationReason: string | null; // DelegationReason
  delegationContextId: string | null;
}
