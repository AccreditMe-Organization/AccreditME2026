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
