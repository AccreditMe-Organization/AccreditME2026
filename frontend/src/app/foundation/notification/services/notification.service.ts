import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { IPaginatedResponse } from '../../../shared/models/paginated-response';

export interface NotificationDto {
  id: string;
  titleEn: string;
  titleAr: string | null;
  bodyEn: string;
  bodyAr: string | null;
  channel: string;
  status: string;
  objectType: string | null;
  objectId: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/notifications`;

  // ACC-78 — page-based, and the response is the shared envelope. This was the
  // only paginating endpoint in the product and it used limit/offset with no
  // total, so nothing could render a paginator against it.
  //
  // `pageSize` replaces the old `limit`. The bell asks for one page of 10 and
  // ignores `total`, which is the point of the envelope: a caller that wants
  // only "the newest few" is unaffected, while one that wants a paginator now
  // has the number it needs.
  list(status?: string, pageSize?: number): Observable<IPaginatedResponse<NotificationDto>> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (pageSize) params = params.set('pageSize', pageSize);
    return this.http.get<IPaginatedResponse<NotificationDto>>(this.base, { params });
  }

  getUnreadCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.base}/unread-count`);
  }

  markRead(id: string): Observable<NotificationDto> {
    return this.http.patch<NotificationDto>(`${this.base}/${id}/read`, {});
  }

  markAllRead(): Observable<{ count: number }> {
    return this.http.post<{ count: number }>(`${this.base}/mark-all-read`, {});
  }
}
