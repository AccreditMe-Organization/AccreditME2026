import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { USERS_PERMISSIONS } from '../../../common/constants/permissions';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { endEverySessionInTx } from '../../auth/session-revocation';
import { sessionStartOf } from '../../auth/session-limit';
import { errorKind } from '../../committees/transfer-notice/error-kind';
import { SecurityNoticeService } from '../../notification/security-notice';
import { assertNotAccountOwner } from '../../roles/account-owner';
import { AccountOwnerProtectedException } from '../../roles/role-permission-refusal';
import { accountActionBlock, holdsActiveRootRole } from '../account-action-rule';
import { sessionDevice } from './session-device';
import {
  IUserSession,
  IUserSessions,
  liveSessionWhere,
  SessionsRefusalCode,
  SessionsRefusalException,
  USER_SESSIONS_CAP,
} from './user-sessions.interface';

export interface SessionsViewer {
  id: string;
  permissions: readonly string[];
  /** The caller's own sign-in, from the access token's `sst` (TenantGuard; no query). */
  sessionStartedAt?: Date;
}

/** What `end*` answers: how many sign-ins it ended (0 when they had already ended). */
export interface SessionsEnded {
  ended: number;
}

/**
 * ACC-216 — the read's gate, with NO query (ACC-101 clause a: the request names
 * the parent, a person). Yourself, always. Anyone else: users:view (the parent,
 * a person's record), then users:manage_sessions (the child's own key; Ahmad,
 * Q2). Each refusal is a 403 naming the missing key, identical for a real
 * colleague and an invented id.
 */
export function assertMayReadSessions(viewer: Pick<SessionsViewer, 'id' | 'permissions'>, userId: string): void {
  if (viewer.id === userId) return;
  for (const key of [USERS_PERMISSIONS.VIEW, USERS_PERMISSIONS.MANAGE_SESSIONS]) {
    if (!viewer.permissions.includes(key)) throw new ForbiddenException(`Required permission: ${key}`);
  }
}

const hashOf = (rawToken: string): string => createHash('sha256').update(rawToken).digest('hex');

/** The same second: `sst` is whole seconds, `sessionStartedAt` has milliseconds. */
const sameSecond = (a: Date, b: Date): boolean => Math.floor(a.getTime() / 1000) === Math.floor(b.getTime() / 1000);

const ACCOUNT_ACTION_CODES = {
  SELF: 'SESSIONS_END_SELF',
  IMPERSONATING: 'SESSIONS_IMPERSONATING',
  HIGHER_ACCOUNT: 'SESSIONS_END_HIGHER_ACCOUNT',
} as const satisfies Record<string, SessionsRefusalCode>;

/**
 * ACC-216 Sessions, PR 1 (backend/Plans/step-216-sessions-and-tasks.md §2, Ahmad's
 * answers of 17 Nov): a person's current sign-ins, and ending them.
 *
 * - **Read** (`GET /users/:userId/sessions`): yourself, or users:view +
 *   users:manage_sessions; the live predicate (`liveSessionWhere()`), capped at
 *   20; the device parsed here; the address only to yourself and the key holder.
 * - **Yourself** (`POST /auth/sessions/:id/end`, `POST /auth/sessions/end-others`,
 *   under /auth so the refresh cookie arrives and "this device" is exact): revokes
 *   the chosen chain, or every chain but yours. It bites at that device's next
 *   renewal, up to 15 minutes later (Q7): nothing is added to TenantGuard or any
 *   other per-request path.
 * - **An administrator** (`POST /users/:userId/sessions/end-all`): "Sign out
 *   everywhere" through `endEverySessionInTx()`, at once (Q4); the account-action
 *   rule (not yourself, not impersonating, not the owner, the floor); an audit
 *   row and the `sessions_ended` email AFTER the commit (Q5).
 *
 * Every query is scoped by the person AND the organisation. Nothing runs on the
 * per-request path.
 */
@Injectable()
export class UserSessionsService {
  private readonly logger = new Logger(UserSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly securityNotice: SecurityNoticeService,
  ) {}

  /** Two queries, whatever the count: the person, then the rows and their count together. */
  async list(organizationId: string, viewer: SessionsViewer, userId: string, now: Date = new Date()): Promise<IUserSessions> {
    assertMayReadSessions(viewer, userId);
    // Another organisation's person, or an invented id: the identical 404.
    const person = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { status: true, tokenVersion: true },
    });
    if (!person) throw new NotFoundException('User not found');
    // A person who is not ACTIVE has no current sign-in, whatever rows remain.
    if (person.status !== 'ACTIVE') return { total: 0, rows: [] };

    const where = liveSessionWhere(userId, organizationId, person.tokenVersion, now);
    const [rows, total] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: USER_SESSIONS_CAP,
        select: { id: true, sessionStartedAt: true, createdAt: true, expiresAt: true, deviceInfo: true, ipAddress: true },
      }),
      this.prisma.refreshToken.count({ where }),
    ]);

    const isSelf = viewer.id === userId;
    const showAddress = isSelf || viewer.permissions.includes(USERS_PERMISSIONS.MANAGE_SESSIONS);
    return {
      total,
      rows: rows.map(
        (r): IUserSession => ({
          id: r.id,
          startedAt: sessionStartOf(r),
          lastActiveAt: r.createdAt,
          expiresAt: r.expiresAt,
          device: sessionDevice(r.deviceInfo),
          address: showAddress ? r.ipAddress : null,
          current: isSelf && !!viewer.sessionStartedAt && !!r.sessionStartedAt && sameSecond(r.sessionStartedAt, viewer.sessionStartedAt),
        }),
      ),
    };
  }

  /**
   * Yourself: end ONE of your sign-ins. `sessionId` is a row of yours (any row of
   * the chain; the list gives the live one, which a renewal may since have
   * replaced). Its whole chain is revoked. Your current sign-in is refused: Sign
   * out ends that.
   */
  async endOwn(
    organizationId: string,
    me: { id: string; impersonating: boolean },
    refreshCookie: string | undefined,
    sessionId: string,
  ): Promise<SessionsEnded> {
    if (me.impersonating) throw new SessionsRefusalException('SESSIONS_IMPERSONATING');
    const chosen = await this.prisma.refreshToken.findFirst({
      where: { id: sessionId, userId: me.id, organizationId },
      select: { id: true, sessionStartedAt: true },
    });
    // Another person's row, another organisation's, or an invented id: the same 404.
    if (!chosen) throw new NotFoundException('Session not found');
    const current = await this.currentRow(organizationId, me.id, refreshCookie);
    if (current && this.sameChain(current, chosen)) throw new SessionsRefusalException('SESSION_IS_CURRENT');

    const { count } = await this.prisma.refreshToken.updateMany({
      where: {
        userId: me.id,
        organizationId,
        revokedAt: null,
        ...(chosen.sessionStartedAt ? { sessionStartedAt: chosen.sessionStartedAt } : { id: chosen.id }),
      },
      data: { revokedAt: new Date() },
    });
    await this.audit(organizationId, me.id, me.id, 'one', count);
    return { ended: count };
  }

  /** Yourself: end every sign-in but the one you are using. */
  async endOtherOwn(
    organizationId: string,
    me: { id: string; impersonating: boolean },
    refreshCookie: string | undefined,
  ): Promise<SessionsEnded> {
    if (me.impersonating) throw new SessionsRefusalException('SESSIONS_IMPERSONATING');
    const current = await this.currentRow(organizationId, me.id, refreshCookie);
    // Without knowing which is yours, "the others" would include it.
    if (!current) throw new SessionsRefusalException('CURRENT_SESSION_UNKNOWN');

    // Rows with no start are always other sign-ins of a chain that is not yours
    // unless they are the current row itself (SQL `<>` never matches NULL, so
    // the null case is spelled out).
    const notMine: Prisma.RefreshTokenWhereInput = current.sessionStartedAt
      ? { OR: [{ sessionStartedAt: null }, { sessionStartedAt: { not: current.sessionStartedAt } }] }
      : { id: { not: current.id } };
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId: me.id, organizationId, revokedAt: null, ...notMine },
      data: { revokedAt: new Date() },
    });
    await this.audit(organizationId, me.id, me.id, 'others', count);
    return { ended: count };
  }

  /** An administrator: "Sign out everywhere" (Q4), at once, through endEverySessionInTx(). */
  async endEverywhere(
    organizationId: string,
    actor: { id: string; permissions: readonly string[]; impersonating: boolean },
    userId: string,
  ): Promise<SessionsEnded> {
    // 1. The keys, before any read (the route also carries @Permissions for the second).
    for (const key of [USERS_PERMISSIONS.VIEW, USERS_PERMISSIONS.MANAGE_SESSIONS]) {
      if (!actor.permissions.includes(key)) throw new ForbiddenException(`Required permission: ${key}`);
    }
    // 2. Another organisation's person, and an invented id, get the same 404.
    const target = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: {
        id: true,
        authUserId: true,
        ownedOrganizations: { where: { id: organizationId }, select: { id: true } },
      },
    });
    if (!target) throw new NotFoundException('User not found');

    // 3–6. The account-action rule (ACC-164's, generalised).
    const block = await accountActionBlock({
      isSelf: target.id === actor.id,
      impersonating: actor.impersonating,
      isAccountOwner: target.ownedOrganizations.length > 0,
      targetHoldsRootRole: () => holdsActiveRootRole(this.prisma, organizationId, target.id),
      actorHoldsRootRole: () => holdsActiveRootRole(this.prisma, organizationId, actor.id),
    });
    if (block === 'ACCOUNT_OWNER_PROTECTED') throw new AccountOwnerProtectedException();
    if (block) throw new SessionsRefusalException(ACCOUNT_ACTION_CODES[block]);

    // 7. One transaction under the person's row lock; the owner checked again inside it.
    const ended = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} AND "organizationId" = ${organizationId} FOR UPDATE`;
      await assertNotAccountOwner(tx, organizationId, userId);
      const live = await tx.refreshToken.count({ where: { userId, organizationId, revokedAt: null } });
      await endEverySessionInTx(tx, { id: userId, organizationId, authUserId: target.authUserId });
      return live;
    });

    // 8. After the commit, never inside it: the audit row, then the email.
    await this.audit(organizationId, actor.id, userId, 'all', ended);
    try {
      await this.securityNotice.enqueue({ organizationId, userId, notice: 'sessions_ended' });
    } catch (err) {
      // The sign-out committed: a failed email never turns it into an error.
      this.logger.warn(`sessions_ended notice not queued (${errorKind(err)}): organisation ${organizationId}, user ${userId}.`);
    }
    return { ended };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** The caller's own current row, by the refresh cookie's hash, scoped to them. */
  private async currentRow(organizationId: string, userId: string, refreshCookie: string | undefined) {
    if (!refreshCookie) return null;
    return this.prisma.refreshToken.findFirst({
      where: { tokenHash: hashOf(refreshCookie), userId, organizationId, revokedAt: null },
      select: { id: true, sessionStartedAt: true },
    });
  }

  private sameChain(a: { id: string; sessionStartedAt: Date | null }, b: { id: string; sessionStartedAt: Date | null }): boolean {
    if (a.id === b.id) return true;
    return !!a.sessionStartedAt && !!b.sessionStartedAt && a.sessionStartedAt.getTime() === b.sessionStartedAt.getTime();
  }

  /** One audit row: who ended how many of whose sign-ins. No address, device or token. */
  private async audit(organizationId: string, actorId: string, userId: string, scope: 'one' | 'others' | 'all', count: number) {
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'User',
      objectId: userId,
      metadata: { event: 'sessions_ended', scope, count },
    });
  }
}
