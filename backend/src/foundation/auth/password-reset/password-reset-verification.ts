import { createHash } from 'crypto';
import type { PrismaService } from '../../../prisma/prisma.service';
import { BETTER_AUTH_RESET_PASSWORD_PREFIX } from '../better-auth.contract';

/** The client inside `prisma.$transaction(async (tx) => …)`. */
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Better Auth's reset row, written by us — ACC-188.
 *
 * THE ONLY PLACE outside Better Auth that writes a `reset-password:` row. The
 * token is ours (32 random bytes, lane B's rule), which Better Auth's
 * requestPasswordReset cannot issue (its tokens are 24 characters), so the row
 * it would have written is written here, inside the issuing transaction, in the
 * exact shape Better Auth's resetPassword consumes. Every fact this relies on is
 * in better-auth.contract.ts and asserted against the installed library by
 * better-auth.contract.spec.ts, so an upgrade that changes one fails CI.
 */

/**
 * The identifier Better Auth stores for `reset-password:<token>` with
 * `storeIdentifier: 'hashed'`: base64url(SHA-256(identifier)), no padding — the
 * same as its defaultKeyHasher (db/verification-token-storage.mjs).
 */
export function storedResetIdentifier(token: string): string {
  return createHash('sha256')
    .update(`${BETTER_AUTH_RESET_PASSWORD_PREFIX}${token}`)
    .digest('base64url');
}

/** Write Better Auth's reset row for this token, in the caller's transaction. */
export async function createResetVerificationInTx(
  tx: Tx,
  token: string,
  authUserId: string,
  expiresAt: Date,
): Promise<void> {
  await tx.authVerification.create({
    data: {
      identifier: storedResetIdentifier(token),
      value: authUserId,
      expiresAt,
    },
  });
}
