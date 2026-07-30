import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface IPlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
  planId: string | null;
  planName: string | null;
  createdAt: string;
}

export interface IPlatformTenantDetail extends IPlatformTenantSummary {
  userCount: number;
  modules: Record<string, boolean>;
  ai: {
    monthlyCredits: number;
    creditsUsed: number;
    creditsRemaining: number;
    overageEnabled: boolean;
  };
  tenantAdmins: { id: string; name: string; email: string }[];
}

export interface CreateTenantDto {
  name: string;
  slug: string;
  country: string;
  planId?: string;
  adminEmail: string;
  adminName: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformTenantService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/platform`;

  listTenants(filters?: { status?: string; planId?: string }): Observable<IPlatformTenantSummary[]> {
    return this.http.get<IPlatformTenantSummary[]>(`${this.baseUrl}/tenants`, { params: { ...filters } });
  }

  getTenantDetail(id: string): Observable<IPlatformTenantDetail> {
    return this.http.get<IPlatformTenantDetail>(`${this.baseUrl}/tenants/${id}`);
  }

  createTenant(dto: CreateTenantDto): Observable<IPlatformTenantDetail> {
    return this.http.post<IPlatformTenantDetail>(`${this.baseUrl}/tenants`, dto);
  }

  suspendTenant(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/tenants/${id}/suspend`, {});
  }

  reactivateTenant(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/tenants/${id}/reactivate`, {});
  }

  extendTrial(id: string, trialEndsAt: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/tenants/${id}/extend-trial`, { trialEndsAt });
  }

  updateTenantModules(id: string, modules: Record<string, boolean>): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/tenants/${id}/modules`, { modules });
  }

  allocateAiCredits(id: string, monthlyCredits: number, overageEnabled?: boolean): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/tenants/${id}/ai-credits`, { monthlyCredits, overageEnabled });
  }

  startImpersonation(tenantId: string, userId: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/tenants/${tenantId}/impersonate/${userId}`, {});
  }

  endImpersonation(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/end-impersonation`, {});
  }
}
