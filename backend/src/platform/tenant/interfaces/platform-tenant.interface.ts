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
  // TENANT_ADMIN users in this tenant — the impersonation target list, and
  // (ACC-221) the people ownership can be transferred to. isOwner marks the
  // account owner among them.
  tenantAdmins: { id: string; name: string; email: string; isOwner: boolean }[];
  // ACC-221 — the organisation's account owner, or null when none is recorded.
  owner: { id: string; name: string; email: string } | null;
}
