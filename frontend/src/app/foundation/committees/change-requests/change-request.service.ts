import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { CommitteePageDto } from '../services/committee.service';

/**
 * ACC-240 — the committee change request reads and moves (ACC-239's routes,
 * with PR 3a's canRaise, deciders' names and labels). Each DTO mirrors
 * `committee-change-request.service.ts`'s response types. The screens never
 * decide who may act: every button reads `actions`, and "Request a change"
 * reads `canRaise`.
 */

/** The committee fields a request may change, in the order every screen lists them. */
export const CHANGE_FIELDS = [
  'nameEn',
  'nameAr',
  'typeValueId',
  'purpose',
  'quorumCount',
  'meetingFrequency',
  'orgUnitId',
  'parentCommitteeId',
  'reportingToCommitteeId',
] as const;
export type ChangeField = (typeof CHANGE_FIELDS)[number];
export type ChangeValue = number | string | null;
export type ChangeValues = Partial<Record<ChangeField, ChangeValue>>;

export interface ChangeRequestActionsDto {
  edit: boolean;
  submit: boolean;
  withdraw: boolean;
  approve: boolean;
  return: boolean;
  reject: boolean;
}

export interface ChangeRequestPersonDto {
  id: string;
  name: string;
}

/** Names for the ids a response names: `{ [id]: { en, ar } }`. */
export type ChangeRequestLabelsDto = Record<string, { en: string; ar: string | null }>;

export interface ChangeRequestDto {
  id: string;
  committeeId: string;
  committeeNameEn: string;
  committeeNameAr: string | null;
  number: number;
  /** The request's stage KEY; null for a stage with no key. */
  status: string | null;
  requestedBy: ChangeRequestPersonDto;
  reason: string;
  changes: ChangeValues;
  fromValues: ChangeValues | null;
  submittedAt: string | null;
  returnNote: string | null;
  rejectionReason: string | null;
  decidedById: string | null;
  decidedBy: ChangeRequestPersonDto | null;
  decidedAt: string | null;
  appliedAt: string | null;
  termsTaskId: string | null;
  withdrawnById: string | null;
  withdrawnBy: ChangeRequestPersonDto | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions: ChangeRequestActionsDto;
  labels: ChangeRequestLabelsDto;
}

export interface OpenChangeRequestDto {
  request: ChangeRequestDto | null;
  /** The create call's own checks, answered without creating (ACC-240 PR 3a). */
  canRaise: boolean;
}

export type ChangeImpactDto =
  | { code: 'QUORUM'; from: ChangeValue; to: ChangeValue; inProgress: number }
  | { code: 'NAME' }
  | { code: 'TYPE' }
  | { code: 'PURPOSE' }
  | { code: 'MEETING_FREQUENCY'; from: ChangeValue; to: ChangeValue }
  | { code: 'OWNING_UNIT'; from: ChangeValue; to: ChangeValue }
  | { code: 'PARENT'; from: ChangeValue; to: ChangeValue }
  | { code: 'REPORTS_TO'; from: ChangeValue; to: ChangeValue }
  | { code: 'TERMS_TASK' };

export interface ChangeRequestPreviewDto {
  changedFields: ChangeField[];
  impacts: ChangeImpactDto[];
  labels: ChangeRequestLabelsDto;
}

export interface ChangeRequestListQuery {
  q?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  take?: number;
  skip?: number;
}

@Injectable({ providedIn: 'root' })
export class ChangeRequestService {
  private readonly http = inject(HttpClient);
  private readonly committees = `${environment.apiUrl}/committees`;
  private readonly requests = `${environment.apiUrl}/committee-change-requests`;

  list(committeeId: string, query: ChangeRequestListQuery): Observable<CommitteePageDto<ChangeRequestDto>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<CommitteePageDto<ChangeRequestDto>>(`${this.committees}/${committeeId}/change-requests`, { params });
  }

  open(committeeId: string): Observable<OpenChangeRequestDto> {
    return this.http.get<OpenChangeRequestDto>(`${this.committees}/${committeeId}/change-requests/open`);
  }

  preview(committeeId: string, changes: ChangeValues): Observable<ChangeRequestPreviewDto> {
    return this.http.post<ChangeRequestPreviewDto>(`${this.committees}/${committeeId}/change-requests/preview`, { changes });
  }

  create(committeeId: string, body: { changes: ChangeValues; reason: string; submit: boolean }): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.committees}/${committeeId}/change-requests`, body);
  }

  awaitingDecision(): Observable<ChangeRequestDto[]> {
    return this.http.get<ChangeRequestDto[]>(`${this.requests}/awaiting-decision`);
  }

  get(id: string): Observable<ChangeRequestDto> {
    return this.http.get<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}`);
  }

  update(id: string, body: { changes: ChangeValues; reason: string; expectedUpdatedAt: string }): Observable<ChangeRequestDto> {
    return this.http.patch<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}`, body);
  }

  submit(id: string): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}/submit`, {});
  }

  withdraw(id: string): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}/withdraw`, {});
  }

  approve(id: string): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}/approve`, {});
  }

  returnForChanges(id: string, note: string): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}/return`, { note });
  }

  reject(id: string, reason: string): Observable<ChangeRequestDto> {
    return this.http.post<ChangeRequestDto>(`${this.requests}/${encodeURIComponent(id)}/reject`, { reason });
  }
}
