import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface IPlatformAnnouncement {
  message: string;
  severity: 'info' | 'warning';
  activeFrom: string | null;
  activeUntil: string | null;
}

export interface IPlatformSettings {
  announcement: IPlatformAnnouncement | null;
}

@Injectable({ providedIn: 'root' })
export class PlatformSettingsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/platform/settings`;

  getSettings(): Observable<IPlatformSettings> {
    return this.http.get<IPlatformSettings>(this.baseUrl);
  }

  updateSettings(dto: { message: string; severity: 'info' | 'warning'; activeFrom?: string; activeUntil?: string }): Observable<void> {
    return this.http.patch<void>(this.baseUrl, dto);
  }
}
