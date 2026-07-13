// TenantGuard — runs on every authenticated request.
//
// JWT contract (must match Better Auth configuration):
//   Algorithm : HS256 (HMAC-SHA256)
//   Secret    : JWT_SECRET env var
//   Claims    : { sub: userId, organizationId, tokenVersion, exp }
//
// Better Auth setup requirement (Step 1 / Step 9):
//   Configure Better Auth with `jwt: { algorithm: 'HS256', secret: process.env.JWT_SECRET }`
//   so that issued tokens are verifiable by this guard. Any algorithm mismatch
//   will cause all requests to fail with 401.
//
// tokenVersion check (activated in Step 9 — Users module):
//   Increment User.tokenVersion on role change or forced logout.
//   This guard will then reject tokens carrying a stale tokenVersion.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { Request } from 'express';

interface JwtPayload {
  sub: string;
  organizationId: string;
  tokenVersion: number;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
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
  canActivate(ctx: ExecutionContext): boolean {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.slice(7);
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

    // TODO(Step 9 — Users): validate payload.tokenVersion against
    // User.tokenVersion in DB to enforce forced-logout on role change.

    request.tenantId = payload.organizationId;
    request.userId = payload.sub;
    return true;
  }
}
