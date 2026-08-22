import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface IOrgPositionDto {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isSingleAssignee: boolean;
  isUnitHeadPosition: boolean;
  roleId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrgPositionDto {
  nameEn: string;
  nameAr?: string;
  grade: number;
  isSingleAssignee?: boolean;
  isUnitHeadPosition?: boolean;
  roleId?: string;
}

export type UpdateOrgPositionDto = Partial<CreateOrgPositionDto>;

@Injectable({ providedIn: 'root' })
export class OrgPositionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/org-positions`;

  // ACC-40 Section 2.1 — OrgPosition is now an org-wide catalog, no more
  // per-OrgUnit filtering.
  listPositions(): Observable<IOrgPositionDto[]> {
    return this.http.get<IOrgPositionDto[]>(this.base);
  }

  getById(id: string): Observable<IOrgPositionDto> {
    return this.http.get<IOrgPositionDto>(`${this.base}/${id}`);
  }

  create(dto: CreateOrgPositionDto): Observable<IOrgPositionDto> {
    return this.http.post<IOrgPositionDto>(this.base, dto);
  }

  update(id: string, dto: UpdateOrgPositionDto): Observable<IOrgPositionDto> {
    return this.http.patch<IOrgPositionDto>(`${this.base}/${id}`, dto);
  }

  deactivate(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/deactivate`, {});
  }

  reactivate(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/activate`, {});
  }
}
