// ACC-173 — extension and on-hold requests.

/** A task's PENDING request, as a list row carries it. At most one per task. */
export interface ITaskOpenRequest {
  id: string;
  type: 'EXTENSION' | 'ON_HOLD';
  requestedDueAt: Date | null;
  holdUntil: Date | null;
  requestedById: string;
  requestedByName: string;
  reason: string;
  createdAt: Date;
}

/** The request row as stored, returned by the request endpoints. */
export interface ITaskRequest {
  id: string;
  organizationId: string;
  taskId: string;
  type: string; // TaskRequestType
  requestedById: string;
  reason: string;
  requestedDueAt: Date | null;
  holdUntil: Date | null;
  status: string; // TaskRequestStatus
  decidedById: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A row of the decider inbox ("Waiting for your decision"). */
export interface ITaskRequestForDecision extends ITaskOpenRequest {
  task: {
    id: string;
    title: string;
    sourceType: string;
    sourceId: string;
    status: string;
    priority: string;
    dueAt: Date | null;
  };
}
