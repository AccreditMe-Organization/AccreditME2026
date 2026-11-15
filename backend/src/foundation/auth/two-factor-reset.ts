import type { PrismaService } from '../../prisma/prisma.service';
import {
  TWO_FACTOR_ATTEMPTS_PREFIX,
  TWO_FACTOR_CHALLENGE_PREFIX,
} from './better-auth.contract';

/** The client inside `prisma.$transaction(async (tx) => …)`. */
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Clearing a person's two-step sign-in from the SERVER — ACC-164, the
 * administrator reset.
 *
 * Better Auth's own `disableTwoFactor` needs the person's session and password,
 * which an administrator has neither of. So this makes exactly the writes
 * `disableTwoFactor` makes (two-factor/index.mjs: the flag, then the row), and
 * nothing more, inside OUR transaction:
 *
 *   1. `AuthUser.twoFactorEnabled = false` — the sign-in hook reads only this
 *      flag to decide whether a code is asked.
 *   2. The `AuthTwoFactor` row is DELETED. Leaving it would be a defect, not
 *      tidiness: `enableTwoFactor` carries an old row's `verified` onto the new
 *      secret, and `verifyTOTP` turns the flag on only for an unverified one,
 *      so the person's next set-up would say "on" and never ask for a code.
 *   3. Any open sign-in challenge of theirs (`2fa-<id>` rows whose value is the
 *      AuthUser id, and their `2fa-attempts-<id>` counters) is deleted — the
 *      same rows `clearChallenge()` deletes, keyed by person instead of cookie.
 *
 * Trust-device rows are not touched: we never send `trustDevice`, so none
 * exist. Every one of these facts is pinned in better-auth.contract.spec.ts.
 *
 * This module and two-factor-challenge.ts are the only places that write
 * Better Auth's two-step state (the scan in two-factor-writes.scan.spec.ts).
 * These are Better Auth's tables, keyed by the AuthUser id; the caller has
 * already scoped the person by organisation.
 */
export async function resetTwoFactorInTx(tx: Tx, authUserId: string): Promise<void> {
  await tx.authUser.update({
    where: { id: authUserId },
    data: { twoFactorEnabled: false },
  });
  await tx.authTwoFactor.deleteMany({ where: { userId: authUserId } });

  const challenges = await tx.authVerification.findMany({
    where: {
      value: authUserId,
      identifier: {
        startsWith: TWO_FACTOR_CHALLENGE_PREFIX,
        not: { startsWith: TWO_FACTOR_ATTEMPTS_PREFIX },
      },
    },
    select: { identifier: true },
  });
  if (challenges.length > 0) {
    await tx.authVerification.deleteMany({
      where: {
        identifier: {
          in: challenges.flatMap((c) => [
            c.identifier,
            `${TWO_FACTOR_ATTEMPTS_PREFIX}${c.identifier}`,
          ]),
        },
      },
    });
  }
}
