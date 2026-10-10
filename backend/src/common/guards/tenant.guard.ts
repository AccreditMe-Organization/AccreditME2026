// TenantGuard — runs on every authenticated request.
//
// JWT contract (must match Better Auth configuration):
//   Algorithm : HS256 (HMAC-SHA256)
//   Secret    : JWT_SECRET env var
//   Claims    : { sub: userId, organizationId, tokenVersion, exp,
//                 impersonatedBy? } — the last one only ever present on a
//                 platform admin's impersonation session (ACC-13).
//
// Token source (Step 9 — Users, Section 12 Discussion 4): reads the
// access_token httpOnly cookie first, falling back to the Authorization
// header for non-browser API clients that can't hold cookies (a future
// Phase 3 public API). This is the ONLY change to how the raw token string
// is obtained — verifyJwt() itself, and everything after it, is unchanged.
// Better Auth (Commit 3's AuthController) mints this exact JWT shape after
// its own credential verification succeeds; it never issues Better Auth's
// own session token to the app.
//
// tokenVersion check (Step 9 — Users, Section 12 Discussion 1):
//   After signature/expiry verification succeeds, compares payload.tokenVersion
//   against the current User.tokenVersion in the DB. A mismatch means the
//   user was deactivated, changed their password, or had their role changed
//   since this JWT was issued — reject immediately rather than waiting for
//   natural (15-minute) expiry. This is the one DB read added to this guard;
//   nothing else about its logic changes.
//
// Permission resolution (Step 4 — Roles):
//   After JWT verification, resolves the user's permission set via the
//   PERMISSION_RESOLVER token and attaches it to the request for PermissionGuard.

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PERMISSION_RESOLVER,
  PermissionResolver,
} from '../services/permission-resolver.interface';
import { isOrganizationOpen } from '../tenant/organization-status';
import type { TenantStatus } from '../../../generated/prisma/client';
import { AuthRefusalException } from '../../foundation/auth/auth-refusal';

export interface JwtPayload {
  sub: string;
  organizationId: string;
  tokenVersion: number;
  exp: number;
  // ACC-13 — present only on a platform admin's impersonation session (see
  // PlatformTenantService.startImpersonation()). Absent on every normal login.
  impersonatedBy?: string;
}

interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
  userPermissions?: string[];
  impersonatedBy?: string;
  // .cookies comes from @types/cookie-parser's Express.Request augmentation
  // (cookie-parser is mounted in main.ts) — no redeclaration needed here.
}

/**
 * The session token a request carries: the access_token cookie first (browser
 * clients), then a Bearer header (API clients that cannot hold cookies).
 * Exported for the rate limiter (ACC-129), which must identify a signed-in user
 * the same way this guard does, and runs before it.
 */
export function readSessionToken(request: {
  cookies?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const cookieToken = request.cookies?.['access_token'];
  if (typeof cookieToken === 'string' && cookieToken) return cookieToken;
  const authHeader = request.headers['authorization'];
  return typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;
}

/** Exported for the rate limiter (ACC-129); see readSessionToken(). */
export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (expected !== signatureB64) throw new Error('Invalid signature');

  const payload = JSON.parse(
    Buffer.from(payloadB64, 'base64url').toString('utf8'),
  ) as JwtPayload;

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('Token expired');
  }

  return payload;
}

/** Why a request's access token does not prove who is calling. */
export type SessionIdentityRefusal =
  | 'missing'
  | 'not_configured'
  | 'invalid'
  | 'claims'
  | 'revoked';

/** Who a valid access token proves the caller is. */
export interface SessionIdentity {
  userId: string;
  organizationId: string;
  impersonatedBy?: string;
  organizationStatus: TenantStatus;
}

export type SessionIdentityResult =
  | { ok: true; identity: SessionIdentity }
  | { ok: false; refusal: SessionIdentityRefusal };

/**
 * Who the request's access token proves the caller is — ACC-203.
 *
 * THE one place this is decided, for TenantGuard and for sign-out. Sign-out is
 * public (it must work after the access cookie has expired), but when a valid
 * access token IS present its audit entry names that person, and "valid" must
 * mean exactly what it means to the guard: the signature and expiry verify, the
 * claims are there, and the user still exists in that organisation with the
 * same tokenVersion. A copy would drift.
 *
 * Deliberately NOT here: the closed-organisation refusal and the permission
 * lookup. Those decide whether a request may PROCEED, which is the guard's
 * business; signing out of a closed organisation must still work.
 *
 * One query, the same one the guard always made.
 */
export async function verifySessionIdentity(
  request: {
    cookies?: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
  },
  prisma: Pick<PrismaService, 'user'>,
): Promise<SessionIdentityResult> {
  // Cookie first (browser clients — the login flow, Commit 3), then the
  // Authorization header (non-browser API clients that can't hold cookies).
  const token = readSessionToken(request);
  if (!token) return { ok: false, refusal: 'missing' };

  const secret = process.env['JWT_SECRET'];
  if (!secret) return { ok: false, refusal: 'not_configured' };

  let payload: JwtPayload;
  try {
    payload = verifyJwt(token, secret);
  } catch {
    return { ok: false, refusal: 'invalid' };
  }

  if (!payload.organizationId || !payload.sub) {
    return { ok: false, refusal: 'claims' };
  }

  // tokenVersion check (Step 9) — a mismatch means this token was issued
  // before a deactivation bumped the stored value (UserService.deactivate()
  // is the only caller of AuthProvider.invalidateUserSessions() today);
  // reject rather than trust a stale token until it naturally expires.
  // Role/permission changes do NOT bump tokenVersion (role.service.ts has
  // zero tokenVersion/invalidateUserSessions references), so a user whose
  // role changes is NOT signed out — their session stays valid until the
  // token expires.
  //
  // CORRECTED (ACC-101): this comment used to add "keeps full access for up
  // to 15 minutes", which was wrong. It conflated session validity with
  // authorization. The JWT carries no permissions; the permission set is
  // resolved from the database a few lines below, on EVERY request. A
  // revocation therefore applies on the very next request — the JWT
  // authenticates, it does not authorize. Verified live in one unbroken
  // session: my-permissions went from ["roles:view"] to [], the endpoint
  // from 200 to 403, /auth/me stayed 200. See SYSTEM-REFERENCE §1.2.
  //
  // ACC-168 — the organisation's status is joined into this SAME query, so
  // refusing a closed organisation costs no extra round trip: one primary-key
  // join on a query that already runs on every request. A closed
  // organisation's sessions therefore stop at the next request, and start
  // working again the moment it reopens — no token is revoked, so there is
  // nothing to reissue. Not exempted for the platform organisation: the rule
  // stays one rule, and the platform organisation cannot be closed
  // (PlatformTenantService.suspendTenant()).
  const user = await prisma.user.findFirst({
    where: { id: payload.sub, organizationId: payload.organizationId },
    select: {
      tokenVersion: true,
      organization: { select: { status: true } },
    },
  });

  if (!user || user.tokenVersion !== payload.tokenVersion) {
    return { ok: false, refusal: 'revoked' };
  }

  return {
    ok: true,
    identity: {
      userId: payload.sub,
      organizationId: payload.organizationId,
      ...(payload.impersonatedBy
        ? { impersonatedBy: payload.impersonatedBy }
        : {}),
      organizationStatus: user.organization.status,
    },
  };
}

/** TenantGuard's refusal for each reason — the messages its callers and specs rely on. */
const REFUSAL_MESSAGES: Record<SessionIdentityRefusal, string> = {
  missing: 'Missing bearer token',
  not_configured: 'Auth not configured',
  invalid: 'Invalid or expired token',
  claims: 'Token missing required claims',
  revoked: 'Session has been revoked',
};

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(PERMISSION_RESOLVER)
    private readonly permissionResolver: PermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    // ACC-203 — who the token proves the caller is, decided in the one place
    // sign-out shares (verifySessionIdentity, above).
    const result = await verifySessionIdentity(request, this.prisma);
    if (!result.ok) {
      throw new UnauthorizedException(REFUSAL_MESSAGES[result.refusal]);
    }
    const { identity } = result;

    if (!isOrganizationOpen(identity.organizationStatus)) {
      throw new AuthRefusalException('ORGANIZATION_UNAVAILABLE');
    }

    request.tenantId = identity.organizationId;
    request.userId = identity.userId;
    request.userPermissions = await this.permissionResolver.getUserPermissions(
      identity.userId,
      identity.organizationId,
    );
    // ACC-13 — passthrough only, no behavior change to this guard otherwise.
    if (identity.impersonatedBy) {
      request.impersonatedBy = identity.impersonatedBy;
    }
    return true;
  }
}
