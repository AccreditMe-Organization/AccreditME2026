// AuthProvider interface — all auth implementations must satisfy this contract.
//
// Implementations:
//   BetterAuthProvider  — default, local accounts via Better Auth
//   AzureAdProvider     — Azure AD / Entra ID via OIDC (Phase 3)
//   GoogleProvider      — Google Workspace via OIDC (future)
//
// The authProvider field on Organization drives which implementation is injected.

// Named AuthenticatedUser, not AuthUser — Step 9 added a Prisma model literally
// named AuthUser (Better Auth's own identity table); renamed here to avoid a
// same-name collision between this small token-validation result type and the
// Prisma-generated AuthUser type.
export interface AuthenticatedUser {
  id: string;
  email: string;
  organizationId: string;
  tokenVersion: number;
}

export interface AuthProvider {
  validateToken(token: string): Promise<AuthenticatedUser | null>;
  invalidateUserSessions(userId: string): Promise<void>;
}

export const AUTH_PROVIDER = Symbol('AUTH_PROVIDER');
