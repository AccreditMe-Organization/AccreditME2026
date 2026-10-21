import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { TaskViewer } from './task.service';
import { TaskAdmissionService } from './task-admission.service';
import { POOL_LABEL_INCLUDE, PICKABLE_STATUSES, poolTargetOf, resolvePoolMemberIds, toPoolView } from './task-pool';
import { OPEN_REQUEST_INCLUDE, toOpenRequest } from './task-request-lifecycle';
import { taskActionsFor } from './task-actions';
import {
  ITaskHistoryEvent,
  ITaskPagePerson,
  ITaskPageView,
  TaskHistoryKind,
} from './interfaces/task-page.interface';

const NOT_FOUND = 'Task not found';

const PERSON_SELECT = {
  id: true,
  name: true,
  position: { select: { nameEn: true, nameAr: true } },
  primaryOrgUnit: { select: { nameEn: true, nameAr: true } },
} as const;

interface PersonRow {
  id: string;
  name: string;
  position: { nameEn: string; nameAr: string | null } | null;
  primaryOrgUnit: { nameEn: string; nameAr: string | null } | null;
}

function toPerson(row: PersonRow): ITaskPagePerson {
  return {
    id: row.id,
    name: row.name,
    positionNameEn: row.position?.nameEn ?? null,
    positionNameAr: row.position?.nameAr ?? null,
    orgUnitNameEn: row.primaryOrgUnit?.nameEn ?? null,
    orgUnitNameAr: row.primaryOrgUnit?.nameAr ?? null,
  };
}

/**
 * ACC-228 — THE TASK PAGE (/tasks/:id): who may open it, what it shows, and
 * its history.
 *
 * WHO MAY OPEN A TASK (Q4, Ahmad 14 Oct) is TaskAdmissionService.admit() —
 * moved there in ACC-231 so the task's files follow the very same rule:
 *   (a) anyone ever on it, (b) whoever may manage it, (c) a member of its pool
 *   while it waits, (d) whoever may decide its open request, (e) a task key
 *   on its type AND the record it is about. Since ACC-244 that is one
 *   condition, taskVisibleSql() (task-visibility.ts).
 * Everyone else gets the identical 404 — the same status and body as an id
 * that does not exist — and the refusal is a log line (ACC-101 clause b). The
 * task must be read to know any of this, so the read comes first, and a
 * missing task and a refused one end in the same throw.
 *
 * No @Permissions on its routes: like every task action endpoint, the
 * entitlement is a relationship, decided here.
 */
@Injectable()
export class TaskPageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delegationLabels: DelegationLabelService,
    // ACC-231 — the admission rule lives there, shared with the task's files.
    private readonly admission: TaskAdmissionService,
  ) {}

  async view(id: string, organizationId: string, viewer: TaskViewer): Promise<ITaskPageView> {
    const row = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: {
        assignees: { include: { user: { select: PERSON_SELECT } } },
        _count: { select: { evidence: { where: { deletedAt: null } } } },
        ...POOL_LABEL_INCLUDE,
        ...OPEN_REQUEST_INCLUDE,
        createdBy: { select: { status: true, ...PERSON_SELECT } },
        rejectedBy: { select: { id: true, name: true } },
        cancelledBy: { select: { id: true, name: true } },
        reopenedBy: { select: { id: true, name: true } },
        workflowInstanceStage: { select: { stage: { select: { nameEn: true, nameAr: true } } } },
      },
    });
    const access = row ? await this.admission.admit(row, viewer, organizationId, 'task page') : null;
    if (!row || !access) throw new NotFoundException(NOT_FOUND);

    const {
      assignees,
      _count,
      requests,
      createdBy,
      rejectedBy,
      cancelledBy,
      reopenedBy,
      workflowInstanceStage,
      assignedOrgUnit,
      assignedPosition,
      assignedCommittee,
      assignedCommitteeRoleValue,
      ...task
    } = row;
    const pool = toPoolView({ assignedOrgUnit, assignedPosition, assignedCommittee, assignedCommitteeRoleValue });
    const openRequest = toOpenRequest(requests);
    const active = assignees.filter((a) => a.removedAt === null);
    const mine = active.find((a) => a.userId === viewer.id) ?? null;
    const target = poolTargetOf(task);
    const waitingInPool = !!target && active.length === 0 && (PICKABLE_STATUSES as readonly string[]).includes(task.status);

    const [delegations, poolMemberIds, record, completedBy, stillInStep] = await Promise.all([
      this.delegationLabels.resolveMany(active, organizationId, viewer),
      waitingInPool && target ? resolvePoolMemberIds(this.prisma, target, organizationId) : Promise.resolve(null),
      this.record(task.sourceType, task.sourceId, organizationId, access.recordVisible),
      task.completedById
        ? this.prisma.user.findFirst({ where: { id: task.completedById, organizationId }, select: { id: true, name: true } })
        : Promise.resolve(null),
      task.status === 'COMPLETED' ? this.stillInStep(task, organizationId) : Promise.resolve(false),
    ]);

    const { status: _creatorStatus, ...creator } = createdBy;
    return {
      task: {
        ...task,
        evidenceCount: _count.evidence,
        pool,
        openRequest,
        canManage: access.mayManage,
      },
      record,
      stage: workflowInstanceStage?.stage ?? null,
      assignees: active.map((a) => ({
        ...toPerson(a.user),
        pickedAt: a.pickedAt,
        delegation: this.delegationLabels.lookup(a, delegations),
      })),
      poolMemberCount: poolMemberIds ? poolMemberIds.length : null,
      createdBy: toPerson(creator),
      createdByWorkflow: !!(task.workflowInstanceStageId || task.workflowInstanceId || task.sourceStageId),
      completedBy,
      rejectedBy,
      cancelledBy,
      reopenedBy,
      actions: taskActionsFor({
        status: task.status,
        requiresEvidence: task.requiresEvidence,
        evidenceCount: _count.evidence,
        viewerId: viewer.id,
        viewerIsActiveAssignee: !!mine,
        viewerPickedIt: !!mine?.pickedAt,
        anyActiveAssignee: active.length > 0,
        hasPoolTarget: !!target,
        viewerInPool: access.inPool,
        openRequest,
        mayManage: access.mayManage,
        mayDecide: access.mayDecide,
        stageEntryTask: !!task.workflowInstanceStageId,
        isMandatory: task.isMandatory,
        legacyWorkflowTask: !task.workflowInstanceStageId && !!(task.sourceStageId || task.workflowInstanceId),
        stillInStep,
      }),
    };
  }

  /**
   * The task's history, oldest first: its own audit rows, its requests' and its
   * evidence's. Three bounded reads on the (objectType, objectId) index. Each
   * row becomes a kind the page words — never the stored before/after.
   */
  async history(id: string, organizationId: string, viewer: TaskViewer): Promise<ITaskHistoryEvent[]> {
    const row = await this.prisma.task.findFirst({
      where: { id, organizationId },
      include: { assignees: true, ...OPEN_REQUEST_INCLUDE, createdBy: { select: { status: true } } },
    });
    if (!row || !(await this.admission.admit(row, viewer, organizationId, 'task history'))) throw new NotFoundException(NOT_FOUND);

    const [requests, evidence] = await Promise.all([
      this.prisma.taskRequest.findMany({ where: { taskId: id, organizationId }, select: { id: true, type: true } }),
      this.prisma.taskEvidence.findMany({ where: { taskId: id, organizationId }, select: { id: true, type: true } }),
    ]);
    const requestType = new Map(requests.map((r) => [r.id, r.type]));
    const evidenceType = new Map(evidence.map((e) => [e.id, e.type as string]));

    const rows = await this.prisma.auditLog.findMany({
      where: {
        organizationId,
        OR: [
          { objectType: 'Task', objectId: id },
          ...(requests.length ? [{ objectType: 'TaskRequest', objectId: { in: [...requestType.keys()] } }] : []),
          ...(evidence.length ? [{ objectType: 'TaskEvidence', objectId: { in: [...evidenceType.keys()] } }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        objectType: true,
        objectId: true,
        action: true,
        metadata: true,
        // Only a request's own row: the reason the person asked with.
        after: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    });

    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const kind = historyKind(r.objectType, r.action, meta);
      const asked = kind === 'request_made' ? ((r.after ?? {}) as Record<string, unknown>)['reason'] : undefined;
      return {
        at: r.createdAt,
        actorName: r.actor?.name ?? null,
        kind,
        reason: typeof asked === 'string' && asked.trim() !== '' ? asked : personReason(kind, meta),
        requestType: r.objectType === 'TaskRequest' ? (requestType.get(r.objectId ?? '') ?? null) : null,
        evidenceType: r.objectType === 'TaskEvidence' ? (evidenceType.get(r.objectId ?? '') ?? null) : null,
      };
    });
  }

  /** The record's name only for a viewer who may open it; otherwise its type alone. */
  private async record(type: string, id: string, organizationId: string, canOpen: boolean): Promise<ITaskPageView['record']> {
    let names: { nameEn: string | null; nameAr: string | null } = { nameEn: null, nameAr: null };
    if (canOpen && type === 'COMMITTEE') {
      const c = await this.prisma.committee.findFirst({ where: { id, organizationId }, select: { nameEn: true, nameAr: true } });
      if (c) names = { nameEn: c.nameEn, nameAr: c.nameAr };
    } else if (canOpen && type === 'MEETING') {
      const m = await this.prisma.meeting.findFirst({ where: { id, organizationId }, select: { title: true } });
      if (m) names = { nameEn: m.title, nameAr: null };
    }
    return { type, id, canOpen, ...names };
  }

  /** reopen()'s own question: is a Completed workflow task's record still in that step? */
  private async stillInStep(
    task: { workflowInstanceStageId: string | null; workflowInstanceId: string | null; sourceStageId: string | null },
    organizationId: string,
  ): Promise<boolean> {
    if (task.workflowInstanceStageId) {
      const entry = await this.prisma.workflowInstanceStage.findFirst({
        where: {
          id: task.workflowInstanceStageId,
          exitedAt: null,
          workflowInstance: { organizationId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        },
        select: { id: true },
      });
      return !!entry;
    }
    if (task.workflowInstanceId) {
      const instance = await this.prisma.workflowInstance.findFirst({
        where: { id: task.workflowInstanceId, organizationId },
        select: { status: true, currentStageId: true },
      });
      return (
        !!instance &&
        (instance.status === 'PENDING' || instance.status === 'IN_PROGRESS') &&
        instance.currentStageId === task.sourceStageId
      );
    }
    return true;
  }
}

// The audit trail's own words for task events, mapped to the kinds the page
// can say. An event the page does not know becomes 'changed' — worded
// "Changed", never shown as a code.
const EVENT_KINDS: Record<string, TaskHistoryKind> = {
  started: 'started',
  edited: 'edited',
  cancelled: 'cancelled',
  reopened: 'reopened',
  picked: 'picked',
  released: 'released',
  departure_returned_to_pool: 'returned_to_pool',
  departure_left_with_others: 'handed_on',
  departure_reassignment: 'reassigned',
  returned_on_reactivation: 'reassigned',
  unassigned_stage_recovery: 'stage_recovery',
  pool_escalation_skipped: 'escalation_skipped',
  pool_escalated: 'escalated',
  request_made: 'request_made',
  request_withdrawn: 'request_withdrawn',
  request_approved: 'request_approved',
  request_declined: 'request_declined',
  request_cancelled: 'request_cancelled',
  hold_started: 'hold_started',
  resumed: 'resumed',
};

export function historyKind(objectType: string, action: string, meta: Record<string, unknown>): TaskHistoryKind {
  if (objectType === 'TaskEvidence') return action === 'DELETE' ? 'evidence_removed' : 'evidence_added';
  const event = typeof meta['event'] === 'string' ? meta['event'] : null;
  if (event && EVENT_KINDS[event]) return EVENT_KINDS[event];
  if (objectType === 'TaskRequest') return action === 'CREATE' ? 'request_made' : 'changed';
  switch (action) {
    case 'CREATE':
      return 'created';
    case 'REJECT':
      return 'rejected';
    case 'DELEGATE':
      return 'reassigned';
  }
  if (meta['completedBy']) return 'completed';
  if (meta['reason'] === 'STAGE_EXIT' || meta['reason'] === 'INSTANCE_CANCELLED') return 'cancelled_by_workflow';
  if (meta['escalationSkipped']) return 'escalation_skipped';
  if (meta['escalatedTo']) return 'escalated';
  return 'changed';
}

// A reason a PERSON wrote — a rejection, a release, a reassignment, a cancel,
// a reopen, a request or a decline. The engine's codes (STAGE_EXIT, …) are not
// reasons anyone typed, so they are never shown.
const KINDS_WITH_REASON = new Set<TaskHistoryKind>([
  'rejected',
  'released',
  'reassigned',
  'cancelled',
  'reopened',
  'request_declined',
]);

function personReason(kind: TaskHistoryKind, meta: Record<string, unknown>): string | null {
  if (!KINDS_WITH_REASON.has(kind)) return null;
  const text = kind === 'request_declined' ? meta['note'] : meta['reason'];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}
