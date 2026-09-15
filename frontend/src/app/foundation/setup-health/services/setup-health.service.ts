import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ACC-82 — Setup health (SYSTEM-REFERENCE §13). Read-only: a condition is
// derived state, so there is nothing to dismiss, snooze or mark read.

// The types the API reports. POSITION_WITHOUT_ROLE exists in the backend enum
// but is deferred (backend DEFERRED_SETUP_CONDITION_TYPES) and never returned.
export type SetupConditionType =
  | 'ORG_UNIT_WITHOUT_HEAD'
  | 'STAGE_WITHOUT_ASSIGNEE'
  | 'TASK_WITHOUT_OWNER';

export type SetupConditionSeverity = 'BLOCKS_WORK' | 'AT_RISK';

// OBJECT: openedAt is the object's own record of entering the condition.
// FIRST_DETECTED: no such record exists; openedAt is the first check that saw
// it, and the page must say so (§13.3).
export type SetupConditionAgeBasis = 'OBJECT' | 'FIRST_DETECTED';

export type SetupConditionFreshnessStatus = 'CURRENT' | 'OVERDUE' | 'FAILED' | 'NEVER_RUN';

// The detector's display snapshot. Every field is optional here because the
// shape differs per type (§13.2); the page reads only what its type writes.
export interface SetupConditionSubject {
  nameEn?: string;
  nameAr?: string | null;
  title?: string;
  escalationResolves?: boolean;
  templateId?: string;
  templateNameEn?: string;
  templateNameAr?: string | null;
  affectedInstances?: number;
}

export interface SetupConditionDto {
  id: string;
  type: SetupConditionType;
  severity: SetupConditionSeverity;
  objectId: string;
  subject: SetupConditionSubject;
  openedAt: string;
  ageBasis: SetupConditionAgeBasis;
  lastSeenAt: string;
  clearedAt: string | null;
}

export interface SetupConditionFreshnessDto {
  type: SetupConditionType;
  status: SetupConditionFreshnessStatus;
  // When this type's rows were last confirmed. Null if it never succeeded.
  computedAt: string | null;
}

export interface SetupHealthDto {
  open: SetupConditionDto[];
  recentlyCleared: SetupConditionDto[];
  freshness: SetupConditionFreshnessDto[];
}

export interface SetupHealthSummaryDto {
  open: number;
  blocksWork: number;
}

@Injectable({ providedIn: 'root' })
export class SetupHealthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/setup-health`;

  // Shared by the rail badge and the page, so opening the page after a fix
  // corrects the badge at once rather than at the rail's next poll.
  private readonly _summary = signal<SetupHealthSummaryDto | null>(null);
  readonly summary = this._summary.asReadonly();

  getHealth(): Observable<SetupHealthDto> {
    return this.http.get<SetupHealthDto>(this.baseUrl).pipe(
      tap((health) =>
        this._summary.set({
          open: health.open.length,
          blocksWork: health.open.filter((c) => c.severity === 'BLOCKS_WORK').length,
        }),
      ),
    );
  }

  getSummary(): Observable<SetupHealthSummaryDto> {
    return this.http
      .get<SetupHealthSummaryDto>(`${this.baseUrl}/summary`)
      .pipe(tap((summary) => this._summary.set(summary)));
  }

  // Called when the user who holds setup:view leaves (logout), so a second
  // user signing in on the same tab never sees the first one's count.
  clear(): void {
    this._summary.set(null);
  }
}
