import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { IOrgPositionDto } from '../../org-position/services/org-position.service';

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
  actingOrgUnitId: string | null;
  actingOrgUnitUntil: string | null;
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
  actingOrgUnitId?: string;
  actingOrgUnitUntil?: string;
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

// ACC-46 Section 2.6.b Step 2 — mirrors backend ITransferContext exactly.
// Drives which subsequent wizard steps are shown (Step 3 only if
// hasActiveDirectReports), pre-fills the position picker (Step 4) with
// only genuinely available choices, and pre-fills the manager step's
// (Step 5) default.
export interface ITransferContextDto {
  hasActiveDirectReports: boolean;
  availablePositions: IOrgPositionDto[];
  currentDestinationHead: { id: string; name: string; positionId: string | null } | null;
}

// ACC-46 Section 2.6.b Step 3
export interface ValidateTransferReplacementDto {
  replacementUserId: string;
}

// ACC-46 Section 2.6.b Step 4
export interface ValidateTransferPositionDto {
  destinationOrgUnitId: string;
  newPositionId: string;
}

// ACC-46 Section 2.6.b Step 6 — mirrors backend TransferUserDto exactly.
export interface TransferUserDto {
  destinationOrgUnitId: string;
  newPositionId: string;
  // Required for a non-promotion transfer, ignored (derived instead) for
  // a promotion — enforced server-side, not here.
  newManagerId?: string;
  // Required only when the departing person has active direct reports.
  replacementUserId?: string;
}

// ACC-46 Section 2.6.b Step 6 / 2.6.e — widened from a plain IUserDto: a
// promotion's own Head-assignment step can fail even after the core
// transfer has already committed, and the caller needs to be told that
// distinctly, not have it look like total failure or be silently
// swallowed into an ordinary success.
export interface ITransferResultDto {
  user: IUserDto;
  promotionCompleted: boolean;
  promotionError?: string;
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

  // ACC-46 Section 2.6.b Step 2 — automatic context load, not a user
  // action.
  getTransferContext(userId: string, destinationOrgUnitId: string): Observable<ITransferContextDto> {
    const params = new HttpParams().set('destinationOrgUnitId', destinationOrgUnitId);
    return this.http.get<ITransferContextDto>(`${this.base}/${userId}/transfer/context`, { params });
  }

  // ACC-46 Section 2.6.b Step 3 — live gate before the wizard advances
  // past the conditional replacement step.
  validateTransferReplacement(userId: string, dto: ValidateTransferReplacementDto): Observable<void> {
    return this.http.post<void>(`${this.base}/${userId}/transfer/validate-replacement`, dto);
  }

  // ACC-46 Section 2.6.b Step 4 — live gate before the wizard advances
  // past the (always-shown) destination position step.
  validateTransferPosition(userId: string, dto: ValidateTransferPositionDto): Observable<void> {
    return this.http.post<void>(`${this.base}/${userId}/transfer/validate-position`, dto);
  }

  // ACC-46 Section 2.6.b Step 6 — the final submit.
  transferUser(userId: string, dto: TransferUserDto): Observable<ITransferResultDto> {
    return this.http.post<ITransferResultDto>(`${this.base}/${userId}/transfer`, dto);
  }
}
