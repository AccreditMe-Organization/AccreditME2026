import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

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
  nameAr: string;
  typeValueId: string;
  purpose: string | null;
  quorumCount: number;
  meetingFrequency: CommitteeMeetingFrequency;
  parentCommitteeId: string | null;
  termsOfReferenceDocumentId: string | null;
  reportingToCommitteeId: string | null;
  reportingToRoleId: string | null;
  formedAt: string | null;
  dissolvedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  parentCommitteeId?: string;
  termsOfReferenceDocumentId?: string;
  reportingToCommitteeId?: string;
  reportingToRoleId?: string;
}

export type UpdateCommitteeDto = Partial<CreateCommitteeDto>;

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

@Injectable({ providedIn: 'root' })
export class CommitteeService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/committees`;

  listCommittees(): Observable<CommitteeDto[]> {
    return this.http.get<CommitteeDto[]>(this.base);
  }

  getById(id: string): Observable<CommitteeDto> {
    return this.http.get<CommitteeDto>(`${this.base}/${id}`);
  }

  create(dto: CreateCommitteeDto): Observable<CommitteeDto> {
    return this.http.post<CommitteeDto>(this.base, dto);
  }

  update(id: string, dto: UpdateCommitteeDto): Observable<CommitteeDto> {
    return this.http.patch<CommitteeDto>(`${this.base}/${id}`, dto);
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
