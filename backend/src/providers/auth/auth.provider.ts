// AuthProvider interface — all auth implementations must satisfy this contract.
//
// Implementations:
//   BetterAuthProvider  — default, local accounts via Better Auth
//   AzureAdProvider     — Azure AD / Entra ID via OIDC (Step 9)
//   GoogleProvider      — Google Workspace via OIDC (future)
//
// The authProvider field on Organization drives which implementation is injected.

export interface AuthUser {
  id: string;
  email: string;
  organizationId: string;
  tokenVersion: number;
}

export interface AuthProvider {
  validateToken(token: string): Promise<AuthUser | null>;
  invalidateUserSessions(userId: string): Promise<void>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
