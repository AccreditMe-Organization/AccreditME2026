import { AccountOwnerProtectedException } from './role-permission-refusal';

/**
 * ACC-221 — the organisation's account owner, and the one check that protects
 * them.
 *
 * DECIDED (Ahmad, 29 Oct 2026): each organisation has one account owner
 * (`Organization.ownerUserId`). Inside the tenant nobody can take Organization
 * Administrator from them, deactivate them or revoke their invitation. Other
 * people may hold Organization Administrator or "Manage roles" and act as
 * administrators; only a platform administrator moves ownership.
 *
 * Called INSIDE the transaction that makes the change, before the write, by
 * exactly three paths: removing TENANT_ADMIN from a user
 * (`RoleService.removeRoleFromUser`), deactivating a user
 * (`UserService.deactivate`) and revoking an invitation
 * (`UserService.revokeInvitation`). Deactivating the role itself is refused for
 * everyone, owner or not (`RootRoleCannotBeDeactivatedException`), so it needs
 * no owner read.
 *
 * One small read of one column, in a handler that is already writing. Never
 * add it to a guard, interceptor or middleware.
 *
 * **No owner recorded (`ownerUserId` null) protects nobody.** An organisation
 * the ACC-221 backfill could not decide for keeps working exactly as before.
 */
export interface AccountOwnerClient {
  organization: {
    findFirst(args: {
      where: { id: string };
      select: { ownerUserId: true };
    }): Promise<{ ownerUserId: string | null } | null>;
  };
}

export async function assertNotAccountOwner(
  client: AccountOwnerClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const org = await client.organization.findFirst({
    where: { id: organizationId },
    select: { ownerUserId: true },
  });
  if (org?.ownerUserId && org.ownerUserId === userId) {
    throw new AccountOwnerProtectedException();
  }
}
