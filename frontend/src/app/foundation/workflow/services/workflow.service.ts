import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ResolvedDelegationDto } from '../../tasks/services/task.service';

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
  unassignedTaskWarnings: string[];
}

// ACC-76 — one entry per WorkflowInstanceStage row: an object's real journey,
// not a progression over WorkflowStage.order.
//
// A stage entered more than once appears more than once. Committee's seeded
// template has a TERMS_REVIEW -> FORMATION "Revise Terms" transition, so a
// real committee's path can read Formation, Terms Review, Formation, Terms
// Review — four visits across two stages. `order` cannot express that; it is
// a display field, not a traversal record.
export interface WorkflowStageVisitDto {
  // The instance-stage row id, NOT stageId — stage ids repeat across visits
  // and would collide as a @for track key.
  id: string;
  stageId: string;
  // Tenant-editable: rendered by isArabic() selection, never `| translate`.
  stageNameEn: string;
  stageNameAr: string;
  enteredAt: string;
  // Null marks the open visit — the current stage. Derived from the data
  // rather than from currentStageId, which cannot say WHICH of two visits to
  // the same stage is live.
  exitedAt: string | null;
  outcome: string;
  actorId: string | null;
  // The person who ENTERED this stage — actorId is written once at creation
  // and never overwritten by whoever later left.
  actorName: string | null;
  // The transition that caused entry into this stage. Derived server-side
  // from the (previous stage -> this stage) pair; null on the first visit and
  // when a pair is ambiguous. Tenant-editable — isArabic(), never translate.
  transitionLabelEn: string | null;
  transitionLabelAr: string | null;
  // WHY that transition was fired. Carries the PREVIOUS visit comment: a
  // comment is written at exit, so it explains the transition into the NEXT
  // stage, not the row it physically sits on.
  comment: string | null;
  isUnassigned: boolean;
  delegation: ResolvedDelegationDto | null;
}

// One entry per stage the template defines — every stage, reached or not.
// This is the SEQUENCE view: what the process is, and where in it we are.
export interface WorkflowStageSequenceEntryDto {
  id: string;
  nameEn: string;
  nameAr: string;
  order: number;
  // 0 = not yet reached. >1 = the record has been here more than once, which
  // the sequence shows rather than flattening — the one honest way a linear
  // list can admit a loop happened.
  visitCount: number;
  // The stage holding the open visit. At most one; none once the instance has
  // exited a final stage.
  isCurrent: boolean;
}

export interface WorkflowStageHistoryDto {
  instanceId: string;
  // The sequence. Always every stage, in order.
  stages: WorkflowStageSequenceEntryDto[];
  // The chronology. Repeats preserved. Neither substitutes for the other —
  // see the backend interface for why.
  visits: WorkflowStageVisitDto[];
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

  // ACC-76 — requires workflows:view, same as the two reads around it. A
  // caller without it gets a 403 and the stage indicator renders nothing,
  // which is how the plain "Current Stage" label already behaved.
  getStageHistory(instanceId: string): Observable<WorkflowStageHistoryDto> {
    return this.http.get<WorkflowStageHistoryDto>(
      `${this.base}/instances/${instanceId}/stage-history`,
    );
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
