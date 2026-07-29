import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type PlanModuleAccessLevel = 'FULL' | 'READ_ONLY' | 'NONE';

export interface IPlanModule {
  id: string;
  planId: string;
  moduleKey: string;
  accessLevel: PlanModuleAccessLevel;
}

export interface IPlan {
  id: string;
  name: string;
  nameEn: string;
  nameAr: string;
  monthlyPrice: string;
  annualPrice: string;
  maxFullUsers: number | null;
  maxStaff: number | null;
  maxStorageGb: number;
  aiCreditsPerMonth: number;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  planModules?: IPlanModule[];
}

export interface IAiCreditPack {
  id: string;
  name: string;
  nameAr: string | null;
  credits: number;
  price: string;
  isActive: boolean;
  availableTo: string[];
  sortOrder: number;
}

export interface IAiFeatureCost {
  id: string;
  featureKey: string;
  creditCost: number;
  description: string | null;
}

// The set of known functional-module keys for the PlanModule editor's
// dropdown — a plain UI-convenience list, NOT a schema enum (PlanModule.
// moduleKey is a free-text DB column by design, per CLAUDE.md's "never
// hardcoded" rule for plan/module config). Extend this array, never the
// schema, whenever a new functional module ships (ACC-17+).
export const KNOWN_MODULE_KEYS = [
  'documents', 'standards', 'incidents', 'capa', 'gap', 'audit', 'kpi', 'committees', 'meetings',
] as const;

@Injectable({ providedIn: 'root' })
export class PlanService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/platform`;

  listPlans(includeInactive = false): Observable<IPlan[]> {
    return this.http.get<IPlan[]>(`${this.baseUrl}/plans`, { params: { includeInactive: String(includeInactive) } });
  }

  getPlanById(id: string): Observable<IPlan> {
    return this.http.get<IPlan>(`${this.baseUrl}/plans/${id}`);
  }

  createPlan(dto: Partial<IPlan>): Observable<IPlan> {
    return this.http.post<IPlan>(`${this.baseUrl}/plans`, dto);
  }

  updatePlan(id: string, dto: Partial<IPlan>): Observable<IPlan> {
    return this.http.patch<IPlan>(`${this.baseUrl}/plans/${id}`, dto);
  }

  deactivatePlan(id: string): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/plans/${id}/deactivate`, {});
  }

  listPlanModules(planId: string): Observable<IPlanModule[]> {
    return this.http.get<IPlanModule[]>(`${this.baseUrl}/plans/${planId}/modules`);
  }

  upsertPlanModule(planId: string, moduleKey: string, accessLevel: PlanModuleAccessLevel): Observable<IPlanModule> {
    return this.http.post<IPlanModule>(`${this.baseUrl}/plans/${planId}/modules`, { moduleKey, accessLevel });
  }

  listAiCreditPacks(includeInactive = false): Observable<IAiCreditPack[]> {
    return this.http.get<IAiCreditPack[]>(`${this.baseUrl}/ai-credit-packs`, { params: { includeInactive: String(includeInactive) } });
  }

  createAiCreditPack(dto: Partial<IAiCreditPack>): Observable<IAiCreditPack> {
    return this.http.post<IAiCreditPack>(`${this.baseUrl}/ai-credit-packs`, dto);
  }

  updateAiCreditPack(id: string, dto: Partial<IAiCreditPack>): Observable<IAiCreditPack> {
    return this.http.patch<IAiCreditPack>(`${this.baseUrl}/ai-credit-packs/${id}`, dto);
  }

  listAiFeatureCosts(): Observable<IAiFeatureCost[]> {
    return this.http.get<IAiFeatureCost[]>(`${this.baseUrl}/ai-feature-costs`);
  }

  upsertAiFeatureCost(dto: { featureKey: string; creditCost: number; description?: string }): Observable<IAiFeatureCost> {
    return this.http.post<IAiFeatureCost>(`${this.baseUrl}/ai-feature-costs`, dto);
  }
}
