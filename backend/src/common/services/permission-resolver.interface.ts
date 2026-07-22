// Keeps common/guards decoupled from the concrete foundation/roles module —
// mirrors the StorageProvider / AuthProvider / AiProvider pluggable-provider
// pattern already established for exactly this kind of cross-cutting concern.
export interface PermissionResolver {
  getUserPermissions(userId: string, organizationId: string): Promise<string[]>;
}

export const PERMISSION_RESOLVER = Symbol('PERMISSION_RESOLVER');
