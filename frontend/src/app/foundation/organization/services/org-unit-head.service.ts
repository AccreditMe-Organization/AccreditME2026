import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ACC-40 Section 2.2/2.3 — "holders" is a live derivation (zero, one, or
// two during a declared handover), never a cached fact. actingHeadUserId
// (Phase 11) IS the cache field itself — the one real source of truth for
// who's covering, unlike "holders" above.
export interface IOrgUnitHeadStatus {
  holders: { id: string; name: string; positionId: string | null }[];
  pendingHeadUserId: string | null;
  headHandoverEffectiveDate: string | null;
  actingHeadUserId: string | null;
}

export interface AssignHeadDto {
  userId: string;
  positionId: string;
}

export interface DeclareHandoverDto {
  incomingUserId: string;
  effectiveDate: string;
  reason?: string;
}

// ACC-40 Section 2.6.4 — coveringForUserId omitted entirely means a pure
// vacancy (Acting Head grants workflow-eligibility only, no role).
//
// ACC-120 slice 2 — actingReason, validFrom and validTo are new, and two of
// them are NOT user-entered. The head-management design's rule: the reason
// follows from the unit's own state, so it is DERIVED and sent, never shown as
// a control. A unit with a head can only need cover because the head is away
// (ABSENCE, covering for that head); a vacant unit can only need cover because
// the post is empty (VACANCY, covering for nobody). Offering the choice would
// let a user record something false — "post is vacant" on a unit with a head.
export type OrgUnitActingReason = 'VACANCY' | 'ABSENCE';

export interface AssignActingHeadDto {
  userId: string;
  actingReason: OrgUnitActingReason;
  /** ISO. Required: an appointment with no start cannot be aged or overlapped. */
  validFrom: string;
  /** ISO. Omitted means "until ended by hand" — see ACTING_HEAD_OPEN_ENDED. */
  validTo?: string;
  reason?: string;
  coveringForUserId?: string;
}

@Injectable({ providedIn: 'root' })
export class OrgUnitHeadService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/organization/units`;

  getHeadStatus(orgUnitId: string): Observable<IOrgUnitHeadStatus> {
    return this.http.get<IOrgUnitHeadStatus>(`${this.base}/${orgUnitId}/head`);
  }

  assignHead(orgUnitId: string, dto: AssignHeadDto): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/assign`, dto);
  }

  vacateHead(orgUnitId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/vacate`, {});
  }

  declareHandover(orgUnitId: string, dto: DeclareHandoverDto): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/handover`, dto);
  }

  completeHandoverNow(orgUnitId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/handover/complete`, {});
  }

  cancelHandover(orgUnitId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/handover/cancel`, {});
  }

  assignActingHead(orgUnitId: string, dto: AssignActingHeadDto): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/acting-head`, dto);
  }

  clearActingHead(orgUnitId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${orgUnitId}/head/acting-head/clear`, {});
  }
}
