import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface WorkflowTemplateDto {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  objectType: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stages?: WorkflowStageDto[];
  // ACC-208 — detail reads only. Which relative assignment routes this
  // template's record type can resolve (from the backend's RECORD_ROUTES, so
  // no copy of it lives here), and each priority's due time in working hours.
  recordRoutes?: { unit: boolean; committee: boolean };
  taskDueHours?: TaskDueHours;
  // ACC-255 — detail reads only, from the backend registries (record-registry.ts):
  // the record actions a stage of this type may allow, and the meanings a stage
  // may carry, in registry order. Served, never copied here.
  recordActions?: WorkflowRecordActionDto[];
  stageFlags?: WorkflowStageFlagDto[];
}

export interface WorkflowRecordActionDto {
  key: string;
  labelKey: string;
}

export interface WorkflowStageFlagDto {
  key: string;
  labelKey: string;
  cardinality: 'any' | 'exactlyOne';
}

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TaskDueHours = Record<TaskPriority, number>;

export interface WorkflowStageDto {
  id: string;
  workflowTemplateId: string;
  nameEn: string;
  nameAr: string | null;
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
  // ACC-190 — on the detail read: how many tasks entering this stage creates,
  // and the longest one's due time in working hours (null with none).
  taskDefinitionCount?: number;
  longestTaskHours?: number | null;
  // ACC-255 — the record actions this stage allows (keys, registry order) and
  // what it means (flag keys).
  actions?: string[];
  flags?: string[];
}

export interface WorkflowTransitionDto {
  id: string;
  fromStageId: string;
  toStageId: string;
  labelEn: string;
  labelAr: string | null;
  requiredPermission: string | null;
  triggerCondition: string;
  triggerUserId: string | null;
  triggerRoleId: string | null;
  validatorConfig: Record<string, unknown> | null;
  isApprovalPath: boolean;
  // ACC-190 — ADVANCE is held by the stage's open mandatory tasks; RETURN and
  // EXIT never are. Never inferred from stage order.
  kind: WorkflowTransitionKind;
  actions?: WorkflowTransitionActionDto[];
}

export type WorkflowTransitionKind = 'ADVANCE' | 'RETURN' | 'EXIT';
export const WORKFLOW_TRANSITION_KINDS: readonly WorkflowTransitionKind[] = ['ADVANCE', 'RETURN', 'EXIT'];

// ── ACC-190 / ACC-208 — task definitions on a stage ─────────────────────────

export type StageTaskAssignKind = 'POSITION' | 'RECORD_UNIT_POSITION' | 'COMMITTEE_ROLE' | 'RECORD_COMMITTEE_ROLE';

/** A non-blocking note on a save, and on each list row (ACC-55's contract). */
export type StageTaskDefinitionWarning = 'POSITION_HAS_NO_HOLDER' | 'POOL_EMPTY' | null;

interface NamedRef {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface StageTaskDefinitionDto {
  id: string;
  stageId: string;
  order: number;
  titleEn: string;
  titleAr: string | null;
  description: string | null;
  isMandatory: boolean;
  requiresEvidence: boolean;
  priority: TaskPriority;
  assignKind: StageTaskAssignKind;
  orgUnitId: string | null;
  positionId: string | null;
  userId: string | null;
  committeeId: string | null;
  committeeRoleValueId: string | null;
  orgUnit: NamedRef | null;
  position: NamedRef | null;
  user: { id: string; name: string } | null;
  committee: NamedRef | null;
  committeeRole: { id: string; labelEn: string; labelAr: string | null } | null;
  /** The priority's due time, in working hours from stage entry. */
  dueAfterHours: number;
  createdAt: string;
  updatedAt: string;
}

/** A list row: the same warning a save returns, and how many tasks it has created. */
export interface StageTaskDefinitionListItemDto extends StageTaskDefinitionDto {
  warning: StageTaskDefinitionWarning;
  createdTaskCount: number;
}

export interface StageTaskDefinitionSavedDto {
  definition: StageTaskDefinitionDto;
  warning: StageTaskDefinitionWarning;
}

export interface StageTaskDefinitionWriteDto {
  titleEn: string;
  titleAr?: string | null;
  description?: string | null;
  isMandatory: boolean;
  requiresEvidence?: boolean;
  priority: TaskPriority;
  assignKind: StageTaskAssignKind;
  orgUnitId?: string | null;
  positionId?: string | null;
  userId?: string | null;
  committeeId?: string | null;
  committeeRoleValueId?: string | null;
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
  kind?: WorkflowTransitionKind;
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
  kind?: WorkflowTransitionKind;
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

  // ACC-76 — IN-FLIGHT COALESCING, deliberately not a cache.
  //
  // The problem it solves: an object-detail page has more than one consumer
  // of the same template. WorkflowTransitionActionsComponent loads it to find
  // the current stage's outgoing transitions, and committee-detail loaded it
  // again, independently, for the stage label — two identical requests fired
  // in the same change-detection cycle. Two is the point to fix that; three is
  // when someone asks why the page makes duplicate calls.
  //
  // WHY NOT A CACHE. A retained cache would need invalidating on every
  // template mutation, and the mutation methods below cannot all derive their
  // template id (updateStage takes a stageId; removeTransition takes a
  // transition id), so the only safe invalidation would be "clear everything
  // on any write". That is more machinery, and it still leaves a page opened
  // later showing a template another user has since edited. Coalescing has
  // neither problem: the entry exists only while the request is in flight, so
  // a later page load always re-fetches, and no write needs to know about it.
  //
  // finalize() before shareReplay() so the entry is dropped when the request
  // settles — on error too, so a failure does not pin a broken observable.
  private readonly inFlightTemplates = new Map<string, Observable<WorkflowTemplateDto>>();

  getTemplate(id: string): Observable<WorkflowTemplateDto> {
    const existing = this.inFlightTemplates.get(id);
    if (existing) return existing;

    const request = this.http.get<WorkflowTemplateDto>(`${this.base}/${id}`).pipe(
      finalize(() => this.inFlightTemplates.delete(id)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.inFlightTemplates.set(id, request);
    return request;
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

  // ── Task definitions on a stage (ACC-190, ACC-208) ────────────────────────

  listStageTaskDefinitions(stageId: string): Observable<StageTaskDefinitionListItemDto[]> {
    return this.http.get<StageTaskDefinitionListItemDto[]>(`${this.base}/stages/${stageId}/task-definitions`);
  }

  addStageTaskDefinition(stageId: string, dto: StageTaskDefinitionWriteDto): Observable<StageTaskDefinitionSavedDto> {
    return this.http.post<StageTaskDefinitionSavedDto>(`${this.base}/stages/${stageId}/task-definitions`, dto);
  }

  updateStageTaskDefinition(id: string, dto: Partial<StageTaskDefinitionWriteDto>): Observable<StageTaskDefinitionSavedDto> {
    return this.http.patch<StageTaskDefinitionSavedDto>(`${this.base}/task-definitions/${id}`, dto);
  }

  removeStageTaskDefinition(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/task-definitions/${id}`);
  }

  /** The new order must name every definition of the stage, once each. */
  reorderStageTaskDefinitions(stageId: string, ids: string[]): Observable<StageTaskDefinitionListItemDto[]> {
    return this.http.post<StageTaskDefinitionListItemDto[]>(`${this.base}/stages/${stageId}/task-definitions/order`, { ids });
  }
}
