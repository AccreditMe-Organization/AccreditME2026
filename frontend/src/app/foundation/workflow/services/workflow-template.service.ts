import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface WorkflowTemplateDto {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string;
  objectType: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stages?: WorkflowStageDto[];
}

export interface WorkflowStageDto {
  id: string;
  workflowTemplateId: string;
  nameEn: string;
  nameAr: string;
  description: string | null;
  order: number;
  slaWorkingHours: number | null;
  isInitial: boolean;
  isFinal: boolean;
  approvalMode: string;
  parallelThreshold: string | null;
  committeeId: string | null;
  assigneeStrategy: string;
  assigneeUserId: string | null;
  assigneeRoleId: string | null;
  // ACC-28 — narrows the COMMITTEE assigneeStrategy case to members holding
  // this committee_member_role lookup value (e.g. "chairman"). Only
  // meaningful when assigneeStrategy === 'COMMITTEE'; null preserves the
  // pre-ACC-28 "every active member" behavior.
  assigneeCommitteeRoleValueId: string | null;
  // ACC-54 — the POSITION_FIXED pair: resolves to whoever holds this
  // position in this specific unit. Only meaningful when
  // assigneeStrategy === 'POSITION_FIXED'.
  assigneePositionId: string | null;
  assigneeOrgUnitId: string | null;
  escalationConfig: Record<string, unknown> | null;
  transitions?: WorkflowTransitionDto[];
}

export interface WorkflowTransitionDto {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  requiredPermission: string | null;
  triggerCondition: string;
  triggerUserId: string | null;
  triggerRoleId: string | null;
  validatorConfig: Record<string, unknown> | null;
  isApprovalPath: boolean;
  actions?: WorkflowTransitionActionDto[];
}

// ACC-55 — why a saved transition's requiredPermission may not do what the
// configurer intended. Always advisory: the write has already succeeded by
// the time this arrives.
//
//   UNKNOWN_PERMISSION    no permission with this module:action exists.
//                         Deliberately does not distinguish a typo from a
//                         deliberate forward reference — 45 seeded
//                         transitions legitimately carry strings for unbuilt
//                         modules (capa:*, incidents:manage), and nothing at
//                         write time can tell those from 'committees:aprove'.
//   NO_ACTIVE_ROLE_HOLDS  the permission is real, but no active role in this
//                         tenant grants it, so nobody can ever fire the
//                         transition.
export type TransitionPermissionWarning = 'UNKNOWN_PERMISSION' | 'NO_ACTIVE_ROLE_HOLDS';

// Returned by addTransition/updateTransition only. Reads still return the
// bare WorkflowTransitionDto — resolving the warning costs two backend
// queries per transition, and getTemplate() returns a whole template's worth.
export interface WorkflowTransitionWriteResult {
  transition: WorkflowTransitionDto;
  permissionWarning: TransitionPermissionWarning | null;
}

export interface WorkflowTransitionActionDto {
  id: string;
  workflowTransitionId: string;
  actionType: string;
  order: number;
  isEnabled: boolean;
  configJson: Record<string, unknown> | null;
}

export interface CreateWorkflowTemplateDto {
  nameEn: string;
  nameAr: string;
  objectType: string;
  isDefault?: boolean;
}

export interface UpdateWorkflowTemplateDto {
  nameEn?: string;
  nameAr?: string;
  objectType?: string;
  isDefault?: boolean;
}

export interface CreateWorkflowStageDto {
  nameEn: string;
  nameAr: string;
  description?: string;
  order: number;
  slaWorkingHours?: number;
  isInitial?: boolean;
  isFinal?: boolean;
  approvalMode: string;
  parallelThreshold?: string;
  committeeId?: string;
  assigneeStrategy: string;
  assigneeUserId?: string;
  assigneeRoleId?: string;
  // string | null (not just string | undefined) — null is a genuine,
  // meaningful value here: explicitly clearing a previously-set filter back
  // to "all active committee members," not merely "field not provided."
  assigneeCommitteeRoleValueId?: string | null;
  // ACC-54 — string | null for the same reason as the field above: null
  // explicitly clears a previously-set value (e.g. switching a stage away
  // from POSITION_FIXED), which the backend distinguishes from "not
  // provided" via its own `!== undefined` check.
  assigneePositionId?: string | null;
  assigneeOrgUnitId?: string | null;
  escalationConfig?: Record<string, unknown>[];
}

export type UpdateWorkflowStageDto = Partial<CreateWorkflowStageDto>;

export interface CreateWorkflowTransitionDto {
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string;
  // ACC-55 — `| null` clears a previously-set permission (the picker's
  // "no permission required" option). The backend distinguishes null from
  // undefined via `!== undefined`, so `|| undefined` would silently mean
  // "leave unchanged" and make clearing impossible.
  requiredPermission?: string | null;
  triggerCondition: string;
  triggerUserId?: string;
  triggerRoleId?: string;
  validatorConfig?: Record<string, unknown>;
}

export interface UpdateWorkflowTransitionDto {
  labelEn?: string;
  labelAr?: string;
  // ACC-55 — `| null` clears a previously-set permission (the picker's
  // "no permission required" option). The backend distinguishes null from
  // undefined via `!== undefined`, so `|| undefined` would silently mean
  // "leave unchanged" and make clearing impossible.
  requiredPermission?: string | null;
  triggerCondition?: string;
  triggerUserId?: string;
  triggerRoleId?: string;
  validatorConfig?: Record<string, unknown>;
  isApprovalPath?: boolean;
}

export interface CreateWorkflowTransitionActionDto {
  actionType: string;
  order: number;
  isEnabled?: boolean;
  configJson?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class WorkflowTemplateService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/workflow-templates`;

  // ── Templates ────────────────────────────────────────────────────────────────

  listTemplates(): Observable<WorkflowTemplateDto[]> {
    return this.http.get<WorkflowTemplateDto[]>(this.base);
  }

  getTemplate(id: string): Observable<WorkflowTemplateDto> {
    return this.http.get<WorkflowTemplateDto>(`${this.base}/${id}`);
  }

  createTemplate(dto: CreateWorkflowTemplateDto): Observable<WorkflowTemplateDto> {
    return this.http.post<WorkflowTemplateDto>(this.base, dto);
  }

  updateTemplate(id: string, dto: UpdateWorkflowTemplateDto): Observable<WorkflowTemplateDto> {
    return this.http.patch<WorkflowTemplateDto>(`${this.base}/${id}`, dto);
  }

  setDefault(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/set-default`, {});
  }

  deactivateTemplate(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/deactivate`, {});
  }

  // ── Stages ───────────────────────────────────────────────────────────────────

  addStage(templateId: string, dto: CreateWorkflowStageDto): Observable<WorkflowStageDto> {
    return this.http.post<WorkflowStageDto>(`${this.base}/${templateId}/stages`, dto);
  }

  updateStage(stageId: string, dto: UpdateWorkflowStageDto): Observable<WorkflowStageDto> {
    return this.http.patch<WorkflowStageDto>(`${this.base}/stages/${stageId}`, dto);
  }

  removeStage(stageId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/stages/${stageId}`);
  }

  // ── Transitions ──────────────────────────────────────────────────────────────

  // ACC-55 — both return { transition, permissionWarning }. The permission
  // LIST itself is not fetched here: RoleService.listAllPermissions() already
  // calls GET /roles/permissions and is already consumed by
  // role-permission-matrix, so the editor reuses that rather than adding a
  // second call to the same endpoint from a second service.
  addTransition(dto: CreateWorkflowTransitionDto): Observable<WorkflowTransitionWriteResult> {
    return this.http.post<WorkflowTransitionWriteResult>(`${this.base}/transitions`, dto);
  }

  updateTransition(
    id: string,
    dto: UpdateWorkflowTransitionDto,
  ): Observable<WorkflowTransitionWriteResult> {
    return this.http.patch<WorkflowTransitionWriteResult>(`${this.base}/transitions/${id}`, dto);
  }

  removeTransition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/transitions/${id}`);
  }

  // ── Transition Actions ───────────────────────────────────────────────────────

  addTransitionAction(
    transitionId: string,
    dto: CreateWorkflowTransitionActionDto,
  ): Observable<WorkflowTransitionActionDto> {
    return this.http.post<WorkflowTransitionActionDto>(
      `${this.base}/transitions/${transitionId}/actions`,
      dto,
    );
  }

  updateTransitionAction(
    id: string,
    dto: Partial<CreateWorkflowTransitionActionDto>,
  ): Observable<WorkflowTransitionActionDto> {
    return this.http.patch<WorkflowTransitionActionDto>(`${this.base}/transitions/actions/${id}`, dto);
  }

  removeTransitionAction(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/transitions/actions/${id}`);
  }
}
