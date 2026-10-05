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
// Login attempt logging, account lockout, and new-IP notification (Commit 5)
// are wired in below via LoginAttemptService — see Section 8's "Login
// Sequence" for the full narrative this method follows exactly.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
// Aliased — the Fetch API's global `Response`/`Headers` (used for Better
// Auth's own auth.api.* results below) would otherwise collide with
// Express's same-named types used for the controller's req/res.
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { createHash, createHmac, randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { NotificationService } from '../notification/notification.service';
import { createBetterAuthInstance } from '../../providers/auth/better-auth.config';
import { LoginAttemptService } from './login-attempt.service';
// ACC-46 Section 2.1 — plain (non-forwardRef) import: AuthModule already
// imports UserModule directly (auth.module.ts's own comment confirms
// UserModule does not import AuthModule back), the same edge
// AuthController already uses. No new circularity.
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetupMfaDto } from './dto/setup-mfa.dto';
import { VerifySetupMfaDto } from './dto/verify-setup-mfa.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import {
  BETTER_AUTH_INVALID_CREDENTIALS,
  BETTER_AUTH_TWO_FACTOR_CODES,
} from './better-auth.contract';
import { AuthRefusalException } from './auth-refusal';
import { InvitationRefusalException } from './invitation-refusal';
import { INVITATION_TOKEN_SHAPE, isOpenInvitation } from './open-invitation';
import {
  attemptsRemaining,
  challengeIdentifierFromRequest,
  challengeIdentifierFromSetCookies,
  clearChallenge,
  loadChallenge,
  TWO_FACTOR_COOKIE_NAMES,
  twoFactorLockedUntil,
} from './two-factor-challenge';

// CLAUDE.md's "JWT expiry: 15 minutes". ACC-122 did NOT change it.
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * ACC-122 — the access-token lifetime, overridable ONLY for local testing.
 *
 * Silent renewal is, by construction, the thing you cannot see working: a
 * correct implementation looks exactly like a session that never expired.
 * Waiting fifteen real minutes to watch one renewal is not a test anybody
 * runs twice, so the browser pass runs the local backend at, say, 30 seconds
 * and watches several renewals in a couple of minutes.
 *
 * THE PRODUCTION VALUE IS UNCHANGED. With the variable unset — which is every
 * deployed environment, and the default locally — this is 15 * 60 exactly as
 * before. A value is only honoured when it parses as a positive integer, so a
 * typo falls back to the default rather than minting a zero-second token.
 *
 * Deliberately not wired to NODE_ENV: the override has to be something a
 * person sets on purpose for one run, not something that switches itself on
 * in an environment that merely looks non-production.
 *
 * IT CAN ONLY EVER SHORTEN. The value is clamped to the 15-minute default, so
 * a stray variable on a deployed environment cannot lengthen the access token
 * — to days, say — and quietly weaken every session on the platform. A
 * test-only affordance that can make production LESS safe is not test-only.
 * Shortening is harmless: a shorter token just renews more often.
 */
function resolveAccessTokenTtlSeconds(): number {
  const raw = process.env['AUTH_ACCESS_TOKEN_TTL_SECONDS'];
  if (!raw) return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  return Math.min(parsed, DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
}

export const ACCESS_TOKEN_TTL_SECONDS = resolveAccessTokenTtlSeconds();
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // matches "Refresh token expiry: 7 days"

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface MfaSetupResult {
  qrCodeDataUrl: string;
  secret: string;
  backupCodes: string[];
}

// Reduces a Fetch API Response's Set-Cookie headers down to the "name=value"
// pairs a subsequent request's Cookie header needs — discards attributes
// (Path, HttpOnly, Max-Age, ...) that only matter to a browser.
function buildCookieHeader(setCookieHeaders: string[]): string {
  return setCookieHeaders.map((raw) => raw.split(';')[0]).join('; ');
}

// Exported for PlatformTenantService's impersonation flow (ACC-13), which
// mints the same JWT shape with an added impersonatedBy claim rather than
// duplicating HS256 signing logic.
export function signAccessToken(
  payload: { sub: string; organizationId: string; tokenVersion: number; impersonatedBy?: string },
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

const MFA_SETUP_SESSION_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly auth: ReturnType<typeof createBetterAuthInstance>;

  // Bridges setupMfa() -> verifySetupMfa() without ever exposing Better
  // Auth's own session cookie to the browser (see this class's header
  // comment — Better Auth "NEVER becomes the app's session mechanism").
  // verifyTOTP requires a live Better Auth session for a non-sign-in caller
  // (confirmed by reading verify-two-factor.mjs's verifyTwoFactor()), so the
  // session established in setupMfa() for enableTwoFactor is held here just
  // long enough for the user to enter the 6-digit code, then discarded.
  //
  // Single-instance assumption: this is process-local. If AuthService ever
  // runs behind multiple horizontally-scaled instances without sticky
  // sessions, this needs to move to Redis (already available via BullMQ)
  // instead of an in-memory Map.
  private readonly pendingMfaSetupSessions = new Map<string, { cookie: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly notificationService: NotificationService,
    private readonly loginAttemptService: LoginAttemptService,
    private readonly userService: UserService,
  ) {
    this.auth = createBetterAuthInstance(this.prisma, this.notificationService);
  }

  // Public only for use by other Commit-3-adjacent flows that need the same
  // namespacing rule (e.g. Commit 4's invite flow will construct AuthUser
  // rows the same way). See Section 8's "Why AuthUser.email Is Namespaced."
  //
  // Uses RFC 5321 plus-addressing rather than a colon-delimited prefix so the
  // result is still a syntactically valid email address — Better Auth's own
  // routes (signUpEmail, signInEmail, requestPasswordReset) validate the body
  // with zod's z.email() and reject a colon in the local part.
  static namespacedEmail(organizationId: string, email: string): string {
    const [localPart, domain] = email.toLowerCase().split('@');
    return `${localPart}+${organizationId}@${domain}`;
  }

  private async resolveOrganizationId(slug: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    // The same refusal as no-such-user and wrong-password, byte for byte — see
    // AUTH_REFUSAL_MESSAGES. It cannot say which part was wrong.
    if (!org) throw new AuthRefusalException('INVALID_CREDENTIALS');
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

  // ACC-122 — tokenVersion is now recorded on the row. It is what lets
  // refresh() tell "this session predates a forced logout" from "this session
  // is current", which it could not do before: refresh tokens rotate, so the
  // row is the only place a session's origin can be written down.
  private async issueRefreshToken(
    userId: string,
    organizationId: string,
    tokenVersion: number,
    req: ExpressRequest,
  ): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        organizationId,
        tokenHash,
        tokenVersion,
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
  // the JWT, issues + sets both cookies, and records the login. Captures
  // lastLoginIp BEFORE overwriting it so isNewIp() has something to compare
  // against — see LoginAttemptService.isNewIp()'s own comment for why this
  // doesn't need a separate LoginAttempt query.
  //
  // ACC-120 slice 9b — THE ONE PLACE a successful sign-in is recorded, and only
  // once every check has passed. It used to be recorded in login() BEFORE this
  // method refused an inactive account, so a deactivated user with the right
  // password wrote a success — wiping the failure streak — and was then turned
  // away; and the MFA path recorded nothing at all, so a completed MFA sign-in
  // never reset the streak either. `attempt` is the (organization, email) key
  // the lockout counts by.
  private async completeLogin(
    appUserId: string,
    req: ExpressRequest,
    res: ExpressResponse,
    attempt: { organizationId: string; email: string },
  ): Promise<PublicUser & { language: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: appUserId } });
    if (!user) throw new AuthRefusalException('INVALID_CREDENTIALS');
    if (user.status !== 'ACTIVE') {
      // Reached here only on the MFA path, by an account deactivated while its
      // challenge was open — login() refuses an inactive account before it
      // issues one. Recorded as NEUTRAL, like login()'s refusal.
      await this.recordInactiveRefusal(attempt, req);
      throw new AuthRefusalException('ACCOUNT_INACTIVE');
    }

    await this.loginAttemptService.record({
      organizationId: attempt.organizationId,
      email: attempt.email,
      success: true,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const wasNewIp = this.loginAttemptService.isNewIp(user.lastLoginIp, req.ip);

    const accessToken = this.mintAccessToken(user);
    const refreshToken = await this.issueRefreshToken(
      user.id,
      user.organizationId,
      user.tokenVersion,
      req,
    );
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

    if (wasNewIp) {
      await this.notificationService.create(
        {
          userId: user.id,
          titleEn: 'New sign-in to your AccreditMe account',
          titleAr: 'تسجيل دخول جديد إلى حسابك في AccreditMe',
          bodyEn: `We noticed a sign-in from a new IP address (${req.ip ?? 'unknown'}). If this wasn't you, reset your password immediately.`,
          bodyAr: `لاحظنا تسجيل دخول من عنوان IP جديد (${req.ip ?? 'غير معروف'}). إذا لم يكن هذا أنت، فأعد تعيين كلمة المرور فورًا.`,
          channel: 'EMAIL',
        },
        user.organizationId,
      );
    }

    // ACC-19 — resolved and returned alongside the login response (not just
    // GET /auth/me) so a saved preference applies immediately on a fresh
    // login, not only after a subsequent page-refresh restoreSession().
    const language = await this.resolveLanguage(user.language, user.organizationId);
    return { id: user.id, email: user.email, name: user.name, language };
  }

  async login(
    dto: LoginDto,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<
    | { success: true; user: PublicUser; language: string }
    | { mfaRequired: true; mfaExpiresAt?: string }
  > {
    const organizationId = await this.resolveOrganizationId(dto.organizationSlug);
    const namespacedEmail = AuthService.namespacedEmail(organizationId, dto.email);

    if (await this.loginAttemptService.isLocked(organizationId, dto.email)) {
      await this.loginAttemptService.record({
        organizationId,
        email: dto.email,
        success: false,
        failureReason: 'locked',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      // Read AFTER recording: the attempt just written is itself a failure and
      // moves the lock later (LoginAttemptService.lockedUntil()). Checked BEFORE
      // the password and computed from (organization, email) rows alone, so it
      // reads the same for an email that has no account.
      const lockedUntil = await this.loginAttemptService.lockedUntil(
        organizationId,
        dto.email,
      );
      throw new AuthRefusalException('ACCOUNT_LOCKED', {
        lockedUntil: lockedUntil ?? new Date(),
      });
    }

    // ACC-120 slice 9b — Better Auth does NOT throw a refused sign-in. With
    // `asResponse: true` its dispatcher RETURNS an APIError as a Response
    // (better-auth/dist/api/dispatch.mjs: `isAPIError(result.response) &&
    // !shouldReturnResponse` is the only branch that throws), so a wrong
    // password arrives here as a 401 Response with
    // `code: 'INVALID_EMAIL_OR_PASSWORD'`. This used to be a try/catch around
    // the call, recording the failure in the catch — which therefore never ran:
    // no failed sign-in had ever been recorded, so the lockout never locked.
    // Measured on dev before the fix: 115 LoginAttempt rows, every one a
    // success. The contract spec pins the dispatcher's behaviour.
    //
    // So the outcome is read off the Response. ONLY Better Auth's own
    // invalid-email-or-password refusal counts as a failed sign-in. Anything
    // else — another refusal code, or a thrown error (a database outage, say) —
    // is not a credential problem: it propagates as a 500 and records NO
    // failure, so an outage cannot lock real people out.
    const result = await this.auth.api.signInEmail({
      body: { email: namespacedEmail, password: dto.password },
      asResponse: true,
    });

    const body = (await result.json()) as {
      twoFactorRedirect?: boolean;
      user?: { id: string };
      code?: string;
    };

    if (!result.ok) {
      if (
        result.status === 401 &&
        body.code === BETTER_AUTH_INVALID_CREDENTIALS
      ) {
        await this.loginAttemptService.record({
          organizationId,
          email: dto.email,
          success: false,
          failureReason: 'invalid_password',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
        throw new AuthRefusalException('INVALID_CREDENTIALS');
      }
      // Status and code only — never the body, which could echo the request.
      throw new Error(
        `Better Auth sign-in returned ${result.status}${body.code ? ` ${body.code}` : ''}`,
      );
    }

    // The password is correct. Resolve the person BEFORE deciding anything
    // else, on both paths: Better Auth's MFA response carries no user, so the
    // namespaced email is the one key both paths have. Scoped by organization;
    // AuthUser.email is unique, so this is one row or none.
    const appUser = await this.prisma.user.findFirst({
      where: { organizationId, authUser: { email: namespacedEmail } },
    });
    if (!appUser) throw new AuthRefusalException('INVALID_CREDENTIALS');

    // An inactive account is refused here — after the password, so the refusal
    // discloses nothing to someone who does not know it, and BEFORE any MFA
    // challenge is handed over, so a deactivated person is not asked for a code
    // they can never use. Recorded as NEUTRAL: it neither counts towards the
    // lock nor resets it (LoginAttemptService.NEUTRAL_FAILURE_REASONS).
    if (appUser.status !== 'ACTIVE') {
      await this.recordInactiveRefusal(
        { organizationId, email: dto.email },
        req,
      );
      throw new AuthRefusalException('ACCOUNT_INACTIVE');
    }

    if (body.twoFactorRedirect) {
      // Forward Better Auth's own two-factor-pending cookie to the browser —
      // it comes back automatically as a normal Cookie header on
      // /auth/mfa/verify, which is all verifyTOTP needs to find it. Nothing is
      // recorded yet: the sign-in is not complete until verifyMfa() succeeds.
      const setCookies = result.headers.getSetCookie();
      for (const cookie of setCookies) {
        res.append('Set-Cookie', cookie);
      }
      // ACC-120 slice 9b — when the challenge ends, read from the challenge
      // row itself rather than assumed from a constant. Omitted, with a
      // warning, if the challenge cannot be read: a missing display hint must
      // not refuse a sign-in whose password was right.
      const identifier = challengeIdentifierFromSetCookies(setCookies);
      const challenge = identifier
        ? await loadChallenge(this.prisma, identifier)
        : null;
      if (!challenge) {
        this.logger.warn(
          'MFA challenge issued but not readable; mfaExpiresAt omitted',
        );
        return { mfaRequired: true };
      }
      return {
        mfaRequired: true,
        mfaExpiresAt: challenge.expiresAt.toISOString(),
      };
    }

    // A 200 with neither a challenge nor a user is not a shape Better Auth
    // documents — a fault, not a refusal.
    if (!body.user?.id)
      throw new Error('Better Auth sign-in returned 200 without a user');

    const { language, ...user } = await this.completeLogin(
      appUser.id,
      req,
      res,
      {
        organizationId,
        email: dto.email,
      },
    );
    return { success: true, user, language };
  }

  // ACC-120 slice 9b — an inactive account's refused sign-in, written down but
  // NEUTRAL for the lock. See NEUTRAL_FAILURE_REASONS.
  private async recordInactiveRefusal(
    attempt: { organizationId: string; email: string },
    req: ExpressRequest,
  ): Promise<void> {
    await this.loginAttemptService.record({
      organizationId: attempt.organizationId,
      email: attempt.email,
      success: false,
      failureReason: 'account_inactive',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  async verifyMfa(
    dto: VerifyMfaDto,
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<{ success: true; user: PublicUser; language: string }> {
    // ACC-120 slice 9b — like signInEmail, verifyTOTP RETURNS a refusal as a
    // Response rather than throwing it, so the outcome is read off the
    // Response. A thrown error is a fault and propagates as a 500.
    const result = await this.auth.api.verifyTOTP({
      body: { code: dto.code },
      // Only the Cookie header matters here — Better Auth reads its own
      // two-factor-pending cookie from it (set during login() above).
      headers: new Headers({ cookie: req.headers.cookie ?? '' }),
      asResponse: true,
    });

    const body = (await result.json()) as {
      user?: { id: string };
      code?: string;
    };
    if (!result.ok) throw await this.mfaRefusal(result.status, body.code, req);
    if (!body.user?.id)
      throw new Error('Better Auth verifyTOTP returned 200 without a user');

    const appUser = await this.prisma.user.findFirst({ where: { authUserId: body.user.id } });
    if (!appUser) throw new AuthRefusalException('INVALID_CREDENTIALS');

    // The lockout's key for this person: their organization, and their email
    // as login() normalised it (LoginDto lower-cases it; the stored email is
    // lower-cased the same way here so the two always agree).
    const { language, ...user } = await this.completeLogin(
      appUser.id,
      req,
      res,
      {
        organizationId: appUser.organizationId,
        email: appUser.email.toLowerCase(),
      },
    );
    return { success: true, user, language };
  }

  // ACC-120 slice 9b — abandon a pending MFA challenge. The challenge is real
  // server-side state (two AuthVerification rows, live for ten minutes) that
  // anyone at the same browser could still complete with a code, and Better
  // Auth's own routes are not mounted, so nothing else can clear it.
  //
  // Only the caller's OWN challenge can be cleared: the identifier comes from
  // the cookie this browser holds, and only once its Better Auth signature
  // verifies (two-factor-challenge.ts). Always succeeds — there being nothing
  // to cancel is not an error, and saying so would tell a caller whether a
  // challenge existed.
  async cancelMfa(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<{ success: true }> {
    const identifier = challengeIdentifierFromRequest(req.headers.cookie);
    if (identifier) await clearChallenge(this.prisma, identifier);
    for (const name of TWO_FACTOR_COOKIE_NAMES) {
      res.clearCookie(name, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: name.startsWith('__Secure-'),
      });
    }
    return { success: true };
  }

  // ACC-120 slice 9b — Better Auth's MFA refusal, as one of ours. Every one is a
  // 401, as `verifyMfa()` returned before. Anything not listed is a fault.
  private async mfaRefusal(
    status: number,
    code: string | undefined,
    req: ExpressRequest,
  ): Promise<Error> {
    const identifier = challengeIdentifierFromRequest(req.headers.cookie);
    const challenge = identifier
      ? await loadChallenge(this.prisma, identifier)
      : null;

    switch (code) {
      case BETTER_AUTH_TWO_FACTOR_CODES.INVALID_CODE:
        // The challenge is live, and its counter has just moved.
        if (!challenge) return new AuthRefusalException('MFA_EXPIRED');
        return new AuthRefusalException('MFA_INVALID', {
          attemptsRemaining: await attemptsRemaining(this.prisma, challenge),
        });
      case BETTER_AUTH_TWO_FACTOR_CODES.INVALID_TWO_FACTOR_COOKIE:
      case BETTER_AUTH_TWO_FACTOR_CODES.TOO_MANY_ATTEMPTS:
        // Missing, tampered with, expired, or spent: either way there is no
        // challenge left to answer, and the way on is to sign in again.
        return new AuthRefusalException('MFA_EXPIRED');
      case BETTER_AUTH_TWO_FACTOR_CODES.ACCOUNT_LOCKED: {
        // Reached only after a correct password, so it discloses nothing about
        // whether the account exists.
        const lockedUntil = challenge
          ? await twoFactorLockedUntil(this.prisma, challenge.authUserId)
          : null;
        return new AuthRefusalException('ACCOUNT_LOCKED', {
          lockedUntil: lockedUntil ?? new Date(),
        });
      }
      default:
        return new Error(
          `Better Auth verifyTOTP returned ${status}${code ? ` ${code}` : ''}`,
        );
    }
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

    // ACC-122 — THE FORCED LOGOUT, MADE TRUE BY CONSTRUCTION.
    //
    // TenantGuard rejects an access token whose tokenVersion is stale
    // (tenant.guard.ts). Before silent renewal that was the whole story: the
    // user's next request 401'd and the frontend signed them out. With
    // renewal, a 401 is no longer the end of anything — the client refreshes
    // and retries — so without this check refresh() would mint a token
    // carrying the CURRENT version and the forced logout would silently stop
    // working.
    //
    // It did not bite today only by coincidence: invalidateUserSessions() has
    // exactly one caller, UserService.deactivate(), which also flips status to
    // INACTIVE, and the check above catches that. But tenant.guard.ts's own
    // comment says the mechanism is also meant to cover a password change, and
    // the first caller that bumps the version WITHOUT deactivating would have
    // reopened the hole with nothing failing to say so.
    //
    // NULL means the row was written before this column existed. Treated as
    // "unknown", which falls back to the status check — exactly the behaviour
    // that shipped before. Refusing nulls would sign out every logged-in user
    // the moment the migration ran, for no security gain, and rows rotate on
    // every refresh so nulls disappear within one refresh cycle.
    // `?? null` rather than a bare `!== null`: a row read through a narrower
    // `select` would give undefined, and a strict null comparison would then
    // reject EVERY refresh — failing closed in the one direction that signs
    // out the whole tenant. Unknown is unknown however it is spelt.
    const issuedAtVersion = existing.tokenVersion ?? null;
    if (issuedAtVersion !== null && issuedAtVersion !== user.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    const accessToken = this.mintAccessToken(user);
    const newRefreshToken = await this.issueRefreshToken(
      user.id,
      user.organizationId,
      user.tokenVersion,
      req,
    );
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

  // ACC-120 slice 9c — the ONE way an invitation is found by its token, shared
  // by the lookup and accept-invitation. One query, with the organisation
  // joined, so every outcome — no row, expired, deactivated, closed tenant,
  // open — costs the same round trip and is decided in memory afterwards: the
  // response time cannot tell "no such token" from "found but refused".
  //
  // Not scoped by organizationId, deliberately: this runs before anyone is
  // signed in, and the token — 192 random bits, unique across all tenants — IS
  // the key. The organisation comes from the row, never from the caller.
  private findInvitation(token: string) {
    return this.prisma.user.findFirst({
      where: { invitationToken: token },
      include: {
        organization: { select: { name: true, nameAr: true, status: true } },
      },
    });
  }

  // ACC-120 slice 9c — which organisation is inviting this person, for the
  // Accept invitation page. Read-only: it never consumes, extends or changes the
  // invitation.
  //
  // Returns EXACTLY { name, nameAr } — no email, inviter, role, slug or logo.
  // Every other case gets the one InvitationRefusalException body, byte for
  // byte: unknown, expired, used, revoked, deactivated invitee, closed tenant,
  // and any body that is not exactly `{ token: <48 hex> }`.
  //
  // The body arrives `unknown`, on purpose. With a DTO class the global
  // ValidationPipe (whitelist + forbidNonWhitelisted) would answer a malformed
  // body itself, with its own message — a second refusal shape. A plain object
  // type is not validated by the pipe at all, so the shape check is here, and a
  // bad shape is refused exactly like a bad token.
  async lookupInvitation(
    body: unknown,
  ): Promise<{ name: string; nameAr: string | null }> {
    const token =
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1
        ? (body as Record<string, unknown>)['token']
        : undefined;
    if (typeof token !== 'string' || !INVITATION_TOKEN_SHAPE.test(token)) {
      throw new InvitationRefusalException();
    }

    const invitation = await this.findInvitation(token);
    if (!isOpenInvitation(invitation, new Date())) {
      throw new InvitationRefusalException();
    }
    return {
      name: invitation.organization.name,
      nameAr: invitation.organization.nameAr,
    };
  }

  async acceptInvitation(dto: AcceptInvitationDto): Promise<void> {
    const user = await this.findInvitation(dto.token);

    if (!user || !user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
      // Deliberately generic — never reveal whether the token was ever valid.
      throw new BadRequestException('Invalid or expired invitation');
    }

    const namespacedEmail = AuthService.namespacedEmail(user.organizationId, user.email);

    // ACC-46 Section 2.1, Layer 2 — defense in depth on top of Layer 1
    // (validateSingleAssigneeCap()/validateUnitHeadUniqueness() now
    // counting INVITED alongside ACTIVE). Closes the narrower race Layer 1
    // alone can't: two invites whose validatePositionAssignment() calls
    // both read the conflict count before either row commits. Placed
    // BEFORE signUpEmail() deliberately — a rejection here must have zero
    // side effects: no Better Auth account created, the User row
    // untouched (still INVITED, token intact, preserved for retry rather
    // than burned like the generic invalid/expired case above, since the
    // conflict may resolve on its own). excludeUserId: user.id is what
    // makes this safe to call unconditionally on every acceptance, not
    // just the racing ones — the accepting user's own INVITED row (now
    // counted per Layer 1) is excluded from its own conflict check, so an
    // ordinary, uncontested acceptance still passes.
    if (user.positionId) {
      try {
        await this.userService.validatePositionAssignment(
          user.positionId,
          user.primaryOrgUnitId,
          user.organizationId,
          user.id,
        );
      } catch {
        await this.userService.notifyTenantAdminsOfInviteAcceptanceConflict(user.name, user.organizationId);
        throw new ConflictException(
          'This position is no longer available in this org unit — contact your administrator',
        );
      }
    }

    // Unlike login() (Section 8's deliberate anti-enumeration behavior —
    // always the same generic "Invalid credentials" regardless of the real
    // reason), there is no equivalent enumeration concern here: the caller
    // already proved possession of a valid, unexpired invitation token
    // before reaching this point. A real Better Auth APIError (e.g. the
    // haveIBeenPwned plugin's PASSWORD_COMPROMISED) carries a genuinely
    // useful message the user needs to act on — this is allowed to throw
    // naturally now (ACC-27): the global HttpExceptionFilter's isAPIError()
    // branch forwards a real APIError's own safe message for the whole app,
    // not just this one call site, using the exact same class-identity
    // check this local try/catch used to do itself.
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

    // ACC-82 — now ACTIVE, the user counts as their unit's Head if their
    // position confers it. invite() refreshed the unit while they were INVITED
    // (not counted), so without this the unit stayed flagged vacant.
    //
    // A failure here must not fail the acceptance: the account is already
    // active, and SlaMonitorProcessor recomputes every active unit's vacancy on
    // its next pass, so the flag is corrected within 15 minutes regardless.
    try {
      await this.userService.refreshHeadVacancyAfterActivation(user);
    } catch (err) {
      this.logger.error(
        `Head vacancy refresh after accepting an invitation failed for user ${user.id}; the next SLA sweep will correct it.`,
        err instanceof Error ? err.stack : undefined,
      );
    }

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

  // Re-verifies the password via signInEmail to obtain a fresh Better Auth
  // session (enableTwoFactor requires one — see this class's
  // pendingMfaSetupSessions field comment), then calls enableTwoFactor with
  // that session to generate + store a new TOTP secret. MFA is NOT active
  // yet after this call — twoFactor.verified stays false, and
  // AuthUser.twoFactorEnabled stays false, until verifySetupMfa() succeeds.
  async setupMfa(userId: string, organizationId: string, dto: SetupMfaDto): Promise<MfaSetupResult> {
    const appUser = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!appUser) throw new UnauthorizedException('Invalid credentials');

    const namespacedEmail = AuthService.namespacedEmail(organizationId, appUser.email);

    // ACC-120 slice 9b — the password is re-checked with a sign-in, and Better
    // Auth RETURNS that sign-in's refusal as a Response rather than throwing
    // it (see login()). So the outcome is read off the Response, one case at a
    // time; nothing here relies on a missing user meaning "wrong password".
    const signInResult = await this.auth.api.signInEmail({
      body: { email: namespacedEmail, password: dto.password },
      asResponse: true,
    });
    const signInBody = (await signInResult.json()) as {
      user?: { id: string };
      twoFactorRedirect?: boolean;
      code?: string;
    };

    if (!signInResult.ok) {
      if (
        signInResult.status === 401 &&
        signInBody.code === BETTER_AUTH_INVALID_CREDENTIALS
      ) {
        throw new UnauthorizedException('Invalid password');
      }
      // Not a password problem — a fault. Nothing has been enabled.
      throw new Error(
        `Better Auth sign-in returned ${signInResult.status}${signInBody.code ? ` ${signInBody.code}` : ''}`,
      );
    }
    // Better Auth answers a correct password for an account with MFA already
    // on with a challenge instead of a session: there is nothing to set up.
    if (signInBody.twoFactorRedirect) {
      throw new ConflictException('MFA is already enabled');
    }
    if (!signInBody.user?.id) {
      throw new Error('Better Auth sign-in returned 200 without a user');
    }

    const sessionCookie = buildCookieHeader(signInResult.headers.getSetCookie());

    let enableResult: { totpURI: string; backupCodes: string[] };
    try {
      enableResult = (await this.auth.api.enableTwoFactor({
        body: { password: dto.password },
        headers: new Headers({ cookie: sessionCookie }),
      })) as { totpURI: string; backupCodes: string[] };
    } catch {
      throw new BadRequestException('Failed to enable two-factor authentication');
    }

    const secret = new URL(enableResult.totpURI).searchParams.get('secret');
    if (!secret) throw new Error('Better Auth did not return a TOTP secret in the totpURI');

    const qrCodeDataUrl = await QRCode.toDataURL(enableResult.totpURI);

    this.pendingMfaSetupSessions.set(appUser.id, {
      cookie: sessionCookie,
      expiresAt: Date.now() + MFA_SETUP_SESSION_TTL_MS,
    });

    return { qrCodeDataUrl, secret, backupCodes: enableResult.backupCodes };
  }

  // Confirms the code generated from the secret shown by setupMfa(), using
  // the Better Auth session bridged through pendingMfaSetupSessions. Success
  // flips AuthUser.twoFactorEnabled to true (handled entirely inside Better
  // Auth's verifyTOTP — see totp/index.mjs).
  async verifySetupMfa(userId: string, organizationId: string, dto: VerifySetupMfaDto): Promise<void> {
    const appUser = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!appUser) throw new UnauthorizedException('Invalid credentials');

    const pending = this.pendingMfaSetupSessions.get(appUser.id);
    if (!pending || pending.expiresAt < Date.now()) {
      this.pendingMfaSetupSessions.delete(appUser.id);
      throw new BadRequestException('MFA setup session expired — restart setup');
    }

    try {
      await this.auth.api.verifyTOTP({
        body: { code: dto.code },
        headers: new Headers({ cookie: pending.cookie }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired code');
    }

    this.pendingMfaSetupSessions.delete(appUser.id);

    await this.auditLog.log({
      tenantId: organizationId,
      actorId: appUser.id,
      action: 'UPDATE',
      objectType: 'User',
      objectId: appUser.id,
      metadata: { event: 'mfa_enabled' },
    });
  }

  // Same re-auth pattern as setupMfa() — disableTwoFactor also requires a
  // live Better Auth session and the caller's password.
  async disableMfa(userId: string, organizationId: string, dto: DisableMfaDto): Promise<void> {
    const appUser = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!appUser) throw new UnauthorizedException('Invalid credentials');

    const namespacedEmail = AuthService.namespacedEmail(organizationId, appUser.email);

    let signInResult: Response;
    try {
      signInResult = (await this.auth.api.signInEmail({
        body: { email: namespacedEmail, password: dto.password },
        asResponse: true,
      })) as unknown as Response;
    } catch {
      throw new UnauthorizedException('Invalid password');
    }

    const signInBody = (await signInResult.json()) as { user?: { id: string } };
    if (!signInBody.user?.id) throw new UnauthorizedException('Invalid password');

    const sessionCookie = buildCookieHeader(signInResult.headers.getSetCookie());

    try {
      await this.auth.api.disableTwoFactor({
        body: { password: dto.password },
        headers: new Headers({ cookie: sessionCookie }),
      });
    } catch {
      throw new BadRequestException('Failed to disable two-factor authentication');
    }

    await this.auditLog.log({
      tenantId: organizationId,
      actorId: appUser.id,
      action: 'UPDATE',
      objectType: 'User',
      objectId: appUser.id,
      metadata: { event: 'mfa_disabled' },
    });
  }

  async getMfaStatus(userId: string, organizationId: string): Promise<{ enabled: boolean }> {
    const appUser = await this.prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!appUser?.authUserId) return { enabled: false };

    const authUser = await this.prisma.authUser.findUnique({ where: { id: appUser.authUserId } });
    return { enabled: authUser?.twoFactorEnabled ?? false };
  }

  // ACC-19 — used by AuthController.getMe() to resolve the effective
  // language for session bootstrap: the user's own saved preference if
  // set, otherwise the tenant's configured default (Organization.language,
  // CLAUDE.md's "defaulted from tenant config"), otherwise 'en'.
  async resolveLanguage(userLanguage: string | null, organizationId: string): Promise<string> {
    if (userLanguage) return userLanguage;
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { language: true },
    });
    return org?.language ?? 'en';
  }

  // ACC-13 — deliberately cross-tenant, no organizationId filter. Used only
  // by AuthController.getMe() to resolve the display info of the platform
  // admin currently impersonating the caller (a different org than the
  // caller's own) — UserService.getById() can't be used here since it's
  // tenant-scoped by design.
  async getPublicUserById(userId: string): Promise<PublicUser | null> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name };
  }
}
