// TenantGuard — runs on every authenticated request.
//
// JWT contract (must match Better Auth configuration):
//   Algorithm : HS256 (HMAC-SHA256)
//   Secret    : JWT_SECRET env var
//   Claims    : { sub: userId, organizationId, tokenVersion, exp }
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

interface JwtPayload {
  sub: string;
  organizationId: string;
  tokenVersion: number;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
  userPermissions?: string[];
  // .cookies comes from @types/cookie-parser's Express.Request augmentation
  // (cookie-parser is mounted in main.ts) — no redeclaration needed here.
}

function verifyJwt(token: string, secret: string): JwtPayload {
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

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(PERMISSION_RESOLVER)
    private readonly permissionResolver: PermissionResolver,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    // Cookie first (browser clients — the login flow, Commit 3), then the
    // Authorization header (non-browser API clients that can't hold cookies).
    const cookieToken = request.cookies?.['access_token'] as string | undefined;
    const authHeader = request.headers['authorization'];
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = cookieToken ?? headerToken;

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const secret = process.env['JWT_SECRET'];

    if (!secret) throw new UnauthorizedException('Auth not configured');

    let payload: JwtPayload;
    try {
      payload = verifyJwt(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload.organizationId || !payload.sub) {
      throw new UnauthorizedException('Token missing required claims');
    }

    // tokenVersion check (Step 9) — a mismatch means this token was issued
    // before a deactivation/password-change/role-change bumped the stored
    // value; reject rather than trust a stale token until it naturally expires.
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, organizationId: payload.organizationId },
      select: { tokenVersion: true },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    request.tenantId = payload.organizationId;
    request.userId = payload.sub;
    request.userPermissions = await this.permissionResolver.getUserPermissions(
      payload.sub,
      payload.organizationId,
    );
    return true;
  }
}
