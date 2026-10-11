import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ITaskDto {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  sourceType: string;
  sourceId: string;
  sourceStageId: string | null;
  workflowInstanceId: string | null;
  meetingId: string | null;
  createdById: string;
  status: string;
  priority: string;
  dueAt: string | null;
  dueDateOverridden: boolean;
  slaBreachedAt: string | null;
  completedAt: string | null;
  completedById: string | null;
  // ACC-163 — Complete is refused while this is true and no evidence exists.
  requiresEvidence: boolean;
  // ACC-163 — set when the last active assignee rejects; cleared by reassign.
  rejectedReason: string | null;
  rejectedAt: string | null;
  rejectedById: string | null;
  // ACC-167 — the pool the task is assigned to, if any: a position in a unit,
  // or a member role on a committee. Kept after a pick, so a release or a
  // departure can hand the task back.
  assignedOrgUnitId: string | null;
  assignedPositionId: string | null;
  assignedCommitteeId: string | null;
  assignedCommitteeRoleValueId: string | null;
  // ACC-167 — when the task last entered its pool, when it escalates if nobody
  // picks it up, and when it did. Written by the server only.
  pooledAt: string | null;
  poolEscalateAt: string | null;
  poolEscalatedAt: string | null;
  // ACC-46 Section 2.7.b — managerEscalatedAt/headEscalatedAt replace the
  // old escalationUserId/escalationAfterHours; written only by
  // SlaMonitorProcessor, never by any caller.
  managerEscalatedAt: string | null;
  headEscalatedAt: string | null;
  // ACC-173 — set only while the task is ON_HOLD (an approved hold request).
  heldAt: string | null;
  onHoldUntil: string | null;
  heldFromStatus: string | null;
  // ACC-174 — the SLA window. slaLimitAt is the latest due date a person may
  // set. Null on a task from before ACC-174 until its backfill runs: a picker
  // reads the limit from the SLA preview instead of trusting a null here.
  slaStartAt: string | null;
  slaLimitAt: string | null;
  slaExtendedTo: string | null;
  // ACC-174 — a cancel by the creator (null when the engine cancelled it), and
  // the last reopen.
  cancelledReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  reopenedReason: string | null;
  reopenedAt: string | null;
  reopenedById: string | null;
  createdAt: string;
  updatedAt: string;
}

// ACC-40 §2.6.3's delegation stamp, resolved server-side. See the backend's
// delegation-label.interface.ts for why the label is resolved there:
// contextId is polymorphic (an OrgUnit id for ACTING_HEAD, the covered-for
// USER's id for OUT_OF_OFFICE_COVERAGE), so a client cannot resolve it
// without duplicating that mapping.
//
// Rendered by isArabic() selection, never `| translate` — an org unit name is
// tenant-editable data (SYSTEM-REFERENCE §9.3).
export interface ResolvedDelegationDto {
  reason: 'ACTING_HEAD' | 'OUT_OF_OFFICE_COVERAGE';
  contextId: string;
  // Null when the referenced OrgUnit/User no longer resolves. Render the
  // actor with NO qualifier in that case — never a raw id.
  contextLabelEn: string | null;
  contextLabelAr: string | null;
}

export interface TaskAssigneeDto {
  userId: string;
  userName: string;
  delegation: ResolvedDelegationDto | null;
}

// ACC-163 — the row BOTH task lists return (my-tasks, and getForSource through
// ITaskWithAssigneesDto below): the task plus how much evidence it holds, so a
// list can disable Complete before the server refuses it. One type for both
// lists, for the ACC-74 reason given below.
export interface ITaskListItemDto extends ITaskDto {
  evidenceCount: number;
  // ACC-167 — the pool, named for display; null when the task went to named
  // people only. Names are tenant data: shown by language, never translated.
  pool: TaskPoolDto | null;
  // ACC-173 — the task's PENDING extension or hold request, if any.
  openRequest: TaskOpenRequestDto | null;
  // ACC-174 — the caller may edit, cancel and reopen this task (its creator,
  // whoever acts for them, or — while the creator is gone — a tasks:reassign
  // holder). Which of those applies to the task's state is the screen's call;
  // the server re-checks every one.
  canManage: boolean;
}

// ACC-173 — mirrors the backend's ITaskOpenRequest. At most one per task.
export type TaskRequestType = 'EXTENSION' | 'ON_HOLD';

export interface TaskOpenRequestDto {
  id: string;
  type: TaskRequestType;
  requestedDueAt: string | null;
  holdUntil: string | null;
  requestedById: string;
  requestedByName: string;
  reason: string;
  createdAt: string;
}

/** A row of "Waiting for your decision". */
export interface TaskRequestForDecisionDto extends TaskOpenRequestDto {
  task: {
    id: string;
    title: string;
    sourceType: string;
    sourceId: string;
    status: string;
    priority: string;
    dueAt: string | null;
  };
}

// The new due date, or the hold date, as an ISO instant (New task's
// convention: the picked day and time read in the browser's zone).
export type CreateTaskRequestDto =
  | { type: 'EXTENSION'; requestedDueAt: string; reason: string }
  | { type: 'ON_HOLD'; holdUntil: string; reason: string };

export interface TaskRequestDto {
  id: string;
  taskId: string;
  type: TaskRequestType;
  status: string;
}

// ACC-167 — mirrors the backend's ITaskPoolView. A POSITION pool fills the
// position and unit names; a COMMITTEE_ROLE pool fills the role and committee.
export interface TaskPoolDto {
  kind: 'POSITION' | 'COMMITTEE_ROLE';
  positionNameEn: string | null;
  positionNameAr: string | null;
  orgUnitNameEn: string | null;
  orgUnitNameAr: string | null;
  roleLabelEn: string | null;
  roleLabelAr: string | null;
  committeeNameEn: string | null;
  committeeNameAr: string | null;
}

// ACC-167 — a row of the caller's OWN list (my-tasks). `pickedByMe` is what
// makes Release available: someone the assigner chose directly rejects
// instead. Its own type for the ACC-74 reason below — only my-tasks knows it.
export interface IMyTaskListItemDto extends ITaskListItemDto {
  pickedByMe: boolean;
}

// ACC-76 — returned by getForSource() ONLY. Deliberately a separate type
// rather than an optional field on ITaskDto: an optional field populated by
// exactly one endpoint is the trap ACC-74 hit, where role-list bound to
// `permissions?.length` and rendered 0 for every role, silently, forever.
export interface ITaskWithAssigneesDto extends ITaskListItemDto {
  assignees: TaskAssigneeDto[];
  // ACC-163 — who rejected a REJECTED task; null on every other task.
  rejectedBy: { id: string; name: string } | null;
  // ACC-174 — who cancelled it, beside cancelledReason; null when the engine did.
  cancelledBy: { id: string; name: string } | null;
}

// ACC-163 — the statuses my-tasks can be filtered by. OVERDUE is not one of
// them: overdue is a separate flag (Q8), combinable with any status.
export type MyTaskStatusFilter = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface MyTasksQuery {
  status?: MyTaskStatusFilter;
  overdue?: boolean;
}

export interface CreateTaskDto {
  title: string;
  description?: string;
  sourceType: string;
  sourceId: string;
  sourceStageId?: string;
  workflowInstanceId?: string;
  meetingId?: string;
  // Named people. The task form sends `assignTo` instead (ACC-167); sending
  // both is refused by the server.
  assigneeUserIds?: string[];
  assignTo?: AssignTargetDto;
  priority?: string;
  dueDate?: string;
  // ACC-163 — Complete is refused until at least one piece of evidence exists.
  requiresEvidence?: boolean;
}

// ACC-167 — who a task goes to, chosen the way the organisation is shaped:
// a unit then a position in it, or (on a committee's own task) a member role,
// each optionally narrowed to one person. The server decides the outcome:
// that person; a single-holder position's holder; otherwise a pool.
export type AssignTargetDto =
  | { kind: 'POSITION'; orgUnitId: string; positionId: string; userId?: string }
  | { kind: 'COMMITTEE_ROLE'; committeeId: string; roleValueId: string; userId?: string };

// ACC-167 — exactly one of the two: `assignTo` (the picker) or the legacy
// named list. The server refuses both or neither.
export interface ReassignTaskDto {
  newAssigneeUserIds?: string[];
  assignTo?: AssignTargetDto;
  reason: string;
}

export interface ReleaseTaskDto {
  reason: string;
}

// ACC-167 — the assignment picker's rows. Only what the cascade needs: no
// email, no status, nothing else about a person.
export interface AssignableUnitDto {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
}

export interface AssignablePositionDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
  isSingleAssignee: boolean;
  // Active holders of this position IN THE CHOSEN UNIT. Zero is a real
  // choice for a single-holder position: the task waits for its holder.
  holderCount: number;
}

export interface AssignableHolderDto {
  id: string;
  name: string;
  positionNameEn: string | null;
  positionNameAr: string | null;
}

export interface AssignableCommitteeRoleDto {
  id: string;
  labelEn: string;
  labelAr: string | null;
  memberCount: number;
}

export interface RejectTaskDto {
  reason: string;
}

// ACC-174 — the creator's edit: any of the four, at least one. dueDate is an
// ISO instant (New task's convention).
export interface UpdateTaskDto {
  title?: string;
  description?: string | null;
  dueDate?: string;
  priority?: TaskPriority;
}

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface CancelTaskDto {
  reason: string;
}

export interface ReopenTaskDto {
  reason: string;
  dueDate?: string;
}

// ACC-174 — per priority, the due date the SLA gives and the latest a person
// may set. From now (New task) or from a task's own SLA start (Edit).
export interface SlaWindowDto {
  dueAt: string;
  limitAt: string;
}
export type SlaPreviewDto = Record<TaskPriority, SlaWindowDto>;

// ACC-163 (Q11) — new evidence is a link (http or https) or a reference to a
// record. A note is a comment, not proof. ACC-177 — a file goes through
// addFileEvidence() instead, as multipart.
export type AddTaskEvidenceDto =
  | { type: 'LINK'; url: string; linkTitle?: string }
  | { type: 'INTERNAL_REFERENCE'; refType: string; refId: string };

// ACC-177 — one piece of evidence as the evidence list shows it. A file is its
// summary only; where it is stored never reaches the browser.
export interface ITaskEvidenceDto {
  id: string;
  /** LINK | INTERNAL_REFERENCE | ATTACHMENT (a file, labelled "File") | TEXT (legacy) */
  type: string;
  url: string | null;
  linkTitle: string | null;
  refType: string | null;
  refId: string | null;
  refDisplay: string | null;
  file: { id: string; name: string; mimeType: string; sizeBytes: number; uploadedAt: string } | null;
  uploadedBy: { id: string; name: string };
  uploadedAt: string;
  canDelete: boolean;
}

export interface ITaskEvidenceListDto {
  items: ITaskEvidenceDto[];
  /** The viewer is an active assignee and the task is open or on hold. */
  canAdd: boolean;
  /** Completed or cancelled: the evidence is read-only for everyone. */
  closed: boolean;
}

/**
 * Where to fetch a file for the next fifteen minutes. `viaApi`: `url` is a
 * path on the API (a local folder's token route); otherwise it is a
 * pre-signed storage URL.
 */
export interface IFileDownloadDto {
  url: string;
  viaApi: boolean;
  expiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tasks`;

  getMyTasks(query: MyTasksQuery = {}): Observable<IMyTaskListItemDto[]> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.overdue) params = params.set('overdue', 'true');
    return this.http.get<IMyTaskListItemDto[]>(`${this.base}/my-tasks`, { params });
  }

  // ACC-167 — waiting tasks in the pools the caller is in right now.
  // Self-scoped, like my-tasks.
  getAvailable(): Observable<ITaskListItemDto[]> {
    return this.http.get<ITaskListItemDto[]>(`${this.base}/available`);
  }

  // ACC-167 — a member of the pool takes the task. 409 when someone was first.
  pick(id: string): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/pick`, {});
  }

  // ACC-167 — whoever picked the task up hands it back, with a reason.
  release(id: string, dto: ReleaseTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/release`, dto);
  }

  // ACC-167 — the assignment picker. `taskId` names the task being
  // reassigned, which is how its creator or a tasks:reassign holder reaches
  // the picker without tasks:create.
  getAssignableUnits(taskId?: string): Observable<AssignableUnitDto[]> {
    return this.http.get<AssignableUnitDto[]>(`${this.base}/assignment/units`, {
      params: withTask(new HttpParams(), taskId),
    });
  }

  getAssignablePositions(orgUnitId: string, taskId?: string): Observable<AssignablePositionDto[]> {
    return this.http.get<AssignablePositionDto[]>(`${this.base}/assignment/positions`, {
      params: withTask(new HttpParams().set('orgUnitId', orgUnitId), taskId),
    });
  }

  getAssignees(orgUnitId: string, positionId: string, taskId?: string): Observable<AssignableHolderDto[]> {
    return this.http.get<AssignableHolderDto[]>(`${this.base}/assignees`, {
      params: withTask(new HttpParams().set('orgUnitId', orgUnitId).set('positionId', positionId), taskId),
    });
  }

  getAssignableCommitteeRoles(committeeId: string, taskId?: string): Observable<AssignableCommitteeRoleDto[]> {
    return this.http.get<AssignableCommitteeRoleDto[]>(`${this.base}/assignment/committee-roles`, {
      params: withTask(new HttpParams().set('committeeId', committeeId), taskId),
    });
  }

  getCommitteeAssignees(committeeId: string, roleValueId: string, taskId?: string): Observable<AssignableHolderDto[]> {
    return this.http.get<AssignableHolderDto[]>(`${this.base}/assignees/committee`, {
      params: withTask(new HttpParams().set('committeeId', committeeId).set('roleValueId', roleValueId), taskId),
    });
  }

  // ACC-76 — the only list endpoint carrying assignees. Requires tasks:view.
  getForSource(sourceType: string, sourceId: string): Observable<ITaskWithAssigneesDto[]> {
    const params = new HttpParams().set('sourceType', sourceType).set('sourceId', sourceId);
    return this.http.get<ITaskWithAssigneesDto[]>(this.base, { params });
  }

  getUnassigned(): Observable<ITaskDto[]> {
    return this.http.get<ITaskDto[]>(`${this.base}/unassigned`);
  }

  getById(id: string): Observable<ITaskDto> {
    return this.http.get<ITaskDto>(`${this.base}/${id}`);
  }

  create(dto: CreateTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(this.base, dto);
  }

  complete(id: string): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/complete`, {});
  }

  // ACC-163 — self-scoped to an active assignee, like complete().
  start(id: string): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/start`, {});
  }

  reject(id: string, dto: RejectTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/reject`, dto);
  }

  // ACC-163 — open to a tasks:reassign holder OR the task's creator; the
  // server decides, and refuses anyone else as not found.
  reassign(id: string, dto: ReassignTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/reassign`, dto);
  }

  // ACC-173 — extension and hold requests. The server decides who may: the
  // assignee asks, the asker withdraws, the creator (or their cover, or a
  // tasks:reassign holder) decides. Anyone else is told the task is not found.
  requestChange(taskId: string, dto: CreateTaskRequestDto): Observable<TaskRequestDto> {
    return this.http.post<TaskRequestDto>(`${this.base}/${taskId}/requests`, dto);
  }

  withdrawRequest(taskId: string, requestId: string): Observable<TaskRequestDto> {
    return this.http.post<TaskRequestDto>(`${this.base}/${taskId}/requests/${requestId}/withdraw`, {});
  }

  approveRequest(taskId: string, requestId: string, note?: string): Observable<TaskRequestDto> {
    return this.http.post<TaskRequestDto>(`${this.base}/${taskId}/requests/${requestId}/approve`, note ? { note } : {});
  }

  declineRequest(taskId: string, requestId: string, note: string): Observable<TaskRequestDto> {
    return this.http.post<TaskRequestDto>(`${this.base}/${taskId}/requests/${requestId}/decline`, { note });
  }

  // "Resume now" — the assignee, or anyone who may decide.
  resume(taskId: string): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${taskId}/resume`, {});
  }

  // "Waiting for your decision" — self-scoped.
  getAwaitingDecision(): Observable<TaskRequestForDecisionDto[]> {
    return this.http.get<TaskRequestForDecisionDto[]>(`${this.base}/requests/awaiting-decision`);
  }

  // ACC-174 — the creator's own actions. The server decides who may (the
  // creator, whoever acts for them, or a tasks:reassign holder while the
  // creator is gone) and tells anyone else the task is not found.
  update(id: string, dto: UpdateTaskDto): Observable<ITaskDto> {
    return this.http.patch<ITaskDto>(`${this.base}/${id}`, dto);
  }

  cancel(id: string, dto: CancelTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/cancel`, dto);
  }

  reopen(id: string, dto: ReopenTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/reopen`, dto);
  }

  // New task's picker: every priority's due date and limit from now. Needs
  // tasks:create, like creating one.
  getSlaPreview(): Observable<SlaPreviewDto> {
    return this.http.get<SlaPreviewDto>(`${this.base}/sla-preview`);
  }

  // Edit's picker: the same, from this task's own SLA start. `restart` is
  // Reopen's: from now, as a reopened task's SLA restarts.
  getTaskSlaPreview(id: string, restart = false): Observable<SlaPreviewDto> {
    const params = restart ? new HttpParams().set('restart', 'true') : new HttpParams();
    return this.http.get<SlaPreviewDto>(`${this.base}/${id}/sla-preview`, { params });
  }

  addEvidence(taskId: string, dto: AddTaskEvidenceDto): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/${taskId}/evidence`, dto);
  }

  // ACC-177 — a file, as multipart, with upload progress. One file per call.
  addFileEvidence(taskId: string, file: File): Observable<HttpEvent<ITaskEvidenceDto>> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<ITaskEvidenceDto>(`${this.base}/${taskId}/evidence/file`, body, {
      reportProgress: true,
      observe: 'events',
    });
  }

  listEvidence(taskId: string): Observable<ITaskEvidenceListDto> {
    return this.http.get<ITaskEvidenceListDto>(`${this.base}/${taskId}/evidence`);
  }

  downloadEvidence(taskId: string, evidenceId: string): Observable<IFileDownloadDto> {
    return this.http.get<IFileDownloadDto>(`${this.base}/${taskId}/evidence/${evidenceId}/download`);
  }

  /** ACC-189 — the in-app viewer's mint: the download's entitlement, 409 for a type it does not render. */
  viewEvidence(taskId: string, evidenceId: string): Observable<IFileDownloadDto> {
    return this.http.get<IFileDownloadDto>(`${this.base}/${taskId}/evidence/${evidenceId}/view`);
  }

  removeEvidence(taskId: string, evidenceId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${taskId}/evidence/${evidenceId}`);
  }
}

function withTask(params: HttpParams, taskId?: string): HttpParams {
  return taskId ? params.set('taskId', taskId) : params;
}
