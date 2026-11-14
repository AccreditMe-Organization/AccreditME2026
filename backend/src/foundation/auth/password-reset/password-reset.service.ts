import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { buildTenantUrl } from '../../../common/config/app-url.config';
import { isAtOwnAddress } from '../../../common/tenant/session-address';
import { isOrganizationOpen } from '../../../common/tenant/organization-status';
import { TransactionalEmailService } from '../../notification/transactional-email.service';
import { SecurityNoticeService } from '../../notification/security-notice';
import { PasswordRefusalException } from '../password-refusal';
import {
  BETTER_AUTH_INVALID_TOKEN,
  BETTER_AUTH_PASSWORD_CHECK_FAILED,
  BETTER_AUTH_PASSWORD_CODES,
} from '../better-auth.contract';
import { endEverySessionInTx } from '../session-revocation';
import { PasswordBreachCheckService } from './password-breach-check.service';
import { createResetVerificationInTx } from './password-reset-verification';
import { ResetLinkRefusalException } from './reset-link-refusal';
import { renderResetEmail } from './reset-email';
import {
  RESET_LINK_RETENTION_MS,
  RESET_LINK_TTL_MS,
  RESET_TOKEN_SHAPE,
  hashResetToken,
  newResetToken,
} from './reset-link.config';

export const PASSWORD_RESET_QUEUE = 'password-reset';
export const PASSWORD_RESET_JOB = 'issue-reset-link';

/** Better Auth's own password limits (create-context.mjs), checked before any network call. */
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export interface PasswordResetJobData {
  organizationSlug: string;
  email: string;
}

/** Better Auth's resetPassword, as a Response — passed in by AuthService, which owns the instance. */
export type BetterAuthResetPassword = (token: string, newPassword: string) => Promise<Response>;

interface OpenLink {
  id: string;
  expiresAt: Date;
  user: { id: string; organizationId: string; email: string; authUserId: string | null };
}

/**
 * Password reset by email — ACC-188. Full flow and decisions:
 * backend/Plans/step-188-password-reset.md §2.5 and §7.
 *
 * Three entry points, each with one job:
 *   request()  — IN THE REQUEST: enqueue and return. A real and an unknown
 *                address do the same work and get the same answer.
 *   issue()    — IN THE WORKER: look the account up, make the link, email it.
 *   lookup() / reset() — the reset page, keyed by the token alone.
 *
 * THE TOKEN is 32 random bytes. It is never written to a log, an audit row, a
 * job or a notification: it is stored only as a SHA-256 here and, hashed again,
 * in Better Auth's reset row; the email carries it once.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(PASSWORD_RESET_QUEUE) private readonly queue: Queue,
    private readonly email: TransactionalEmailService,
    private readonly securityNotices: SecurityNoticeService,
    private readonly auditLog: AuditLogService,
    private readonly breachCheck: PasswordBreachCheckService,
  ) {}

  /**
   * Forgot password. ONE queue add and nothing else, whoever the address
   * belongs to, so neither the answer nor the time it takes can tell a real
   * account from an unknown one. Everything that depends on the account happens
   * in issue(). A failed add is logged by its kind only (it can name the Redis
   * server) and still answers the same 200: the person asks again.
   */
  async request(data: PasswordResetJobData): Promise<void> {
    try {
      await this.queue.add(
        PASSWORD_RESET_JOB,
        { organizationSlug: data.organizationSlug, email: data.email },
        { attempts: 1, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
      );
    } catch (err) {
      this.logger.error(
        `Could not enqueue a reset-link request (${err instanceof Error ? err.name : 'unknown error'}).`,
      );
    }
  }

  /**
   * In the worker. Issues a link only for an ACTIVE person with a password
   * account, in an open organisation; every other case does nothing, silently.
   */
  async issue(data: PasswordResetJobData, now: Date = new Date()): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { slug: data.organizationSlug },
      select: { id: true, slug: true, status: true, name: true, nameAr: true, language: true },
    });
    if (!organization || !isOrganizationOpen(organization.status)) return;

    const user = await this.prisma.user.findFirst({
      where: {
        organizationId: organization.id,
        email: { equals: data.email, mode: 'insensitive' },
      },
      select: { id: true, organizationId: true, email: true, status: true, authUserId: true, language: true },
    });
    if (!user || user.status !== 'ACTIVE' || !user.authUserId) return;
    const authUserId = user.authUserId;

    const token = newResetToken();
    const expiresAt = new Date(now.getTime() + RESET_LINK_TTL_MS);
    const cutoff = new Date(now.getTime() - RESET_LINK_RETENTION_MS);

    // ONE OPEN LINK PER PERSON (lane B): the User row lock serialises two
    // requests, the earlier link ends REPLACED, and the new one is written with
    // Better Auth's row — all in one transaction (ACC-173's shape). The same
    // transaction deletes this person's links that ended or expired more than
    // 30 days ago; there is no sweep.
    const linkId = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} AND "organizationId" = ${user.organizationId} FOR UPDATE`;
      // Retention first: ending a long-expired open link below would give it
      // a fresh endedAt and keep it another 30 days.
      await tx.passwordResetLink.deleteMany({
        where: {
          organizationId: user.organizationId,
          userId: user.id,
          OR: [{ endedAt: { lt: cutoff } }, { endedAt: null, expiresAt: { lt: cutoff } }],
        },
      });
      await tx.passwordResetLink.updateMany({
        where: { organizationId: user.organizationId, userId: user.id, endedAt: null },
        data: { endedAt: now, endReason: 'REPLACED' },
      });
      const link = await tx.passwordResetLink.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          tokenHash: hashResetToken(token),
          expiresAt,
        },
        select: { id: true },
      });
      await createResetVerificationInTx(tx, token, authUserId, expiresAt);
      return link.id;
    });

    // The link is built by buildTenantUrl() and nothing else: the person's own
    // address, never Better Auth's handler (ACC-148, ACC-139).
    const url = buildTenantUrl(organization.slug, `/reset-password?token=${token}`);
    const language = (user.language ?? organization.language) === 'ar' ? 'ar' : 'en';
    const organisation =
      language === 'ar' ? (organization.nameAr ?? organization.name) : organization.name;
    const { subject, body } = renderResetEmail(language, organisation, url);

    try {
      await this.email.send({ to: user.email, subject, body, direction: language === 'ar' ? 'rtl' : 'ltr' });
    } catch (err) {
      // A link nobody received is ended, so it can never be the "newest" one.
      // The error carries no token: neither does anything we rethrow.
      await this.prisma.passwordResetLink.updateMany({
        where: { id: linkId, endedAt: null },
        data: { endedAt: new Date(), endReason: 'VOID' },
      });
      throw new Error(
        `Reset-link email not sent for user ${user.id} (${err instanceof Error ? err.name : 'unknown error'}).`,
      );
    }

    await this.auditLog.log({
      tenantId: user.organizationId,
      actorId: user.id,
      action: 'UPDATE',
      objectType: 'User',
      objectId: user.id,
      metadata: { event: 'password_reset_requested' },
    });
  }

  /**
   * The reset page's first read. Read-only. The body arrives `unknown` and is
   * shape-checked here (like lookupInvitation()), so a malformed one gets the
   * same RESET_LINK_INVALID as an unknown token, not the pipe's own message.
   */
  async lookup(body: unknown, origin: string | string[] | undefined): Promise<{ state: 'open'; expiresAt: string }> {
    const token =
      typeof body === 'object' && body !== null && !Array.isArray(body) && Object.keys(body).length === 1
        ? (body as Record<string, unknown>)['token']
        : undefined;
    if (typeof token !== 'string') throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    const link = await this.findOpenLink(token, origin, new Date());
    return { state: 'open', expiresAt: link.expiresAt.toISOString() };
  }

  /**
   * Set the new password. In order: the link is open; the password's length;
   * the breach check (BEFORE the token is spent); Better Auth consumes the
   * token and sets the password; then one transaction ends the link, every
   * session, and the wrong-password lock. Never signs anyone in, so MFA is
   * never bypassed; never touches the MFA code lock.
   */
  async reset(
    input: { token: string; password: string },
    origin: string | string[] | undefined,
    ipAddress: string | undefined,
    resetWithBetterAuth: BetterAuthResetPassword,
  ): Promise<void> {
    const link = await this.findOpenLink(input.token, origin, new Date());

    if (input.password.length < PASSWORD_MIN) throw new PasswordRefusalException('PASSWORD_TOO_SHORT');
    if (input.password.length > PASSWORD_MAX) throw new PasswordRefusalException('PASSWORD_TOO_LONG');
    await this.breachCheck.assertNotBreached(input.password);

    const response = await resetWithBetterAuth(input.token, input.password);
    if (!response.ok) await this.refuseFromBetterAuth(response, link);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${link.user.id} AND "organizationId" = ${link.user.organizationId} FOR UPDATE`;
      await tx.passwordResetLink.updateMany({
        where: { id: link.id, organizationId: link.user.organizationId, endedAt: null },
        data: { endedAt: now, endReason: 'USED' },
      });
      // Ahmad's rule 2: signed out everywhere.
      await endEverySessionInTx(tx, link.user, now);
      // Ahmad's rule 3: the wrong-password lock ends at the first success
      // (LoginAttemptService.lockedUntil()). Nothing is deleted, and the reason
      // keeps it apart from a real sign-in. The MFA code lock is not touched.
      await tx.loginAttempt.create({
        data: {
          organizationId: link.user.organizationId,
          email: link.user.email.toLowerCase(),
          success: true,
          failureReason: 'password_reset',
          ipAddress: ipAddress ?? null,
        },
      });
    });

    await this.auditLog.log({
      tenantId: link.user.organizationId,
      actorId: link.user.id,
      action: 'UPDATE',
      objectType: 'User',
      objectId: link.user.id,
      metadata: { event: 'password_reset' },
      ipAddress,
    });
    try {
      await this.securityNotices.enqueue({
        organizationId: link.user.organizationId,
        userId: link.user.id,
        notice: 'password_changed',
      });
    } catch (err) {
      this.logger.error(
        `Password changed for user ${link.user.id}, but its notice was not enqueued (${err instanceof Error ? err.name : 'unknown error'}).`,
      );
    }
  }

  /**
   * The link's state, or the refusal that names it. Keyed by the token's hash
   * alone, NOT by organisation: this runs before anyone is signed in, and the
   * token — 256 random bits — IS the key. The organisation comes from the row,
   * and the request must come from that organisation's own address.
   */
  private async findOpenLink(
    token: string,
    origin: string | string[] | undefined,
    now: Date,
  ): Promise<OpenLink> {
    if (!RESET_TOKEN_SHAPE.test(token)) throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    const row = await this.prisma.passwordResetLink.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: {
        id: true,
        expiresAt: true,
        endReason: true,
        user: { select: { id: true, organizationId: true, email: true, status: true, authUserId: true } },
        organization: { select: { slug: true, status: true } },
      },
    });
    if (!row || !isAtOwnAddress(origin, row.organization.slug)) {
      throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    }
    if (row.endReason === 'USED') throw new ResetLinkRefusalException('RESET_LINK_USED');
    if (row.endReason === 'REPLACED') throw new ResetLinkRefusalException('RESET_LINK_REPLACED');
    if (
      row.endReason === 'VOID' ||
      row.user.status !== 'ACTIVE' ||
      !row.user.authUserId ||
      !isOrganizationOpen(row.organization.status)
    ) {
      throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    }
    if (row.expiresAt.getTime() <= now.getTime()) throw new ResetLinkRefusalException('RESET_LINK_EXPIRED');
    return { id: row.id, expiresAt: row.expiresAt, user: row.user };
  }

  /** Better Auth refused. Read the returned Response, never a thrown error. */
  private async refuseFromBetterAuth(response: Response, link: OpenLink): Promise<never> {
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    switch (body.code) {
      case BETTER_AUTH_INVALID_TOKEN:
        // Our ledger said open, so another request spent it first (or its hour
        // ran out between the two reads).
        throw new ResetLinkRefusalException(
          link.expiresAt.getTime() <= Date.now() ? 'RESET_LINK_EXPIRED' : 'RESET_LINK_USED',
        );
      // Checked by Better Auth before it consumes: the link still works.
      case BETTER_AUTH_PASSWORD_CODES.TOO_SHORT:
        throw new PasswordRefusalException('PASSWORD_TOO_SHORT');
      case BETTER_AUTH_PASSWORD_CODES.TOO_LONG:
        throw new PasswordRefusalException('PASSWORD_TOO_LONG');
      case BETTER_AUTH_PASSWORD_CODES.COMPROMISED:
        // After our own check passed, so the breach list answered differently a
        // moment later. Better Auth consumed the token first: the link is gone.
        await this.voidLink(link);
        throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    }
    if (
      response.status === 500 &&
      typeof body.message === 'string' &&
      body.message.startsWith(BETTER_AUTH_PASSWORD_CHECK_FAILED)
    ) {
      await this.voidLink(link);
      throw new ResetLinkRefusalException('RESET_LINK_INVALID');
    }
    // Status and code only — never the body.
    throw new Error(`Better Auth resetPassword returned ${response.status}${body.code ? ` ${body.code}` : ''}`);
  }

  private async voidLink(link: OpenLink): Promise<void> {
    await this.prisma.passwordResetLink.updateMany({
      where: { id: link.id, organizationId: link.user.organizationId, endedAt: null },
      data: { endedAt: new Date(), endReason: 'VOID' },
    });
  }
}
