import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface LookupCategoryDto {
  id: string;
  organizationId: string | null;
  key: string;
  labelEn: string;
  labelAr: string;
  isSystem: boolean;
  isExtensible: boolean;
  attributeSchema: Record<string, unknown> | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface LookupValueDto {
  id: string;
  organizationId: string | null;
  categoryId: string;
  key: string;
  labelEn: string;
  labelAr: string;
  layer: 'SYSTEM' | 'TENANT';
  attributes: Record<string, unknown> | null;
  isActive: boolean;
  isHidden: boolean;
  labelOverrideEn: string | null;
  labelOverrideAr: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedValueDto {
  key: string;
  labelEn: string;
  labelAr: string;
}

export interface UpdateLookupCategoryDto {
  labelEn?: string;
  labelAr?: string;
  attributeSchema?: Record<string, unknown>;
  sortOrder?: number;
}

export interface CreateLookupValueDto {
  key: string;
  labelEn: string;
  labelAr: string;
  attributes?: Record<string, unknown>;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateLookupValueDto {
  labelEn?: string;
  labelAr?: string;
  attributes?: Record<string, unknown>;
  isActive?: boolean;
  sortOrder?: number;
}

export interface OverrideLabelDto {
  labelOverrideEn: string;
  labelOverrideAr: string;
}

@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/lookups`;

  // ── Categories ──────────────────────────────────────────────────────────────

  getCategories(): Observable<LookupCategoryDto[]> {
    return this.http.get<LookupCategoryDto[]>(`${this.base}/categories`);
  }

  getCategoryByKey(key: string): Observable<LookupCategoryDto> {
    return this.http.get<LookupCategoryDto>(`${this.base}/categories/${key}`);
  }

  updateCategory(key: string, dto: UpdateLookupCategoryDto): Observable<LookupCategoryDto> {
    return this.http.patch<LookupCategoryDto>(`${this.base}/categories/${key}`, dto);
  }

  deactivateCategory(key: string): Observable<void> {
    return this.http.post<void>(`${this.base}/categories/${key}/deactivate`, {});
  }

  // ── Values ──────────────────────────────────────────────────────────────────

  getValues(categoryKey: string): Observable<LookupValueDto[]> {
    return this.http.get<LookupValueDto[]>(`${this.base}/categories/${categoryKey}/values`);
  }

  addValue(categoryKey: string, dto: CreateLookupValueDto): Observable<LookupValueDto> {
    return this.http.post<LookupValueDto>(`${this.base}/categories/${categoryKey}/values`, dto);
  }

  suggestValues(categoryKey: string): Observable<SuggestedValueDto[]> {
    return this.http.post<SuggestedValueDto[]>(`${this.base}/categories/${categoryKey}/suggest`, {});
  }

  updateValue(id: string, dto: UpdateLookupValueDto): Observable<LookupValueDto> {
    return this.http.patch<LookupValueDto>(`${this.base}/values/${id}`, dto);
  }

  removeValue(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/values/${id}`);
  }

  hideSystemValue(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/values/${id}/hide`, {});
  }

  unhideSystemValue(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/values/${id}/hide`);
  }

  overrideLabel(id: string, dto: OverrideLabelDto): Observable<void> {
    return this.http.post<void>(`${this.base}/values/${id}/override-label`, dto);
  }
}
