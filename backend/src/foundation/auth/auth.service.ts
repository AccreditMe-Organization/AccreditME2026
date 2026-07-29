// AuthService — the Better Auth <-> AccreditMe JWT bridge described in
// backend/Plans/step-09-user-management.md Section 1 and Section 12
// Discussion 4. Better Auth's own instance (created once here) owns
// credential verification, password hashing (Argon2id), the HaveIBeenPwned
// check, and TOTP MFA — entirely within this service. It NEVER becomes the
// app's session mechanism: every method below ends by minting AccreditMe's
// own hand-signed JWT and setting it as an httpOnly access_token cookie
// (plus a DB-backed refresh_token cookie), which is what TenantGuard already
// validates (commit 3's TenantGuard update) — completely unchanged from
// Better Auth's perspective.
//
// NOTE(Commit 5): loginAttemptService.isLocked()/record()/isNewIp() calls
// are intentionally NOT wired yet — LoginAttemptService does not exist until
// Commit 5. The plan's Section 8 "Login Sequence" describes the FINAL
// behavior after Commit 5 lands; this commit builds every other part of that
// sequence and leaves clearly marked TODO(Commit 5) call sites.

import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
// Aliased — the Fetch API's global `Response`/`Headers` (used for Better
// Auth's own auth.api.* results below) would otherwise collide with
// Express's same-named types used for the controller's req/res.
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { createHash, createHmac, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { createBetterAuthInstance } from '../../providers/auth/better-auth.config';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // matches CLAUDE.md's "JWT expiry: 15 minutes"
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // matches "Refresh token expiry: 7 days"

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

function signAccessToken(
  payload: { sub: string; organizationId: string; tokenVersion: number },
  secret: string,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const base64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  const headerB64 = base64url(header);
  const payloadB64 = base64url({ ...payload, exp });
  const signature = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  return `${headerB64}.${payloadB64}.${signature}`;
}

@Injectable()
export class AuthService {
  private readonly auth: ReturnType<typeof createBetterAuthInstance>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notificationService: NotificationService,
  ) {
    this.auth = createBetterAuthInstance(this.prisma, this.notificationService);
  }

  // Public only for use by other Commit-3-adjacent flows that need the same
  // namespacing rule (e.g. Commit 4's invite flow will construct AuthUser
  // rows the same way). See Section 8's "Why AuthUser.email Is Namespaced."
  static namespacedEmail(organizationId: string, email: string): string {
    return `${organizationId}:${email.toLowerCase()}`;
  }

  private async resolveOrganizationId(slug: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new UnauthorizedException('Invalid organization or credentials');
    return org.id;
  }

  private mintAccessToken(user: {
    id: string;
    organizationId: string;
    tokenVersion: number;
  }): string {
    const secret = process.env['JWT_SECRET'];
    if (!secret) throw new Error('JWT_SECRET is not configured');
    return signAccessToken(
      { sub: user.id, organizationId: user.organizationId, tokenVersion: user.tokenVersion },
      secret,
    );
  }

  private async issueRefreshToken(
    userId: string,
    organizationId: string,
    req: ExpressRequest,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        organizationId,
        tokenHash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
        deviceInfo: req.headers['user-agent'],
        ipAddress: req.ip,
      },
    });

    return rawToken;
  }

  private setSessionCookies(res: ExpressResponse, accessToken: string, refreshToken: string): void {
    const isProd = process.env['NODE_ENV'] === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
      // Scoped narrowly — the browser only ever sends this cookie back on
      // the one endpoint that needs it, per Section 12 Discussion 4.
      path: '/api/v1/auth/refresh',
    });
  }

  private clearSessionCookies(res: ExpressResponse): void {
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
  }

  // Shared tail for both the no-MFA login path and the post-verifyMfa path —
  // resolves the real AccreditMe User behind a Better Auth AuthUser id, mints
  // the JWT, issues + sets both cookies, and records the login.
  private async completeLogin(
    appUserId: string,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({ where: { id: appUserId } });
    if (!user) throw new UnauthorizedException('Invalid organization or credentials');
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    const accessToken = this.mintAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id, user.organizationId, req);
    this.setSessionCookies(res, accessToken, refreshToken);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: req.ip },
    });

    await this.auditLog.log({
      tenantId: user.organizationId,
      actorId: user.id,
      action: 'LOGIN',
      objectType: 'User',
      objectId: user.id,
      ipAddress: req.ip,
    });

    return { id: user.id, email: user.email, name: user.name };
  }

  async login(
    dto: LoginDto,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<{ success: true; user: PublicUser } | { mfaRequired: true }> {
    const organizationId = await this.resolveOrganizationId(dto.organizationSlug);
    const namespacedEmail = AuthService.namespacedEmail(organizationId, dto.email);

    // TODO(Commit 5): loginAttemptService.isLocked(organizationId, dto.email)
    // check goes here, BEFORE calling Better Auth at all.

    let result: Response;
    try {
      result = (await this.auth.api.signInEmail({
        body: { email: namespacedEmail, password: dto.password },
        asResponse: true,
      })) as unknown as Response;
    } catch {
      // TODO(Commit 5): loginAttemptService.record({ success: false, failureReason: 'invalid_password', ... })
      throw new UnauthorizedException('Invalid credentials');
    }

    const body = (await result.json()) as { twoFactorRedirect?: boolean; user?: { id: string } };

    if (body.twoFactorRedirect) {
      // Forward Better Auth's own two-factor-pending cookie to the browser —
      // it comes back automatically as a normal Cookie header on
      // /auth/mfa/verify, which is all verifyTOTP needs to find it.
      for (const cookie of result.headers.getSetCookie()) {
        res.append('Set-Cookie', cookie);
      }
      return { mfaRequired: true };
    }

    if (!body.user?.id) throw new UnauthorizedException('Invalid credentials');

    // AuthUser has no appUserId scalar of its own — User.authUserId is the
    // FK side of this 1:1 link (see Commit 1's schema).
    const appUser = await this.prisma.user.findFirst({ where: { authUserId: body.user.id } });
    if (!appUser) throw new UnauthorizedException('Invalid credentials');

    // TODO(Commit 5): loginAttemptService.record({ success: true, ... }) and
    // isNewIp() check -> NotificationService email if this is a new IP.
    const user = await this.completeLogin(appUser.id, req, res);
    return { success: true, user };
  }

  async verifyMfa(
    dto: VerifyMfaDto,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<{ success: true; user: PublicUser }> {
    let result: Response;
    try {
      result = (await this.auth.api.verifyTOTP({
        body: { code: dto.code },
        // Only the Cookie header matters here — Better Auth reads its own
        // two-factor-pending cookie from it (set during login() above).
        headers: new Headers({ cookie: req.headers.cookie ?? '' }),
        asResponse: true,
      })) as unknown as Response;
    } catch {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const body = (await result.json()) as { user?: { id: string } };
    if (!body.user?.id) throw new UnauthorizedException('Invalid or expired code');

    const appUser = await this.prisma.user.findFirst({ where: { authUserId: body.user.id } });
    if (!appUser) throw new UnauthorizedException('Invalid or expired code');

    const user = await this.completeLogin(appUser.id, req, res);
    return { success: true, user };
  }

  async refresh(req: ExpressRequest, res: ExpressResponse): Promise<{ success: true }> {
    const rawToken = req.cookies?.['refresh_token'] as string | undefined;
    if (!rawToken) throw new UnauthorizedException('Missing refresh token');

    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const existing = await this.prisma.refreshToken.findFirst({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate — revoke the presented token, issue a brand new one. Never
    // reuse a refresh token value across requests.
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findFirst({ where: { id: existing.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('This account is not active');
    }

    const accessToken = this.mintAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(user.id, user.organizationId, req);
    this.setSessionCookies(res, accessToken, newRefreshToken);

    return { success: true };
  }

  async logout(req: ExpressRequest, res: ExpressResponse): Promise<{ success: true }> {
    const rawToken = req.cookies?.['refresh_token'] as string | undefined;
    if (rawToken) {
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    this.clearSessionCookies(res);

    const authReq = req as ExpressRequest & { tenantId?: string; userId?: string };
    if (authReq.tenantId && authReq.userId) {
      await this.auditLog.log({
        tenantId: authReq.tenantId,
        actorId: authReq.userId,
        action: 'LOGOUT',
        objectType: 'User',
        objectId: authReq.userId,
        ipAddress: req.ip,
      });
    }

    return { success: true };
  }

  async acceptInvitation(dto: AcceptInvitationDto): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { invitationToken: dto.token },
    });

    if (!user || !user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
      // Deliberately generic — never reveal whether the token was ever valid.
      throw new BadRequestException('Invalid or expired invitation');
    }

    const namespacedEmail = AuthService.namespacedEmail(user.organizationId, user.email);

    const signUpResult = await this.auth.api.signUpEmail({
      body: { email: namespacedEmail, password: dto.password, name: user.name },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        authUserId: signUpResult.user.id,
        status: 'ACTIVE',
        invitationToken: null,
        invitationExpiresAt: null,
      },
    });

    await this.auditLog.log({
      tenantId: user.organizationId,
      actorId: user.id,
      action: 'UPDATE',
      objectType: 'User',
      objectId: user.id,
      metadata: { event: 'invitation_accepted' },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    // Never reveal whether the organization or the email exists within it —
    // resolve silently and no-op on failure rather than throwing.
    let organizationId: string;
    try {
      organizationId = await this.resolveOrganizationId(dto.organizationSlug);
    } catch {
      return;
    }

    const namespacedEmail = AuthService.namespacedEmail(organizationId, dto.email);

    try {
      await this.auth.api.requestPasswordReset({ body: { email: namespacedEmail } });
    } catch {
      // Better Auth already responds identically whether or not the email
      // exists (see requestPasswordReset's own timing-attack mitigation) —
      // swallow anything else so this endpoint never leaks existence either.
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    await this.auth.api.resetPassword({
      body: { newPassword: dto.password, token: dto.token },
    });
  }
}
