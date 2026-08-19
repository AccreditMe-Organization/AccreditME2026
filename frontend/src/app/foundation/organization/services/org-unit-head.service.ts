import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ACC-40 Section 2.2/2.3 — "holders" is a live derivation (zero, one, or
// two during a declared handover), never a cached fact.
export interface IOrgUnitHeadStatus {
  holders: { id: string; name: string; positionId: string | null }[];
  pendingHeadUserId: string | null;
  headHandoverEffectiveDate: string | null;
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
}
