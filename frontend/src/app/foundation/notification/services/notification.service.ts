import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

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

  list(status?: string, limit?: number): Observable<NotificationDto[]> {
    let params = new HttpParams();
    if (status) params = params.set('status', status);
    if (limit) params = params.set('limit', limit);
    return this.http.get<NotificationDto[]>(this.base, { params });
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
