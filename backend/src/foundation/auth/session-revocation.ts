import type { PrismaService } from '../../prisma/prisma.service';

/** The client inside `prisma.$transaction(async (tx) => …)`. */
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * End every session a person has — ACC-188, shared with ACC-164.
 *
 * Runs INSIDE the caller's transaction, so ending the sessions commits or rolls
 * back with the change that requires it (a password reset; an MFA reset):
 *
 *   1. `User.tokenVersion += 1`. TenantGuard refuses every access token issued
 *      at the old version on its next request, and `refresh()` refuses every
 *      refresh token issued at it (ACC-122).
 *   2. Every live RefreshToken row is revoked (`revokedAt = now`), so the rows
 *      themselves say the session ended, and the effect does not rest on the
 *      version check alone.
 *   3. Better Auth's own `authSession` rows for the person are deleted.
 *
 * It only revokes. It never CREATES a refresh row: AuthService.issueRefreshToken()
 * is the one place that does (ACC-126's write scan).
 *
 * Scoped by the user id AND organisation together, like every tenant write.
 */
export async function endEverySessionInTx(
  tx: Tx,
  user: { id: string; organizationId: string; authUserId: string | null },
  now: Date = new Date(),
): Promise<void> {
  await tx.user.updateMany({
    where: { id: user.id, organizationId: user.organizationId },
    data: { tokenVersion: { increment: 1 } },
  });
  await tx.refreshToken.updateMany({
    where: { userId: user.id, organizationId: user.organizationId, revokedAt: null },
    data: { revokedAt: now },
  });
  if (user.authUserId) {
    await tx.authSession.deleteMany({ where: { userId: user.authUserId } });
  }
}
