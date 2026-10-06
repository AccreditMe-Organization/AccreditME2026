import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import { ITaskOpenRequest } from './interfaces/task-request.interface';

// ACC-173 — the pieces of the request and hold lifecycle that TaskService's
// existing actions share with TaskRequestService. Plain functions over the
// client they are given, so they run inside the caller's transaction and
// under the caller's row lock.

type RequestClient = Pick<PrismaService, 'taskRequest'>;

/** A hold's three fields, all cleared — on resume, and when a hold ends early. */
export const HOLD_CLEARED = { heldAt: null, onHoldUntil: null, heldFromStatus: null } as const;

/** The statuses a person may ask about: Assigned (and legacy OVERDUE) or In progress. */
export const REQUESTABLE_STATUSES: readonly string[] = ['PENDING', 'OVERDUE', 'IN_PROGRESS'];

/** Include for a task list query: its PENDING request, with the requester's name. */
export const OPEN_REQUEST_INCLUDE = {
  requests: {
    where: { status: 'PENDING' as const },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      type: true,
      requestedDueAt: true,
      holdUntil: true,
      requestedById: true,
      reason: true,
      createdAt: true,
      requestedBy: { select: { name: true } },
    },
  },
};

interface OpenRequestRow {
  id: string;
  type: 'EXTENSION' | 'ON_HOLD';
  requestedDueAt: Date | null;
  holdUntil: Date | null;
  requestedById: string;
  reason: string;
  createdAt: Date;
  requestedBy: { name: string };
}

export function toOpenRequest(rows: OpenRequestRow[] | undefined): ITaskOpenRequest | null {
  const row = rows?.[0];
  if (!row) return null;
  const { requestedBy, ...rest } = row;
  return { ...rest, requestedByName: requestedBy.name };
}

export type RequestCancelCause =
  | 'task_completed'
  | 'task_rejected'
  | 'task_released'
  | 'task_reassigned'
  | 'task_cancelled'
  | 'requester_left_task'
  | 'departure';

export interface CancelledRequest {
  id: string;
  taskId: string;
  cause: RequestCancelCause;
}

/**
 * Cancels the PENDING requests on these tasks — optionally only those made by
 * one person — and returns them so the caller can audit each after commit.
 */
export async function cancelOpenRequests(
  client: RequestClient,
  organizationId: string,
  taskIds: string[],
  cause: RequestCancelCause,
  requestedById?: string,
): Promise<CancelledRequest[]> {
  if (taskIds.length === 0) return [];
  const where = {
    organizationId,
    taskId: { in: taskIds },
    status: 'PENDING' as const,
    ...(requestedById ? { requestedById } : {}),
  };
  const open = await client.taskRequest.findMany({ where, select: { id: true, taskId: true } });
  if (open.length === 0) return [];
  await client.taskRequest.updateMany({
    where: { id: { in: open.map((r) => r.id) }, organizationId },
    data: { status: 'CANCELLED' },
  });
  return open.map((r) => ({ ...r, cause }));
}

/** One audit row per cancelled request — after commit, like every audit write here. */
export async function auditCancelledRequests(
  auditLog: AuditLogService,
  cancelled: CancelledRequest[],
  organizationId: string,
  actorId: string | undefined,
): Promise<void> {
  for (const request of cancelled) {
    await auditLog.log({
      action: 'UPDATE',
      objectType: 'TaskRequest',
      objectId: request.id,
      ...(actorId ? { actorId } : {}),
      tenantId: organizationId,
      metadata: { event: 'request_cancelled', taskId: request.taskId, cause: request.cause },
    });
  }
}
