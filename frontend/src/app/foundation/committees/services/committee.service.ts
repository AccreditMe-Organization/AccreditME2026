import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { LookupValueDto } from '../../lookup/services/lookup.service';
import type { OrgUnitDto } from '../../organization/services/org-unit.service';

export const COMMITTEE_MEETING_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
  'AS_NEEDED',
] as const;
export type CommitteeMeetingFrequency = (typeof COMMITTEE_MEETING_FREQUENCIES)[number];

export interface CommitteeDto {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string | null;
  typeValueId: string;
  purpose: string | null;
  quorumCount: number;
  meetingFrequency: CommitteeMeetingFrequency;
  parentCommitteeId: string | null;
  // ACC-135 — the org unit that owns this committee. Nullable in the column for
  // the expand step only; the backend always writes one, and the contract
  // migration makes it NOT NULL.
  orgUnitId: string | null;
  termsOfReferenceDocumentId: string | null;
  reportingToCommitteeId: string | null;
  formedAt: string | null;
  dissolvedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ACC-76 — what listCommittees() returns, as distinct from a single
// committee. Separate type rather than optional fields on CommitteeDto, for
// the reason ACC-74 established: an optional field populated by exactly one
// endpoint silently renders wrong at every other call site.
export interface CommitteeListItemDto extends CommitteeDto {
  memberCount: number;
  // Live workflow stage, read from the engine rather than stored on the
  // committee. Null when no instance exists. Tenant-editable data — rendered
  // by isArabic() selection, never `| translate`.
  currentStageNameEn: string | null;
  currentStageNameAr: string | null;
  // ACC-233 — the SERVER's answer to "is it being dissolved, or has it been?"
  // (its stage's DISSOLVING flag since ACC-255). The dialog's pickers leave
  // those committees out.
  isDissolving: boolean;
  /** ACC-255 — what the current stage allows and means, as the server answers it. */
  stageRules: CommitteeStageRulesDto;
  /** ACC-246 — the committee's own type, with its label (see CommitteeTypeValueDto). */
  typeValue: CommitteeTypeValueDto | null;
}

/**
 * ACC-255 — the engine's answer for the committee's current stage: which record
 * actions it allows, and what it means (DISSOLVING, IN_FORCE). The writes are
 * refused by the same answer (STAGE_ACTION_NOT_ALLOWED). A committee with no
 * live stage allows nothing (D14). Screens combine it with the person's
 * permission (committee-offers.ts) and never read a stage key.
 */
export interface CommitteeStageRulesDto {
  actions: {
    edit_details: boolean;
    add_member: boolean;
    remove_member: boolean;
    change_member_role: boolean;
    request_change: boolean;
  };
  flags: string[];
}

/**
 * ACC-246 — a committee's own type as its read carries it, so the Edit dialog
 * shows it before the type list arrives, and still shows one the organisation
 * no longer offers (`offered: false`: deactivated or hidden).
 */
export interface CommitteeTypeValueDto {
  id: string;
  key: string;
  labelEn: string;
  labelAr: string | null;
  offered: boolean;
}

// ACC-238 — a single committee as its record page reads it (GET /committees/:id):
// the row plus what its current stage allows and means (ACC-255: `stageRules`,
// the server's answer; the page never reads a stage key or name). Separate from
// CommitteeDto for CommitteeListItemDto's reason.
export interface CommitteeDetailDto extends CommitteeDto {
  isDissolving: boolean;
  stageRules: CommitteeStageRulesDto;
  typeValue: CommitteeTypeValueDto | null;
  /** ACC-265 — the owning unit, named; null for none, or a unit not in this organisation. */
  orgUnit: CommitteeOrgUnitDto | null;
}

/** ACC-265 — a committee's owning unit as its record read names it. */
export interface CommitteeOrgUnitDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
}

/** GET /committees/form-choices (ACC-255, plan §10.5). */
export interface CommitteeFormChoicesDto {
  committeeTypes: LookupValueDto[];
  orgUnits: OrgUnitDto[];
}

export interface CommitteeMemberDto {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  joinedAt: string;
  leftAt: string | null;
  isActive: boolean;
}

export interface CommitteeMembershipEventDto {
  id: string;
  organizationId: string;
  committeeId: string;
  userId: string;
  roleValueId: string;
  action: 'JOINED' | 'LEFT' | 'ROLE_CHANGED';
  effectiveDate: string;
  reason: string | null;
  approvedBy: string | null;
  createdAt: string;
}

export interface CreateCommitteeDto {
  nameEn: string;
  nameAr: string;
  typeValueId: string;
  purpose?: string;
  quorumCount?: number;
  meetingFrequency?: CommitteeMeetingFrequency;
  // ACC-233 — null clears it (an update); omitted leaves it alone.
  parentCommitteeId?: string | null;
  // ACC-135 — OPTIONAL HERE, REQUIRED IN THE RECORD. Omitting it means "the whole
  // organisation", which the backend resolves to the tenant's root unit rather
  // than storing an absence. The form always sends one, so this stays optional
  // for the API's shape rather than for the form's convenience.
  orgUnitId?: string;
  termsOfReferenceDocumentId?: string;
  reportingToCommitteeId?: string | null;
}

export type UpdateCommitteeDto = Partial<CreateCommitteeDto> & {
  // ACC-238 — the committee's updatedAt as the dialog loaded it. A committee
  // changed since is refused with 409 COMMITTEE_CHANGED and nothing is saved.
  expectedUpdatedAt?: string;
};

export interface AddCommitteeMemberDto {
  userId: string;
  roleValueId: string;
  effectiveDate?: string;
  reason?: string;
}

export interface ChangeCommitteeMemberRoleDto {
  roleValueId: string;
  effectiveDate?: string;
  reason?: string;
}

export interface RemoveCommitteeMemberDto {
  effectiveDate?: string;
  reason?: string;
}

// ACC-230 — a row of the Members panel and its See all list.
export interface CommitteeMemberRowDto {
  id: string;
  userId: string;
  name: string;
  roleValueId: string;
  roleLabelEn: string | null;
  roleLabelAr: string | null;
  joinedAt: string;
}

// ACC-230 — a row of the Sub-committees panel and its See all list.
export interface SubCommitteeRowDto {
  id: string;
  nameEn: string;
  nameAr: string | null;
  stageNameEn: string | null;
  stageNameAr: string | null;
  memberCount: number;
}

export interface CommitteePageDto<T> {
  items: T[];
  total: number;
  matching: number;
}

export interface CommitteeListQuery {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  take?: number;
  skip?: number;
  lang?: 'en' | 'ar';
}

@Injectable({ providedIn: 'root' })
export class CommitteeService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/committees`;

  listCommittees(): Observable<CommitteeListItemDto[]> {
    return this.http.get<CommitteeListItemDto[]>(this.base);
  }

  /**
   * ACC-255 (plan §10.5) — what the committee dialogs choose from: the
   * committee types the organisation offers and its unit tree, exactly as
   * the lookup and unit lists serve them, for anyone who may create OR edit a
   * committee. So a tenant-made role that edits committees without
   * lookups:view or org:view gets its lists rather than a 403 its Retry can
   * never get past.
   */
  formChoices(): Observable<CommitteeFormChoicesDto> {
    return this.http.get<CommitteeFormChoicesDto>(`${this.base}/form-choices`);
  }

  getById(id: string): Observable<CommitteeDetailDto> {
    return this.http.get<CommitteeDetailDto>(`${this.base}/${id}`);
  }

  create(dto: CreateCommitteeDto): Observable<CommitteeDto> {
    return this.http.post<CommitteeDto>(this.base, dto);
  }

  update(id: string, dto: UpdateCommitteeDto): Observable<CommitteeDto> {
    return this.http.patch<CommitteeDto>(`${this.base}/${id}`, dto);
  }

  // ACC-230 — searched, sorted and paged on the server.
  membersPage(committeeId: string, query: CommitteeListQuery): Observable<CommitteePageDto<CommitteeMemberRowDto>> {
    return this.http.get<CommitteePageDto<CommitteeMemberRowDto>>(`${this.base}/${committeeId}/members/page`, { params: toParams(query) });
  }

  subCommittees(committeeId: string, query: CommitteeListQuery): Observable<CommitteePageDto<SubCommitteeRowDto>> {
    return this.http.get<CommitteePageDto<SubCommitteeRowDto>>(`${this.base}/${committeeId}/sub-committees`, { params: toParams(query) });
  }

  listMembers(committeeId: string): Observable<CommitteeMemberDto[]> {
    return this.http.get<CommitteeMemberDto[]>(`${this.base}/${committeeId}/members`);
  }

  listMembershipEvents(committeeId: string): Observable<CommitteeMembershipEventDto[]> {
    return this.http.get<CommitteeMembershipEventDto[]>(`${this.base}/${committeeId}/membership-events`);
  }

  addMember(committeeId: string, dto: AddCommitteeMemberDto): Observable<CommitteeMemberDto> {
    return this.http.post<CommitteeMemberDto>(`${this.base}/${committeeId}/members`, dto);
  }

  changeMemberRole(
    committeeId: string,
    memberId: string,
    dto: ChangeCommitteeMemberRoleDto,
  ): Observable<CommitteeMemberDto> {
    return this.http.patch<CommitteeMemberDto>(`${this.base}/${committeeId}/members/${memberId}`, dto);
  }

  removeMember(committeeId: string, memberId: string, dto: RemoveCommitteeMemberDto): Observable<void> {
    return this.http.delete<void>(`${this.base}/${committeeId}/members/${memberId}`, { body: dto });
  }
}

function toParams(query: CommitteeListQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  }
  return params;
}
