export interface ITaskAssignee {
  id: string;
  taskId: string;
  userId: string;
  assignedAt: Date;
  assignedById: string;
  removedAt: Date | null;
}
