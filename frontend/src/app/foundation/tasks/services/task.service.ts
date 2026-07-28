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
  escalationUserId: string | null;
  escalationAfterHours: number | null;
  createdAt: string;
  updatedAt: string;
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
  escalationUserId?: string;
  escalationAfterHours?: number;
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

  getForSource(sourceType: string, sourceId: string): Observable<ITaskDto[]> {
    const params = new HttpParams().set('sourceType', sourceType).set('sourceId', sourceId);
    return this.http.get<ITaskDto[]>(this.base, { params });
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
