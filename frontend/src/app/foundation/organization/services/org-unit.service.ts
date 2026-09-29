import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  labelAr: string;
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

  create(dto: CreateOrgUnitDto): Observable<OrgUnitDto> {
    return this.http.post<OrgUnitDto>(this.base, dto);
  }

  update(id: string, dto: UpdateOrgUnitDto): Observable<OrgUnitDto> {
    return this.http.patch<OrgUnitDto>(`${this.base}/${id}`, dto);
  }

  deactivate(id: string): Observable<OrgUnitDto> {
    return this.http.post<OrgUnitDto>(`${this.base}/${id}/deactivate`, {});
  }
}
