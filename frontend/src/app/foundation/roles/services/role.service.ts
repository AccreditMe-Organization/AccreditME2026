import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

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
  permissions?: string[];
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

  listRoles(): Observable<RoleDto[]> {
    return this.http.get<RoleDto[]>(this.base);
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
