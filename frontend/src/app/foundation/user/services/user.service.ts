import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface IUserDto {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: string;
  language: string | null;
  positionId: string | null;
  primaryOrgUnitId: string | null;
  managerId: string | null;
  outOfOfficeFrom: string | null;
  outOfOfficeTo: string | null;
  actingUserId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InviteUserDto {
  email: string;
  name: string;
  positionId?: string;
  primaryOrgUnitId?: string;
  managerId?: string;
}

export interface UpdateUserProfileDto {
  name?: string;
  language?: string;
  positionId?: string;
  primaryOrgUnitId?: string;
  managerId?: string;
}

export interface UpdateOutOfOfficeDto {
  outOfOfficeFrom?: string;
  outOfOfficeTo?: string;
  actingUserId?: string;
}

export interface ListUsersFilters {
  status?: string;
  orgUnitId?: string;
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/users`;

  listUsers(filters?: ListUsersFilters): Observable<IUserDto[]> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.orgUnitId) params = params.set('orgUnitId', filters.orgUnitId);
    if (filters?.search) params = params.set('search', filters.search);
    return this.http.get<IUserDto[]>(this.base, { params });
  }

  getById(id: string): Observable<IUserDto> {
    return this.http.get<IUserDto>(`${this.base}/${id}`);
  }

  invite(dto: InviteUserDto): Observable<IUserDto> {
    return this.http.post<IUserDto>(`${this.base}/invite`, dto);
  }

  updateProfile(id: string, dto: UpdateUserProfileDto): Observable<IUserDto> {
    return this.http.patch<IUserDto>(`${this.base}/${id}/profile`, dto);
  }

  updateOutOfOffice(id: string, dto: UpdateOutOfOfficeDto): Observable<IUserDto> {
    return this.http.patch<IUserDto>(`${this.base}/${id}/out-of-office`, dto);
  }

  deactivate(id: string): Observable<{ reassignedCount: number; unassignedCount: number }> {
    return this.http.post<{ reassignedCount: number; unassignedCount: number }>(
      `${this.base}/${id}/deactivate`,
      {},
    );
  }
}
