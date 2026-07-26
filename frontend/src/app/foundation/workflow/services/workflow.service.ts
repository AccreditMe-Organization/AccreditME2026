import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface WorkflowInstanceDto {
  id: string;
  organizationId: string;
  workflowTemplateId: string;
  objectType: string;
  objectId: string;
  status: string;
  currentStageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowApprovalDto {
  id: string;
  workflowInstanceStageId: string;
  approverId: string;
  decision: string;
  comment: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface TriggerTransitionDto {
  transitionId: string;
  comment?: string;
}

export interface SubmitApprovalDto {
  decision: 'APPROVED' | 'APPROVED_WITH_COMMENTS' | 'RETURNED' | 'ABSTAINED';
  comment?: string;
}

@Injectable({ providedIn: 'root' })
export class WorkflowService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/workflows`;

  getInstance(id: string): Observable<WorkflowInstanceDto> {
    return this.http.get<WorkflowInstanceDto>(`${this.base}/instances/${id}`);
  }

  getInstancesByObject(objectType: string, objectId: string): Observable<WorkflowInstanceDto[]> {
    const params = new HttpParams().set('objectType', objectType).set('objectId', objectId);
    return this.http.get<WorkflowInstanceDto[]>(`${this.base}/instances`, { params });
  }

  triggerTransition(instanceId: string, dto: TriggerTransitionDto): Observable<WorkflowInstanceDto> {
    return this.http.post<WorkflowInstanceDto>(`${this.base}/instances/${instanceId}/transitions`, dto);
  }

  submitApproval(instanceStageId: string, dto: SubmitApprovalDto): Observable<WorkflowApprovalDto> {
    return this.http.post<WorkflowApprovalDto>(
      `${this.base}/instance-stages/${instanceStageId}/approvals`,
      dto,
    );
  }

  cancelInstance(instanceId: string, reason: string): Observable<void> {
    return this.http.post<void>(`${this.base}/instances/${instanceId}/cancel`, { reason });
  }
}
