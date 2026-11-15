import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { USERS_PERMISSIONS } from '../../../common/constants/permissions';
import { SecurityNoticeService } from '../../notification/security-notice';
import { assertNotAccountOwner } from '../../roles/account-owner';
import { AccountOwnerProtectedException } from '../../roles/role-permission-refusal';
import { endEverySessionInTx } from '../../auth/session-revocation';
import { resetTwoFactorInTx } from '../../auth/two-factor-reset';
import {
  holdsActiveRootRole,
  mfaResetBlock,
  MfaResetBlock,
  MfaResetRefusalException,
} from './mfa-reset-rule';

/** What the user record shows a viewer about someone else's two-step sign-in. */
export interface TwoStepForViewer {
  enabled: boolean;
  /** Reset is offered: it is on, and the viewer isn't signed in as someone else. */
  mayReset: boolean;
}

/** The facts about the person, read in the user record's own query. */
export interface TwoStepTarget {
  id: string;
  isAccountOwner: boolean;
  twoFactorEnabled: boolean;
}

/**
 * The administrator reset of another person's two-step sign-in — ACC-164
 * (backend/Plans/step-164-mfa-off.md §4, §0b).
 *
 * A reset makes, in ONE transaction under the person's row lock: the two-step
 * writes Better Auth's own `disableTwoFactor` makes (two-factor-reset.ts), and
 * the end of every session (session-revocation.ts). After the commit, one audit
 * row, then the `mfa_reset` security notice (an email, never a bell entry).
 */
@Injectable()
export class UserMfaResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly securityNotice: SecurityNoticeService,
  ) {}

  private block(
    organizationId: string,
    actorId: string,
    target: { id: string; isAccountOwner: boolean },
    impersonating: boolean,
  ): Promise<MfaResetBlock | null> {
    return mfaResetBlock({
      isSelf: target.id === actorId,
      impersonating,
      isAccountOwner: target.isAccountOwner,
      targetHoldsRootRole: () => holdsActiveRootRole(this.prisma, organizationId, target.id),
      actorHoldsRootRole: () => holdsActiveRootRole(this.prisma, organizationId, actorId),
    });
  }

  /**
   * Rule 4 (Ahmad, 14 Nov): the status shows only to people allowed to reset
   * it. `null` — no panel at all, never "Off" — for a viewer without the key,
   * on their own record (which reads /auth/mfa/status), on the account owner's,
   * and below the floor. The same rule as the route, so nothing offered is
   * refused, except the impersonation refusal, which is a fallback.
   */
  async twoStepFor(
    organizationId: string,
    viewer: { id: string; permissions: readonly string[]; impersonating: boolean },
    target: TwoStepTarget,
  ): Promise<TwoStepForViewer | null> {
    if (!viewer.permissions.includes(USERS_PERMISSIONS.RESET_MFA)) return null;
    // Impersonation hides only the action, never the panel.
    const block = await this.block(organizationId, viewer.id, target, false);
    if (block) return null;
    return {
      enabled: target.twoFactorEnabled,
      mayReset: target.twoFactorEnabled && !viewer.impersonating,
    };
  }

  /** `POST /users/:id/mfa/reset` — every check before any write. */
  async resetMfa(
    id: string,
    organizationId: string,
    actorId: string,
    impersonating: boolean,
  ): Promise<void> {
    // 1. Another organisation's person, and an invented id, get the same 404.
    const target = await this.prisma.user.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        organizationId: true,
        authUserId: true,
        authUser: { select: { twoFactorEnabled: true } },
        ownedOrganizations: { where: { id: organizationId }, select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException('User not found');

    // 2–5. Self, impersonating, owner, the floor: the rule the screen reads.
    const block = await this.block(
      organizationId,
      actorId,
      { id: target.id, isAccountOwner: target.ownedOrganizations.length > 0 },
      impersonating,
    );
    if (block === 'ACCOUNT_OWNER_PROTECTED') throw new AccountOwnerProtectedException();
    if (block) throw new MfaResetRefusalException(block);

    // 6. Nothing to reset: a repeated press is harmless, and writes nothing.
    if (!target.authUserId || !target.authUser?.twoFactorEnabled) {
      throw new MfaResetRefusalException('MFA_NOT_ENABLED');
    }
    const authUserId = target.authUserId;

    // 7. One transaction, under the person's row lock: two administrators
    // pressing at once make one reset and one MFA_NOT_ENABLED.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`;
      // ACC-221 — the owner check, inside the transaction, before the write.
      await assertNotAccountOwner(tx, organizationId, id);
      const current = await tx.authUser.findUnique({
        where: { id: authUserId },
        select: { twoFactorEnabled: true },
      });
      if (!current?.twoFactorEnabled) throw new MfaResetRefusalException('MFA_NOT_ENABLED');
      await resetTwoFactorInTx(tx, authUserId);
      await endEverySessionInTx(tx, { id, organizationId, authUserId });
    });

    // 8. After the commit, never inside it: the audit row, then the notice.
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: id,
      metadata: { event: 'mfa_reset' },
    });
    await this.securityNotice.enqueue({ organizationId, userId: id, notice: 'mfa_reset' });
  }
}
