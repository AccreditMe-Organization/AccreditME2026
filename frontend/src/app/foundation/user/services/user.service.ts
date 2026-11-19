import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { IPaginatedResponse } from '../../../shared/models/paginated-response';
import { IOrgPositionDto } from '../../org-position/services/org-position.service';

export interface IBilingualNameDto {
  nameEn: string;
  nameAr: string | null;
}

/** ACC-216 — one membership on GET /users/:id/committees (backend IUserCommitteeMembership). */
export interface IUserCommitteeDto {
  committee: { id: string; nameEn: string; nameAr: string | null };
  /** The seat as this organisation names it; labels null only when unreadable. */
  seat: { id: string; labelEn: string | null; labelAr: string | null; layer: 'SYSTEM' | 'TENANT' | null };
  joinedAt: string;
  leftAt: string | null;
  /** An active member of an active committee (ACC-281's rule, decided by the server). */
  current: boolean;
}

export interface IUserCommitteesDto {
  total: number;
  rows: IUserCommitteeDto[];
}

/**
 * ACC-216 part 2 — one row of GET /users/:id/access-history (backend
 * IAccessHistoryRow). The kind is the server's reading of one stored audit row;
 * no before/after value is ever sent.
 */
export type AccessHistoryKind =
  | 'INVITED'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'PROFILE_EDITED'
  | 'OUT_OF_OFFICE_CHANGED'
  | 'TRANSFERRED'
  | 'HEAD_APPOINTMENT_FAILED'
  | 'DEACTIVATED'
  | 'REACTIVATED'
  | 'ROLE_GRANTED'
  | 'ROLE_REMOVED'
  | 'TWO_STEP_TURNED_ON'
  | 'TWO_STEP_TURNED_OFF'
  | 'TWO_STEP_RESET'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET'
  | 'SESSIONS_ENDED'
  | 'SIGNED_IN_AS'
  | 'CHANGED';

/** SESSIONS_ENDED: one of the person's own sign-ins, all but the one in use, or all (an administrator). */
export type AccessHistorySessionsScope = 'one' | 'others' | 'all';

export type AccessHistoryField =
  | 'name'
  | 'language'
  | 'calendar'
  | 'position'
  | 'unit'
  | 'manager'
  | 'actingUnit'
  | 'outOfOffice'
  | 'cover';

export interface IAccessHistoryNameDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface IAccessHistoryRowDto {
  id: string;
  at: string;
  kind: AccessHistoryKind;
  /** Null: the system, a platform administrator, or an account since deleted. */
  actor: { id: string; name: string } | null;
  fields?: AccessHistoryField[];
  /** Named only for a viewer with roles:view. */
  role?: IAccessHistoryNameDto | null;
  viaHeadship?: boolean;
  transfer?: {
    from: IAccessHistoryNameDto | null;
    to: IAccessHistoryNameDto | null;
    position: IAccessHistoryNameDto | null;
    headAppointment: 'NONE' | 'DONE' | 'FAILED';
  };
  /** SESSIONS_ENDED only, both or neither: absent when the server could not read them. */
  sessionsScope?: AccessHistorySessionsScope;
  sessionsCount?: number;
}

export interface IUserAccessHistoryPageDto {
  rows: IAccessHistoryRowDto[];
  total: number;
  skip: number;
  take: number;
}

/** ACC-216 Sessions — one current sign-in on GET /users/:id/sessions (backend IUserSession). */
export interface IUserSessionDto {
  id: string;
  startedAt: string;
  /** The last renewal: accurate to about 15 minutes. */
  lastActiveAt: string;
  expiresAt: string;
  /** Family names read on the server; null when unrecognised. */
  device: { browser: string | null; os: string | null };
  /** Sent only to the person and a users:manage_sessions holder. */
  address: string | null;
  /** Your own sign-in on your own list. */
  current: boolean;
}

export interface IUserSessionsDto {
  total: number;
  rows: IUserSessionDto[];
}

export interface ISessionsEndedDto {
  ended: number;
}

// ACC-79 — names for the ids on a user record. Returned by GET /users/:id
// only, so a read-only profile can label its fields without the
// permission-gated position, org-unit and user lists.
export interface IUserReferenceNamesDto {
  position: IBilingualNameDto | null;
  primaryOrgUnit: IBilingualNameDto | null;
  actingOrgUnit: IBilingualNameDto | null;
  manager: string | null;
  actingUser: string | null;
}

export interface IUserDto {
  // Present only on GET /users/:id — list, invite and save responses omit it.
  references?: IUserReferenceNamesDto;
  // ACC-221 — whether this person is the organisation's account owner. Only
  // GET /users/:id sends it; absent elsewhere, which reads as "not the owner".
  isAccountOwner?: boolean;
  // ACC-164 — someone else's two-step sign-in, only for a viewer allowed to
  // reset it (the server's UserMfaResetService.twoStepFor()). null or absent:
  // draw no panel at all, never "Off". Your own record reads /auth/mfa/status.
  twoStep?: { enabled: boolean; mayReset: boolean } | null;
  // ACC-172 — the person's position names. Only GET /users (the list) sends
  // it; absent elsewhere. nameAr is null when the position has no Arabic name.
  position?: { nameEn: string; nameAr: string | null } | null;
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

// ACC-120 slice 5 — all three REQUIRED, null where empty. The endpoint
// replaces the whole window (a field left out is written as null), so a
// partial body would silently clear what it did not mention (CC-88, A2).
export interface UpdateOutOfOfficeDto {
  outOfOfficeFrom: string | null;
  outOfOfficeTo: string | null;
  actingUserId: string | null;
}

export interface ListUsersFilters {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  status?: string;
  orgUnitId?: string;
  // ACC-78 — the reference's filter bar is status + org unit + position.
  positionId?: string;
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

  // ACC-78 — paginated. status/orgUnitId remain this endpoint's own filters;
  // search/page/pageSize/sort are the shared list contract.
  listUsers(filters?: ListUsersFilters): Observable<IPaginatedResponse<IUserDto>> {
    let params = new HttpParams();
    if (filters?.status) params = params.set('status', filters.status);
    if (filters?.orgUnitId) params = params.set('orgUnitId', filters.orgUnitId);
    if (filters?.positionId) params = params.set('positionId', filters.positionId);
    if (filters?.search) params = params.set('search', filters.search);
    if (filters?.page) params = params.set('page', filters.page);
    if (filters?.pageSize) params = params.set('pageSize', filters.pageSize);
    if (filters?.sortBy) params = params.set('sortBy', filters.sortBy);
    if (filters?.sortDir) params = params.set('sortDir', filters.sortDir);
    return this.http.get<IPaginatedResponse<IUserDto>>(this.base, { params });
  }

  // ACC-78 — "every matching user", for the pickers and lookups that are not
  // lists and must not be paginated.
  //
  // WHY THIS EXISTS RATHER THAN .data AT EACH CALL SITE. Ten components call
  // listUsers() to populate a dropdown or resolve ids to names. Paginating the
  // endpoint made every one of them silently return the FIRST PAGE — a picker
  // quietly capped at 25 users, with no error and no visible symptom beyond a
  // colleague missing from a list. Unwrapping .data individually would have
  // fixed the types and left that behaviour in place, which is the worse
  // failure: it compiles, it renders, and it is wrong.
  //
  // Capped at the backend's own @Max(200). A tenant with more than 200 active
  // users has outgrown a dropdown and needs a searching picker — which is a
  // real ticket, not something to paper over with a larger number.
  listAllUsers(filters?: Omit<ListUsersFilters, 'page' | 'pageSize'>): Observable<IUserDto[]> {
    return this.listUsers({ ...filters, pageSize: 200 }).pipe(map((page) => page.data));
  }

  // ACC-78 — counts behind the list's filter chips. Separate from the list
  // because the list is already filtered: on the Invited chip its total IS the
  // invited count, so every other chip would read zero.
  getStatusCounts(): Observable<Record<string, number>> {
    return this.http.get<Record<string, number>>(`${this.base}/status-counts`);
  }

  getById(id: string): Observable<IUserDto> {
    return this.http.get<IUserDto>(`${this.base}/${id}`);
  }

  /**
   * ACC-216 — the committees a person sits on, and sat on: committees:view, plus
   * users:view unless it is your own. At most 200 rows; `total` counts past them.
   */
  getCommittees(id: string): Observable<IUserCommitteesDto> {
    return this.http.get<IUserCommitteesDto>(`${this.base}/${id}/committees`);
  }

  /**
   * ACC-216 part 2 — what was changed about a person, newest first: yourself, or
   * users:view. take 1–50.
   */
  getAccessHistory(id: string, page: { skip: number; take: number }): Observable<IUserAccessHistoryPageDto> {
    const params = new HttpParams().set('skip', page.skip).set('take', page.take);
    return this.http.get<IUserAccessHistoryPageDto>(`${this.base}/${id}/access-history`, { params });
  }

  /**
   * ACC-216 Sessions — a person's current sign-ins: yourself, or users:view plus
   * users:manage_sessions. At most 20; `total` counts past them.
   */
  getSessions(id: string): Observable<IUserSessionsDto> {
    return this.http.get<IUserSessionsDto>(`${this.base}/${id}/sessions`);
  }

  /** Yourself: end one other sign-in (by any row of its chain). Bites within 15 minutes. */
  endOwnSession(sessionId: string): Observable<ISessionsEndedDto> {
    return this.http.post<ISessionsEndedDto>(`${environment.apiUrl}/auth/sessions/${sessionId}/end`, {});
  }

  /** Yourself: end every sign-in but this device's. Bites within 15 minutes. */
  endOtherOwnSessions(): Observable<ISessionsEndedDto> {
    return this.http.post<ISessionsEndedDto>(`${environment.apiUrl}/auth/sessions/end-others`, {});
  }

  /** An administrator (users:manage_sessions): "Sign out everywhere", at once; the person is emailed. */
  endAllSessions(id: string): Observable<ISessionsEndedDto> {
    return this.http.post<ISessionsEndedDto>(`${this.base}/${id}/sessions/end-all`, {});
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

  // ACC-83 — the mirror of deactivate, on its own permission server-side
  // (users:reactivate). Returns how many tasks came back with the person, so
  // the list can say what happened rather than just that it worked.
  reactivate(id: string): Observable<{ returnedTaskCount: number }> {
    return this.http.post<{ returnedTaskCount: number }>(`${this.base}/${id}/reactivate`, {});
  }

  // ACC-83 — withdraws an invitation nobody accepted. Deletes the row, so the
  // seat frees and the same email can be invited again.
  // ACC-164 — reset another person's two-step sign-in (users:reset_mfa). The
  // server answers 204; every refusal is a 404 or a 409 with a code.
  resetMfa(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/mfa/reset`, {});
  }

  revokeInvitation(id: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/revoke-invitation`, {});
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
