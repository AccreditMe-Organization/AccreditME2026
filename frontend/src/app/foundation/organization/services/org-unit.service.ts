import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface OrgUnitDto {
  id: string;
  organizationId: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  // ACC-137 - superseded by typeValueId/typeValue and kept under its own name
  // and shape, because org-unit-tree renders it directly. Dropped in the
  // contract step, once nothing reads it.
  type: string | null;
  typeValueId: string | null;
  typeValue: OrgUnitTypeDto | null;
  description: string | null;
  isActive: boolean;
  isCodeLocked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children?: OrgUnitDto[];
}

/**
 * A unit's type, resolved from the org_unit_type lookup - ACC-137.
 *
 * Both labels arrive already override-resolved, so the client never maps a KEY
 * to a label from a table of its own. isRetired marks a value the tenant has
 * since hidden or deactivated: it still renders on a unit that holds it, and is
 * not offered as a new choice.
 */
export interface OrgUnitTypeDto {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
  isRetired: boolean;
}

/**
 * ACC-149 - THESE INTERFACES MIRROR THE BACKEND DTOs AND MUST BE KEPT IN STEP.
 *
 * They are separate declarations: nothing makes them agree. ACC-137 made
 * `typeValueId` required on the backend's CreateOrgUnitDto and this interface
 * was not updated, so it still described the old free-text `type`. The form
 * then posted a payload matching THIS interface, cast it with
 * `as CreateOrgUnitDto`, and the compiler had nothing to object to - Add Unit
 * returned 400 for every user while tsc and 1495 tests passed.
 *
 * The cast is gone. Keeping these fields accurate is what makes its absence
 * useful: with a correct interface and no cast, a payload missing a required
 * field is a compile error.
 */
export interface CreateOrgUnitDto {
  nameEn: string;
  nameAr?: string;
  code: string;
  /** Required by the API since ACC-137. A lookup value id, not a key. */
  typeValueId: string;
  parentId?: string | null;
  description?: string;
  sortOrder?: number;
}

export interface UpdateOrgUnitDto {
  nameEn?: string;
  nameAr?: string;
  code?: string;
  /** Optional on update: an edit that does not mention the type leaves it. */
  typeValueId?: string;
  parentId?: string | null;
  description?: string;
  sortOrder?: number;
}

// ── ACC-120 slice 11: the read model (GET units/structure, units/chart,
// units/:id/summary). Mirrors backend interfaces/org-structure.interface.ts —
// kept in step by hand, as above.
//
// What a caller sees (D7): person names need users:view (else null), committee
// items need committees:view (else counts only), `attention` needs setup:view
// (else ABSENT). Titles and headcounts are for every org:view holder.

export interface OrgStructureHeadDto {
  userId: string;
  name: string | null;
  positionId: string | null;
  positionNameEn: string | null;
  positionNameAr: string | null;
  /** `incoming`: the pending successor, who already holds head access. */
  role: 'substantive' | 'incoming';
  countedHere: boolean;
}

export interface OrgStructureActingDto {
  userId: string;
  name: string | null;
  reason: 'VACANCY' | 'ABSENCE' | null;
  validFrom: string;
  validTo: string | null;
  /** False when the cover's own primary unit is elsewhere. */
  countedHere: boolean;
}

export interface OrgUnitAttentionDto {
  code: 'ORG_UNIT_WITHOUT_HEAD' | 'ORG_UNIT_WITHOUT_TYPE' | 'ACTING_HEAD_OPEN_ENDED';
  severity: 'BLOCKS_WORK' | 'AT_RISK';
  since: string;
  openCount: number;
}

export interface OrgStructureNodeDto {
  id: string;
  parentId: string | null;
  nameEn: string;
  nameAr: string | null;
  code: string;
  type: OrgUnitTypeDto | null;
  sortOrder: number;
  isActive: boolean;
  /** ACTIVE direct children, including any below a chart's cut-off. */
  childCount: number;
  heads: OrgStructureHeadDto[];
  acting: OrgStructureActingDto | null;
  headcount: number;
  committees: { count: number };
  /** Present only for setup:view; null there when nothing is open. */
  attention?: OrgUnitAttentionDto | null;
}

export interface OrgUnitPathItemDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface OrgStructureResponseDto {
  nodes: OrgStructureNodeDto[];
  asOf: string;
}

export interface OrgChartNodeDto extends OrgStructureNodeDto {
  /** 0 for the window's root, up to depth - 1. */
  depth: number;
}

export interface OrgChartResponseDto {
  root: { id: string; path: OrgUnitPathItemDto[] };
  depth: number;
  nodes: OrgChartNodeDto[];
  asOf: string;
}

export interface OrgUnitPositionInUseDto {
  positionId: string;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isUnitHeadPosition: boolean;
  count: number;
}

export interface OrgUnitPersonDto {
  userId: string;
  name: string | null;
  positionId: string | null;
  positionNameEn: string | null;
  positionNameAr: string | null;
  isHead: boolean;
}

export interface OrgUnitCommitteeItemDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
  stageNameEn: string | null;
  stageNameAr: string | null;
  stageKey: string | null;
}

export interface OrgUnitSummaryDto {
  unit: OrgStructureNodeDto & { description: string | null; createdAt: string; updatedAt: string };
  path: OrgUnitPathItemDto[];
  /** PR D — direct ACTIVE children, in sibling order. */
  children: OrgStructureNodeDto[];
  positions: OrgUnitPositionInUseDto[];
  people: OrgUnitPersonDto[];
  committees: { count: number; items: OrgUnitCommitteeItemDto[] | null };
  asOf: string;
}

/** ACC-120 slice 11 — deactivate's refusal (409), said from its codes. */
/**
 * PR D — `GET /organization/units/:id/history` (D8). The unit's stored rows,
 * newest first. A name is null without `users:view`; the position stands in.
 */
export interface OrgUnitHistoryPersonDto {
  userId: string;
  name: string | null;
  /** False for an id that is not a user of this organisation (a platform account, a script). */
  inOrganization: boolean;
  positionNameEn: string | null;
  positionNameAr: string | null;
}

export type OrgUnitHistoryField = 'nameEn' | 'nameAr' | 'code' | 'type' | 'description' | 'parent' | 'sortOrder';

export type OrgUnitHeadEventKind =
  | 'ASSIGNED'
  | 'HANDOVER_DECLARED'
  | 'HANDOVER_COMPLETED'
  | 'HANDOVER_CANCELLED'
  | 'VACATED'
  | 'ACTING_ASSIGNED'
  | 'ACTING_ENDED';

export interface OrgUnitAuditHistoryEntryDto {
  id: string;
  source: 'AUDIT';
  kind: 'CREATED' | 'CHANGED' | 'DEACTIVATED' | 'REACTIVATED' | 'RECORDED';
  at: string;
  actor: OrgUnitHistoryPersonDto | null;
  fields: OrgUnitHistoryField[];
  /** Only when the parent changed: the new parent, or null for the top. */
  movedTo?: OrgUnitPathItemDto | null;
}

export interface OrgUnitHeadHistoryEntryDto {
  id: string;
  source: 'HEAD_EVENT';
  kind: OrgUnitHeadEventKind;
  at: string;
  effectiveDate: string;
  actor: OrgUnitHistoryPersonDto | null;
  subject: OrgUnitHistoryPersonDto;
  position: { id: string; nameEn: string; nameAr: string | null } | null;
}

export type OrgUnitHistoryEntryDto = OrgUnitAuditHistoryEntryDto | OrgUnitHeadHistoryEntryDto;

export interface OrgUnitHistoryPageDto {
  items: OrgUnitHistoryEntryDto[];
  total: number;
  skip: number;
  take: number;
  /** Inactive units only: the row that deactivated it, or null if none was recorded. */
  deactivation?: { at: string; actor: OrgUnitHistoryPersonDto | null } | null;
}

export interface OrgUnitDependenciesRefusalDto {
  code: 'ORG_UNIT_HAS_DEPENDENCIES';
  message: string;
  blockers: Array<{ code: 'ACTIVE_CHILDREN' | 'ACTIVE_USERS' | 'ACTIVE_COMMITTEES'; count: number }>;
}

export function orgUnitDisplayName(unit: { nameEn: string; nameAr: string | null }): string {
  return unit.nameAr ? `${unit.nameEn} (${unit.nameAr})` : unit.nameEn;
}

// ACC-42 Phase 6 — shared hierarchy-tree builder for every OrgUnit picker
// migrating to OverlaySelectComponent's hierarchy mode (optionGroupLabel/
// optionGroupChildren, see overlay-select.component.ts). Extracted from
// org-unit-form.component.ts's own private buildCascadeOptions() (its
// exact, already-proven logic, unchanged) rather than left as 4 near-
// duplicate copies across org-unit-form/invite-user/user-profile's 3
// pickers — only org-unit-form has a genuine excludeId need (a unit can't
// become its own ancestor); the other 3 consumers pass null, since a user
// isn't an org unit and has no self/descendant relationship to exclude.
export interface OrgUnitCascadeOption {
  label: string;
  value: string;
  items?: OrgUnitCascadeOption[];
  /** ACC-120 slice 11 — shown but not choosable (the parent picker). */
  unavailable?: boolean;
  /** Why, appended to the option's accessible name. */
  unavailableReason?: string;
}

export function buildOrgUnitCascadeOptions(
  all: OrgUnitDto[],
  excludeId: string | null,
  parentId: string | null,
): OrgUnitCascadeOption[] {
  return all
    .filter((u) => u.parentId === parentId && u.id !== excludeId && u.isActive)
    .map((u) => {
      const items = buildOrgUnitCascadeOptions(all, excludeId, u.id);
      return {
        label: orgUnitDisplayName(u),
        value: u.id,
        ...(items.length ? { items } : {}),
      };
    });
}

@Injectable({ providedIn: 'root' })
export class OrgUnitService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/organization/units`;

  getTree(): Observable<OrgUnitDto[]> {
    return this.http.get<OrgUnitDto[]>(this.base);
  }

  getFlat(): Observable<OrgUnitDto[]> {
    return this.http.get<OrgUnitDto[]>(`${this.base}/flat`);
  }

  /** PR D — one unit, for the record's Edit dialog. */
  getById(id: string): Observable<OrgUnitDto> {
    return this.http.get<OrgUnitDto>(`${this.base}/${id}`);
  }

  create(dto: CreateOrgUnitDto): Observable<OrgUnitDto> {
    return this.http.post<OrgUnitDto>(this.base, dto);
  }

  update(id: string, dto: UpdateOrgUnitDto): Observable<OrgUnitDto> {
    return this.http.patch<OrgUnitDto>(`${this.base}/${id}`, dto);
  }

  deactivate(id: string): Observable<OrgUnitDto> {
    return this.http.post<OrgUnitDto>(`${this.base}/${id}/deactivate`, {});
  }

  /** ACC-120 slice 11 — every active unit; inactive too for org:manage, when asked. */
  getStructure(options: { includeInactive?: boolean } = {}): Observable<OrgStructureResponseDto> {
    const params = options.includeInactive ? new HttpParams().set('includeInactive', 'true') : undefined;
    return this.http.get<OrgStructureResponseDto>(`${this.base}/structure`, { params });
  }

  /** ACC-120 slice 11 — the chart's window: from rootId (or the top unit), at most 4 levels. */
  getChart(options: { rootId?: string; depth?: number } = {}): Observable<OrgChartResponseDto> {
    let params = new HttpParams();
    if (options.rootId) params = params.set('rootId', options.rootId);
    if (options.depth !== undefined) params = params.set('depth', String(options.depth));
    return this.http.get<OrgChartResponseDto>(`${this.base}/chart`, { params });
  }

  /** ACC-120 slice 11 — one unit for its record page and the chart's side panel. */
  getSummary(id: string): Observable<OrgUnitSummaryDto> {
    return this.http.get<OrgUnitSummaryDto>(`${this.base}/${id}/summary`);
  }

  getHistory(id: string, page: { skip?: number; take?: number } = {}): Observable<OrgUnitHistoryPageDto> {
    let params = new HttpParams();
    if (page.skip !== undefined) params = params.set('skip', String(page.skip));
    if (page.take !== undefined) params = params.set('take', String(page.take));
    return this.http.get<OrgUnitHistoryPageDto>(`${this.base}/${id}/history`, { params });
  }
}

/**
 * ACC-120 slice 11 — the Add / Edit unit dialog's parent options.
 *
 * Unlike buildOrgUnitCascadeOptions(), which REMOVES the unit being edited and
 * so its whole branch, this keeps the full active tree and marks the unit and
 * everything below it unavailable, each with its reason (OS L637): a reader
 * sees where the unit sits and why those choices are greyed. The server refuses
 * the same set with ORG_UNIT_PARENT_CYCLE regardless.
 *
 * `label` decides each option's text, so the caller can follow the session's
 * language (LanguageService.bilingual) rather than "English (Arabic)".
 */
export function buildOrgUnitParentOptions(
  all: OrgUnitDto[],
  movingId: string | null,
  label: (unit: OrgUnitDto) => string,
  reasons: { self: string; descendant: string },
  parentId: string | null = null,
  insideMoving = false,
): OrgUnitCascadeOption[] {
  return all
    .filter((u) => u.parentId === parentId && u.isActive)
    .map((u) => {
      const isSelf = u.id === movingId;
      const blocked = insideMoving || isSelf;
      const items = buildOrgUnitParentOptions(all, movingId, label, reasons, u.id, blocked);
      return {
        label: label(u),
        value: u.id,
        ...(items.length ? { items } : {}),
        ...(blocked ? { unavailable: true, unavailableReason: isSelf ? reasons.self : reasons.descendant } : {}),
      };
    });
}

/** ACC-120 slice 11 — every unit below `id`, at any depth: what a move takes with it. */
export function countDescendants(all: OrgUnitDto[], id: string): number {
  const children = all.filter((u) => u.parentId === id);
  return children.reduce((n, child) => n + 1 + countDescendants(all, child.id), 0);
}
