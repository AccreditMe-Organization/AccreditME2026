import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * ACC-296 — one seat the person holds, from GET /committees/memberships
 * (ACC-295, SYSTEM-REFERENCE §3.21.1). `memberId` is what the committee's
 * DELETE /committees/:id/members/:memberId takes; `mayRemove` is whether the
 * committee's current stage allows removing a member.
 */
export interface TransferCommitteeSeatDto {
  memberId: string;
  committeeId: string;
  nameEn: string;
  nameAr: string | null;
  seat: { id: string; labelEn: string; labelAr: string | null };
  joinedAt: string;
  stage: { nameEn: string | null; nameAr: string | null };
  mayRemove: boolean;
}

/** At most 100 rows; `total` is the true count. */
export interface TransferCommitteesDto {
  total: number;
  rows: TransferCommitteeSeatDto[];
}

/**
 * ACC-296 — the person's committee seats, for the Transfer wizard. Read ONCE
 * when the wizard opens. A caller the server refuses gets a 403: the wizard
 * reads that as "not this caller's to see" and shows no step, whichever
 * permissions the server asks for (they may widen).
 */
@Injectable({ providedIn: 'root' })
export class TransferCommitteesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/committees/memberships`;

  forUser(userId: string): Observable<TransferCommitteesDto> {
    return this.http.get<TransferCommitteesDto>(this.url, { params: new HttpParams().set('userId', userId) });
  }
}
