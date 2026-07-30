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
  ai: {
    monthlyCredits: number;
    creditsUsed: number;
    creditsRemaining: number;
    overageEnabled: boolean;
  };
  // TENANT_ADMIN users in this tenant — the impersonation target list.
  tenantAdmins: { id: string; name: string; email: string }[];
}
