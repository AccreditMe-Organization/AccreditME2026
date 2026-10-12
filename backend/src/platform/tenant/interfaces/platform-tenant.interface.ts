import { IAiBalance } from '../../../foundation/ai/ai-balance';
export interface IPlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
  planId: string | null;
  planName: string | null;
  createdAt: Date;
}

export interface IPlatformTenantDetail extends IPlatformTenantSummary {
  userCount: number;
  modules: Record<string, boolean>;
  // ACC-194 — from the AI columns: allocation, used, remaining, renewal, a pending cut.
  ai: IAiBalance;
  // TENANT_ADMIN users in this tenant — the impersonation target list.
  tenantAdmins: { id: string; name: string; email: string }[];
}
