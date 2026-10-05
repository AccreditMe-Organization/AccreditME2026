import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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
  // ACC-46 Section 2.7.b — managerEscalatedAt/headEscalatedAt replace the
  // old escalationUserId/escalationAfterHours; written only by
  // SlaMonitorProcessor, never by any caller.
  managerEscalatedAt: string | null;
  headEscalatedAt: string | null;
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
}

// ACC-76 — returned by getForSource() ONLY. Deliberately a separate type
// rather than an optional field on ITaskDto: an optional field populated by
// exactly one endpoint is the trap ACC-74 hit, where role-list bound to
// `permissions?.length` and rendered 0 for every role, silently, forever.
export interface ITaskWithAssigneesDto extends ITaskListItemDto {
  assignees: TaskAssigneeDto[];
  // ACC-163 — who rejected a REJECTED task; null on every other task.
  rejectedBy: { id: string; name: string } | null;
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
  assigneeUserIds: string[];
  priority?: string;
  dueDate?: string;
  // ACC-163 — Complete is refused until at least one piece of evidence exists.
  requiresEvidence?: boolean;
}

export interface ReassignTaskDto {
  newAssigneeUserIds: string[];
  reason: string;
}

export interface RejectTaskDto {
  reason: string;
}

// ACC-163 (Q11) — new evidence is a link (http or https) or a reference to a
// record. A note is a comment, not proof, and attachments wait for storage.
export type AddTaskEvidenceDto =
  | { type: 'LINK'; url: string; linkTitle?: string }
  | { type: 'INTERNAL_REFERENCE'; refType: string; refId: string };

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tasks`;

  getMyTasks(query: MyTasksQuery = {}): Observable<ITaskListItemDto[]> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.overdue) params = params.set('overdue', 'true');
    return this.http.get<ITaskListItemDto[]>(`${this.base}/my-tasks`, { params });
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

  addEvidence(taskId: string, dto: AddTaskEvidenceDto): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/${taskId}/evidence`, dto);
  }
}
