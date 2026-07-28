import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface IOrgPositionDto {
  id: string;
  organizationId: string;
  orgUnitId: string | null;
  nameEn: string;
  nameAr: string | null;
  grade: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrgPositionDto {
  nameEn: string;
  nameAr?: string;
  orgUnitId?: string;
  grade: number;
}

export type UpdateOrgPositionDto = Partial<CreateOrgPositionDto>;

@Injectable({ providedIn: 'root' })
export class OrgPositionService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/org-positions`;

  listPositions(orgUnitId?: string): Observable<IOrgPositionDto[]> {
    const params = orgUnitId ? new HttpParams().set('orgUnitId', orgUnitId) : undefined;
    return this.http.get<IOrgPositionDto[]>(this.base, { params });
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
}
