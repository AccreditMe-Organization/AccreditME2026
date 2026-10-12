import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ITenant {
  id: string;
  name: string;
  // ACC-120 — null for a tenant that has never filled it in, which every tenant
  // is today. Never substituted with `name` by the API: choosing which name to
  // SHOW is a display decision, and nothing in this ticket displays it.
  nameAr: string | null;
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

// ACC-181 — mirrors the backend's IMaskedEmailConfig
// (backend/src/foundation/tenant/email-config.ts). SECRETS ARE WRITE-ONLY:
// each one reads 'set' or null, never its value.
export type EmailProvider = 'resend' | 'smtp' | 'office365' | 'sendgrid' | 'ses';

export interface IEmailConfig {
  provider: EmailProvider | null;
  /** The chosen provider's fields; each secret reads 'set' or null. */
  settings: Record<string, string | number | null> | null;
  /** When each secret was last set (ISO), or null. */
  secretsSetAt: Record<string, string | null>;
  /** AccreditMe's own sender (RESEND_FROM_EMAIL), or null when unset. */
  defaultSender: string | null;
}

/**
 * A save: the chosen provider and its block. A secret is included ONLY when a
 * new value was typed — omitted, the stored one is kept.
 */
export interface IUpdateEmailConfig {
  provider: EmailProvider;
  [block: string]: string | Record<string, string | number>;
}

// ACC-46 Section 2.7.c — mirrors the backend's ITaskSlaTier/ITaskSlaSettings
// exactly (backend/src/foundation/tenant/interfaces/tenant.interface.ts).
export interface ITaskSlaTier {
  dueAfterHours: number;
  managerEscalationAfterHours: number;
  headEscalationAfterHours: number;
}

export interface ITaskSlaSettings {
  LOW: ITaskSlaTier;
  MEDIUM: ITaskSlaTier;
  HIGH: ITaskSlaTier;
  CRITICAL: ITaskSlaTier;
}

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tenant`;

  getCurrent(): Observable<ITenant> {
    return this.http.get<ITenant>(this.baseUrl);
  }

  // ACC-120 — `country` is GONE from this shape, and that is the fix for the 400.
  //
  // The component sent it, UpdateTenantDto never declared it, and main.ts runs
  // ValidationPipe with forbidNonWhitelisted — so the backend refused the whole
  // request and EVERY save on Organization Profile failed. The field is also
  // absent from the reviewed drawing, which settles which side gives way.
  //
  // UI REMOVAL ONLY. Organization.country is non-null, the Super Admin create
  // flow still sets it, and mapToITenant still returns it — the response
  // contract is unchanged. The tenant-facing screen simply stops editing it.
  update(dto: {
    name?: string;
    nameAr?: string | null;
    logo?: string;
  }): Observable<ITenant> {
    return this.http.patch<ITenant>(this.baseUrl, dto);
  }

  getEmailConfig(): Observable<IEmailConfig> {
    return this.http.get<IEmailConfig>(`${this.baseUrl}/email-config`);
  }

  updateEmailConfig(dto: IUpdateEmailConfig): Observable<IEmailConfig> {
    return this.http.patch<IEmailConfig>(`${this.baseUrl}/email-config`, dto);
  }

  /** ACC-181 — Disconnect: back to AccreditMe's default delivery. */
  disconnectEmailConfig(): Observable<IEmailConfig> {
    return this.http.delete<IEmailConfig>(`${this.baseUrl}/email-config`);
  }

  // Deliberately narrow — a tenant admin may only toggle this one field;
  // monthlyCredits/creditsUsed/creditsRemaining are set exclusively by a
  // Platform Admin via the Super Admin Portal.
  updateAiOverageSetting(overageEnabled: boolean): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/ai-settings`, { overageEnabled });
  }

  getTaskSla(): Observable<ITaskSlaSettings> {
    return this.http.get<ITaskSlaSettings>(`${this.baseUrl}/task-sla`);
  }

  updateTaskSla(dto: ITaskSlaSettings): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/task-sla`, dto);
  }
}
