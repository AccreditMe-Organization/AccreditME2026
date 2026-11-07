import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SetupConditionDto, SetupConditionFreshnessDto } from '../setup-health/services/setup-health.service';

/** A part the caller may see that could not be read this time. */
export interface HomePartFailed {
  failed: true;
}

export interface HomeSetupSliceDto {
  open: number;
  blocksWork: number;
  /** The page's first three: blocking first, then the oldest. */
  top: SetupConditionDto[];
  freshness: SetupConditionFreshnessDto[];
}

export interface HomeUserCountsDto {
  active: number;
  invited: number;
  invitedExpired: number;
  /** Null without tenant:view, or when the organisation has no seat limit. */
  seats: { occupied: number; maxUsers: number } | null;
}

export interface HomeCommitteeCountsDto {
  inForce: number;
  belowQuorum: number;
}

/** ACC-279 — GET /home/admin-summary. null: not the caller's to see. */
export interface HomeAdminSummaryDto {
  setup: HomeSetupSliceDto | HomePartFailed | null;
  users: HomeUserCountsDto | HomePartFailed | null;
  committees: HomeCommitteeCountsDto | HomePartFailed | null;
}

export function isPartFailed(part: object | null): part is HomePartFailed {
  return !!part && 'failed' in part && (part as HomePartFailed).failed === true;
}

@Injectable({ providedIn: 'root' })
export class HomeSummaryService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/home`;

  adminSummary(): Observable<HomeAdminSummaryDto> {
    return this.http.get<HomeAdminSummaryDto>(`${this.base}/admin-summary`);
  }
}
