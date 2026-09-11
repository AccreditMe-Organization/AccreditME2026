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

// ACC-76 — returned by getForSource() ONLY. Deliberately a separate type
// rather than an optional field on ITaskDto: an optional field populated by
// exactly one endpoint is the trap ACC-74 hit, where role-list bound to
// `permissions?.length` and rendered 0 for every role, silently, forever.
export interface ITaskWithAssigneesDto extends ITaskDto {
  assignees: TaskAssigneeDto[];
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
}

export interface ReassignTaskDto {
  newAssigneeUserIds: string[];
  reason: string;
}

export interface AddTaskEvidenceDto {
  type: string;
  content?: string;
  s3Key?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  url?: string;
  linkTitle?: string;
  refType?: string;
  refId?: string;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tasks`;

  getMyTasks(status?: string): Observable<ITaskDto[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<ITaskDto[]>(`${this.base}/my-tasks`, { params });
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

  reassign(id: string, dto: ReassignTaskDto): Observable<ITaskDto> {
    return this.http.post<ITaskDto>(`${this.base}/${id}/reassign`, dto);
  }

  addEvidence(taskId: string, dto: AddTaskEvidenceDto): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/${taskId}/evidence`, dto);
  }
}
