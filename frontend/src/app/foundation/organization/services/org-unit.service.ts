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
  type: string | null;
  description: string | null;
  isActive: boolean;
  isCodeLocked: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  children?: OrgUnitDto[];
}

export interface CreateOrgUnitDto {
  nameEn: string;
  nameAr?: string;
  code: string;
  type?: string;
  parentId?: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateOrgUnitDto {
  nameEn?: string;
  nameAr?: string;
  code?: string;
  type?: string;
  parentId?: string;
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
