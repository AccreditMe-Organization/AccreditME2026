import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ITenant {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  language: string;
  logo: string | null;
  isPlatformOrg: boolean;
  modules: Record<string, boolean>;
  ai: {
    enabled: boolean;
    monthlyCredits: number;
    creditsUsed: number;
    creditsRemaining: number;
    resetDate: string | null;
    overageEnabled: boolean;
  };
}

export interface IEmailConfig {
  emailProvider: 'resend' | 'smtp' | 'office365' | 'sendgrid' | 'ses' | null;
  config: Record<string, unknown> | null;
}

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tenant`;

  getCurrent(): Observable<ITenant> {
    return this.http.get<ITenant>(this.baseUrl);
  }

  update(dto: { name?: string; country?: string; logo?: string }): Observable<ITenant> {
    return this.http.patch<ITenant>(this.baseUrl, dto);
  }

  getEmailConfig(): Observable<IEmailConfig> {
    return this.http.get<IEmailConfig>(`${this.baseUrl}/email-config`);
  }

  updateEmailConfig(dto: { emailProvider: string; config: Record<string, unknown> }): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/email-config`, dto);
  }

  // Deliberately narrow — a tenant admin may only toggle this one field;
  // monthlyCredits/creditsUsed/creditsRemaining are set exclusively by a
  // Platform Admin via the Super Admin Portal.
  updateAiOverageSetting(overageEnabled: boolean): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/ai-settings`, { overageEnabled });
  }
}
