import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { IListQuery, IPaginatedResponse } from '../../../shared/models/paginated-response';

export interface RoleDto {
  id: string;
  organizationId: string;
  key: string | null;
  nameEn: string;
  nameAr: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Detail-only — populated by getRole(), absent from listRoles().
  permissions?: string[];
  // ACC-74 — present on listRoles() responses. The list renders a number, so
  // the backend sends a count rather than the full permission set.
  permissionCount?: number;
}

export interface PermissionDto {
  id: string;
  module: string;
  action: string;
  description: string | null;
}

export interface CreateRoleDto {
  nameEn: string;
  nameAr: string;
  description?: string;
  permissionKeys?: string[];
}

export interface UpdateRoleDto {
  nameEn?: string;
  nameAr?: string;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class RoleService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/roles`;
  private readonly usersBase = `${environment.apiUrl}/users`;

  // ── Roles ──────────────────────────────────────────────────────────────────

  // ACC-78 — paginated.
  listRoles(query?: IListQuery): Observable<IPaginatedResponse<RoleDto>> {
    let params = new HttpParams();
    if (query?.search) params = params.set('search', query.search);
    if (query?.page) params = params.set('page', query.page);
    if (query?.pageSize) params = params.set('pageSize', query.pageSize);
    if (query?.sortBy) params = params.set('sortBy', query.sortBy);
    if (query?.sortDir) params = params.set('sortDir', query.sortDir);
    return this.http.get<IPaginatedResponse<RoleDto>>(this.base, { params });
  }

  // ACC-78 — every role, for the six pickers that are not lists. Same reasoning
  // as UserService.listAllUsers(): paginating the endpoint would otherwise cap
  // each of them at the first page, silently.
  listAllRoles(): Observable<RoleDto[]> {
    return this.listRoles({ pageSize: 200 }).pipe(map((page) => page.data));
  }

  getRole(id: string): Observable<RoleDto> {
    return this.http.get<RoleDto>(`${this.base}/${id}`);
  }

  listAllPermissions(): Observable<PermissionDto[]> {
    return this.http.get<PermissionDto[]>(`${this.base}/permissions`);
  }

  createRole(dto: CreateRoleDto): Observable<RoleDto> {
    return this.http.post<RoleDto>(this.base, dto);
  }

  updateRole(id: string, dto: UpdateRoleDto): Observable<RoleDto> {
    return this.http.patch<RoleDto>(`${this.base}/${id}`, dto);
  }

  assignPermissions(id: string, permissionKeys: string[]): Observable<RoleDto> {
    return this.http.patch<RoleDto>(`${this.base}/${id}/permissions`, { permissionKeys });
  }

  deactivateRole(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/deactivate`, {});
  }

  activateRole(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/activate`, {});
  }

  // ── User ↔ Role assignment ───────────────────────────────────────────────────
  // Temporary home — see plan Business Rules: revisit once Step 9 (Users) ships.

  getUserRoles(userId: string): Observable<RoleDto[]> {
    return this.http.get<RoleDto[]>(`${this.usersBase}/${userId}/roles`);
  }

  assignRoleToUser(userId: string, roleId: string): Observable<void> {
    return this.http.post<void>(`${this.usersBase}/${userId}/roles`, { roleId });
  }

  removeRoleFromUser(userId: string, roleId: string): Observable<void> {
    return this.http.delete<void>(`${this.usersBase}/${userId}/roles/${roleId}`);
  }
}
